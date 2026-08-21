param([string]$Destination = "$env:LOCALAPPDATA\VisionControlPlane")
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { Rename-Item -LiteralPath $Destination -NewName (Split-Path $Destination -Leaf) -ErrorAction SilentlyContinue }
Write-Output (ConvertTo-Json @{ removed = $true; destination = $Destination; note = 'User data and credentials are intentionally preserved.' })
