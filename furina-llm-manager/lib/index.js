// furina-llm-manager — cordis plugin: LLM call source audit + pricing + stats.
// P65 port of LLM-Manager (proxy_request_logs / model_pricing / usage_stats).
// Hooks DSH's llm/stream waterfall (every model call passes through) and
// exposes llmUsage/* / llmProviders/* / llmPricing/* tools.
// Mounted via profile cordis.patch.yml `- insert:` (user layer, official untouched).
import { mkdir, readFile, appendFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { isTokenDelta } from "@deepseek-ai/dsh-llm";
import {
  DEFAULT_PRICING, pricingKeyFor, computeCostFor, aggregate, parseLogLine,
  buildRecord, redactError, filterRecords, normalizePricing,
} from "./core.js";

export const name = "furina-llm-manager";
export const inject = ["llm", "tools"];
export const Config = z.object({
  // Plugin data directory (audit JSONL + pricing overrides).
  dataDir: z.string().required(),
  // Cost multiplier applied to all computed costs (e.g. membership discount).
  multiplier: z.number().default(1),
  // Extra pricing entries merged over DEFAULT_PRICING (model -> per-million USD).
  // Extra pricing entries merged over DEFAULT_PRICING (model -> per-million USD).
  // Shape: { model: { input, output, cacheRead?, cacheWrite? } }; normalized in core.
  pricing: z.dict(z.any()).default({}),
  maxErrorLen: z.number().default(200),
});

const LOG_FILE = "llm_call_logs.jsonl";
const PRICING_FILE = "pricing.overrides.json";
let seqCounter = 0;

function logPath(dataDir) { return join(dataDir, LOG_FILE); }
function pricingPath(dataDir) { return join(dataDir, PRICING_FILE); }

/** Load persisted pricing overrides, merged over defaults. */
export async function loadPricing(dataDir, configPricing) {
  const merged = { ...DEFAULT_PRICING, ...normalizePricing(configPricing) };
  try {
    if (existsSync(pricingPath(dataDir))) {
      const raw = JSON.parse(await readFile(pricingPath(dataDir), "utf8"));
      Object.assign(merged, normalizePricing(raw));
    }
  } catch { /* overrides file optional/corrupt -> defaults */ }
  return merged;
}

/** Persist pricing overrides. */
export async function savePricing(dataDir, pricing) {
  await writeFile(pricingPath(dataDir), JSON.stringify(pricing, null, 2), "utf8");
}

/** Read all audit records (tolerant of corrupt lines). */
export async function readRecords(dataDir) {
  const file = logPath(dataDir);
  if (!existsSync(file)) return [];
  const text = await readFile(file, "utf8");
  return text.split("\n").map(parseLogLine).filter(Boolean);
}

/** Append one record atomically (single write call per record). */
export async function appendRecord(dataDir, record) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(logPath(dataDir), JSON.stringify(record) + "\n", "utf8");
}

/** Rewrite the log keeping only records younger than `days`. */
export async function pruneRecords(dataDir, days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const records = await readRecords(dataDir);
  const kept = records.filter((r) => (r.created_at ?? 0) >= cutoff);
  await mkdir(dataDir, { recursive: true });
  await writeFile(logPath(dataDir), kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : ""), "utf8");
  return records.length - kept.length;
}

/**
 * Wrap a llm/stream chunk stream with source audit: TTFT, usage, finish,
 * cost. Never throws into the call: audit failures degrade to a warn log.
 */
export function auditStream(stream, options, startMs, dataDir, pricing, multiplier, maxErrorLen) {
  let ttftMs = null;
  let usage = null;
  let status = "ok";
  let errorCode = null;
  let errorMessage = null;
  let lastChunk;

  async function* wrapped() {
    try {
      for await (const chunk of stream) {
        lastChunk = chunk;
        if (ttftMs === null && isTokenDelta(chunk)) ttftMs = Date.now() - startMs;
        if (chunk.type === "usage") usage = chunk.usage;
        if (chunk.type === "finish") {
          const reason = chunk.reason ?? {};
          if (reason.kind === "error") {
            status = "error";
            errorCode = reason.failure?.code ?? null;
            errorMessage = redactError(reason.failure?.message ?? String(reason.failure ?? ""), maxErrorLen);
          } else if (reason.kind === "aborted") {
            status = "aborted";
            errorCode = reason.failure?.code ?? null;
            errorMessage = redactError(reason.failure?.message ?? "", maxErrorLen);
          } else {
            status = "ok";
          }
        }
        yield chunk;
      }
    } finally {
      // Record regardless of how iteration ended (complete, break, throw).
      const cost = computeCostFor(options?.model ?? "", usage ?? {}, pricing, multiplier);
      const record = buildRecord({
        options,
        startMs,
        ttftMs,
        usage,
        status,
        errorCode,
        errorMessage,
        sessionId: options?.sessionId ?? null,
        cost,
        pricingModel: cost.pricing_model,
        seq: ++seqCounter,
      });
      try {
        await appendRecord(dataDir, record);
      } catch (e) {
        console.warn(`[furina-llm-manager] audit append failed: ${e?.message ?? e}`);
      }
    }
  }
  return wrapped();
}

