param([string]$Destination = "$env:LOCALAPPDATA\VisionControlPlane")
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item (Join-Path $source 'dist') (Join-Path $Destination 'dist') -Recurse -Force
Copy-Item (Join-Path $source 'bin') (Join-Path $Destination 'bin') -Recurse -Force
if (Test-Path (Join-Path $source 'optional')) { Copy-Item (Join-Path $source 'optional') (Join-Path $Destination 'optional') -Recurse -Force }
Write-Output (ConvertTo-Json @{ installed = $true; destination = $Destination; scope = 'per-user'; signed = $false })
