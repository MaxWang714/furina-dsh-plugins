# Vision + Codex Unified Product 0.2.0-rc.1

这是 Vision / 神之眼统一产品的首个公开候选版。它把旧 `furina-llm-manager` 的有效功能融合为单一 DSH observability 模块，并增加 Rust `visiond`、SQLite、Dashboard、Replay、安全脱敏、Codex Direct Provider 和可选 CLIProxyAPI 反代。

## 已真实验证

- Codex Direct Provider：真实增量流通过。
- CLIProxyAPI：真实 `/v1/models`、非流式 `/v1/responses`、SSE、usage 通过。
- Codex CLI 与 DSH 均通过 CLIProxyAPI 完成真实 Codex 调用。
- DSH 真实宿主通过 DeepSeek 和 Codex 反代两条路径。
- DeepSeek 官方 API、LongCat 和多模型平台 Qwen 真实调用通过。
- Vision Vitest 30/30、CLIProxy DSH provider 21/21、Direct Provider 4/4。
- Rust、TypeScript、Vite、Go 构建与相关回归通过。
- MSVC/Tauri current-user NSIS 安装、启动、卸载与目录回滚通过。
- portable ZIP 解包后逐文件 SHA-256 与尺寸复验通过。
- 发布资产 secret scan 为 0 命中。

## Codex 网络注意事项

Windows 浏览器代理、WinHTTP 与 Node/Go/Git 的代理不是同一层。浏览器能访问 ChatGPT 时，CLIProxyAPI 仍可能直连超时。国内网络环境应在 CLIProxyAPI 可写配置中显式设置 `proxy-url`，并让 Codex 客户端明确指向 `http://127.0.0.1:8317/v1`。

`GET /v1/models = 200` 不能代替真实生成验收；必须检查 `/v1/responses`、SSE、usage 和真实客户端消费结果。

## 安全与限制

- Codex 与 CLIProxyAPI 默认关闭，CLIProxyAPI 默认只监听 loopback。
- OAuth、API key、prompt、response body 和 Authorization header 不进入 Git、ZIP、日志或 SQLite。
- 每个用户必须授权自己的 Codex 账号；本次验收身份不随安装包分发。
- 此 RC 未做可信代码签名，Windows SmartScreen 可能提示。
- CLIProxyAPI 保持独立 Go sidecar，Vision Rust Core 不重写其成熟协议翻译器。
