# Repository map

## Material responsibilities

| Material | Responsibility | Key entry points | Vision decision |
|---|---|---|---|
| `素材/cc-switch` | Tauri desktop provider/proxy/usage application | `src-tauri/src/lib.rs`, proxy handlers, usage logger, usage dashboard | Selective reference only; Vision owns a new domain and UI. |
| `素材/CLIProxyAPI` | Go external gateway, protocol translators, executor and usage plugin | `cmd/server/main.go`, `internal/api/server_routes.go`, `sdk/cliproxy/usage` | Protocol and accounting reference; no wholesale Go port. |
| `素材/llm-manager` | DSH/EVA stream telemetry connector and JSONL aggregation | `lib/index.js`, `lib/core.js` | Future connector contract; not the storage/UI core. |

## Request flow comparison

CC Switch: client → local Rust proxy handler → provider transform → usage parser/logger → SQLite projections → React dashboard.

CLIProxyAPI: HTTP route → executor/translator → upstream provider → streaming response writer → usage manager/plugin.

llm-manager: DSH `llm/stream` interception → first token/usage extraction → JSONL log → report tools.

Vision: client → `127.0.0.1:8787` Gateway → protocol adapter → Mock/compatible provider → streaming classifier → Observation + Canonical Request → SQLite → Overview/Request Detail.

## Reuse boundary

Directly reusable later: protocol fixtures and boundary cases, accounting vocabulary, redaction test cases, and small MIT modules after audit. Wrap rather than copy: DSH and CLIProxyAPI connectors. Reference only: CC Switch product shell, mutable pricing table, approximate `first_token_ms`, subscription queries, and CLIProxyAPI full translator graph.

## Known semantic and privacy risks

- CC Switch `first_token_ms` is an approximation of the first SSE event; it is not Vision TTFT.
- CLIProxyAPI's reporter measures first response byte (TTFB-like), not meaningful model output.
- Mutable pricing tables can rewrite historical meaning; Vision uses immutable snapshots.
- Stream errors can leave naive JSONL records marked successful.
- Full request/response logging can leak Authorization, cookies, API keys, prompts, responses and local paths; Vision redacts before persistence and defaults to metadata-only.

## Explicit MVP exclusions

MCP, Skills, Prompt management, cloud sync, subscriptions/quota collectors, health incidents, reconciliation ledger, adaptive routing, and full provider fleet are not migrated in Phase 1.
