# Metric semantics

- **TTFB** = first upstream response body byte − upstream request sent.
- **TTFT** = first meaningful model output event − upstream request sent.
- **Generation duration** = completed − first meaningful output.
- **Output TPS** = output token count / generation seconds.

Headers, `response.created`, `response.in_progress`, empty deltas, keepalives and metadata-only events are not meaningful output. The classifier is versioned as `meaningful-event-v1`.

Vision stores TTFB and TTFT independently. If no meaningful event occurs, TTFT is unknown; it is never inferred from the first SSE event.
