# Grab one frame from a camera so Claude can look at the installation.
#   .\tools\cam_snap.ps1 gallery        -> frames\gallery-<timestamp>.jpg (path printed)
# Camera URLs come from secrets.local.json (untracked; see secrets.local.example.json).
param([Parameter(Mandatory = $true, Position = 0)][string]$Camera)

$root = Split-Path $PSScriptRoot -Parent
$secrets = Join-Path $root 'secrets.local.json'
if (-not (Test-Path $secrets)) { Write-Error "Missing $secrets (copy secrets.local.example.json and fill in)."; exit 1 }
$url = (Get-Content -Raw $secrets | ConvertFrom-Json).cameras.$Camera
if (-not $url) { Write-Error "No camera named '$Camera' in secrets.local.json."; exit 1 }

$frames = Join-Path $root 'frames'
New-Item -ItemType Directory -Force $frames | Out-Null
$out = Join-Path $frames ("$Camera-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jpg')
& ffmpeg -hide_banner -loglevel error -rtsp_transport tcp -i $url -frames:v 1 -q:v 2 -y $out
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) { Write-Error "ffmpeg failed for '$Camera'."; exit 1 }
$out
