# Prestige — un comando (`bun run dev`). Requiere Bun ≥ 1.3 y Docker Desktop.
# Uso:  .\dev.ps1
#       .\dev.ps1 --reset
#       .\dev.ps1 down
#       .\dev.ps1 down --volumes
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "Necesitas Bun >= 1.3: https://bun.sh"
}

bun scripts/dev.ts @args
exit $LASTEXITCODE
