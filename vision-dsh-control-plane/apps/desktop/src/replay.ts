import fs from 'node:fs';
import path from 'node:path';
import { VisionStore } from './storage.js';

export interface ReplayResult { fixture: string; passed: boolean; expected: Record<string, unknown>; actual: Record<string, unknown>; mismatches: string[]; }
export async function replayFixture(fixture: string, store: VisionStore, gatewayUrl = 'http://127.0.0.1:8787'): Promise<ReplayResult> {
  const root = path.resolve(process.cwd(), fixture); const request = JSON.parse(fs.readFileSync(path.join(root, 'request.json'), 'utf8')) as Record<string, unknown>; const scenario = JSON.parse(fs.readFileSync(path.join(root, 'scenario.json'), 'utf8')) as Record<string, unknown>; const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json'), 'utf8')) as Record<string, unknown>;
  const response = await fetch(`${gatewayUrl}/v1/responses`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...request, scenario }) }); const text = await response.text(); const row = store.listRequests(1)[0];
  const actual: Record<string, unknown> = { status: row?.status, protocol: row?.protocolIn, tokenQuality: row?.tokens.quality, inputUncached: row?.tokens.inputUncached, outputText: row?.tokens.outputText, cost: row?.cost.totalApiCost === null ? 'unknown' : row?.cost.totalApiCost, ttftMs: row?.metrics.ttftMs, outputTps: row?.metrics.outputTps, meaningfulEventRequired: row?.metrics.ttftMs !== null && row?.metrics.ttftMs !== undefined, httpStatus: response.status, responseBytes: text.length };
  const mismatches: string[] = []; for (const [key, value] of Object.entries(expected)) { if (key === 'ttftRangeMs' && Array.isArray(value)) { const n = Number(actual.ttftMs); if (!Number.isFinite(n) || n < Number(value[0]) || n > Number(value[1])) mismatches.push(`${key}: ${n} outside ${value}`); } else if (key === 'outputTpsMin') { if (Number(actual.outputTps ?? 0) < Number(value)) mismatches.push(`${key}: ${actual.outputTps}`); } else if (actual[key] !== value) mismatches.push(`${key}: expected ${String(value)}, got ${String(actual[key])}`); }
  return { fixture, passed: mismatches.length === 0, expected, actual, mismatches };
}
