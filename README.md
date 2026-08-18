# Furina DSH Plugins

DeepSeek Harness 插件合集：LLM 审计 + ChatGPT 直连适配器。

## 插件列表

| 插件 | 说明 |
|------|------|
| `furina-llm-manager` | LLM 调用审计 + 成本核算 + Provider 视图 |
| `furina-codex-provider` | 直连 ChatGPT 后端 API（Codex 协议） |

## 快速开始

1. 安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
2. 将插件目录复制到 `dsh-home/plugins/`
3. 在 `cordis.patch.yml` 中注册插件（见各插件 README）
4. 重启 DSH

## 前置要求

- **furina-llm-manager**：无额外依赖，纯本地运行
- **furina-codex-provider**：需要 Codex CLI 账号（OAuth token） + 代理（国内环境）
