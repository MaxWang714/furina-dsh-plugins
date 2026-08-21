import { describe, expect, it } from 'vitest';
import { calculateCost, classifyMeaningfulEvent, createRequest, deriveMetrics, normalizeTokens, redact } from '../apps/desktop/src/core.js';

describe('Vision core semantics', () => {
  it('does not classify metadata as TTFT', () => {
    expect(classifyMeaningfulEvent({ type: 'response.created' })).toBe(false);
    expect(classifyMeaningfulEvent({ type: 'response.output_text.delta', delta: '' })).toBe(false);
    expect(classifyMeaningfulEvent({ type: 'response.output_text.delta', delta: 'x' })).toBe(true);
  });
  it('keeps TTFB and TTFT separate', () => {
    const m = deriveMetrics({ upstreamStartedAt: 1000, firstByteAt: 1010, firstMeaningfulOutputAt: 1040, completedAt: 2040 }, 20);
    expect(m.ttfbMs).toBe(10); expect(m.ttftMs).toBe(40); expect(m.generationMs).toBe(1000); expect(m.outputTps).toBe(20);
  });
  it('normalizes cache and reasoning buckets', () => {
    const t = normalizeTokens({ input_tokens: 100, output_tokens: 30, input_token_details: { cached_tokens: 20, cache_write: 5 }, output_token_details: { reasoning_tokens: 10 } });
    expect(t.inputUncached).toBe(75); expect(t.cacheRead).toBe(20); expect(t.cacheWrite).toBe(5); expect(t.outputText).toBe(20); expect(t.outputReasoning).toBe(10); expect(t.quality).toBe('complete');
  });
  it('does not turn missing usage into zero', () => { expect(normalizeTokens(null).quality).toBe('unknown'); expect(normalizeTokens(null).inputUncached).toBeNull(); });
  it('calculates decimal money without floating point facts', () => { const r = calculateCost(normalizeTokens({ input_tokens: 1000000, output_tokens: 1000000 }), { id:'p',providerId:'m',modelId:'m',inputPrice:'1',outputPrice:'2',cacheReadPrice:'0.5',cacheWritePrice:'0.5',currency:'USD',unit:1000000,effectiveFrom:'2020',effectiveUntil:null,source:'test',confidence:'exact',createdAt:'2020',contentHash:'x' }); expect(r.inputCost).toBe('1'); expect(r.outputCost).toBe('2'); expect(r.totalApiCost).toBe('3'); });
  it('redacts secrets before persistence', () => { const r = redact({ Authorization: 'Bearer secret', api_key: 'sk-test', nested: { cookie: 'x' } }) as Record<string, unknown>; expect(r.Authorization).toBe('[REDACTED]'); expect(r.api_key).toBe('[REDACTED]'); expect((r.nested as Record<string, unknown>).cookie).toBe('[REDACTED]'); });
  it('creates a new Vision request identity', () => { const r = createRequest({ requestedModel:'a',normalizedModel:'a',billingModel:'a' }); expect(r.id).toMatch(/^req_/); expect(r.status).toBe('running'); expect(r.finalizedAt).toBeNull(); });
});
