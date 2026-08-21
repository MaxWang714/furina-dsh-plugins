import test from "node:test";
import assert from "node:assert/strict";
import { createCodexAdapter, parseSseBody, sanitizeError } from "../lib/index.js";

async function* chunks(values) { for (const value of values) yield new TextEncoder().encode(value); }

test("SSE parser emits complete events across arbitrary chunk boundaries", async () => {
  const events = [];
  for await (const event of parseSseBody(chunks(["event: response.output_", "text.delta\ndata: {\"delta\":\"A\"}\n\n", "event: response.completed\ndata: {\"response\":{}}\n\n"]))) events.push(event);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "response.output_text.delta");
  assert.equal(JSON.parse(events[0].data).delta, "A");
});

test("direct adapter streams text, reasoning and usage without buffering", async () => {
  const requests = [];
  const transport = async (request) => {
    requests.push(request);
    return { status: 200, ok: true, body: chunks([
      "event: response.reasoning_summary_text.delta\ndata: {\"delta\":\"think\"}\n\n",
      "event: response.output_item.added\ndata: {\"output_index\":0,\"item\":{\"type\":\"function_call\",\"call_id\":\"call-1\",\"name\":\"lookup\",\"arguments\":\"{}\"}}\n\n",
      "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\n",
      "event: response.completed\ndata: {\"response\":{\"usage\":{\"input_tokens\":3,\"output_tokens\":4,\"input_tokens_details\":{\"cached_tokens\":1},\"output_tokens_details\":{\"reasoning_tokens\":2}}}}\n\n",
    ]) };
  };
  const adapter = createCodexAdapter({ logger: { debug() {} } }, { CODEX_ACCESS_TOKEN: "ignored", transport });
  const output = [];
  for await (const event of adapter.stream({ model: "test-model", messages: [{ role: "user", content: "hi" }] })) output.push(event);
  assert.equal(requests.length, 1);
  assert.match(requests[0].headers.Authorization, /^Bearer /);
  assert.equal(output.find((event) => event.type === "text-delta" && event.index === 0).text, "hello");
  assert.equal(output.find((event) => event.type === "usage").usage.cacheReadTokens, 1);
  assert.equal(output.find((event) => event.type === "tool-call").toolCall.name, "lookup");
  assert.equal(output.at(-1).type, "finish");
});

test("upstream errors are sanitized and do not become a successful finish", async () => {
  const adapter = createCodexAdapter({}, { CODEX_ACCESS_TOKEN: "ignored", transport: async () => ({ status: 401, ok: false, async json() { return { error: { message: "Bearer sk_sensitive_value" } }; } }) });
  const output = [];
  for await (const event of adapter.stream({ model: "test-model", messages: [] })) output.push(event);
  assert.equal(output[0].reason.kind, "error");
  assert.doesNotMatch(output[0].reason.failure.message, /sk_sensitive/);
  assert.equal(sanitizeError("Bearer abc token=secret"), "Bearer [REDACTED] token=[REDACTED]");
});

test("aborted requests produce an aborted finish event", async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = createCodexAdapter({}, { CODEX_ACCESS_TOKEN: "ignored", transport: async () => { throw new Error("aborted transport"); } });
  const output = [];
  for await (const event of adapter.stream({ model: "test-model", messages: [], signal: controller.signal })) output.push(event);
  assert.equal(output.at(-1).reason.kind, "aborted");
});
