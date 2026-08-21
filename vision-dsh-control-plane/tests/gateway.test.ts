import { describe, expect, it, afterAll } from 'vitest';
import { startMockProvider } from '../apps/desktop/src/mock.js';
import { startGateway } from '../apps/desktop/src/gateway.js';
import { VisionStore } from '../apps/desktop/src/storage.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-')), 'test.db');
const store = new VisionStore(dbFile); const mock = startMockProvider(18890); const gateway = startGateway({ port: 18887, upstream: 'http://127.0.0.1:18890', store });
afterAll(() => { gateway.close(); mock.close(); store.db.close(); });

describe('gateway vertical slice', () => {
  it('proxies non-stream responses and persists cost', async () => { const r = await fetch('http://127.0.0.1:18887/v1/responses', { method:'POST', headers:{'content-type':'application/json','x-vision-agent':'codex'}, body: JSON.stringify({ model:'vision-mock-1', input:'hello' }) }); expect(r.status).toBe(200); const data = await r.json() as Record<string, unknown>; expect(data.object).toBe('response'); expect(store.listRequests(1)[0]?.status).toBe('success'); expect(store.listRequests(1)[0]?.tokens.inputUncached).toBe(120); });
  it('proxies SSE and records meaningful TTFT', async () => { const r = await fetch('http://127.0.0.1:18887/v1/responses', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'vision-mock-1', stream:true }) }); expect(r.status).toBe(200); await r.text(); const row = store.listRequests(1)[0]; expect(row?.isStreaming).toBe(true); expect(row?.metrics.ttfbMs).not.toBeNull(); expect(row?.metrics.ttftMs).not.toBeNull(); });
  it('keeps Chat Completions and Anthropic mock contracts available', async () => { for (const endpoint of ['/v1/chat/completions', '/v1/messages']) { const r = await fetch(`http://127.0.0.1:18890${endpoint}`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'vision-mock-1', input:'compat' }) }); expect(r.status).toBe(200); const data = await r.json() as Record<string, unknown>; expect(data.id).toBeTruthy(); } });
  it('classifies upstream rate limits without leaking provider text', async () => { const r = await fetch('http://127.0.0.1:18887/v1/responses', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'vision-mock-1', scenario:{ status:429 } }) }); expect(r.status).toBe(429); const row = store.listRequests(1)[0]; expect(row?.errorType).toBe('rate_limit'); expect(row?.sanitizedErrorMessage).toBe('Upstream request failed (429)'); });
});
