# Vision DSH Observability Plugin

`@vision/dsh-observability` is the DSH-side companion to Vision / 神之眼. Vision/product is the desktop Personal LLM Control Plane; this directory is an independent DSH Cordis plugin, not a second desktop application.

It observes DSH's `llm/stream` waterfall, records token/timing/status/cost facts to a local append-only JSONL file, and can optionally POST sanitized `RequestObservation` payloads to a Vision Gateway. It does not write Vision SQLite and it never captures prompts, responses, Authorization headers, cookies, or API keys.

## Development

```powershell
npm install
npm run check
```

The development dependencies are pinned to the DSH `0.1.0-rc.8` line. Use an explicit DSH prerelease line in the host profile; do not rely on npm's `latest` tag.

## Profile configuration

The exact profile wrapper depends on the DSH distribution, but the plugin row is:

```yaml
- id: vision-dsh-observability
  name: '@vision/dsh-observability'
  config:
    dataDir: './data/vision-observability'
    gatewayUrl: 'http://127.0.0.1:8787'
    privacy: 'normal'
    multiplier: 1
```

For an offline-only installation, omit `gatewayUrl`. The plugin returns an AsyncIterable synchronously from its waterfall listener, so downstream DSH consumers continue to receive the original stream.

## Tools

- `vision_llm_usage_report`: aggregate recent calls by provider/model/day.
- `vision_llm_usage_logs`: inspect sanitized local observations with filters and pagination.
- `vision_llm_usage_clear`: prune local observations by retention days.

## Semantics

DSH exposes token-level model chunks, so the plugin can measure TTFT (first meaningful token delta) but cannot claim network TTFB. Missing Usage remains `unknown`; unknown pricing remains `null`, never a fabricated zero. Monetary fields in the emitted observation are decimal strings.
