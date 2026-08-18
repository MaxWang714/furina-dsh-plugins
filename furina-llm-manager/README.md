# furina-llm-manager

LLM call audit + cost accounting + provider view plugin for DeepSeek Harness (P65).

## Features

- Automatic audit of every LLM call via `llm/stream` waterfall
- Call log query (by provider/model/time range)
- Usage summary report (by provider/model/day)
- Provider health check
- Pricing table management

## Registration

In `cordis.patch.yml`:

```yaml
plugins:
  - id: furina-llm-manager
    name: ../../plugins/furina-llm-manager/lib/index.js
    config:
      dataDir: "path/to/data"
```

## Tools

| Tool | Description |
|------|-------------|
| `llmUsage/logs` | Audit log query |
| `llmUsage/report` | Usage summary |
| `llmUsage/clear` | Clean old records |
| `llmProviders/list` | List providers |
| `llmProviders/health` | Health check |
| `llmPricing/list` | Pricing table |
| `llmPricing/update` | Update pricing |
