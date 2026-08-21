# CLIProxyAPI integration

CLIProxyAPI remains an optional Go sidecar. Vision does not rewrite or embed its 1,300+ file runtime in Rust. This directory owns the pinned donor manifest, safe loopback configuration, lifecycle helpers, DSH provider donor and acceptance boundary.

The sidecar must bind to loopback by default and expose `/v1/models` and `/v1/responses`. Credentials are supplied to CLIProxyAPI through its own approved auth store. The Vision process only records sanitized status, timing, usage and trace identifiers.

The `dsh-provider` package discovers the sidecar catalog and registers an OpenAI Responses profile. It is kept separate from `plugins/furina-codex-provider`: Direct Provider calls the Codex backend itself; CLIProxyAPI is the true externally compatible reverse-proxy path.

No real Codex PASS is claimed until a running sidecar has completed non-streaming, incremental SSE, tool, reasoning, usage, cancel and error cases against a real Codex account.

## Windows upstream routing

Windows Internet Settings and WinHTTP are separate proxy stacks. A browser can reach ChatGPT through a desktop proxy while CLIProxyAPI, Go, Git or a terminal still attempts a direct connection and times out. When that happens, set `proxy-url` in the writable CLIProxyAPI runtime configuration. `startSidecar({ upstreamProxyUrl })` also supplies the standard proxy environment variables, but the explicit CLIProxyAPI setting is authoritative and easiest to diagnose.

The readiness probe accepts `apiKey` or custom `headers`; this is required when the local `/v1/models` endpoint is protected. Probe failures are reported only as status/error classes and never include the key.

## Codex client profile

Keep the user's normal Codex configuration intact. Test the reverse proxy with an isolated profile using an environment-backed local key:

```toml
model = "gpt-5.6-luna"
model_provider = "cliproxyapi"

[model_providers.cliproxyapi]
name = "Vision CLIProxyAPI"
base_url = "http://127.0.0.1:8317/v1"
env_key = "DSH_CLIPROXY_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
```

`GET /v1/models` only proves the local process and catalog boundary. Release acceptance additionally requires a real `POST /v1/responses` result, streaming events, usage, and a Codex CLI or DSH call through the same sidecar.
