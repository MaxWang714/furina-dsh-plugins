import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { appendObservation, apply, readObservations } from '../lib/index.js';
import { buildObservation, calculateCost, normalizeUsage, sanitizeError, canonicalizeRequest, cacheKey, planCache } from '../lib/core.js';

const dir = await mkdtemp(join(tmpdir(), 'vision-dsh-plugin-'));
try {
  assert.equal(normalizeUsage(null).quality, 'unknown');
  assert.equal(normalizeUsage({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, reasoningTokens: 5 }).inputUncached, 90);
  assert.equal(calculateCost(normalizeUsage(null), 'unknown', {}).totalCost, null);
  assert.equal(calculateCost(normalizeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }), 'deepseek-chat', { 'deepseek-chat': { input: '0.27', output: '1.1', cacheRead: '0.07', cacheWrite: '1.1' } }).totalCost, '1.37');
  assert.ok(!sanitizeError('Bearer sk-secret-token').includes('sk-secret-token'));
  assert.equal(canonicalizeRequest({ model: 'm', parameters: { temperature: 0.2, max_tokens: 10 } }), canonicalizeRequest({ parameters: { max_tokens: 10, temperature: 0.2 }, model: 'm' }));
  assert.equal(cacheKey({ model: 'm' }), cacheKey({ model: 'm' }));
  assert.equal(planCache({ model: 'm' }).decision, 'disabled-by-default');

  const observation = buildObservation({ options: { provider: 'p', model: 'm', sessionId: 'session-secret' }, startedAt: 100, firstMeaningfulAt: 120, completedAt: 200, usage: null, status: 'aborted', pricing: {}, multiplier: '1' });
  assert.equal(observation.metrics.ttfb_ms, null); assert.equal(observation.metrics.ttft_ms, 20); assert.equal(observation.tokens.quality, 'unknown'); assert.equal(observation.metadata.session_id.length, 64); assert.equal(JSON.stringify(observation).includes('session-secret'), false);
  await appendObservation(dir, observation); assert.equal((await readObservations(dir)).length, 1);

  let handler; const tools = [];
  const ctx = { inject: (_services, callback) => callback(ctx), on: (event, callback) => { if (event === 'llm/stream') handler = callback; }, tools: { register: (definition) => { tools.push(definition); } } };
  apply(ctx, { dataDir: dir, gatewayUrl: '', privacy: 'normal', multiplier: '1', maxErrorLen: 200 });
  assert.equal(typeof handler, 'function'); assert.equal(tools.length, 3);
  const next = () => (async function* () { yield { type: 'text-delta', text: 'hello' }; yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }; yield { type: 'finish', reason: { kind: 'stop' } }; })();
  const wrapped = handler({ provider: 'p', model: 'deepseek-chat', sessionId: 's' }, next);
  assert.equal(typeof wrapped.then, 'undefined'); assert.equal(typeof wrapped[Symbol.asyncIterator], 'function'); const chunks = []; for await (const chunk of wrapped) chunks.push(chunk); assert.equal(chunks.length, 3);
  const rows = await readObservations(dir); assert.equal(rows.length, 2); assert.equal(rows.at(-1).status, 'success'); assert.equal(rows.at(-1).tokens.inputUncached, 10);
  let received = null; const server = createServer((request, response) => { const chunks = []; request.on('data', (chunk) => chunks.push(chunk)); request.on('end', () => { received = JSON.parse(Buffer.concat(chunks).toString('utf8')); response.writeHead(201).end(); }); }); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; let gatewayHandler; const gatewayCtx = { inject: (_services, callback) => callback(gatewayCtx), on: (event, callback) => { if (event === 'llm/stream') gatewayHandler = callback; }, tools: { register: () => {} } }; apply(gatewayCtx, { dataDir: dir, gatewayUrl: `http://127.0.0.1:${port}`, privacy: 'normal', multiplier: '1', maxErrorLen: 200 });
  const gatewayStream = gatewayHandler({ provider: 'p', model: 'unknown-model' }, () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })()); for await (const _chunk of gatewayStream) { /* consume */ } await new Promise((resolve) => setTimeout(resolve, 20)); server.close(); assert.equal(received.source, 'dsh_agent'); assert.equal(received.cost.totalCost, null);
  console.log(`PASS Vision DSH plugin checks (${tools.length} tools, ${rows.length} observations)`);
} finally { await rm(dir, { recursive: true, force: true }); }
