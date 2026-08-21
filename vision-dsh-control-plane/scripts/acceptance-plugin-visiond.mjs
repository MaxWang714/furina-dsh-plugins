import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { apply, readObservations } from '../plugins/dsh-observability/lib/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.VISIOND_BIN ?? join(root, 'target', 'x86_64-pc-windows-gnu', 'release', 'visiond.exe');
const dir = await mkdtemp(join(tmpdir(), 'visiond-plugin-'));
const db = join(dir, 'visiond.db');
const dataDir = join(dir, 'plugin-data');
const child = spawn(bin, [], { env: { ...process.env, VISIOND_BIND: '127.0.0.1:8789', VISIOND_DB: db }, stdio: ['ignore', 'ignore', 'pipe'] });
try {
  let ready = false;
  for (let i = 0; i < 30 && !ready; i += 1) { try { ready = (await fetch('http://127.0.0.1:8789/health')).ok; } catch {} if (!ready) await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(ready, true, 'visiond health did not become ready');
  let handler;
  const ctx = { inject: (_services, callback) => callback(ctx), on: (event, callback) => { if (event === 'llm/stream') handler = callback; }, tools: { register: () => {} } };
  apply(ctx, { dataDir, gatewayUrl: 'http://127.0.0.1:8789', privacy: 'normal', multiplier: 1, maxErrorLen: 200 });
  const stream = handler({ provider: 'longcat', model: 'deepseek-v4', sessionId: 'session-secret', traceId: 'trace-acceptance' }, () => (async function* () {
    yield { type: 'text-delta', text: 'accepted' };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })());
  for await (const _chunk of stream) {}
  await new Promise((r) => setTimeout(r, 150));
  const summary = await (await fetch('http://127.0.0.1:8789/api/summary')).json();
  const rows = await readObservations(dataDir);
  assert.equal(rows.length, 1);
  assert.equal(summary.observations, 1);
  assert.equal(rows[0].metadata.session_id.length, 64);
  const raw = await readFile(db);
  assert.ok(raw.length > 0);
  assert.equal(JSON.stringify(rows).includes('session-secret'), false);
  console.log(JSON.stringify({ ok: true, plugin_observations: rows.length, visiond_summary: summary, database_bytes: raw.length }));
} finally {
  child.kill();
  await rm(dir, { recursive: true, force: true });
}
