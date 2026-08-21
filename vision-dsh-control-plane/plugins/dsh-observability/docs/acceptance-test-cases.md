# LLM / Vision / DSH 验收测试题目

这套题目把介绍稿中的每个职责变成可执行的验收问题。验收时必须同时记录：输入、运行版本、实际响应/Observation、日志路径、结论。模型生成的解释不能替代运行证据。

## 通过标准

- P0（阻断）：流式行为被破坏、secret 泄漏、未知 usage/价格被记为 0、真实服务无法启动。
- P1（必须）：核心调用、Observation、工具、诊断、回放和隐私语义符合预期。
- P2（改进）：展示文案、统计分位数、清理提示等非核心体验问题。

## 测试题目

| ID | 验收问题/操作 | 预期证据 | 级别 |
|---|---|---|---|
| LLM-01 | 能否用一句话说明 LLM、DSH 插件、Vision 控制平面的边界？ | 介绍稿边界表；无“插件=主智能体”混淆 | P1 |
| VISION-01 | 启动真实 Vision Gateway，访问 `/health`、`/api/summary`、`/api/diagnostics` | HTTP 200；返回结构化健康、汇总、诊断数据 | P0 |
| VISION-02 | 发起一次真实的非流式 Responses 请求（loopback provider） | 响应完成；请求/响应状态可追溯 | P0 |
| VISION-03 | 发起一次真实 SSE 流式请求并逐块消费 | `text/event-stream`；顺序、结束事件和正文完整 | P0 |
| VISION-04 | 比较首字节时间与首个有意义 token 时间 | TTFB、TTFT 字段分开；元数据事件不计为 TTFT | P1 |
| VISION-05 | 模拟只有 metadata/usage、没有 token 的响应 | `ttft_ms=null` 或 unknown，不得伪造首 token | P1 |
| VISION-06 | 供应商不返回 usage | token quality=unknown；成本=null；不是全 0 | P0 |
| VISION-07 | 发送输入 token 小于 cacheRead+cacheWrite 的矛盾 usage | quality=inconsistent；成本不被静默接受 | P1 |
| VISION-08 | 使用固定价格快照计算已知模型成本，再用未知模型重试 | 已知价格可复算；未知模型成本=null 并带原因 | P1 |
| VISION-09 | 检查一次调用的 Observation/SQLite 写入与状态闭合 | unique request/observation ID；success/error/aborted 闭合 | P1 |
| VISION-10 | 在错误、session、header、prompt 夹带 Bearer/API key/token | 日志/Observation 无原文密钥；session 仅哈希 | P0 |
| VISION-11 | 运行 diagnostics，检查 provider、数据库、回放和时间线检查项 | 每项有 pass/fail 与可定位证据 | P1 |
| VISION-12 | 对一个成功请求执行 replay | replay 可重复请求形状并生成新 trace；不复制 secret | P1 |
| DSH-01 | 在真实 DSH 依赖（`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools` RC.8）中加载插件 | 导出 `name`、`inject`、`Config`；依赖解析成功 | P0 |
| DSH-02 | 调用插件注册的 `llm/stream` waterfall handler | handler 同步返回 AsyncIterable；原 chunk 顺序与数量不变 | P0 |
| DSH-03 | 运行成功、错误、取消三类流 | Observation 状态分别为 success/error/aborted；TTFT/finish 语义正确 | P1 |
| DSH-04 | 运行 missing usage、partial usage、unknown model | unknown/partial 不补零；未知价格 totalCost=null | P0 |
| DSH-05 | 连续写入 JSONL，模拟 torn final line，再执行读取与按天清理 | 完整行可读；坏尾行容忍；清理数量准确 | P1 |
| DSH-06 | 检查插件工具是否注册并执行 report/logs/clear | 3 个工具可调用；时间窗、聚合、分页、清理结果可复核 | P1 |
| DSH-07 | 配置 `gatewayUrl`，向 `/api/observations` 上报 | 请求是脱敏 Observation；网络失败不阻断流；成功/失败可见 | P1 |
| DSH-08 | 扫描插件源码、测试输出和打包内容 | 无真实 key、prompt、response；仅允许测试中的假 secret fixture | P0 |
| ARCH-01 | 检查 `Vision/product` 与 `Vision/dsh-plugin` 的 git、依赖和发布物 | product 原版本未改写；插件可独立安装/回滚 | P0 |

## 本次执行口径

本轮“真实插件”指：使用真实发布的 DSH RC.8 包解析并执行插件模块、真实调用其 waterfall/工具接口；Gateway 上传用本地 HTTP 接收器验证。尚未把插件装入带真实供应商密钥的完整 DSH 生产 profile，因此 DSH-01/02/03 的运行级结论不能外推成“真实供应商端到端已通过”。Vision 的核心 Gateway loopback 与前端构建则按真实软件运行验收。
