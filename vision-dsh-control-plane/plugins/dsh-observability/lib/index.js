import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { isTokenDelta } from '@deepseek-ai/dsh-llm';
import { DEFAULT_PRICING, aggregate, buildObservation, sanitizeError } from './core.js';

export const name = 'vision-dsh-observability';
export const inject = ['llm', 'tools'];
export const Config = z.object({
  dataDir: z.string().required(),
  gatewayUrl: z.string().default(''),
  privacy: z.string().default('normal'),
  multiplier: z.number().default(1),
  maxErrorLen: z.number().default(200),
});

const LOG_FILE = 'observations.jsonl';
const logPath = (dataDir) => join(dataDir, LOG_FILE);

function mergePricing(overrides) {
  const result = Object.fromEntries(Object.entries(DEFAULT_PRICING).map(([key, value]) => [key, { ...value }]));
  for (const [key, value] of Object.entries(overrides ?? {})) if (value && typeof value === 'object') result[key] = { ...result[key], ...value };
  return result;
}

export async function readObservations(dataDir) {
  if (!existsSync(logPath(dataDir))) return [];
  const text = await readFile(logPath(dataDir), 'utf8'); const rows = [];
  for (const line of text.split('\n')) { try { const value = JSON.parse(line); if (value?.observation_id) rows.push(value); } catch { /* tolerate a torn final line */ } }
  return rows;
}

export async function appendObservation(dataDir, observation) {
  await mkdir(dataDir, { recursive: true }); await appendFile(logPath(dataDir), `${JSON.stringify(observation)}\n`, 'utf8');
}

export async function pruneObservations(dataDir, days) {
  const rows = await readObservations(dataDir); const cutoff = Date.now() - days * 86400000;
  const kept = rows.filter((row) => Date.parse(row.captured_at) >= cutoff);
  await mkdir(dataDir, { recursive: true }); await writeFile(logPath(dataDir), kept.map((row) => JSON.stringify(row)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
  return rows.length - kept.length;
}

async function postObservation(gatewayUrl, observation) {
  if (!gatewayUrl) return { delivered: false, reason: 'offline_mode' };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/observations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(observation), signal: controller.signal });
    return { delivered: response.ok, status: response.status };
  } catch (error) { return { delivered: false, reason: sanitizeError(error?.message ?? error, 120) }; } finally { clearTimeout(timeout); }
}

async function emit(dataDir, gatewayUrl, observation) {
  try { await appendObservation(dataDir, observation); } catch (error) { console.warn(`[vision-dsh-observability] local append failed: ${sanitizeError(error?.message ?? error)}`); }
  const result = await postObservation(gatewayUrl, observation);
  if (gatewayUrl && !result.delivered) console.warn(`[vision-dsh-observability] Gateway delivery failed: ${result.reason ?? result.status}`);
}

