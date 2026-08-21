# furina-codex-provider

Optional DSH Direct Provider for the ChatGPT Codex Responses backend. It keeps the package identity and DSH adapter shape of the legacy donor while fixing the release blockers:

- TLS certificate verification is always enabled; there is no `rejectUnauthorized: false` path.
- Responses are parsed incrementally from SSE, so the first meaningful delta is observable before socket close.
- Text, reasoning, function-call, usage, cancellation and error events are mapped without fabricating missing usage as zero.
- Base URL, API path, proxy URL, model catalog and auth path are configurable. No proxy or provider is enabled by default.
- Credentials are read from `CODEX_ACCESS_TOKEN`/`OPENAI_ACCESS_TOKEN` or the normal Codex auth file and are never logged or persisted.
- The HTTP proxy transport is a declared `undici` runtime dependency, so `CODEX_PROXY_URL` also works in a clean installation.

Configuration keys are `CODEX_BASE_URL`, `CODEX_API_PATH`, `CODEX_PROXY_URL`, `CODEX_MODELS`, `CODEX_AUTH_PATH` and `CODEX_ACCESS_TOKEN`. For production, prefer an approved credential store over an environment variable. The provider test suite uses an injected transport and does not claim real Codex acceptance.
