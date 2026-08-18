// furina-codex-provider — cordis plugin: wraps ChatGPT Codex backend API as a DSH LLM provider.
// Registers the "codex-openai" provider route, calling chatgpt.com/backend-api/codex/responses
// directly (bypassing the Codex CLI binary). Uses the OAuth token from ~/.codex/auth.json.
// Architecture: DSH LLM provider adapter → HTTPS → chatgpt.com (via Clash proxy) → LLM Manager audit.
//
// NOTE: The DSH sandbox blocks Node.js child_process.spawn with pipe stdio (EPERM).
// This version uses raw HTTP CONNECT tunneling through the Clash proxy (127.0.0.1:7890)
// to avoid node:fetch timeout issues, and does not spawn any subprocesses.
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const name = "furina-codex-provider";
export const inject = ["llm"];

// Proxy settings (Clash for Windows default).
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 7890;

// ChatGPT backend endpoint.
const API_HOST = "chatgpt.com";
const API_PATH = "/backend-api/codex/responses";

// Path to Codex OAuth token.
const CODEX_AUTH_PATH = resolve(homedir(), ".codex", "auth.json");

// Models this adapter advertises (from codex-proxy project).
const KNOWN_MODELS = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", context: 128000 },
  { id: "gpt-5.6-sol-mini", name: "GPT-5.6 Sol Mini", context: 128000 },
  { id: "gpt-5.6-sol-high", name: "GPT-5.6 Sol High", context: 128000 },
  { id: "gpt-5.6-sol-mini-high", name: "GPT-5.6 Sol Mini High", context: 128000 },
  { id: "gpt-5.4", name: "GPT-5.4", context: 128000 },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", context: 128000 },
  { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", context: 128000 },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", context: 128000 },
  { id: "gpt-5.1", name: "GPT-5.1", context: 128000 },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", context: 128000 },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", context: 128000 },
];

/**
 * Read the OAuth token from ~/.codex/auth.json.
 */
function readToken() {
  if (!existsSync(CODEX_AUTH_PATH)) {
    throw new Error(`Codex auth file not found at ${CODEX_AUTH_PATH}. Install Codex CLI first.`);
  }
  const auth = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf8"));
  const token = auth.tokens?.access_token;
  if (!token) {
    throw new Error("No access_token found in Codex auth file. Run 'codex login' first.");
  }
  return token;
}

/**
 * Establish a TLS tunnel to (hostname:port) through the Clash proxy.
 * Returns a connected TLS socket.
 */
function tunnelConnect(hostname, port, signal) {
  return new Promise((resolve, reject) => {
    const proxyReq = http.request({
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      method: "CONNECT",
      path: `${hostname}:${port}`,
      timeout: 15000,
    });

    const abort = () => {
      proxyReq.destroy?.();
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });

    proxyReq.on("connect", (res, socket) => {
      signal?.removeEventListener("abort", abort);
      // Upgrade the plain TCP socket to TLS.
      const tlsSocket = tls.connect({
        socket,
        servername: hostname,
        rejectUnauthorized: false,
      }, () => resolve(tlsSocket));
      tlsSocket.on("error", reject);
    });

    proxyReq.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });

    proxyReq.on("timeout", () => {
      signal?.removeEventListener("abort", abort);
      proxyReq.destroy();
      reject(new Error("CONNECT tunnel timeout"));
    });

    proxyReq.end();
  });
}

/**
 * Send an HTTP request over a TLS tunnel and collect the response body.
 * Returns { status, headers, body }.
 */
