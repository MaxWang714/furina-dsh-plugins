# Codex 反代“原来能用、验收时失败、修复后又能用”复盘

## 结论

这不是一个单点故障，而是四层状态被混在一起：

1. **本地服务层**：8317 是否有真实 CLIProxyAPI 进程监听；
2. **下游配置层**：Codex/DSH 是否真的指向 8317，并携带正确的本地鉴权；
3. **上游网络层**：Go/Node/终端是否走实际可用的代理；
4. **上游身份层**：Codex OAuth 是否有效并能完成真实 Responses 请求。

早期证据只证明了部分层：`/v1/models = 200` 证明本地服务和 catalog，未证明真实 Codex generation；LongCat 成功证明另一家上游可达，未证明 OpenAI/Codex 路由。

## 为什么会先误判失败

- 升级后的用户 Codex 主配置没有指向 `127.0.0.1:8317/v1`。
- 8317 当时没有进程监听，旧测试配置还使用空的测试 auth 目录。
- Windows Internet Settings 由 Clash 提供 `127.0.0.1:7890`，浏览器自动使用；WinHTTP、Go、Node 和 Git 没有自动继承，所以终端直连超时。
- Direct Provider 调用了 `undici.ProxyAgent`，但 package 没声明 `undici`，代理配置一启用才暴露运行时依赖缺失。
- 先前报告把“请求超时”过早归纳为“网络无法直连 OpenAI”，没有继续把浏览器代理、WinHTTP、进程环境、应用显式代理四层逐项比较。

## 为什么后来可以

- 通过已有安全身份只在内存中请求 Codex catalog，经显式 `127.0.0.1:7890` 代理返回 200，证明账号有效、问题在路由。
- CLIProxyAPI 使用 loopback 8317、真实 auth store 和显式 `proxy-url` 启动。
- 使用隔离 Codex profile 指向 8317，避免覆盖用户主配置。
- Direct Provider 补充并锁定 `undici` 运行依赖。
- 验收升级为真实 `/v1/responses` 非流式、SSE、usage、Codex CLI 和 DSH 消费，而不是只看 `/v1/models`。

## 这是不是“大模型惯性思维”

部分是，但不能把责任只归给模型。

大模型常见的工程盲区是：

- **过早压缩原因**：看到多次 timeout，倾向用一个熟悉标签“网络问题”结束排查；
- **证据替代**：把相邻模块成功当成目标模块成功；
- **默认配置想象**：假定系统代理会自动传给所有运行时；
- **成功记录锚定**：看到旧报告写“启动成功”，容易忽略它只证明了当时、那个配置、那个 endpoint；
- **测试绿灯偏差**：单元测试和 mock 全绿后，低估账号、进程、端口、代理、证书和凭据存储等运行时状态；
- **长任务上下文压缩**：长会话中容易保留结论、丢失结论的适用边界。

README 缺失或过时会放大这些问题，但不是唯一原因。本事故中，CLIProxyAPI 教程存在，真正的问题是没有在验收入口建立“必须逐层读取并核对当前事实”的强制清单，而且发布说明后来仍保留旧失败结论，说明文档也需要进入自动门禁。

## 防复发门禁

以后任何反代验收必须保存并通过以下矩阵：

| 层 | 必查证据 | 不足以证明什么 |
|---|---|---|
| Process | PID、binary hash、bind address、port listener | 不证明上游可用 |
| Downstream auth | 无 key 401/403、正确 key 200 | 不证明 Codex identity |
| Client config | 实际加载的 profile、base URL、wire API、env key 名 | 配置文件存在不等于被加载 |
| Network | DNS、direct、system proxy、WinHTTP、process env、app proxy对照 | 浏览器成功不等于终端成功 |
| Identity | 真实 catalog 或 OAuth identity probe | token 文件存在不等于 token 有效 |
| Generation | 非流式真实输出、response ID、usage | `/models` 200 不等于生成成功 |
| Streaming | delta、completed、usage、取消、错误 | 单个 200 不等于 SSE 正确 |
| Consumer | Codex CLI、DSH 或目标客户端精确输出 | curl 成功不等于集成成功 |
| Packaging | fresh extract/install 后复测 | 源目录成功不等于发布包成功 |
| Documentation | 文档中的 PASS/BLOCKED 与机器报告一致 | README 存在不等于没有过时 |

自动门禁还应执行：

1. 对 README、release notes、final status 做状态词一致性检查；
2. 禁止 `PASS_REAL` 由 `/models`、mock、fixture 或 skipped 推导；
3. 网络错误必须记录失败层级：DNS、TCP、TLS、proxy、HTTP、auth、protocol、consumer；
4. 每个真实 case 绑定 `case_id/run_id/trace_id`，并保留脱敏 request、network events、response metadata、assertions、review 和 verdict；
5. 先建立能工作的 baseline，再一次只改变一个配置或依赖并复跑同一组 eval；
6. 最终发布必须从 ZIP/installer 的全新目录重放，而不是复用开发目录。
