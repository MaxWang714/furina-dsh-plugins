// furina-llm-manager — pure core: pricing / aggregation / JSONL store.
// P65 port of LLM-Manager's proxy_request_logs + model_pricing + usage_stats
// onto DSH's llm/stream waterfall. No cordis, no I/O beyond dataDir JSONL.

export const DEFAULT_PRICING = {
  // Per-million-token USD, seeded from public DeepSeek pricing (V3-era) as
  // calibratable defaults. DSH uses DeepSeek-V4-* models; exact V4 rates are
  // not public, so seed V4 entries through the same multiplier mechanism and
  // let the operator adjust (llmPricing/update).
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 2.19 },
  // DeepSeek-V4 series: placeholder pricing (not public); calibrate via
  // llmPricing/update.  Prefix matches V4-Flash, V4-Pro, V4-* variants.
  "deepseek-v4": { input: 0.5, output: 2.0, cacheRead: 0.125, cacheWrite: 2.0 },
};

/** Match a model id to a pricing key: exact, then longest prefix. Case-insensitive. */
export function pricingKeyFor(model, pricing) {
  if (!model) return null;
  const lc = model.toLowerCase();
  if (pricing[model]) return model;
  // Check exact lowercase match first
  for (const key of Object.keys(pricing)) {
    if (key.toLowerCase() === lc) return key;
  }
  // Then longest prefix match (case-insensitive)
  let best = null;
  for (const key of Object.keys(pricing)) {
    if (lc.startsWith(key.toLowerCase()) && (best === null || key.length > best.length)) best = key;
  }
  return best;
}

/** Compute USD cost for one call's token usage by exact/prefix model match. */
export function computeCostFor(model, usage, pricing, multiplier = 1) {
  const { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, reasoningTokens = 0 } = usage ?? {};
  const key = pricingKeyFor(model, pricing);
  if (key === null) {
    return {
      cost_usd: 0,
      input_cost_usd: 0,
      output_cost_usd: 0,
      cache_read_cost_usd: 0,
      cache_write_cost_usd: 0,
      pricing_model: null,
    };
  }
  const p = pricing[key];
  const inputCost = (inputTokens / 1e6) * p.input;
  const outputCost = (outputTokens / 1e6) * p.output;
  const cacheReadCost = (cacheReadTokens / 1e6) * (p.cacheRead ?? p.input);
  const cacheWriteCost = (cacheWriteTokens / 1e6) * (p.cacheWrite ?? p.output);
  const m = multiplier;
  return {
    cost_usd: (inputCost + outputCost + cacheReadCost + cacheWriteCost) * m,
    input_cost_usd: inputCost * m,
    output_cost_usd: outputCost * m,
    cache_read_cost_usd: cacheReadCost * m,
    cache_write_cost_usd: cacheWriteCost * m,
    pricing_model: key,
  };
}

/** Token bucket helper for aggregation. */
function emptyBucket() {
  return {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
    first_token_ms: [],
    duration_ms: [],
    errors: 0,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/**
 * Aggregate call records.
 * @param {Array} records - parsed llm_call_logs rows.
 * @param {string} groupBy - "provider" | "model" | "day" (day uses created_at).
 * @returns array of { key, ...bucket, ttft_p50, ttft_p95, duration_p50, tokens_per_sec }
 */
export function aggregate(records, groupBy = "provider") {
  const map = new Map();
  const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
  for (const r of records) {
    const key = groupBy === "day" ? dayOf(r.created_at ?? 0) : r[groupBy] ?? "unknown";
    let b = map.get(key);
    if (!b) { b = emptyBucket(); map.set(key, b); }
    b.calls += 1;
    b.input_tokens += r.input_tokens ?? 0;
    b.output_tokens += r.output_tokens ?? 0;
    b.cache_read_tokens += r.cache_read_tokens ?? 0;
    b.cache_write_tokens += r.cache_write_tokens ?? 0;
    b.reasoning_tokens += r.reasoning_tokens ?? 0;
    b.cost_usd += r.cost_usd ?? 0;
    if (r.first_token_ms != null) b.first_token_ms.push(r.first_token_ms);
    if (r.duration_ms != null) b.duration_ms.push(r.duration_ms);
    if (r.status === "error" || r.status === "aborted") b.errors += 1;
  }
  const out = [];
  for (const [key, b] of map) {
    const ttft = [...b.first_token_ms].sort((a, z) => a - z);
    const dur = [...b.duration_ms].sort((a, z) => a - z);
    const totalSec = b.duration_ms.reduce((s, d) => s + d, 0) / 1000;
    out.push({
      key,
      calls: b.calls,
      input_tokens: b.input_tokens,
      output_tokens: b.output_tokens,
      cache_read_tokens: b.cache_read_tokens,
      cache_write_tokens: b.cache_write_tokens,
      reasoning_tokens: b.reasoning_tokens,
      cost_usd: Number(b.cost_usd.toFixed(6)),
      errors: b.errors,
      ttft_p50: percentile(ttft, 0.5),
      ttft_p95: percentile(ttft, 0.95),
      duration_p50: percentile(dur, 0.5),
      tokens_per_sec: totalSec > 0 ? Number(((b.output_tokens) / totalSec).toFixed(1)) : null,
    });
  }
  out.sort((a, z) => z.cost_usd - a.cost_usd || z.calls - a.calls);
  return out;
}

/** Parse one JSONL line, tolerant of corruption. Returns record or null. */
export function parseLogLine(line) {
  if (!line || typeof line !== "string") return null;
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && typeof obj.call_id === "string") return obj;
    return null;
  } catch {
    return null;
  }
}

