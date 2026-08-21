import fs from 'node:fs';
import path from 'node:path';
import { classifyMeaningfulEvent, normalizeTokens, redact } from './core.js';
import { VisionStore } from './storage.js';

export type DiagnosticResult = { name: string; durationMs: number; result: 'passed' | 'warning' | 'failed'; message: string; action?: string };
export async function runDiagnostics(store: VisionStore, gatewayUrl = 'http://127.0.0.1:8787'): Promise<DiagnosticResult[]> {
  const checks: Array<[string, () => Promise<string> | string]> = [
    ['Database', () => { store.db.prepare('SELECT 1').get(); return 'SQLite opened'; }],
    ['Migration', () => { const r = store.db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }; return `schema ${r.version}`; }],
    ['Gateway Bind', () => gatewayUrl.includes('127.0.0.1') ? 'loopback only' : 'gateway is not loopback'],
    ['Mock Provider', async () => { const r = await fetch('http://127.0.0.1:8790/v1/responses', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'vision-mock-1', input:'diagnostic' }) }); if (!r.ok) throw new Error(`mock returned ${r.status}`); return 'reachable'; }],
    ['OpenAI Responses Non-stream', async () => { const r = await fetch(`${gatewayUrl}/v1/responses`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'vision-mock-1', input:'diagnostic', stream:false, scenario:{ inputTokens:1, outputTokens:1 } }) }); if (!r.ok) throw new Error(`gateway returned ${r.status}`); return 'request completed'; }],
    ['Meaningful Event Classifier', () => classifyMeaningfulEvent({ type:'response.output_text.delta', delta:'x' }) && !classifyMeaningfulEvent({ type:'response.created' }) ? 'classifier v1' : 'classifier mismatch'],
    ['Token Normalizer', () => normalizeTokens({ input_tokens:2, output_tokens:1 }).quality === 'complete' ? 'buckets valid' : 'normalizer mismatch'],
    ['Pricing Resolver', () => store.findPricing('mock','mock-model',new Date().toISOString()) ? 'snapshot resolved' : 'no snapshot'],
    ['Fixture Replay', () => fs.existsSync(path.resolve(process.cwd(),'fixtures/responses/simple/expected.json')) ? 'fixture catalog available' : 'fixture missing'],
    ['Privacy Configuration', () => JSON.stringify(redact({ Authorization:'Bearer secret', api_key:'sk-test' })).includes('REDACTED') ? 'redactor active' : 'redactor mismatch']
  ];
  const results: DiagnosticResult[] = [];
  for (const [name, fn] of checks) { const started = Date.now(); try { const message = await fn(); results.push({ name, durationMs: Date.now()-started, result: 'passed', message }); } catch (error) { results.push({ name, durationMs: Date.now()-started, result: 'failed', message: error instanceof Error ? error.message : 'check failed', action: 'inspect logs and rerun' }); } }
  return results;
}
