# Vision + Codex Unified Product 0.1.0-rc.1

This unsigned Windows RC contains the Vision desktop executable, Rust `visiond`, TypeScript dashboard assets, the merged DSH observability plugin, the optional secure Codex Direct Provider and an optional CLIProxyAPI sidecar binary.

Verified locally:

- Rust workspace check/test and GNU Windows release builds.
- TypeScript, storage, gateway, replay and frontend builds.
- DSH observability and CLIProxyAPI provider contract suites.
- LongCat-2.0 real request with sanitized evidence.
- CLIProxyAPI binary build and loopback process/auth boundary.

Not promoted to real PASS:

- Codex Direct real upstream smoke is blocked by `chatgpt.com` network failure despite a local Codex auth file.
- CLIProxyAPI real Codex upstream path is blocked until the sidecar has a valid Codex auth store and network route.
- DeepSeek and multi-model platform real credentials were not present in the approved environment.
- CLIProxyAPI donor full Go test suite retains three existing Windows/invariant failures; these are preserved in the evidence ledger.

The package is unsigned. Use `packaging/install-user.ps1` for a per-user install and keep the `optional` sidecar disabled until its identity and upstream tests pass.
