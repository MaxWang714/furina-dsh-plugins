# Unified product boundaries

Vision is the local control plane. The DSH observability plugin is a fail-open observer, not a competing LLM runtime. Rust owns deterministic domain, storage, gateway and replay primitives; TypeScript owns the desktop/dashboard boundary; providers remain optional adapters.

There are two intentionally different Codex paths:

1. Direct Provider: DSH calls the ChatGPT Codex backend through `plugins/furina-codex-provider`. It yields incremental DSH chunks and is disabled by default.
2. CLIProxyAPI sidecar: a separate Go process provides the public OpenAI-compatible `/v1/models` and `/v1/responses` interface. Vision supervises lifecycle and records sanitized evidence; it does not reimplement the Go proxy in Rust.

Every acceptance run carries `case_id`, `run_id` and `trace_id`. Secrets and raw prompts/responses are excluded from evidence; replay uses sanitized fixtures or explicitly approved real traces.
