# Save the open TouchDesigner project as River\river.toe, without any chance of a modal prompt.
#   .\tools\td_save.ps1
# Why: with TD's incremental save on (pref general.inc, default 2), project.save(path) can try to write
# river.<N>.toe, find it exists and pop "already exists. Replace?". That modal blocks TD's main thread,
# so the bridge hangs. bitcube has general.inc = 0 (set 2026-10-18). This script re-checks it, refuses to
# save if incrementing is back on, saves, verifies river.toe's timestamp, and clears stray river.<N>.toe.
$root = Split-Path $PSScriptRoot -Parent
$td = Join-Path $PSScriptRoot 'td.ps1'
$target = Join-Path $root 'river.toe'

$inc = & $td "ui.preferences['general.inc']"
if ($LASTEXITCODE -ne 0) { exit 1 }
if ([int]$inc -ne 0) {
    & $td "ui.preferences['general.inc'] = 0; ui.preferences.save()" | Out-Null
    $inc = & $td "ui.preferences['general.inc']"
    if ([int]$inc -ne 0) { Write-Error "Incremental save is on (general.inc=$inc) and could not be turned off; not saving."; exit 1 }
}

$before = if (Test-Path $target) { (Get-Item $target).LastWriteTime } else { [datetime]::MinValue }
$result = & $td "project.save(r'$($target -replace '\\', '/')'), project.name"
if ($LASTEXITCODE -ne 0) { exit 1 }
$after = (Get-Item $target).LastWriteTime
if ($after -le $before) { Write-Error "river.toe was not updated (save returned $result)."; exit 1 }

Get-ChildItem $root -Filter 'river.*.toe' | Where-Object { $_.Name -match '^river\.\d+\.toe$' } | Remove-Item
"saved $target at $($after.ToString('HH:mm:ss'))  ($result)"
