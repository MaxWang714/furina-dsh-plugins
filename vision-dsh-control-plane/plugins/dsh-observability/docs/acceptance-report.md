# 本轮验收报告

日期：2026-08-20（Asia/Shanghai）  
范围：未修改的 `Vision/product` 软件版本 + 独立 `Vision/dsh-plugin` DSH 插件

## 结论摘要

- DSH 插件包的 P0/P1 包级验收通过：真实安装 `@deepseek-ai/dsh-llm@0.1.0-rc.8`、`@deepseek-ai/dsh-tools@0.1.0-rc.8`，流式中间件、Observation JSONL、未知 usage/价格、工具、Gateway mock 上报和脱敏检查均通过。
- Vision/product 的构建、27 个自动化测试、真实 loopback Gateway、非流式、SSE、诊断和 replay 通过；原版本 git HEAD `e745b39` 未被改写。
- 发现一个原版本 P1 问题：非流式响应即使没有 usage，也把 `firstByteAt` 当作 `firstMeaningfulOutputAt`，所以 `ttftMs` 不是 null。该问题没有在本轮修复，以遵守“保留现在版本”；已列为后续修复项。
- 尚未用真实供应商密钥启动完整 DSH profile；因此“完整 DSH 主机 + 真实供应商端到端”仍是未完成项。插件本身已用真实 DSH RC.8 API 运行，并用本地 HTTP 接收器验证上报。

## 介绍稿与题目

- [LLM 功能与职责介绍稿](./llm-function-introduction.md)
- [验收测试题目](./acceptance-test-cases.md)

## 证据记录

### Vision/product（保留版本）

执行命令：

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node node_modules/vite/bin/vite.js build --config apps/desktop/vite.config.ts
```

结果：4 个测试文件、27 个测试全部通过；TypeScript、生产构建通过；Vite 生成 `dist/index.html` 与 JS/CSS 产物。

真实 Gateway smoke（`node dist/server.js`）：

- `/health` 返回 `{"ok":true,"name":"Vision Gateway"}`。
- `/api/diagnostics` 的 10 项检查全部 `passed`。
- 非流式 `/v1/responses` 返回 200，usage 输入 100/输出 20 被透传并持久化。
- SSE `/v1/responses` 返回 200，包含 `response.created`、两个 text delta、`response.completed`、`[DONE]`。
- `/api/replay` 的 `fixtures/responses/simple` 返回 `passed:true`，mismatches 为空。
- 缺失 usage 场景真实运行后：`tokens.quality=unknown`，各 token 与 `cost.totalApiCost` 为 null，未被补成 0。

发现：上述缺失 usage 的非流式记录 `firstMeaningfulOutputAt=null`，但 `metrics.ttftMs=ttfbMs`；这违反“元数据/首字节不算首 token”的验收语义。对应题目 VISION-05：**未通过**（原版本已知缺陷）。

### Vision/dsh-plugin（独立包）

版本/依赖：

```text
@vision/dsh-observability@0.1.0
@deepseek-ai/dsh-llm@0.1.0-rc.8
@deepseek-ai/dsh-tools@0.1.0-rc.8
@deepseek-ai/schemastery@3.18.1
```

执行命令与结果：

```text
npm run check                 PASS（typecheck + plugin test）
npm audit --omit=dev --audit-level=high   found 0 vulnerabilities
npm pack --dry-run             PASS（9 个发布文件）
git diff --check               PASS
```

插件测试输出：`PASS Vision DSH plugin checks (3 tools, 2 observations)`。

额外运行证据：

- handler 同步返回 `AsyncIterable`，3 个 chunk 顺序和数量保持不变。
- 成功流写入 `status=success`；无 finish 的流归为 `aborted`；异常归为 `error`。
- `normalizeUsage({inputTokens:100, outputTokens:20})` 返回 `quality=partial`；缺失 usage 返回 `unknown`；未知模型成本为 `null`。
- 真实工具执行得到 `vision_llm_usage_report`、`vision_llm_usage_logs`、`vision_llm_usage_clear` 三个工具，汇总、明细和 JSONL 数量可复核。
- Gateway mock 收到脱敏 Observation，`source=dsh_agent`；未知模型 `totalCost=null`；网络失败不阻塞流。
- 手工 secret scan 未发现真实 key；唯一允许的 `sk-secret-token` 只存在于脱敏单元测试 fixture。

## 逐题结论

| 范围 | 结果 |
|---|---|
| LLM-01 | PASS：介绍稿明确三层边界 |
| VISION-01/02/03 | PASS：真实 Gateway 健康、非流式、SSE |
| VISION-04 | PASS：产品记录分别保存 TTFB/TTFT；自动化测试覆盖 |
| VISION-05 | **FAIL：原版本缺失 usage 的非流式 TTFT 误取首字节** |
| VISION-06 | PASS：unknown token/cost 保持 null |
| VISION-07 | PARTIAL：核心单测覆盖规范化，但本轮 mock smoke 未产生 cache 大于 input 的真实矛盾样本 |
| VISION-08/09/10/11/12 | PASS：价格、持久化、隐私、诊断、replay |
| DSH-01/02/03/04/05/06/07/08 | PASS（包级 + mock Gateway；完整 DSH host 未运行） |
| ARCH-01 | PASS：product HEAD `e745b39` 未变；插件 HEAD `11d718e` 独立可回滚 |

## 后续必须处理

1. 在 `Vision/product` 的非流式路径修正 `firstMeaningfulOutputAt`：只有真实文本/工具输出事件才产生 TTFT；修复后重新跑 VISION-05 及全套测试。
2. 在独立产品分支为 Vision Gateway 增加 `/api/observations`，再把 DSH 插件的可选 Gateway 上报从 mock 验收提升为真实跨项目验收。
3. 准备无敏感信息的 DSH profile fixture，运行完整 DSH host 加载插件；如需真实供应商端到端，密钥只能由环境变量/批准的 SecretProvider 提供。

## 治理备注

Tianli directory guard 本轮仍报告 5 个既有、未注册的 M6 文件；它们不在本次 Vision 改动范围内，也未被修改。Vision/product 工作树保持干净；插件工作树在提交 `11d718e` 后保持干净。