/** Build one audit record from a completed stream observation. */
export function buildRecord({ options, startMs, ttftMs, usage, status, errorCode, errorMessage, sessionId, cost, pricingModel, seq }) {
  const now = Date.now();
  return {
    call_id: `c-${now}-${seq}`,
    provider: options?.provider ?? "unknown",
    model: options?.model ?? "unknown",
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_read_tokens: usage?.cacheReadTokens ?? 0,
    cache_write_tokens: usage?.cacheWriteTokens ?? 0,
    reasoning_tokens: usage?.reasoningTokens ?? 0,
    first_token_ms: ttftMs ?? null,
    duration_ms: now - startMs,
    status,
    error_code: errorCode ?? null,
    error_message: errorMessage ?? null,
    session_id: sessionId ?? null,
    cost_usd: cost?.cost_usd ?? 0,
    input_cost_usd: cost?.input_cost_usd ?? 0,
    output_cost_usd: cost?.output_cost_usd ?? 0,
    cache_read_cost_usd: cost?.cache_read_cost_usd ?? 0,
    cache_write_cost_usd: cost?.cache_write_cost_usd ?? 0,
    pricing_model: pricingModel ?? null,
    created_at: now,
  };
}

/** Redact likely secret-bearing content from an error message. */
export function redactError(message, maxLen = 200) {
  if (typeof message !== "string" || message.length === 0) return null;
  let out = message;
  const patterns = [
    /\b(?:Bearer|Authorization)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /\b(?:sk|pk|ghp|gho|ghu|ghs|rk|ak)_[A-Za-z0-9]{8,}/gi,
    /\bapi[_-]?key\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi,
    /\bx-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi,
  ];
  for (const re of patterns) out = out.replace(re, "[redacted]");
  if (out.length > maxLen) out = out.slice(0, maxLen) + "…";
  return out;
}

/** Filter records: provider/model exact + created_at range; returns page. */
export function filterRecords(records, { provider, model, from, to, limit = 100, offset = 0 } = {}) {
  let out = records;
  if (provider) out = out.filter((r) => r.provider === provider);
  if (model) out = out.filter((r) => r.model === model);
  if (from != null) out = out.filter((r) => (r.created_at ?? 0) >= from);
  if (to != null) out = out.filter((r) => (r.created_at ?? 0) <= to);
  out = [...out].sort((a, z) => (z.created_at ?? 0) - (a.created_at ?? 0));
  const total = out.length;
  const page = out.slice(offset, offset + Math.min(limit, 500));
  return { total, rows: page };
}

/** Normalize a user-supplied pricing table against schema. */
export function normalizePricing(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [model, p] of Object.entries(raw)) {
      if (!p || typeof p !== "object") continue;
      const input = Number(p.input), output = Number(p.output);
      if (!Number.isFinite(input) && !Number.isFinite(output)) continue; // no price info
      out[model] = {
        input: Number.isFinite(input) ? input : 0,
        output: Number.isFinite(output) ? output : 0,
        cacheRead: p.cacheRead != null ? Number(p.cacheRead) : (Number.isFinite(input) ? input : 0),
        cacheWrite: p.cacheWrite != null ? Number(p.cacheWrite) : (Number.isFinite(output) ? output : 0),
      };
    }
  }
  return out;
}
