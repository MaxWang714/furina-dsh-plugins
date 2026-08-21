# Evidence chain

Each test case must produce a JSON record linking:

`test question -> case_id/run_id/trace_id -> sanitized request -> network/SSE events -> sanitized response -> Observation -> JSONL/SQLite -> dashboard summary -> replay -> automatic assertions -> human/cross-model review -> verdict`.

`mock`, `fixture`, `skipped`, missing OAuth and missing sidecar are recorded as `BLOCKED`, `UNSUPPORTED` or `NOT_APPLICABLE`; they are never promoted to a real `PASS`.