export function apply(ctx, config) {
  const pricing = mergePricing(config.pricing);
  ctx.inject(['llm'], (llmCtx) => {
    llmCtx.on('llm/stream', (options, next) => {
      const startedAt = Date.now(); let firstMeaningfulAt = null; let usage = null; let status = 'running'; let errorCode = null; let errorMessage = null; let terminal = false;
      const stream = next();
      async function* audited() {
        try {
          for await (const chunk of stream) {
            if (firstMeaningfulAt == null && isTokenDelta(chunk)) firstMeaningfulAt = Date.now();
            if (chunk?.type === 'usage') usage = chunk.usage ?? null;
            if (chunk?.type === 'finish') { terminal = true; const reason = chunk.reason ?? {}; if (reason.kind === 'error') { status = 'error'; errorCode = reason.failure?.code ?? null; errorMessage = reason.failure?.message ?? reason.failure; } else if (reason.kind === 'aborted') { status = 'aborted'; errorCode = reason.failure?.code ?? null; errorMessage = reason.failure?.message ?? reason.failure; } else status = 'success'; }
            yield chunk;
          }
        } catch (error) { status = 'error'; errorCode = 'STREAM_ERROR'; errorMessage = error?.message ?? error; throw error; }
        finally {
          if (!terminal && status === 'running') status = 'aborted';
          const observation = buildObservation({ options, startedAt, firstMeaningfulAt, completedAt: Date.now(), usage, status, errorCode, errorMessage, pricing, multiplier: config.multiplier, privacy: config.privacy });
          await emit(config.dataDir, config.gatewayUrl, observation);
        }
      }
      return audited();
    });
  });

  ctx.tools.register(defineTool({
    name: 'vision_llm_usage_report', description: 'Vision DSH 模型调用观察汇总。数据仅来自本插件脱敏 Observation。',
    parameters: { groupBy: { type: 'string', enum: ['provider', 'model', 'day'], description: '聚合维度，默认 provider。' }, days: { type: 'number', description: '最近 N 天，默认 7。' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { rows: { type: 'array', items: { type: 'json' } }, total_calls: { type: 'integer' } } }, render: (_args, value) => [{ type: 'text', text: `Vision LLM usage: ${value.total_calls} calls\n${value.rows.map((row) => `${row.key}: ${row.calls} calls, in=${row.input_tokens}, out=${row.output_tokens}, cacheR=${row.cache_read_tokens}, cost=${row.cost}, TTFT p50=${row.ttft_p50 ?? '-'}ms`).join('\n') || '(none)'}` }] },
    execute: async (args) => { const rows = await readObservations(config.dataDir); const cutoff = Date.now() - (args.days ?? 7) * 86400000; const recent = rows.filter((row) => Date.parse(row.captured_at) >= cutoff); const grouped = aggregate(recent, args.groupBy === 'day' ? 'day' : args.groupBy ?? 'provider'); return { rows: grouped, total_calls: recent.length }; },
    presentCall: (args) => ({ card: 'generic', title: 'Vision LLM usage', kind: 'other', rawInput: `${args.groupBy ?? 'provider'}/${args.days ?? 7}d` }),
  }));

  ctx.tools.register(defineTool({
    name: 'vision_llm_usage_logs', description: '查询本地脱敏 Observation 明细。', parameters: { provider: { type: 'string' }, model: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { total: { type: 'integer' }, rows: { type: 'array', items: { type: 'json' } } } }, render: (_args, value) => [{ type: 'text', text: value.total ? `共 ${value.total} 条，显示 ${value.rows.length}\n${value.rows.map((row) => `${row.metadata.provider}/${row.metadata.model} ${row.status} ttft=${row.metrics.ttft_ms ?? '-'}ms`).join('\n')}` : '(无匹配 Observation)' }] },
    execute: async (args) => { let rows = await readObservations(config.dataDir); if (args.provider) rows = rows.filter((row) => row.metadata.provider === args.provider); if (args.model) rows = rows.filter((row) => row.metadata.model === args.model); rows.sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at)); const total = rows.length; return { total, rows: rows.slice(args.offset ?? 0, (args.offset ?? 0) + Math.min(args.limit ?? 100, 500)) }; },
    presentCall: () => ({ card: 'generic', title: 'Vision LLM observations', kind: 'other', rawInput: 'logs' }),
  }));

  ctx.tools.register(defineTool({
    name: 'vision_llm_usage_clear', description: '清理本地 Observation，保留最近 N 天。', parameters: { days: { type: 'number', description: '保留天数，默认 30。' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { removed: { type: 'integer' }, kept: { type: 'integer' } } }, render: (_args, value) => [{ type: 'text', text: `清理完成：删除 ${value.removed} 条，保留 ${value.kept} 条` }] },
    execute: async (args) => { const before = (await readObservations(config.dataDir)).length; const removed = await pruneObservations(config.dataDir, args.days ?? 30); return { removed, kept: before - removed }; },
    presentCall: (args) => ({ card: 'generic', title: 'Prune Vision observations', kind: 'other', rawInput: `${args.days ?? 30}d` }),
  }));
}
