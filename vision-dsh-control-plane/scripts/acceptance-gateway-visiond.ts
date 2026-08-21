import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.VISIOND_BIN ?? join(root, 'target', 'x86_64-pc-windows-gnu', 'release', 'visiond.exe');
const dir = await mkdtemp(join(tmpdir(), 'vision-gateway-'));
const child = spawn(bin, [], { env: { ...process.env, VISIOND_BIND: '127.0.0.1:8797', VISIOND_DB: join(dir, 'visiond.db') }, stdio: ['ignore', 'ignore', 'pipe'] });
process.env.VISIOND_URL = 'http://127.0.0.1:8797';
const { startMockProvider } = await import('../apps/desktop/src/mock.ts');
const { startGateway } = await import('../apps/desktop/src/gateway.ts');
const mock = startMockProvider(8795);
const gateway = startGateway({ port: 8796, upstream: 'http://127.0.0.1:8795' });
try {
  let ready = false;
  for (let i = 0; i < 30 && !ready; i += 1) { try { ready = (await fetch('http://127.0.0.1:8797/health')).ok; } catch {} if (!ready) await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(ready, true);
  const response = await fetch('http://127.0.0.1:8796/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'vision-mock-1', input: 'gateway sidecar acceptance', stream: false }) });
  assert.equal(response.status, 200);
  const summary = await (await fetch('http://127.0.0.1:8797/api/summary')).json() as { observations: number; requests: number };
  assert.equal(summary.observations, 1);
  assert.equal(summary.requests, 1);
  console.log(JSON.stringify({ ok: true, gateway_status: response.status, sidecar_summary: summary }));
} finally {
  gateway.close(); mock.close(); child.kill(); await rm(dir, { recursive: true, force: true });
}
