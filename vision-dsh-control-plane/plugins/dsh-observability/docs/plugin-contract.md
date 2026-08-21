# Plugin contract

`@vision/dsh-observability` is a Cordis plugin with `apply(ctx, config)` and `Config` exports.

Required configuration:

- `dataDir`: local append-only JSONL fallback directory.

Optional configuration:

- `gatewayUrl`: Vision Gateway base URL. Empty means offline-only mode.
- `privacy`: `normal` (default) or `privacy`.
- `multiplier`: Cost multiplier represented as a number at the plugin boundary (default `1`).
- `maxErrorLen`: sanitized error length limit.

The plugin wraps `llm/stream`, never writes Vision SQLite directly, and emits a `RequestObservation`-shaped JSON document. The Gateway endpoint is optional so the plugin remains useful when Vision is not running.
