# LLM Manager migration

The active product has one observer: `plugins/dsh-observability`. It absorbs the audited responsibilities of the former `furina-llm-manager` package:

| Former responsibility | Unified implementation |
|---|---|
| `llm/stream` interception | DSH waterfall listener in `plugins/dsh-observability/lib/index.js` |
| token, cache and reasoning accounting | `normalizeUsage`, with `unknown`/`inconsistent` quality |
| pricing and decimal cost | `calculateCost` and `DEFAULT_PRICING` |
| provider/model/day reports | `vision_llm_usage_report` |
| filtered detail logs | `vision_llm_usage_logs` |
| retention cleanup | `vision_llm_usage_clear` |
| error and credential redaction | `sanitizeError` plus Vision privacy boundary |
| canonical cache analysis | `canonicalizeRequest`, `cacheKey`, opt-in `planCache` |

The old package is not loaded as a second observer. Its source is recoverable from the `legacy-furina-dsh-plugins-v0.1.0` tag. Existing DSH profiles should change the plugin path to `plugins/dsh-observability`; the tool names remain compatible at the semantic level, while new observations use the Vision schema.
