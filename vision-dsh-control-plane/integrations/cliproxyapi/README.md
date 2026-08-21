# CLIProxyAPI integration

CLIProxyAPI remains an optional Go sidecar. Vision does not rewrite or embed its 1,300+ file runtime in Rust. This directory owns the pinned donor manifest, safe loopback configuration, lifecycle helpers, DSH provider donor and acceptance boundary.

The sidecar must bind to loopback by default and expose `/v1/models` and `/v1/responses`. Credentials are supplied to CLIProxyAPI through its own approved auth store. The Vision process only records sanitized status, timing, usage and trace identifiers.

The `dsh-provider` package discovers the sidecar catalog and registers an OpenAI Responses profile. It is kept separate from `plugins/furina-codex-provider`: Direct Provider calls the Codex backend itself; CLIProxyAPI is the true externally compatible reverse-proxy path.

No real Codex PASS is claimed until a running sidecar has completed non-streaming, incremental SSE, tool, reasoning, usage, cancel and error cases against a real Codex account.
