# furina-codex-provider

ChatGPT backend API direct connector for DeepSeek Harness (Codex protocol).

## Features

- Registers as a DSH LLM provider (`codex-openai`)
- Direct connection to `chatgpt.com/backend-api/codex/responses`
- Supported models: gpt-5.6-sol, gpt-5.4, gpt-5.3-codex, gpt-5.1, etc.
- Uses HTTP CONNECT tunnel through Clash proxy (for China mainland)
- Automatically audited by LLM Manager

## Prerequisites

1. **Codex CLI account**: Install Codex CLI and log in, ensure `~/.codex/auth.json` exists
2. **Proxy**: Clash or similar proxy (default 127.0.0.1:7890)

## Registration

In `cordis.patch.yml`:

```yaml
plugins:
  - id: furina-codex-provider
    name: ../../plugins/furina-codex-provider/lib/index.js
```

## Usage

After registration, select `codex-openai` as your LLM provider in DSH config.
Supported models are listed in `lib/index.js` `KNOWN_MODELS`.
