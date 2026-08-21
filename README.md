# Vision + Codex Unified Product

This repository is the release candidate for the Vision DSH control plane. It has one observability implementation and two optional Codex paths:

- `vision-dsh-control-plane/plugins/dsh-observability` records sanitized DSH stream observations, cost, timing, cache and provider reports.
- `vision-dsh-control-plane/plugins/furina-codex-provider` is the optional DSH Direct Provider for the Codex backend. It uses secure TLS, incremental SSE and environment/config based credentials.
- `vision-dsh-control-plane/integrations/cliproxyapi` describes and supervises the optional CLIProxyAPI sidecar, which exposes OpenAI-compatible `/v1/models` and `/v1/responses`.
- `vision-dsh-control-plane/apps` and `crates` contain the Vision desktop/gateway/Rust core.

The old top-level `furina-llm-manager` and `visualization` directories were removed from the active tree after creating the immutable recovery tag `legacy-furina-dsh-plugins-v0.1.0`. Their audited capabilities are implemented by the single DSH observability plugin and the Vision dashboard/docs.

## Local checks

```powershell
Set-Location vision-dsh-control-plane
pnpm install --frozen-lockfile
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node plugins/furina-codex-provider/test/index.test.mjs
```

Codex Direct and CLIProxyAPI are optional and disabled by default. Real provider acceptance requires credentials supplied through the process environment or an approved credential store; credentials are never written to logs, evidence, SQLite, JSONL, Git or release files.
