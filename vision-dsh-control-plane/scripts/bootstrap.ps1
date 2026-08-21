param([switch]$Install)
$ErrorActionPreference = 'Stop'
Write-Host "Vision toolchain check"
node --version
if ((node --version) -notmatch '^v(22|24)\.') { Write-Warning 'Vision is tested on Node 22/24.' }
pnpm --version
if ((pnpm --version) -ne '11.19.0') { Write-Warning 'Vision lockfile expects pnpm 11.19.0.' }
if (Get-Command cargo -ErrorAction SilentlyContinue) { cargo --version } else { Write-Warning 'Rust/Cargo is not installed; Node MVP remains runnable.' }
if (Test-Path (Join-Path $PSScriptRoot '..\rust-toolchain.toml')) { Write-Host 'Rust toolchain pinned by rust-toolchain.toml (1.88.0).' }
if ($Install) { pnpm install }
