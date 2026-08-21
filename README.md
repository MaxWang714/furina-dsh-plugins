# Vision / 神之眼 — LLM Control Plane + Codex

Vision 是原 `furina-llm-manager` 的统一升级产品：它保留 LLM 调用审计、成本、缓存、Provider 和时延分析，并增加 Rust 持久化核心、Dashboard、Replay、安全脱敏以及两条可选 Codex 路径。

## 包含什么

| 模块 | 作用 | 默认状态 |
|---|---|---|
| `plugins/dsh-observability` | 观察 DSH `llm/stream`，记录脱敏后的模型、token、成本、缓存、TTFT、错误和 trace | 可独立启用 |
| Rust `visiond` | SQLite、schema migration、脱敏、摘要、请求详情、Replay 和本地 API | 本地 loopback |
| Vision Desktop | 查看 Provider、调用、成本、缓存、错误和 trace 的桌面 Dashboard | 随安装包提供 |
| `plugins/furina-codex-provider` | DSH 直接调用 Codex 后端的适配器 | 可选、默认关闭 |
| `integrations/cliproxyapi` | 管理 CLIProxyAPI sidecar，对外提供 OpenAI Responses 兼容 `/v1/models`、`/v1/responses` | 可选、默认关闭 |
| `dsh-cliproxyapi-provider` | 让 DSH 通过 CLIProxyAPI 使用 Codex 或其他兼容模型 | 可选 |

旧顶层 `furina-llm-manager` 与 `visualization` 不再作为第二套运行实现保留；它们的功能、迁移关系和旧文件通过 Git 历史及 legacy tag 可恢复。这样避免同一次调用被两套 observer 重复计费、重复写日志或产生相互矛盾的结论。

## Codex 的两条路径

1. **Direct Provider**：DSH 直接使用 Codex backend，路径短，适合 DSH 内部使用。
2. **CLIProxyAPI sidecar**：在本机 `127.0.0.1:8317` 提供标准 Responses API，可被 Codex CLI、DSH 或其他 OpenAI-compatible 客户端使用。

两条路径相互独立、默认关闭，也不影响普通 DeepSeek、LongCat 或多模型平台调用。

## Windows 快速使用

发布页提供：

- `Vision-0.2.0-rc.1-x64-setup.exe`：current-user NSIS 安装器，无需管理员权限；
- `Vision-0.2.0-rc.1-portable.zip`：portable 包，包含 Vision Desktop、`visiond`、DSH plugins 和可选 CLIProxyAPI sidecar；
- `CLIProxyAPI-vision-pinned-windows-x64.exe`：单独的 pinned sidecar；
- SBOM、SHA-256、验收摘要和发布说明。

当前 RC 未做可信代码签名，Windows SmartScreen 可能警告。请先核对发布页 SHA-256。

Codex 身份不会打进安装包。每个用户必须使用 CLIProxyAPI 支持的 OAuth 流程授权自己的 Codex 账号，或使用已有的受支持认证存储。API key、OAuth token、prompt 和完整 response 不会写入 Git 或发布包。

## 国内网络与代理

浏览器能打开 ChatGPT 不代表 Go、Node、Git 或终端能直连。若使用 Clash 等本地代理，应在 CLIProxyAPI 的可写运行配置中显式设置：

```yaml
proxy-url: "http://127.0.0.1:7890"
```

同时确认 Codex 客户端使用独立 profile 指向：

```toml
model_provider = "cliproxyapi"

[model_providers.cliproxyapi]
base_url = "http://127.0.0.1:8317/v1"
env_key = "DSH_CLIPROXY_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

`GET /v1/models = 200` 只证明本地服务和 catalog；真实验收还必须包括 `POST /v1/responses` 非流式、SSE、usage 以及真实客户端调用。

## 从源码验证

```powershell
Set-Location vision-dsh-control-plane
pnpm install --frozen-lockfile
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node plugins/furina-codex-provider/test/index.test.mjs
cargo test --workspace --locked
```

完整模块说明、安装、隐私、迁移、测试与事故复盘见 `vision-dsh-control-plane/docs/`。