/** Build one audit record from a completed stream observation. */
export function apply(ctx, config) {
  const { dataDir, multiplier } = config;

  // --- Source audit hook: every DSH LLM call passes llm/stream waterfall. ---
  ctx.inject(["llm"], (ctx) => {
    let pricingPromise = loadPricing(dataDir, config.pricing);
    ctx.on("llm/stream", (options, next) => {
      const startMs = Date.now();
      const stream = next();

      // The waterfall contract requires this handler to return an
      // AsyncIterable immediately. Keep asynchronous pricing I/O inside the
      // generator instead of turning the handler itself into a Promise.
      async function* audited() {
        const pricing = await pricingPromise;
        yield* auditStream(stream, options, startMs, dataDir, pricing, multiplier, config.maxErrorLen);
      }

      return audited();
    });
  });

  // --- Tools ---
  const refreshPricing = () => loadPricing(dataDir, config.pricing);

  ctx.tools.register(defineTool({
    name: "llmUsage/report",
    description:
      "LLM 调用审计汇总（源头 token 审计，P65）：按 provider/model/day 聚合 调用数/tokens/成本/TTFT/生成速度。" +
      "数据来自 llm/stream 瀑布（每次模型调用自动记账）。",
    parameters: {
      groupBy: { type: "string", enum: ["provider", "model", "day"], description: "聚合维度，默认 provider。" },
      days: { type: "number", description: "统计最近 N 天，默认 7。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          rows: { type: "array", items: { type: "json" } },
          total_cost_usd: { type: "number" },
          total_calls: { type: "integer" },
        },
      },
      render: (_args, value) => {
        const lines = value.rows.map((r) =>
          `${r.key}: ${r.calls} calls, in=${r.input_tokens} out=${r.output_tokens} cacheR=${r.cache_read_tokens} cacheW=${r.cache_write_tokens}, ` +
          `$${r.cost_usd} (err=${r.errors}), TTFT p50=${r.ttft_p50 ?? "-"}ms p95=${r.ttft_p95 ?? "-"}ms, dur p50=${r.duration_p50 ?? "-"}ms, ${r.tokens_per_sec ?? "-"} tok/s`
        );
        return [{ type: "text", text: `LLM 审计（${value.rows.length} 组，合计 $${value.total_cost_usd} / ${value.total_calls} calls）：\n` + (lines.join("\n") || "（暂无记录）") }];
      },
    },
    execute: async (args) => {
      const records = await readRecords(dataDir);
      const cutoff = Date.now() - (args.days ?? 7) * 24 * 3600 * 1000;
      const recent = records.filter((r) => (r.created_at ?? 0) >= cutoff);
      const rows = aggregate(recent, args.groupBy ?? "provider");
      return {
        rows,
        total_cost_usd: Number(rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(6)),
        total_calls: rows.reduce((s, r) => s + r.calls, 0),
      };
    },
    presentCall: (args) => ({ card: "generic", title: "LLM usage report", kind: "other", rawInput: `${args.groupBy ?? "provider"}/${args.days ?? 7}d` }),
  }));

  ctx.tools.register(defineTool({
    name: "llmUsage/logs",
    description:
      "LLM 调用审计明细查询（分页）。过滤：provider/model 精确匹配，from/to 时间戳。" +
      "按时间倒序，最多 500 条/页。",
    parameters: {
      provider: { type: "string", description: "精确 provider 过滤。" },
      model: { type: "string", description: "精确 model 过滤。" },
      from: { type: "number", description: "起始时间戳(ms)。" },
      to: { type: "number", description: "结束时间戳(ms)。" },
      limit: { type: "number", description: "页大小，默认 100。" },
      offset: { type: "number", description: "偏移，默认 0。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          total: { type: "integer" },
          rows: { type: "array", items: { type: "json" } },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.total === 0
          ? "（无匹配审计记录）"
          : `共 ${value.total} 条，显示 ${value.rows.length}：\n` + value.rows.map((r) =>
              `[${new Date(r.created_at).toISOString().slice(0, 19)}] ${r.provider}/${r.model} in=${r.input_tokens} out=${r.output_tokens} ${r.status} $${r.cost_usd} ttft=${r.first_token_ms ?? "-"}ms dur=${r.duration_ms}ms`
            ).join("\n"),
      }],
    },
    execute: (args) => readRecords(dataDir).then((records) => filterRecords(records, args)),
    presentCall: (args) => ({ card: "generic", title: "LLM audit logs", kind: "other", rawInput: `${args.provider ?? "all"}/${args.model ?? "all"}` }),
  }));

  ctx.tools.register(defineTool({
    name: "llmUsage/clear",
    description:
      "清理审计台账：保留最近 N 天记录（默认 30），删除更早明细。返回删除条数。仅影响本插件审计数据。",
    parameters: {
      days: { type: "number", description: "保留天数，默认 30。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { removed: { type: "integer" }, kept: { type: "integer" } },
      },
      render: (_args, value) => [{ type: "text", text: `清理完成：删除 ${value.removed} 条，保留 ${value.kept} 条` }],
    },
    execute: async (args) => {
      const before = (await readRecords(dataDir)).length;
      const removed = await pruneRecords(dataDir, args.days ?? 30);
      return { removed, kept: before - removed };
    },
    presentCall: (args) => ({ card: "generic", title: "Prune audit logs", kind: "other", rawInput: `${args.days ?? 30}d` }),
  }));

  ctx.tools.register(defineTool({
    name: "llmProviders/list",
    description:
      "只读 Provider 视图：已注册 adapter 的 provider 清单（id/name/baseURL）+ 可配置 provider 目录。不写任何配置。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          providers: { type: "array", items: { type: "json" } },
          configurable: { type: "array", items: { type: "json" } },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: (value.providers.length === 0 ? "（无已注册 provider）\n" : value.providers.map((p) => `- ${p.id}（${p.name}${p.baseURL ? " / " + p.baseURL : ""}）`).join("\n") + "\n") +
          (value.configurable.length === 0 ? "（无 configurable provider）" : value.configurable.map((p) => `- cfg ${p.provider}（${p.displayName}, ns=${p.settingsNs}）`).join("\n")),
      }],
    },
    execute: () => ({
      providers: ctx.llm.listProviders(),
      configurable: ctx.llm.listConfigurableProviders(),
    }),
    presentCall: () => ({ card: "generic", title: "List LLM providers", kind: "other", rawInput: "providers" }),
  }));

  ctx.tools.register(defineTool({
    name: "llmProviders/health",
    description:
      "Provider 探活（只读网络调用）：对每个已注册 provider 执行 listModels + 首个模型 resolveModelInfo，" +
      "返回成功/失败与耗时。注意可能较慢。可选指定 provider。",
    parameters: {
      provider: { type: "string", description: "只探活该 provider（缺省全部）。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { results: { type: "array", items: { type: "json" } } },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.results.map((r) => `${r.provider}: ${r.ok ? "OK" : "FAIL"} (${r.ms}ms${r.models != null ? `, ${r.models} models` : ""}${r.error ? ", " + r.error : ""})`).join("\n"),
      }],
    },
    execute: async (args) => {
      const all = ctx.llm.listProviders();
      const targets = args.provider ? all.filter((p) => p.id === args.provider) : all;
      const results = [];
      for (const p of targets) {
        const t0 = Date.now();
        try {
          const models = await ctx.llm.listModels(p.id);
          let resolved = null;
          if (models.length > 0) {
            try { resolved = await ctx.llm.resolveModelInfo(p.id, models[0].id); } catch { resolved = null; }
          }
          results.push({ provider: p.id, ok: true, ms: Date.now() - t0, models: models.length, resolved: resolved?.id ?? null });
        } catch (e) {
          results.push({ provider: p.id, ok: false, ms: Date.now() - t0, error: redactError(e?.message ?? String(e), 160) });
        }
      }
      return { results };
    },
    presentCall: (args) => ({ card: "generic", title: "Provider health", kind: "other", rawInput: args.provider ?? "all" }),
  }));

  ctx.tools.register(defineTool({
    name: "llmPricing/list",
    description:
      "查看计价表（每百万 token USD）：默认 DeepSeek 档 + 覆盖项。模型按前缀匹配。" +
      "定价由 llmPricing/update 持久化到插件数据目录。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { pricing: { type: "json" }, multiplier: { type: "number" } },
      },
      render: (_args, value) => [{
        type: "text",
        text: `multiplier=${value.multiplier}\n` + Object.entries(value.pricing).map(([k, p]) => `- ${k}: in=${p.input} out=${p.output} cacheR=${p.cacheRead} cacheW=${p.cacheWrite}`).join("\n"),
      }],
    },
    execute: () => refreshPricing().then((pricing) => ({ pricing, multiplier })),
    presentCall: () => ({ card: "generic", title: "List pricing", kind: "other", rawInput: "pricing" }),
  }));

  ctx.tools.register(defineTool({
    name: "llmPricing/update",
    description:
      "更新计价表覆盖项（持久化到插件数据目录 pricing.overrides.json）。" +
      "示例：{\"deepseek-v4-flash\":{\"input\":0.27,\"output\":1.1,\"cacheRead\":0.07}}。" +
      "模型按前缀匹配；未覆盖模型按默认表。multiplier 由插件配置控制。",
    parameters: {
      entries: { type: "json", required: true, description: "model -> {input,output,cacheRead?,cacheWrite?} 每百万 USD。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { updated: { type: "integer" }, multiplier: { type: "number" } },
      },
      render: (_args, value) => [{ type: "text", text: `计价更新：${value.updated} 项，multiplier=${value.multiplier}` }],
    },
    execute: async (args) => {
      const pricing = await refreshPricing();
      const entries = normalizePricing(args.entries);
      for (const [k, v] of Object.entries(entries)) pricing[k] = v;
      await savePricing(dataDir, entries);
      return { updated: Object.keys(entries).length, multiplier };
    },
    presentCall: (args) => ({ card: "generic", title: "Update pricing", kind: "other", rawInput: `${Object.keys(args.entries ?? {}).length} entries` }),
  }));
}
