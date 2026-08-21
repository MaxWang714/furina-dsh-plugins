import crypto from 'node:crypto';

export const DEFAULT_PRICING = Object.freeze({
  'deepseek-chat': { input: '0.27', output: '1.1', cacheRead: '0.07', cacheWrite: '1.1' },
  'deepseek-reasoner': { input: '0.55', output: '2.19', cacheRead: '0.14', cacheWrite: '2.19' },
  'deepseek-v4': { input: '0.5', output: '2', cacheRead: '0.125', cacheWrite: '2' },
});

export function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

/** Deterministic, secret-free request representation used for cache analysis. */
export function canonicalizeRequest(request = {}) {
  const canonical = {
    provider: request.provider ?? null,
    model: request.model ?? null,
    messages: Array.isArray(request.messages) ? request.messages.map((message) => ({
      role: message?.role ?? null,
      content: typeof message?.content === 'string' ? message.content : message?.content ?? null,
    })) : [],
    parameters: request.parameters && typeof request.parameters === 'object' ? sortObject(request.parameters) : {},
    tools: Array.isArray(request.tools) ? request.tools.map((tool) => sortObject(tool)) : [],
  };
  return JSON.stringify(canonical);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

export function cacheKey(request) { return `vision-cache-v1-${sha256(canonicalizeRequest(request))}`; }

/** Cache Planner is deliberately opt-in; this function only returns a plan and never serves a hit. */
export function planCache(request, { enabled = false } = {}) {
  return { enabled: Boolean(enabled), key: cacheKey(request), decision: enabled ? 'eligible-analysis-only' : 'disabled-by-default', semantic_risk: 'responses and tool side effects require caller approval' };
}

export function pricingKeyFor(model, pricing) {
  if (!model) return null;
  const lower = String(model).toLowerCase();
  const exact = Object.keys(pricing).find((key) => key.toLowerCase() === lower);
  if (exact) return exact;
  return Object.keys(pricing).filter((key) => lower.startsWith(key.toLowerCase())).sort((a, b) => b.length - a.length)[0] ?? null;
}

function decimal(value) {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100000000n + BigInt((fraction + '00000000').slice(0, 8));
}

function formatDecimal(scaled) {
  const raw = scaled.toString().padStart(9, '0');
  return `${raw.slice(0, -8)}.${raw.slice(-8)}`.replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function money(tokens, price, unit = 1000000n) {
  if (tokens == null || !Number.isInteger(tokens) || tokens < 0) return null;
  const rate = decimal(price);
  return rate == null ? null : formatDecimal((rate * BigInt(tokens)) / unit);
}

export function calculateCost(usage, model, pricing, multiplier = '1') {
  const key = pricingKeyFor(model, pricing);
  if (!key) return { pricingModel: null, inputCost: null, outputCost: null, cacheReadCost: null, cacheWriteCost: null, totalCost: null, currency: 'USD', calculationVersion: 'vision-dsh-cost-v1-unknown-price' };
  const p = pricing[key];
  const inputCost = money(usage.inputUncached, p.input); const outputCost = money(usage.outputText, p.output);
  const cacheReadCost = money(usage.cacheRead, p.cacheRead); const cacheWriteCost = money(usage.cacheWrite, p.cacheWrite);
  if (usage.quality === 'unknown' || [inputCost, outputCost, cacheReadCost, cacheWriteCost].some((value) => value == null)) return { pricingModel: key, inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost: null, currency: 'USD', calculationVersion: 'vision-dsh-cost-v1-unknown-usage' };
  const factor = decimal(multiplier) ?? 100000000n;
  const values = [inputCost, outputCost, cacheReadCost, cacheWriteCost].map(decimal);
  const total = values.reduce((sum, value) => sum + value, 0n);
  return { pricingModel: key, inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost: formatDecimal((total * factor) / 100000000n), currency: 'USD', calculationVersion: 'vision-dsh-cost-v1' };
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return { inputUncached: null, cacheRead: null, cacheWrite: null, outputText: null, outputReasoning: null, unclassified: null, quality: 'unknown', source: 'missing' };
  const n = (value) => Number.isInteger(value) && value >= 0 ? value : null;
  const input = n(raw.inputTokens); const output = n(raw.outputTokens); const cacheRead = n(raw.cacheReadTokens); const cacheWrite = n(raw.cacheWriteTokens); const reasoning = n(raw.reasoningTokens);
  const known = [input, output, cacheRead, cacheWrite, reasoning].some((value) => value != null);
  const complete = [input, output, cacheRead, cacheWrite, reasoning].every((value) => value != null);
  const inconsistent = input != null && cacheRead != null && cacheWrite != null && input < cacheRead + cacheWrite;
  return { inputUncached: input == null ? null : Math.max(0, input - (cacheRead ?? 0) - (cacheWrite ?? 0)), cacheRead, cacheWrite, outputText: output == null ? null : Math.max(0, output - (reasoning ?? 0)), outputReasoning: reasoning, unclassified: null, quality: inconsistent ? 'inconsistent' : complete ? 'complete' : known ? 'partial' : 'unknown', source: 'dsh_llm_stream' };
}

export function sanitizeError(error, maxLen = 200) {
  if (!error) return null;
  let text = String(error).replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]').replace(/\b(?:sk|ghp|gho|ghs|rk|ak)_[A-Za-z0-9_-]{8,}/g, '[REDACTED]').replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, '$1[REDACTED]');
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export function buildObservation({ options, startedAt, firstMeaningfulAt, completedAt, usage, status, errorCode, errorMessage, pricing, multiplier, privacy = 'normal' }) {
  const tokens = normalizeUsage(usage); const cost = calculateCost(tokens, options?.model ?? 'unknown', pricing, multiplier); const session = options?.sessionId ? sha256(options.sessionId) : null;
  return {
    observation_id: `obs_${crypto.randomUUID()}`, logical_request_id: `dsh_${options?.traceId ?? crypto.randomUUID()}`,
    source: 'dsh_agent', confidence: tokens.quality === 'unknown' ? 'unknown' : 'high', captured_at: new Date().toISOString(), raw_schema_version: 'vision-observation-v1',
    payload_hash: sha256(JSON.stringify({ provider: options?.provider ?? 'unknown', model: options?.model ?? 'unknown', startedAt })),
    metadata: { provider: options?.provider ?? 'unknown', model: options?.model ?? 'unknown', session_id: session, protocol: 'dsh-llm', privacy },
    metrics: { ttfb_ms: null, ttft_ms: firstMeaningfulAt == null ? null : firstMeaningfulAt - startedAt, duration_ms: completedAt - startedAt, timing_source: 'dsh_llm_stream', timing_confidence: firstMeaningfulAt == null ? 'unknown' : 'high' },
    tokens, status, error_code: errorCode ?? null, sanitized_error_message: sanitizeError(errorMessage), cost,
  };
}

export function aggregate(records, groupBy = 'provider') {
  const groups = new Map();
  for (const record of records) { const key = groupBy === 'day' ? String(record.captured_at).slice(0, 10) : record.metadata?.[groupBy] ?? 'unknown'; const bucket = groups.get(key) ?? { key, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost: '0', errors: 0, ttft: [] }; bucket.calls++; bucket.input_tokens += record.tokens.inputUncached ?? 0; bucket.output_tokens += (record.tokens.outputText ?? 0) + (record.tokens.outputReasoning ?? 0); bucket.cache_read_tokens += record.tokens.cacheRead ?? 0; bucket.cache_write_tokens += record.tokens.cacheWrite ?? 0; if (record.cost.totalCost != null) bucket.cost = formatDecimal(decimal(bucket.cost) + decimal(record.cost.totalCost)); if (record.status !== 'success') bucket.errors++; if (record.metrics.ttft_ms != null) bucket.ttft.push(record.metrics.ttft_ms); groups.set(key, bucket); }
  return [...groups.values()].map((bucket) => ({ key: bucket.key, calls: bucket.calls, input_tokens: bucket.input_tokens, output_tokens: bucket.output_tokens, cache_read_tokens: bucket.cache_read_tokens, cache_write_tokens: bucket.cache_write_tokens, cost: bucket.cost, errors: bucket.errors, ttft_p50: percentile(bucket.ttft, 0.5), ttft_p95: percentile(bucket.ttft, 0.95) })).sort((a, b) => a.key.localeCompare(b.key));
}

function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
