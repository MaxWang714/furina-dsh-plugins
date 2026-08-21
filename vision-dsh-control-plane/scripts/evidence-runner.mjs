import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const runId = process.env.VISION_RUN_ID ?? `local-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
const evidenceDir = resolve(process.env.EVIDENCE_DIR ?? 'evidence');
const jsonl = resolve(evidenceDir, 'observations.jsonl');
await mkdir(evidenceDir, { recursive: true });

function redact(value) {
  return String(value ?? '').replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]').replace(/\b(?:sk|ghp|gho|ghs|rk|ak)_[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}
function run(command, args, cwd) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, shell: command.endsWith('.cmd'), windowsHide: true, env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolveResult({ code: code ?? 1, signal, stdout: redact(stdout).slice(-12000), stderr: redact(stderr).slice(-12000) }));
  });
}
async function record({ caseId, question, request, result, real = false, notes = [] }) {
  const traceId = `trace_${caseId}_${runId}`; const now = new Date().toISOString();
  const verdict = result.code === 0 ? (real ? 'PASS' : 'PASS_LOCAL_ONLY') : 'FAIL';
  const row = { case_id: caseId, run_id: runId, trace_id: traceId, test_question: question, sanitized_request: request, network_events: [], sanitized_response: { exit_code: result.code, signal: result.signal, stdout_tail: result.stdout, stderr_tail: result.stderr }, observation: { source: 'evidence-runner', captured_at: now, real, status: verdict }, storage: { jsonl: jsonl, sqlite: null }, dashboard: { summary: 'local command result' }, replay: { status: 'not_applicable', reason: real ? 'provider replay is separate' : 'deterministic build/test' }, automatic_assertions: { exit_code_zero: result.code === 0 }, review: { human: 'pending', cross_model: 'pending' }, verdict, notes };
  await appendFile(jsonl, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cases = [
  ['vision-ts-vitest', 'Run Rust-independent Vision TypeScript unit, storage, gateway and replay tests', [process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts'], root]],
  ['vision-ts-build', 'Compile the Vision TypeScript production bundle', [process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], root]],
  ['vision-frontend-build', 'Build the portable frontend bundle', [process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/desktop/vite.config.ts'], root]],
  ['dsh-observability', 'Run the merged LLM Manager observability plugin checks', [npmCommand, ['run', 'check'], resolve(root, 'plugins/dsh-observability')]],
  ['codex-direct-contract', 'Run Direct Provider incremental SSE, usage, reasoning and redaction contract tests', [process.execPath, ['--test', 'test/index.test.mjs'], resolve(root, 'plugins/furina-codex-provider')]],
  ['cliproxyapi-provider', 'Run CLIProxyAPI DSH provider discovery and lifecycle contract tests', [npmCommand, ['run', 'check'], resolve(root, 'integrations/cliproxyapi/dsh-provider')]],
];
const rows = [];
for (const [caseId, question, [command, args, cwd]] of cases) rows.push(await record({ caseId, question, request: { command, args, cwd: cwd.replaceAll('\\', '/') }, result: await run(command, args, cwd), notes: ['local deterministic evidence; not a real supplier PASS'] }));
await writeFile(resolve(evidenceDir, 'summary.json'), JSON.stringify({ schema_version: '1.0.0', run_id: runId, generated_at: new Date().toISOString(), rows, real_supplier_status: { longcat: 'BLOCKED_CREDENTIAL_NOT_PRESENT', deepseek: 'BLOCKED_CREDENTIAL_NOT_PRESENT', multi_model_platform: 'BLOCKED_CREDENTIAL_NOT_PRESENT', codex_direct: 'BLOCKED_CREDENTIAL_NOT_PRESENT', cliproxyapi_codex: 'BLOCKED_SIDECAR_BINARY_OR_REAL_IDENTITY_NOT_PRESENT' } }, null, 2), 'utf8');
console.log(JSON.stringify({ run_id: runId, cases: rows.length, passed_local: rows.filter((row) => row.verdict === 'PASS_LOCAL_ONLY').length, failed: rows.filter((row) => row.verdict === 'FAIL').length, jsonl }));
