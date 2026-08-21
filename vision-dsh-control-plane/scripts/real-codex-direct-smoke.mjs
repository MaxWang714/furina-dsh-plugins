import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCodexAdapter } from '../plugins/furina-codex-provider/lib/index.js';

const evidenceDir = resolve(process.env.EVIDENCE_DIR ?? 'evidence');
await mkdir(evidenceDir, { recursive: true });
const started = Date.now();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(new Error('real Codex smoke timeout')), Number(process.env.CODEX_SMOKE_TIMEOUT_MS ?? 45000));
const eventTypes = []; let firstMeaningfulMs = null; let usageKeys = []; let finish = null; let textChars = 0; let reasoningChars = 0;
const adapter = createCodexAdapter({ logger: { debug(message) { if (/status=/.test(message)) eventTypes.push('network:status'); } } }, { CODEX_ACCESS_TOKEN: process.env.CODEX_ACCESS_TOKEN, CODEX_BASE_URL: process.env.CODEX_BASE_URL, CODEX_PROXY_URL: process.env.CODEX_PROXY_URL });
let error = null;
try {
  for await (const event of adapter.stream({ model: process.env.CODEX_MODEL ?? 'gpt-5.6-luna', messages: [{ role: 'user', content: 'Reply with one word: ping.' }], signal: controller.signal })) {
    eventTypes.push(event.type);
    if (firstMeaningfulMs == null && (event.type === 'text-delta' || event.type === 'tool-call')) firstMeaningfulMs = Date.now() - started;
    if (event.type === 'text-delta') { if (event.index === 1) reasoningChars += event.text?.length ?? 0; else textChars += event.text?.length ?? 0; }
    if (event.type === 'usage') usageKeys = Object.keys(event.usage ?? {}).sort();
    if (event.type === 'finish') finish = event.reason?.kind ?? 'unknown';
  }
} catch (caught) { error = String(caught?.message ?? caught).replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]'); }
finally { clearTimeout(timeout); }
const result = { schema_version: '1.0.0', case_id: 'codex-direct-real-smoke', run_id: process.env.VISION_RUN_ID ?? 'unknown', trace_id: `trace_codex_direct_real_${Date.now()}`, real: true, request: { provider: 'codex-openai', model: process.env.CODEX_MODEL ?? 'gpt-5.6-luna', prompt: '[REDACTED]' }, network: { event_types: eventTypes }, response: { text_chars: textChars, reasoning_chars: reasoningChars, first_meaningful_ms: firstMeaningfulMs, usage_keys: usageKeys, finish }, observation: { status: error ? 'error' : finish === 'stop' ? 'success' : 'incomplete' }, replay: { status: 'not_applicable', reason: 'real provider response is not persisted' }, verdict: error ? 'BLOCKED_OR_FAIL' : finish === 'stop' ? 'PASS_REAL_CODEX_DIRECT' : 'NOT_READY', error };
await writeFile(resolve(evidenceDir, 'codex-direct-real.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ verdict: result.verdict, event_count: eventTypes.length, first_meaningful_ms: firstMeaningfulMs, finish, error }));
if (result.verdict !== 'PASS_REAL_CODEX_DIRECT') process.exitCode = 2;
