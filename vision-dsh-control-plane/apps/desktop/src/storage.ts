import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { CostBreakdown, Observation, PricingSnapshot, RequestRecord, redact } from './core.js';

export class VisionStore {
  readonly db: DatabaseSync;
  constructor(file = path.resolve(process.cwd(), 'vision.db')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }
  private migrate(): void {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY, name TEXT NOT NULL, vendor TEXT NOT NULL, base_url TEXT NOT NULL, protocol TEXT NOT NULL, credential_ref TEXT, enabled INTEGER NOT NULL DEFAULT 1, capabilities TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS models(id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, name TEXT NOT NULL, billing_model TEXT NOT NULL, FOREIGN KEY(provider_id) REFERENCES providers(id));
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, version TEXT, metadata TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, provider_id TEXT NOT NULL, requested_model TEXT NOT NULL, routing_policy TEXT NOT NULL DEFAULT '{}', config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS pricing_snapshots(id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, input_price TEXT NOT NULL, output_price TEXT NOT NULL, cache_read_price TEXT NOT NULL, cache_write_price TEXT NOT NULL, currency TEXT NOT NULL, unit INTEGER NOT NULL, effective_from TEXT NOT NULL, effective_until TEXT, source TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, logical_request_id TEXT NOT NULL, native_request_id TEXT, agent_id TEXT NOT NULL, preset_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, requested_model TEXT NOT NULL, normalized_model TEXT NOT NULL, billing_model TEXT NOT NULL, protocol_in TEXT NOT NULL, protocol_out TEXT NOT NULL, received_at TEXT NOT NULL, upstream_started_at TEXT, first_byte_at TEXT, first_meaningful_output_at TEXT, completed_at TEXT, finalized_at TEXT, metrics TEXT NOT NULL, tokens TEXT NOT NULL, status_code INTEGER, status TEXT NOT NULL, error_type TEXT, error_code TEXT, sanitized_error_message TEXT, is_streaming INTEGER NOT NULL, chunk_count INTEGER NOT NULL, pricing_snapshot_id TEXT, cost TEXT NOT NULL, provenance TEXT NOT NULL, route_trace TEXT NOT NULL, request_hash TEXT NOT NULL, response_hash TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_trace ON requests(trace_id);
      CREATE TABLE IF NOT EXISTS request_observations(observation_id TEXT PRIMARY KEY, logical_request_id TEXT NOT NULL, source TEXT NOT NULL, confidence TEXT NOT NULL, captured_at TEXT NOT NULL, raw_schema_version TEXT NOT NULL, metrics TEXT NOT NULL, metadata TEXT NOT NULL, payload_hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_logical ON request_observations(logical_request_id);
      CREATE TRIGGER IF NOT EXISTS prevent_finalized_request_update
      BEFORE UPDATE ON requests
      WHEN OLD.finalized_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'finalized request is immutable'); END;`);
      const row = this.db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as { version?: number } | undefined;
      if (!row) this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
  seed(): void {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO providers(id,name,vendor,base_url,protocol,credential_ref,capabilities,created_at,updated_at) VALUES ('mock','Vision Mock Provider','Vision','http://127.0.0.1:8790','openai-responses',NULL,'{"stream":true}',?,?)`).run(now, now);
    this.db.prepare(`INSERT OR IGNORE INTO models(id,provider_id,name,billing_model) VALUES ('mock-model','mock','vision-mock-1','vision-mock-1')`).run();
    for (const [id, name, type] of [['codex', 'Codex', 'coding'], ['claude-code', 'Claude Code', 'coding'], ['gemini-cli', 'Gemini CLI', 'coding'], ['eva', 'EVA', 'agent'], ['custom', 'Custom Agent', 'custom']] as const) this.db.prepare('INSERT OR IGNORE INTO agents(id,name,type,version) VALUES (?,?,?,?)').run(id, name, type, '1');
    this.db.prepare(`INSERT OR IGNORE INTO presets(id,name,description,provider_id,requested_model) VALUES ('coding','Coding','Balanced coding preset','mock','vision-mock-1'),('fast','Fast','Low latency preset','mock','vision-mock-1'),('cheap','Cheap','Cost-aware preset','mock','vision-mock-1')`).run();
    this.db.prepare(`INSERT OR IGNORE INTO pricing_snapshots(id,provider_id,model_id,input_price,output_price,cache_read_price,cache_write_price,currency,unit,effective_from,effective_until,source,confidence,created_at,content_hash) VALUES ('price-mock-v1','mock','mock-model','0.10000000','0.20000000','0.05000000','0.15000000','USD',1000000,? ,NULL,'built-in','high',?,'mock-price-v1')`).run(now, now);
  }
  getPrivacyConfig(): { mode: 'normal' | 'privacy' | 'debug'; retention: '24h' | '7d' | '30d' | null } {
    const mode = String((this.db.prepare("SELECT value FROM settings WHERE key='privacy.mode'").get() as { value?: string } | undefined)?.value ?? 'normal');
    const retention = (this.db.prepare("SELECT value FROM settings WHERE key='privacy.retention'").get() as { value?: string } | undefined)?.value ?? null;
    return { mode: (['normal', 'privacy', 'debug'].includes(mode) ? mode : 'normal') as 'normal' | 'privacy' | 'debug', retention: (['24h', '7d', '30d'].includes(String(retention)) ? retention : null) as '24h' | '7d' | '30d' | null };
  }
  setPrivacyConfig(mode: 'normal' | 'privacy' | 'debug', retention: '24h' | '7d' | '30d' | null): void {
    if (mode === 'debug' && !retention) throw new Error('debug mode requires retention');
    const save = this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    save.run('privacy.mode', mode); save.run('privacy.retention', retention ?? '');
  }
  saveRequest(request: RequestRecord): void {
    const r = redact(request) as RequestRecord;
    const existing = this.db.prepare('SELECT finalized_at FROM requests WHERE id=?').get(r.id) as { finalized_at?: string | null } | undefined;
    if (existing?.finalized_at) return;
    this.db.prepare(`INSERT INTO requests(id,trace_id,logical_request_id,native_request_id,agent_id,preset_id,provider_id,model_id,requested_model,normalized_model,billing_model,protocol_in,protocol_out,received_at,upstream_started_at,first_byte_at,first_meaningful_output_at,completed_at,finalized_at,metrics,tokens,status_code,status,error_type,error_code,sanitized_error_message,is_streaming,chunk_count,pricing_snapshot_id,cost,provenance,route_trace,request_hash,response_hash,created_at) VALUES (${Array(35).fill('?').join(',')}) ON CONFLICT(id) DO UPDATE SET metrics=excluded.metrics,tokens=excluded.tokens,status_code=excluded.status_code,status=excluded.status,error_type=excluded.error_type,error_code=excluded.error_code,sanitized_error_message=excluded.sanitized_error_message,first_byte_at=excluded.first_byte_at,first_meaningful_output_at=excluded.first_meaningful_output_at,completed_at=excluded.completed_at,finalized_at=excluded.finalized_at,chunk_count=excluded.chunk_count,cost=excluded.cost,pricing_snapshot_id=excluded.pricing_snapshot_id,response_hash=excluded.response_hash`).run(
      r.id, r.traceId, r.logicalRequestId, r.nativeRequestId, r.agentId, r.presetId, r.providerId, r.modelId, r.requestedModel, r.normalizedModel, r.billingModel, r.protocolIn, r.protocolOut, r.receivedAt, r.upstreamStartedAt, r.firstByteAt, r.firstMeaningfulOutputAt, r.completedAt, r.finalizedAt, JSON.stringify(r.metrics), JSON.stringify(r.tokens), r.statusCode, r.status, r.errorType, r.errorCode, r.sanitizedErrorMessage, r.isStreaming ? 1 : 0, r.chunkCount, r.pricingSnapshotId, JSON.stringify(r.cost), JSON.stringify(r.provenance), JSON.stringify(r.routeTrace), r.requestHash, r.responseHash, r.createdAt);
  }
  listAgents(): Array<Record<string, unknown>> { return this.db.prepare('SELECT id,name,type,version,metadata,enabled FROM agents ORDER BY name').all().map((row) => ({ ...(row as Record<string, unknown>), metadata: JSON.parse(String((row as Record<string, unknown>).metadata ?? '{}')), enabled: Boolean((row as Record<string, unknown>).enabled) })); }
  listPresets(): Array<Record<string, unknown>> { return this.db.prepare('SELECT id,name,description,provider_id,requested_model,routing_policy,config,enabled FROM presets ORDER BY name').all().map((row) => ({ ...(row as Record<string, unknown>), routingPolicy: JSON.parse(String((row as Record<string, unknown>).routing_policy ?? '{}')), config: JSON.parse(String((row as Record<string, unknown>).config ?? '{}')), enabled: Boolean((row as Record<string, unknown>).enabled) })); }
  listProviders(): Array<Record<string, unknown>> { return this.db.prepare('SELECT id,name,vendor,base_url,protocol,enabled,capabilities,created_at,updated_at FROM providers ORDER BY name').all().map((row) => ({ ...(row as Record<string, unknown>), capabilities: JSON.parse(String((row as Record<string, unknown>).capabilities ?? '{}')), enabled: Boolean((row as Record<string, unknown>).enabled) })); }
  saveAgent(input: { id: string; name: string; type: string; version?: string; metadata?: Record<string, unknown>; enabled?: boolean }): void { this.db.prepare('INSERT INTO agents(id,name,type,version,metadata,enabled) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,version=excluded.version,metadata=excluded.metadata,enabled=excluded.enabled').run(input.id, input.name, input.type, input.version ?? null, JSON.stringify(redact(input.metadata ?? {})), input.enabled === false ? 0 : 1); }
  deleteAgent(id: string): void { this.db.prepare('DELETE FROM agents WHERE id=?').run(id); }
  savePreset(input: { id: string; name: string; description?: string; providerId: string; requestedModel: string; routingPolicy?: Record<string, unknown>; config?: Record<string, unknown>; enabled?: boolean }): void { this.db.prepare('INSERT INTO presets(id,name,description,provider_id,requested_model,routing_policy,config,enabled) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,provider_id=excluded.provider_id,requested_model=excluded.requested_model,routing_policy=excluded.routing_policy,config=excluded.config,enabled=excluded.enabled').run(input.id, input.name, input.description ?? null, input.providerId, input.requestedModel, JSON.stringify(redact(input.routingPolicy ?? {})), JSON.stringify(redact(input.config ?? {})), input.enabled === false ? 0 : 1); }
  deletePreset(id: string): void { this.db.prepare('DELETE FROM presets WHERE id=?').run(id); }
  addObservation(observation: Observation): void {
    this.db.prepare('INSERT INTO request_observations(observation_id,logical_request_id,source,confidence,captured_at,raw_schema_version,metrics,metadata,payload_hash) VALUES (?,?,?,?,?,?,?,?,?)').run(observation.observationId, observation.logicalRequestId, observation.source, observation.confidence, observation.capturedAt, observation.rawSchemaVersion, JSON.stringify(redact(observation.metrics)), JSON.stringify(redact(observation.metadata)), observation.payloadHash);
  }
  findPricing(providerId: string, modelId: string, at: string): PricingSnapshot | null {
    const row = this.db.prepare('SELECT * FROM pricing_snapshots WHERE provider_id=? AND (model_id=? OR model_id=?) AND effective_from<=? AND (effective_until IS NULL OR effective_until>?) ORDER BY effective_from DESC LIMIT 1').get(providerId, modelId, 'mock-model', at, at) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), providerId: String(row.provider_id), modelId: String(row.model_id), inputPrice: String(row.input_price), outputPrice: String(row.output_price), cacheReadPrice: String(row.cache_read_price), cacheWritePrice: String(row.cache_write_price), currency: String(row.currency), unit: Number(row.unit), effectiveFrom: String(row.effective_from), effectiveUntil: row.effective_until ? String(row.effective_until) : null, source: String(row.source), confidence: String(row.confidence) as PricingSnapshot['confidence'], createdAt: String(row.created_at), contentHash: String(row.content_hash) };
  }
  listRequests(limit = 100): RequestRecord[] {
    const rows = this.db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(row => this.inflate(row));
  }
  summary(): Record<string, unknown> {
    const row = this.db.prepare(`SELECT COUNT(*) requests, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success, SUM(CAST(json_extract(tokens,'$.inputUncached') AS INTEGER)) input_tokens, SUM(CAST(json_extract(tokens,'$.outputText') AS INTEGER)+CAST(json_extract(tokens,'$.outputReasoning') AS INTEGER)) output_tokens, SUM(CAST(json_extract(tokens,'$.cacheRead') AS INTEGER)) cache_read, SUM(CAST(json_extract(tokens,'$.cacheWrite') AS INTEGER)) cache_write FROM requests`).get() as Record<string, unknown>;
    const metricRows = this.db.prepare(`SELECT json_extract(metrics,'$.ttftMs') ttft, json_extract(metrics,'$.outputTps') tps FROM requests WHERE status='success'`).all() as Array<{ ttft: number | null; tps: number | null }>;
    const percentile = (values: number[], p: number): number | null => { if (!values.length) return null; const sorted = values.sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null; };
    const ttft = metricRows.flatMap((x) => x.ttft === null ? [] : [Number(x.ttft)]); const tps = metricRows.flatMap((x) => x.tps === null ? [] : [Number(x.tps)]);
    const costs = this.db.prepare(`SELECT SUM(CASE WHEN json_extract(cost,'$.totalApiCost') IS NOT NULL THEN CAST(json_extract(cost,'$.totalApiCost') AS REAL) ELSE 0 END) total_cost FROM requests WHERE status='success'`).get() as Record<string, unknown>;
    return { requests: Number(row.requests ?? 0), success: Number(row.success ?? 0), successRate: Number(row.requests) ? Number(row.success ?? 0) / Number(row.requests) : 0, inputTokens: Number(row.input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0), cacheRead: Number(row.cache_read ?? 0), cacheWrite: Number(row.cache_write ?? 0), p50Ttft: percentile(ttft, 0.5), p95Ttft: percentile(ttft, 0.95), p50Tps: percentile(tps, 0.5), p95Tps: percentile(tps, 0.95), totalCost: costs.total_cost ?? null };
  }
  private inflate(row: Record<string, unknown>): RequestRecord { return { id: String(row.id), traceId: String(row.trace_id), logicalRequestId: String(row.logical_request_id), nativeRequestId: row.native_request_id ? String(row.native_request_id) : null, agentId: String(row.agent_id), presetId: String(row.preset_id), providerId: String(row.provider_id), modelId: String(row.model_id), requestedModel: String(row.requested_model), normalizedModel: String(row.normalized_model), billingModel: String(row.billing_model), protocolIn: String(row.protocol_in), protocolOut: String(row.protocol_out), receivedAt: String(row.received_at), upstreamStartedAt: row.upstream_started_at ? String(row.upstream_started_at) : null, firstByteAt: row.first_byte_at ? String(row.first_byte_at) : null, firstMeaningfulOutputAt: row.first_meaningful_output_at ? String(row.first_meaningful_output_at) : null, completedAt: row.completed_at ? String(row.completed_at) : null, finalizedAt: row.finalized_at ? String(row.finalized_at) : null, metrics: JSON.parse(String(row.metrics)) as RequestRecord['metrics'], tokens: JSON.parse(String(row.tokens)) as RequestRecord['tokens'], statusCode: row.status_code === null ? null : Number(row.status_code), status: String(row.status) as RequestRecord['status'], errorType: row.error_type ? String(row.error_type) : null, errorCode: row.error_code ? String(row.error_code) : null, sanitizedErrorMessage: row.sanitized_error_message ? String(row.sanitized_error_message) : null, isStreaming: Boolean(row.is_streaming), chunkCount: Number(row.chunk_count), pricingSnapshotId: row.pricing_snapshot_id ? String(row.pricing_snapshot_id) : null, cost: JSON.parse(String(row.cost)) as CostBreakdown, usageSource: 'vision_proxy', usageConfidence: 'high', timingSource: 'vision_proxy', timingConfidence: 'high', pricingSource: 'built-in', provenance: JSON.parse(String(row.provenance)), routeTrace: JSON.parse(String(row.route_trace)), requestHash: String(row.request_hash), responseHash: row.response_hash ? String(row.response_hash) : null, createdAt: String(row.created_at) }; }
}
