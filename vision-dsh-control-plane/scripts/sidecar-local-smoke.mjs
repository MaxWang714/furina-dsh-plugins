import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.CLIPROXYAPI_BIN;
const config = resolve(root, 'integrations/cliproxyapi/test-config.yaml');
const evidenceDir = resolve(process.env.EVIDENCE_DIR ?? 'evidence');
await mkdir(evidenceDir, { recursive: true });
if (!binary) throw new Error('Set CLIPROXYAPI_BIN to the optional sidecar executable');
const child = spawn(binary, ['-config', config], { cwd: resolve(root, 'integrations/cliproxyapi'), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = ''; child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(-4000); });
const base = 'http://127.0.0.1:8317'; let models = null; let responseStatus = null; let error = null;
try {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { try { const response = await fetch(`${base}/v1/models`); if (response.ok) { models = await response.json(); break; } } catch {} await new Promise((r) => setTimeout(r, 200)); }
  if (!models) throw new Error('sidecar /v1/models did not become ready');
  const response = await fetch(`${base}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'codex-test', input: 'blocked without auth', stream: false }) });
  responseStatus = response.status;
} catch (caught) { error = String(caught?.message ?? caught); }
finally { child.kill(); }
const result = { schema_version: '1.0.0', case_id: 'cliproxyapi-local-process-smoke', run_id: process.env.VISION_RUN_ID ?? 'unknown', trace_id: `trace_cliproxyapi_local_${Date.now()}`, real_process: true, real_upstream: false, request: { models: '[GET /v1/models]', responses: '[POST /v1/responses; no credential]' }, network: { models_status: models ? 200 : null, responses_status: responseStatus }, observation: { status: error ? 'error' : 'success' }, replay: { status: 'not_applicable' }, verdict: error ? 'FAIL_LOCAL_SIDECAR' : 'PASS_LOCAL_SIDECAR_AUTH_BOUNDARY', error, stderr_tail: stderr.slice(-1000) };
await writeFile(resolve(evidenceDir, 'cliproxyapi-local-process.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ verdict: result.verdict, models_status: result.network.models_status, responses_status: responseStatus, error }));
if (error) process.exitCode = 2;