async function tunnelRequest(method, hostname, path, reqHeaders, body, signal) {
  const tlsSocket = await tunnelConnect(hostname, 443, signal);

  return new Promise((resolve, reject) => {
    const abort = () => {
      try { tlsSocket.destroy(); } catch {}
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });

    // Build the raw HTTP request.
    let reqStr = `${method} ${path} HTTP/1.1\r\nHost: ${hostname}\r\n`;
    for (const [k, v] of Object.entries(reqHeaders)) {
      reqStr += `${k}: ${v}\r\n`;
    }
    if (body) {
      reqStr += `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n`;
    }
    reqStr += "Connection: close\r\n\r\n";
    if (body) reqStr += body;

    // Send the request.
    tlsSocket.write(reqStr);

    let rawData = "";
    tlsSocket.on("data", (chunk) => {
      rawData += chunk.toString("utf8");
    });

    tlsSocket.on("end", () => {
      signal?.removeEventListener("abort", abort);
      // Parse HTTP response.
      const headerEnd = rawData.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        reject(new Error("Malformed HTTP response: no header boundary"));
        return;
      }
      const headerLines = rawData.substring(0, headerEnd).split("\r\n");
      const statusLine = headerLines[0];
      const status = parseInt(statusLine.split(" ")[1], 10);
      const headers = {};
      for (let i = 1; i < headerLines.length; i++) {
        const colonIdx = headerLines[i].indexOf(":");
        if (colonIdx > 0) {
          const k = headerLines[i].substring(0, colonIdx).trim().toLowerCase();
          const v = headerLines[i].substring(colonIdx + 1).trim();
          headers[k] = v;
        }
      }
      const body = rawData.substring(headerEnd + 4);
      resolve({ status, headers, body });
    });

    tlsSocket.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });
  });
}

/**
 * Handle chunked transfer encoding for SSE responses.
 * The raw HTTP response body may be chunked (chunk-size + chunk-data + \r\n).
 * Returns the concatenated body after dechunking, or the raw body if not chunked.
 */
function dechunkIfNeeded(body, headers) {
  if (headers["transfer-encoding"] !== "chunked") return body;

  let result = "";
  let pos = 0;
  while (pos < body.length) {
    // Find the chunk size line (hex + \r\n).
    const crlf = body.indexOf("\r\n", pos);
    if (crlf === -1) break;
    const chunkSizeHex = body.substring(pos, crlf).trim();
    if (!chunkSizeHex) break;
    const chunkSize = parseInt(chunkSizeHex, 16);
    if (chunkSize === 0) break; // Final chunk.
    pos = crlf + 2;
    result += body.substring(pos, pos + chunkSize);
    pos += chunkSize + 2; // Skip trailing \r\n.
  }
  return result;
}

/**
 * Extract text content from a DSH message content field.
 * Handles both string and array formats.
 */
function extractMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === "string") return c;
      if (c.type === "text") return c.text;
      if (c.type === "reasoning") return c.text;
      return "";
    }).join("").trim();
  }
  return String(content ?? "");
}

/**
 * Adapter class implementing DSH's LlmAdapter contract.
 * Calls chatgpt.com/backend-api/codex/responses directly via TLS tunnel.
 */
