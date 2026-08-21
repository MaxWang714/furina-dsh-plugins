# Reuse manifest

This package is a new DSH plugin. It selectively reimplements the useful boundary ideas from the read-only material at `Vision/素材/llm-manager`:

- `llm/stream` waterfall interception and synchronous AsyncIterable return.
- Token-delta TTFT observation and terminal status handling.
- JSONL audit fallback, pricing-prefix matching, aggregation, and error redaction test cases.

The material plugin is not copied wholesale. Vision changes the name, package boundary, privacy behavior, missing-usage semantics, unknown-cost semantics, and Observation schema. Vision/product remains a separate desktop software project.
