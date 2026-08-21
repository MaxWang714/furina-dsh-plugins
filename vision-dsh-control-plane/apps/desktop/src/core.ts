import crypto from 'node:crypto';

export type Confidence = 'exact' | 'high' | 'medium' | 'low' | 'unknown';
export type TokenQuality = 'exact' | 'complete' | 'partial' | 'inconsistent' | 'estimated' | 'unknown';
export type RequestStatus = 'running' | 'success' | 'error' | 'aborted' | 'timeout';

export interface TokenBuckets {
  inputUncached: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  outputText: number | null;
  outputReasoning: number | null;
  unclassified: number | null;
  quality: TokenQuality;
  source: string;
}

export interface Metrics {
  ttfbMs: number | null;
  ttftMs: number | null;
  generationMs: number | null;
  durationMs: number | null;
  outputTps: number | null;
}

export interface PricingSnapshot {
  id: string;
  providerId: string;
  modelId: string;
  inputPrice: string;
  outputPrice: string;
  cacheReadPrice: string;
  cacheWritePrice: string;
  currency: string;
  unit: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  source: string;
  confidence: Confidence;
  createdAt: string;
  contentHash: string;
}

export interface CostBreakdown {
  inputCost: string | null;
  outputCost: string | null;
  cacheReadCost: string | null;
  cacheWriteCost: string | null;
  totalApiCost: string | null;
  currency: string;
  calculationVersion: string;
}

export interface RequestRecord {
  id: string;
  traceId: string;
  nativeRequestId: string | null;
  logicalRequestId: string;
  agentId: string;
  presetId: string;
  providerId: string;
  modelId: string;
  requestedModel: string;
  normalizedModel: string;
  billingModel: string;
  protocolIn: string;
  protocolOut: string;
  receivedAt: string;
  upstreamStartedAt: string | null;
  firstByteAt: string | null;
  firstMeaningfulOutputAt: string | null;
  completedAt: string | null;
  finalizedAt: string | null;
  metrics: Metrics;
  tokens: TokenBuckets;
  statusCode: number | null;
  status: RequestStatus;
  errorType: string | null;
  errorCode: string | null;
  sanitizedErrorMessage: string | null;
  isStreaming: boolean;
  chunkCount: number;
  pricingSnapshotId: string | null;
  cost: CostBreakdown;
  usageSource: string;
  usageConfidence: Confidence;
  timingSource: string;
  timingConfidence: Confidence;
  pricingSource: string;
  provenance: Record<string, unknown>;
  routeTrace: Record<string, unknown>;
  requestHash: string;
  responseHash: string | null;
  createdAt: string;
}

export interface Observation {
  observationId: string;
  logicalRequestId: string;
  source: string;
  confidence: Confidence;
  capturedAt: string;
  rawSchemaVersion: string;
  metrics: Record<string, unknown>;
  metadata: Record<string, unknown>;
  payloadHash: string;
}

export function nowIso(): string { return new Date().toISOString(); }
export function newId(prefix: string): string { return `${prefix}_${crypto.randomUUID()}`; }
export function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

export function classifyMeaningfulEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type : '';
  if (type === 'response.output_text.delta' || type === 'response.function_call_arguments.delta' || type.includes('reasoning') && type.includes('delta')) {
    const delta = e.delta;
    return typeof delta === 'string' ? delta.length > 0 : Boolean(delta && typeof delta === 'object');
  }
  return false;
}

export function normalizeTokens(raw: Record<string, unknown> | null | undefined): TokenBuckets {
  if (!raw) return { inputUncached: null, cacheRead: null, cacheWrite: null, outputText: null, outputReasoning: null, unclassified: null, quality: 'unknown', source: 'missing' };
  const n = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
  const input = n(raw.input_tokens ?? raw.prompt_tokens);
  const output = n(raw.output_tokens ?? raw.completion_tokens);
  const details = (raw.input_token_details ?? raw.prompt_tokens_details) as Record<string, unknown> | undefined;
  const outDetails = (raw.output_token_details ?? raw.completion_tokens_details) as Record<string, unknown> | undefined;
  const cacheRead = n(raw.cache_read_input_tokens ?? details?.cached_tokens ?? details?.cache_read);
  const cacheWrite = n(raw.cache_creation_input_tokens ?? details?.cache_write);
  const reasoning = n(raw.reasoning_tokens ?? outDetails?.reasoning_tokens ?? outDetails?.reasoning);
  const text = output === null || reasoning === null ? output : Math.max(0, output - reasoning);
  const hasAny = [input, output, cacheRead, cacheWrite, reasoning].some(v => v !== null);
  const inconsistent = input !== null && cacheRead !== null && cacheWrite !== null && input < cacheRead + cacheWrite;
  return {
    inputUncached: input === null ? null : Math.max(0, input - (cacheRead ?? 0) - (cacheWrite ?? 0)),
    cacheRead, cacheWrite, outputText: text, outputReasoning: reasoning,
    unclassified: hasAny ? (inconsistent ? 0 : null) : null,
    quality: inconsistent ? 'inconsistent' : hasAny ? 'complete' : 'unknown',
    source: hasAny ? 'provider_usage' : 'missing'
  };
}

