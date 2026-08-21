# Data model

The runtime uses SQLite via Node 24's built-in `node:sqlite` for the executable development slice. The Rust workspace contains the same boundary for the Tauri build.

Core tables: `schema_migrations`, `settings`, `providers`, `models`, `agents`, `presets`, `request_observations`, `requests`, and `pricing_snapshots`.

`request_observations` is append-only. `requests.finalized_at` protects final facts from ordinary updates. Corrections are new observations and a new calculation version.

Migration version 1 is executed inside `BEGIN IMMEDIATE`/`COMMIT`; rollback prevents a partially-created schema. SQLite enables `foreign_keys`, stores monetary facts as decimal TEXT, and installs `prevent_finalized_request_update`. The repository also refuses an upsert when a request is already finalized, so both the SQL boundary and normal code path protect history.
