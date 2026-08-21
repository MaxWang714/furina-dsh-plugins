# Testing

Install with `pnpm install --frozen-lockfile`, then run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm frontend:build`. `pnpm dev` starts the local gateway and mock provider. The Windows desktop shell uses Tauri 2 and starts the compiled Node gateway sidecar during setup; a local Node runtime is required for this MVP.

Rust checks use the pinned 1.88.0 toolchain: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets`, `cargo test --workspace`, and `cargo build --workspace`. On Windows GNU, the core crates can be tested with LLVM-MinGW; the Tauri `cdylib` packaging target requires the MSVC linker/Windows SDK because GNU PE export limits can reject the WebView2 bundle. This is a packaging-toolchain limitation, not a Rust source workaround.
