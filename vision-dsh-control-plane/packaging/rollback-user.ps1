param([string]$Destination = "$env:LOCALAPPDATA\VisionControlPlane", [string]$Backup)
$ErrorActionPreference = 'Stop'
if (-not $Backup) { throw 'Provide an explicit backup path for rollback.' }
if (-not (Test-Path -LiteralPath $Backup)) { throw "Backup does not exist: $Backup" }
if (Test-Path -LiteralPath $Destination) { Rename-Item -LiteralPath $Destination -NewName ((Split-Path $Destination -Leaf) + '.failed-' + (Get-Date -Format yyyyMMddHHmmss)) }
Copy-Item -LiteralPath $Backup -Destination $Destination -Recurse -Force
Write-Output (ConvertTo-Json @{ rolled_back = $true; destination = $Destination; backup = $Backup })