export function deriveMetrics(t: { upstreamStartedAt: number | null; firstByteAt: number | null; firstMeaningfulOutputAt: number | null; completedAt: number | null }, outputTokens: number | null): Metrics {
  const delta = (a: number | null, b: number | null): number | null => a !== null && b !== null && a >= b ? Math.round(a - b) : null;
  const ttfbMs = delta(t.firstByteAt, t.upstreamStartedAt);
  const ttftMs = delta(t.firstMeaningfulOutputAt, t.upstreamStartedAt);
  const generationMs = delta(t.completedAt, t.firstMeaningfulOutputAt);
  const durationMs = delta(t.completedAt, t.upstreamStartedAt);
  const outputTps = outputTokens !== null && generationMs !== null && generationMs > 0 ? Number((outputTokens / (generationMs / 1000)).toFixed(4)) : null;
  return { ttfbMs, ttftMs, generationMs, durationMs, outputTps };
}

function decimal(value: string | number | null): bigint | null {
  if (value === null) return null;
  const s = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole ?? '0') * 100000000n + BigInt((frac + '00000000').slice(0, 8));
}
function money(tokens: number | null, price: string, unit: number): string | null {
  const p = decimal(price); if (tokens === null || p === null || !Number.isFinite(unit) || unit <= 0) return null;
  const scaled = (p * BigInt(tokens)) / BigInt(unit);
  const sign = scaled < 0n ? '-' : ''; const abs = scaled < 0n ? -scaled : scaled;
  const raw = abs.toString().padStart(9, '0');
  return `${sign}${raw.slice(0, -8)}.${raw.slice(-8)}`.replace(/0+$/, '').replace(/\.$/, '') || '0';
}
export function calculateCost(tokens: TokenBuckets, pricing: PricingSnapshot | null): CostBreakdown {
  if (!pricing) return { inputCost: null, outputCost: null, cacheReadCost: null, cacheWriteCost: null, totalApiCost: null, currency: 'USD', calculationVersion: 'vision-cost-v1-unknown-price' };
  if (tokens.quality === 'unknown') return { inputCost: null, outputCost: null, cacheReadCost: null, cacheWriteCost: null, totalApiCost: null, currency: pricing.currency, calculationVersion: 'vision-cost-v1-unknown-usage' };
  const inputCost = money(tokens.inputUncached, pricing.inputPrice, pricing.unit);
  const outputCost = money((tokens.outputText ?? 0) + (tokens.outputReasoning ?? 0), pricing.outputPrice, pricing.unit);
  const cacheReadCost = money(tokens.cacheRead ?? 0, pricing.cacheReadPrice, pricing.unit);
  const cacheWriteCost = money(tokens.cacheWrite ?? 0, pricing.cacheWritePrice, pricing.unit);
  const values = [inputCost, outputCost, cacheReadCost, cacheWriteCost].map(decimal);
  const total = values.some(v => v === null) ? null : values.reduce<bigint>((a, v) => a + (v as bigint), 0n);
  const totalApiCost = total === null ? null : (() => { const raw = total.toString().padStart(9, '0'); return `${raw.slice(0, -8)}.${raw.slice(-8)}`.replace(/0+$/, '').replace(/\.$/, '') || '0'; })();
  return { inputCost, outputCost, cacheReadCost, cacheWriteCost, totalApiCost, currency: pricing.currency, calculationVersion: 'vision-cost-v1' };
}

const SECRET_KEYS = /^(authorization|cookie|x-api-key|api_key|access_token|refresh_token|token|credential)$/i;
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-[REDACTED]').replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token)=)[^&\s]+/gi, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v)]));
  return value;
}

export function createRequest(input: Partial<RequestRecord> & Pick<RequestRecord, 'requestedModel' | 'normalizedModel' | 'billingModel'>): RequestRecord {
  const timestamp = nowIso();
  return {
    id: input.id ?? newId('req'), traceId: input.traceId ?? newId('trace'), nativeRequestId: input.nativeRequestId ?? null,
    logicalRequestId: input.logicalRequestId ?? newId('logical'), agentId: input.agentId ?? 'unknown', presetId: input.presetId ?? 'unknown',
    providerId: input.providerId ?? 'mock', modelId: input.modelId ?? input.billingModel, requestedModel: input.requestedModel,
    normalizedModel: input.normalizedModel, billingModel: input.billingModel, protocolIn: input.protocolIn ?? 'openai-responses', protocolOut: input.protocolOut ?? 'openai-responses',
    receivedAt: input.receivedAt ?? timestamp, upstreamStartedAt: null, firstByteAt: null, firstMeaningfulOutputAt: null, completedAt: null, finalizedAt: null,
    metrics: { ttfbMs: null, ttftMs: null, generationMs: null, durationMs: null, outputTps: null },
    tokens: normalizeTokens(null), statusCode: null, status: 'running', errorType: null, errorCode: null, sanitizedErrorMessage: null,
    isStreaming: input.isStreaming ?? false, chunkCount: 0, pricingSnapshotId: null,
    cost: { inputCost: null, outputCost: null, cacheReadCost: null, cacheWriteCost: null, totalApiCost: null, currency: 'USD', calculationVersion: 'pending' },
    usageSource: 'unknown', usageConfidence: 'unknown', timingSource: 'vision_proxy', timingConfidence: 'high', pricingSource: 'unknown',
    provenance: {}, routeTrace: { gateway: 'vision-local', version: '0.1.0' }, requestHash: input.requestHash ?? '', responseHash: null, createdAt: timestamp
  };
}
