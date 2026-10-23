# One camera still for mission control, as base64 JPEG on stdout (docs/mission-plan.md). The camera URL comes from
# the untracked secrets.local.json and is never printed. From the mini:
#   ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\River\river-bitcube\tools\mission\snap.ps1 -Camera gallery
param([ValidateSet('gallery', 'river')][string]$Camera = 'gallery', [int]$Width = 960)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$url = (Get-Content -Raw (Join-Path $repo 'secrets.local.json') | ConvertFrom-Json).cameras.$Camera
$url = $url -replace 'Preview_01_main', 'Preview_01_sub'
$out = Join-Path $env:TEMP "mission_snap_$Camera.jpg"
Remove-Item $out -ErrorAction SilentlyContinue
$ff = 'C:\Program Files\WinGet\Links\ffmpeg.exe'
$ErrorActionPreference = 'Continue'
& $ff -hide_banner -loglevel error -rtsp_transport tcp -timeout 8000000 -i $url -frames:v 1 -vf "scale=${Width}:-2" -q:v 5 -y $out 2>$null | Out-Null
if (Test-Path $out) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($out)) } else { 'ERROR no frame' }
