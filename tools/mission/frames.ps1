# Mission control's live frames from TouchDesigner: what the ropes and the HUB75 are being sent right now, for the
# portal's lights simulator. Prints ONE line of JSON: td_mission.py's answer with its "frames" key (shape in its header).
# Cheap enough to run every 10 s: no device checks, one bridge call with a short timeout. From the Mac mini:
#   ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\River\river-bitcube\tools\mission\frames.ps1
param([int]$Timeout = 8)
$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Get-Process TouchDesigner -ErrorAction SilentlyContinue)) { '{"ok":false,"error":"TouchDesigner is not running"}'; exit 0 }

# td_mission.py takes its request from %TEMP%\mission_args.json unless MISSION_ARGS is defined before it runs. A copy
# with that first line keeps this call out of the way of a probe.ps1 running at the same time (they would share the file).
$code = "MISSION_ARGS = {'action': 'frames'}`n" + (Get-Content -Raw (Join-Path $PSScriptRoot 'td_mission.py'))
$tmp = Join-Path $env:TEMP 'mission_frames.py'
[IO.File]::WriteAllText($tmp, $code, (New-Object Text.UTF8Encoding $false))
$raw = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\td.ps1') -File $tmp -Timeout $Timeout 2>&1
$line = $raw | Where-Object { "$_" -match '^\{' } | Select-Object -Last 1
if ($line) { "$line"; exit 0 }
# No JSON: td.ps1's first message says why (not running, a blocking dialog, a timeout, a Python error).
$err = $raw | ForEach-Object { "$_" } | Where-Object { $_ -match '\S' } | Select-Object -First 1
$msg = if ($err) { $err.Substring(0, [Math]::Min(200, $err.Length)) } else { 'no answer from the TD bridge' }
@{ ok = $false; error = $msg } | ConvertTo-Json -Compress
