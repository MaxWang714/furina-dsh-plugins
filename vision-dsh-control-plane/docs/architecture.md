# Architecture

The MVP has four layers: protocol adapters, gateway/mock transport, observability/domain accounting, and SQLite/UI projections. A future `AgentTelemetryConnector`, `ExternalGatewayConnector`, and `QuotaCollector` emits `RequestObservation` objects and never writes the Vision database directly.

The local gateway is the only canonical proxy. DSH and CLIProxyAPI are future connectors, not competing local servers.

During the MVP, the Tauri shell starts the compiled Node runtime (`dist/server.js`) as a local sidecar on loopback and owns its lifecycle. This keeps protocol/storage behavior in one tested implementation while leaving a clean boundary for a future Rust-native gateway or bundled Node sidecar. The desktop shell terminates the child process on window close and application exit.

The local control API exposes `/api/providers`, `/api/agents`, `/api/presets`, and `/api/privacy` for the desktop settings surfaces. Agent and Preset identifiers are read from `X-Vision-Agent` and `X-Vision-Preset`; unrecognized values remain `unknown` on the Canonical Request rather than being discarded. The MVP Windows crate intentionally builds an `rlib` for the executable; mobile/static-library targets are deferred.
