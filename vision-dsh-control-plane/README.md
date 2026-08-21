# Vision DSH Observability

Independent release candidate for the Vision / 神之眼 DSH plugin and Rust observability sidecar.

The DSH plugin is a thin `@vision/dsh-observability` Cordis plugin. It observes `llm/stream`, computes conservative token/timing/cost facts, writes a local JSONL audit trail, and sends only sanitized observations to `visiond`. The Rust `visiond` binary owns SQLite persistence, schema migration, recursive secret redaction, SHA-256 payload identity, health, summary, and request/observation APIs. Existing Vision/product and Vision/dsh-plugin directories are donors and remain unchanged.

## Build

On Windows x64, the release candidate is built and tested with the official MSVC Build Tools toolchain. The source also remains GNU-compatible for the core crates:

```powershell
$env:Path = "$PWD/.tools/winlibs/mingw64/bin;$env:Path"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = 'x86_64-w64-mingw32-gcc.exe'
rustup run 1.88.0-x86_64-pc-windows-gnu cargo test -p visiond --target x86_64-pc-windows-gnu
rustup run 1.88.0-x86_64-pc-windows-gnu cargo build -p visiond --release --target x86_64-pc-windows-gnu
npm --prefix plugins/dsh-observability install --ignore-scripts
npm --prefix plugins/dsh-observability run check
```

For the tested MSVC release build, use a Visual Studio Developer PowerShell and run:

```powershell
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked
cargo build -p visiond --release --locked
cargo build -p vision-desktop --release --locked
```

## Run

```powershell
$env:VISIOND_BIND = '127.0.0.1:8788'
$env:VISIOND_DB = './data/visiond.db'
./target/x86_64-pc-windows-gnu/release/visiond.exe
```

Configure DSH with `gatewayUrl: http://127.0.0.1:8788`. The plugin package is `@vision/dsh-observability`; it can run offline when `gatewayUrl` is omitted. Credentials are resolved by the host/approved SecretProvider and are never written to this repository, JSONL, SQLite, or receipts.

## Acceptance

`node scripts/acceptance-plugin-visiond.mjs` runs the real plugin listener against the real Rust binary, verifies cross-process delivery, SQLite persistence, summary count, session hashing, and no secret leakage. The validated RC includes DSH RC.6/RC.8 evidence, TypeScript/Rust/plugin/Gateway/Replay checks, a currentUser NSIS installer, portable MSVC binaries, SBOM/license notices and SHA256 checksums. The installer is unsigned and intended for controlled testing.
