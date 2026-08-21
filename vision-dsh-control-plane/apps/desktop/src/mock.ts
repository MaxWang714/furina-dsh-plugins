import http from 'node:http';
import { sha256 } from './core.js';

export interface MockScenario { ttfbMs?: number; ttftMs?: number; chunkCount?: number; inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheWrite?: number; reasoningTokens?: number; status?: number; interruptAt?: number; missingUsage?: boolean; inconsistentUsage?: boolean; invalidJson?: boolean; model?: string; billingModel?: string; }
const defaultScenario: Required<MockScenario> = { ttfbMs: 25, ttftMs: 60, chunkCount: 3, inputTokens: 120, outputTokens: 48, cacheRead: 0, cacheWrite: 0, reasoningTokens: 8, status: 200, interruptAt: -1, missingUsage: false, inconsistentUsage: false, invalidJson: false, model: 'vision-mock-1', billingModel: 'vision-mock-1' };

export function startMockProvider(port = 8790): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/v1/responses', '/v1/chat/completions', '/v1/messages'].includes(req.url ?? '')) { res.writeHead(404).end(); return; }
    const body = await readBody(req); const payload = body ? JSON.parse(body) as Record<string, unknown> : {};
    const scenario = { ...defaultScenario, ...(payload.scenario as Partial<MockScenario> | undefined) };
    if (scenario.status !== 200) { res.writeHead(scenario.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'mock_error', code: String(scenario.status), message: `Mock scenario returned ${scenario.status}` } })); return; }
    const stream = Boolean(payload.stream);
    const protocol = req.url === '/v1/messages' ? 'anthropic' : req.url === '/v1/chat/completions' ? 'openai-chat' : 'openai-responses';
    if (!stream) { await delay(scenario.ttfbMs); res.writeHead(200, { 'content-type': 'application/json' }); res.end(scenario.invalidJson ? '{"invalid":' : JSON.stringify(responseJson(protocol, scenario))); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    await delay(scenario.ttfbMs);
    const total = Math.max(1, scenario.chunkCount); const text = 'Vision mock streaming output.';
    for (let i = 0; i < total; i++) { await delay(i === 0 ? Math.max(0, scenario.ttftMs - scenario.ttfbMs) : 10); if (scenario.interruptAt >= 0 && i === scenario.interruptAt) { res.destroy(); return; } const event = i === 0 ? { type: 'response.created', response: { id: `mock_${sha256(body).slice(0, 12)}` } } : { type: 'response.output_text.delta', delta: text.slice(Math.floor((i - 1) * text.length / Math.max(1, total - 1)), Math.floor(i * text.length / Math.max(1, total - 1))) }; res.write(`data: ${JSON.stringify(event)}\n\n`); }
    const usage = scenario.missingUsage ? undefined : { input_tokens: scenario.inconsistentUsage ? 1 : scenario.inputTokens, output_tokens: scenario.outputTokens, input_token_details: { cached_tokens: scenario.cacheRead, cache_write: scenario.cacheWrite }, output_token_details: { reasoning_tokens: scenario.reasoningTokens } };
    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { model: scenario.model, billing_model: scenario.billingModel }, usage })}\n\n`); res.write('data: [DONE]\n\n'); res.end();
  });
  server.listen(port, '127.0.0.1'); return server;
}
function responseJson(protocol: string, s: Required<MockScenario>): Record<string, unknown> { const usage = s.missingUsage ? undefined : { input_tokens: s.inputTokens, output_tokens: s.outputTokens, input_token_details: { cached_tokens: s.cacheRead, cache_write: s.cacheWrite }, output_token_details: { reasoning_tokens: s.reasoningTokens } }; if (protocol === 'anthropic') return { id: 'msg_mock', type: 'message', model: s.model, content: [{ type: 'text', text: 'Vision mock response' }], usage: { input_tokens: s.inputTokens, output_tokens: s.outputTokens } }; return { id: 'resp_mock', object: 'response', model: s.model, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Vision mock response' }] }], usage }; }
function readBody(req: http.IncomingMessage): Promise<string> { return new Promise((resolve, reject) => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(Buffer.from(c))); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject); }); }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