class CodexAdapter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  providerInfo(provider) {
    return { id: provider, name: "Codex (OpenAI via ChatGPT)" };
  }

  providerRetryPolicy(_provider) {
    return undefined; // Use DSH defaults.
  }

  async listModels(_provider) {
    return KNOWN_MODELS.map((m) => ({ id: m.id, name: m.name }));
  }

  async resolveModel(provider, model, _signal) {
    const known = KNOWN_MODELS.find((m) => m.id === model);
    return {
      provider,
      id: model,
      name: known?.name ?? model,
      context: known ? { contextWindow: known.context } : undefined,
    };
  }

  async *stream(options) {
    const { model, messages, signal } = options;
    const token = readToken();

    // Build the request body for the ChatGPT Responses API.
    const input = messages.map((m) => ({
      role: m.role ?? "user",
      content: extractMessageContent(m.content),
    }));

    const body = JSON.stringify({
      model,
      input,
      store: false,
      stream: true,
    });

    this.ctx.logger?.info?.(
      `[codex-provider] Calling chatgpt.com/backend-api/codex/responses with model ${model}`
    );

    // Send the request through the Clash proxy tunnel.
    const response = await tunnelRequest(
      "POST",
      API_HOST,
      API_PATH,
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/event-stream",
        "OpenAI-Beta": "responses=v1",
      },
      body,
      signal,
    );

    // Log response status for debugging.
    this.ctx.logger?.debug?.(
      `[codex-provider] Response status: ${response.status}`
    );

    if (response.status !== 200) {
      let errMsg = `ChatGPT API returned status ${response.status}`;
      try {
        const err = JSON.parse(response.body);
        errMsg = err.detail ?? errMsg;
      } catch {}
      yield {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "CODEX_API_ERROR", message: errMsg },
        },
      };
      return;
    }

    // Dechunk the response body (SSE over chunked transfer encoding).
    const bodyText = dechunkIfNeeded(response.body, response.headers);

    // Log quota headers for debugging.
    const primaryUsed = response.headers["x-codex-primary-used-percent"];
    const planType = response.headers["x-codex-plan-type"];
    if (primaryUsed || planType) {
      this.ctx.logger?.debug?.(
        `[codex-provider] Quota: ${planType ?? "?"}, used ${primaryUsed ?? "?"}%`
      );
    }

    // Parse SSE events and yield StreamChunk events.
    let allText = "";
    let textBlockIndex = 0;
    let textBlockStarted = false;
    let usage = null;
    let errorMessage = null;
    let responseId = null;

    // Split by "event: " to find SSE events.
    // The SSE format is:
    //   event: <event_name>\n
    //   data: <json>\n\n
    const events = bodyText.split("\n\n");
    for (const eventBlock of events) {
      if (!eventBlock.trim()) continue;

      // Extract event line and data line.
      let eventName = "";
      let eventData = "";
      for (const line of eventBlock.split("\n")) {
        if (line.startsWith("event: ")) {
          eventName = line.substring(7).trim();
        } else if (line.startsWith("data: ")) {
          eventData = line.substring(6).trim();
        }
      }

      if (!eventData) continue;

      let parsed;
      try {
        parsed = JSON.parse(eventData);
      } catch {
        continue;
      }

      // Handle different event types.
      switch (eventName) {
        case "response.created":
          responseId = parsed.response?.id;
          this.ctx.logger?.debug?.(
            `[codex-provider] Response created: ${responseId}`
          );
          break;

        case "response.output_text.delta":
          if (!textBlockStarted) {
            yield { type: "block-start", index: textBlockIndex, blockType: "text" };
            textBlockStarted = true;
          }
          const delta = parsed.delta ?? "";
          if (delta) {
            allText += delta;
            yield { type: "text-delta", index: textBlockIndex, text: delta };
          }
          break;

        case "response.output_text.done":
          // The final text value is in parsed.text.
          // If we didn't get deltas, emit the full text now.
          if (!textBlockStarted && parsed.text) {
            yield { type: "block-start", index: textBlockIndex, blockType: "text" };
            textBlockStarted = true;
            allText = parsed.text;
            yield { type: "text-delta", index: textBlockIndex, text: parsed.text };
          }
          break;

        case "response.completed":
          // Extract usage from the completed response.
          if (parsed.response?.usage) {
            const u = parsed.response.usage;
            usage = {
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
            };
          }
          if (parsed.response?.error) {
            errorMessage = parsed.response.error.message ?? parsed.response.error.code ?? "API error";
          }
          break;

        case "error":
          errorMessage = eventData;
          break;
      }
    }

    // Close the text block.
    if (textBlockStarted) {
      yield {
        type: "block-end",
        index: textBlockIndex,
        block: { type: "text", text: allText },
      };
    }

    // Yield usage.
    if (usage) {
      yield { type: "usage", usage };
    }

    // Yield finish.
    if (errorMessage) {
      yield {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "CODEX_API_ERROR", message: errorMessage },
        },
      };
    } else {
      yield {
        type: "finish",
        reason: { kind: "stop" },
      };
    }
  }
}

/** Plugin entry: register the Codex adapter. */
export function apply(ctx, _config) {
  ctx.inject(["llm"], (ctx) => {
    const adapter = new CodexAdapter(ctx);
    const handle = ctx.llm.registerAdapter(["codex-openai"], adapter);
    ctx.logger?.info?.("[codex-provider] Registered codex-openai provider (direct API mode)");
    ctx.on("dispose", () => handle());
  });
}