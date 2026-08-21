import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const name = "furina-codex-provider";
export const inject = ["llm"];
const DEFAULT_BASE_URL = "https://chatgpt.com";
const DEFAULT_PATH = "/backend-api/codex/responses";
const DEFAULT_AUTH_PATH = resolve(homedir(), ".codex", "auth.json");
const DEFAULT_MODELS = ["gpt-5.6-sol", "gpt-5.6-sol-mini", "gpt-5.6-sol-high", "gpt-5.6-sol-mini-high", "gpt-5.4", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2-codex", "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex-mini"];

function configValue(config, key, fallback) { const value = config?.[key] ?? process.env[key]; return value == null || value === "" ? fallback : value; }

export function readAccessToken({ authPath = DEFAULT_AUTH_PATH, env = process.env } = {}) {
  const fromEnv = env.CODEX_ACCESS_TOKEN ?? env.OPENAI_ACCESS_TOKEN;
  if (fromEnv) return fromEnv;
  if (!existsSync(authPath)) throw new Error(`Codex auth file not found at ${authPath}`);
  let auth; try { auth = JSON.parse(readFileSync(authPath, "utf8")); } catch { throw new Error("Codex auth file is not valid JSON"); }
  const token = auth?.tokens?.access_token ?? auth?.access_token;
  if (!token) throw new Error("No access_token found in Codex auth file; run codex login first");
  return token;
}

export function sanitizeError(value, maxLen = 240) {
  let text = String(value ?? "").replace(/Bearer\s+[^\s,]+/gi, "Bearer [REDACTED]").replace(/\b(?:sk|ghp|gho|ghs|rk|ak)_[A-Za-z0-9_-]{8,}/g, "[REDACTED]").replace(/((?:[?&\s]|^)\b(?:api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, "$1[REDACTED]");
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function extractContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part?.text ?? part?.content ?? "").join("");
  return content == null ? "" : String(content);
}
function buildInput(messages = []) { return messages.map((message) => ({ role: message.role ?? "user", content: extractContent(message.content) })); }
function parseModelList(value) { if (!value) return DEFAULT_MODELS; try { const parsed = JSON.parse(value); if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed; } catch {} return DEFAULT_MODELS; }

/** Incrementally parse an SSE Response body without buffering the whole response. */
export async function* parseSseBody(body, decoder = new TextDecoder()) {
  let buffer = "", event = "", data = [];
  const flush = function* () { if (!event && data.length === 0) return; const payload = data.join("\n"); data = []; const result = { event, data: payload }; event = ""; if (payload || result.event) yield result; };
  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") { yield* flush(); continue; }
      if (line.startsWith(":")) continue;
      const separator = line.indexOf(":"); const field = separator < 0 ? line : line.slice(0, separator); const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") event = value; else if (field === "data") data.push(value);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) for (const line of buffer.split(/\r?\n/)) { if (line.startsWith("event:")) event = line.slice(6).trim(); else if (line.startsWith("data:")) data.push(line.slice(5).trim()); }
  yield* flush();
}

function usageFromResponse(response) {
  const usage = response?.usage; if (!usage || typeof usage !== "object") return null; const result = {};
  const put = (name, value) => { if (Number.isInteger(value) && value >= 0) result[name] = value; };
  put("inputTokens", usage.input_tokens); put("outputTokens", usage.output_tokens); put("reasoningTokens", usage.output_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens); put("cacheReadTokens", usage.input_tokens_details?.cached_tokens ?? usage.cache_read_tokens); put("cacheWriteTokens", usage.input_tokens_details?.cache_write_tokens ?? usage.cache_write_tokens);
  return Object.keys(result).length ? result : null;
}

export function createCodexAdapter(ctx, config = {}) {
  const baseUrl = String(configValue(config, "CODEX_BASE_URL", DEFAULT_BASE_URL)).replace(/\/$/, ""); const apiPath = String(configValue(config, "CODEX_API_PATH", DEFAULT_PATH)); const authPath = configValue(config, "CODEX_AUTH_PATH", DEFAULT_AUTH_PATH); const accessToken = configValue(config, "CODEX_ACCESS_TOKEN", null); const proxyUrl = configValue(config, "CODEX_PROXY_URL", null); const models = parseModelList(configValue(config, "CODEX_MODELS", null)); const transport = config.transport ?? defaultTransport;
  return {
    providerInfo(provider) { return { id: provider, name: "Codex (OpenAI via ChatGPT)" }; },
    providerRetryPolicy() { return undefined; },
    async listModels() { return models.map((id) => ({ id, name: id })); },
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 128000 } }; },
    async *stream(options = {}) {
      const token = readAccessToken({ authPath, env: { ...process.env, CODEX_ACCESS_TOKEN: accessToken ?? process.env.CODEX_ACCESS_TOKEN } }); const model = options.model ?? models[0];
      let response;
      try { response = await transport({ url: `${baseUrl}${apiPath}`, proxyUrl, signal: options.signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream", "OpenAI-Beta": "responses=v1", "User-Agent": "furina-codex-provider/1.0" }, body: JSON.stringify({ model, input: buildInput(options.messages), store: false, stream: true }) }); }
      catch (error) { if (options.signal?.aborted) { yield { type: "finish", reason: { kind: "aborted", failure: { code: "CODEX_ABORTED", message: "Codex request aborted" } } }; return; } throw error; }
      ctx?.logger?.debug?.(`[codex-provider] upstream status=${response.status}`);
      if (!response.ok) { let message = `Codex upstream returned HTTP ${response.status}`; try { const error = await response.json(); message = error?.detail ?? error?.error?.message ?? message; } catch {} yield { type: "finish", reason: { kind: "error", failure: { code: "CODEX_API_ERROR", message: sanitizeError(message) } } }; return; }
      if (!response.body) { yield { type: "finish", reason: { kind: "error", failure: { code: "CODEX_EMPTY_STREAM", message: "Codex upstream returned no body" } } }; return; }
      let text = "", reasoning = "", textStarted = false, reasoningStarted = false, finalUsage = null, finalError = null;
      try { for await (const sse of parseSseBody(response.body)) {
        if (!sse.data || sse.data === "[DONE]") continue; let parsed; try { parsed = JSON.parse(sse.data); } catch { continue; }
        const type = sse.event || parsed.type || "";
        if (type === "response.output_text.delta") { const delta = String(parsed.delta ?? ""); if (!textStarted) { textStarted = true; yield { type: "block-start", index: 0, blockType: "text" }; } if (delta) { text += delta; yield { type: "text-delta", index: 0, text: delta }; } }
        else if (type === "response.output_text.done" && !textStarted && parsed.text) { textStarted = true; text = String(parsed.text); yield { type: "block-start", index: 0, blockType: "text" }; yield { type: "text-delta", index: 0, text }; }
        else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") { const delta = String(parsed.delta ?? ""); if (!reasoningStarted) { reasoningStarted = true; yield { type: "block-start", index: 1, blockType: "reasoning" }; } if (delta) { reasoning += delta; yield { type: "text-delta", index: 1, text: delta }; } }
        else if (type === "response.output_item.added" && parsed.item?.type === "function_call") yield { type: "tool-call", index: parsed.output_index ?? 0, toolCall: { id: parsed.item.call_id ?? parsed.item.id, name: parsed.item.name, arguments: parsed.item.arguments ?? "" } };
        else if (type === "response.completed") { finalUsage = usageFromResponse(parsed.response); if (parsed.response?.error) finalError = parsed.response.error.message ?? parsed.response.error.code; }
        else if (type === "error" || parsed.type === "error") finalError = parsed.error?.message ?? parsed.message ?? sse.data;
      } } catch (error) { if (options.signal?.aborted) { yield { type: "finish", reason: { kind: "aborted", failure: { code: "CODEX_ABORTED", message: "Codex stream aborted" } } }; return; } throw error; }
      if (textStarted) yield { type: "block-end", index: 0, block: { type: "text", text } }; if (reasoningStarted) yield { type: "block-end", index: 1, block: { type: "reasoning", text: reasoning } }; if (finalUsage) yield { type: "usage", usage: finalUsage }; if (finalError) yield { type: "finish", reason: { kind: "error", failure: { code: "CODEX_API_ERROR", message: sanitizeError(finalError) } } }; else yield { type: "finish", reason: { kind: "stop" } };
    },
  };
}

async function defaultTransport({ url, proxyUrl, signal, headers, body }) {
  const init = { method: "POST", headers, body, signal };
  if (proxyUrl) { try { const { ProxyAgent } = await import("undici"); init.dispatcher = new ProxyAgent(proxyUrl); } catch { throw new Error("CODEX_PROXY_URL requires the undici ProxyAgent runtime"); } }
  return fetch(url, init);
}

export function apply(ctx, config = {}) { ctx.inject(["llm"], (inner) => { const adapter = createCodexAdapter(inner, config); const dispose = inner.llm.registerAdapter([config.providerId ?? "codex-openai"], adapter); inner.logger?.info?.("[codex-provider] registered secure streaming adapter"); inner.on("dispose", () => dispose()); }); }
