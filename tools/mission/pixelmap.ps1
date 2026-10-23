# Prints the newest rope pixel map (tools/pixelmap/pixelmap-YYYY-MM-DD.json) as ONE line of JSON, with "file" and
# "modified" added in front of the map's own keys (meta, ropes, points, hub75_quad1...), for mission control to fetch
# once per new map (the probe's "pixelmap" summary says which file is newest). From the mini:
#   ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\River\river-bitcube\tools\mission\pixelmap.ps1 [-File pixelmap-2026-10-18.json]
# The file is passed through as text (no parse/serialise round trip, which would be slow and could alter numbers):
# decode.py writes it with line breaks between points only, so dropping them keeps the JSON valid.
param([string]$File)
$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'tools\pixelmap'
if ($File) {
    if ($File -notmatch '^pixelmap-\d{4}-\d{2}-\d{2}\.json$') { '{"error":"File must be pixelmap-YYYY-MM-DD.json"}'; exit 0 }
    $pm = Get-Item (Join-Path $dir $File) -ErrorAction SilentlyContinue
} else {
    $pm = Get-ChildItem $dir -Filter 'pixelmap-????-??-??.json' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
}
if (-not $pm) { '{"error":"no pixel map on bitcube"}'; exit 0 }
$raw = ([IO.File]::ReadAllText($pm.FullName)) -replace '\r?\n', ''
$raw = $raw.Trim()
$head = '{"file":"' + $pm.Name + '","modified":"' + $pm.LastWriteTime.ToString('s') + '",'
if ($raw.StartsWith('{') -and $raw.Length -gt 2) { $head + $raw.Substring(1) } else { $raw }
