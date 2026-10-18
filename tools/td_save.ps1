# Save the open TouchDesigner project without any chance of a modal prompt.
#   .\tools\td_save.ps1                                   # save the open file (e.g. river.toe) in place
#   .\tools\td_save.ps1 -Target river-local-oct-18.toe    # Save As: TD then runs the new file
# The default is the file TD has open, never a hard-coded name, so saving while a checkpoint file is
# open can't overwrite river.toe. A relative -Target is relative to the repo root.
# Why: with TD's incremental save on (pref general.inc, default 2), project.save(path) can try to write
# <name>.<N>.toe, find it exists and pop "already exists. Replace?". That modal blocks TD's main thread,
# so the bridge hangs. bitcube has general.inc = 0 (set 2026-10-18). This script re-checks it, refuses to
# save if incrementing is back on, saves, verifies the target's timestamp, and clears stray <name>.<N>.toe.
param([string]$Target)
$root = Split-Path $PSScriptRoot -Parent
$td = Join-Path $PSScriptRoot 'td.ps1'

if (-not $Target) {
    $Target = & $td "print(project.folder + '/' + project.name)"
    if ($LASTEXITCODE -ne 0 -or -not $Target) { Write-Error 'Could not read the open project path from TD.'; exit 1 }
    # An incremental copy (river.7.toe) is open: save the real file (river.toe), never the copy.
    $Target = $Target -replace '\.\d+\.toe$', '.toe'
}
if (-not [IO.Path]::IsPathRooted($Target)) { $Target = Join-Path $root $Target }
$Target = [IO.Path]::GetFullPath($Target)
if ($Target -notlike '*.toe') { Write-Error "Target must be a .toe file: $Target"; exit 1 }

$inc = & $td "ui.preferences['general.inc']"
if ($LASTEXITCODE -ne 0) { exit 1 }
if ([int]$inc -ne 0) {
    & $td "ui.preferences['general.inc'] = 0; ui.preferences.save()" | Out-Null
    $inc = & $td "ui.preferences['general.inc']"
    if ([int]$inc -ne 0) { Write-Error "Incremental save is on (general.inc=$inc) and could not be turned off; not saving."; exit 1 }
}

$before = if (Test-Path $Target) { (Get-Item $Target).LastWriteTime } else { [datetime]::MinValue }
$result = & $td "project.save(r'$($Target -replace '\\', '/')'), project.name"
if ($LASTEXITCODE -ne 0) { exit 1 }
if (-not (Test-Path $Target)) { Write-Error "$Target was not written (save returned $result)."; exit 1 }
$after = (Get-Item $Target).LastWriteTime
if ($after -le $before) { Write-Error "$Target was not updated (save returned $result)."; exit 1 }

$base = [IO.Path]::GetFileNameWithoutExtension($Target)
Get-ChildItem (Split-Path $Target -Parent) -Filter "$base.*.toe" |
    Where-Object { $_.Name -match ('^' + [regex]::Escape($base) + '\.\d+\.toe$') } | Remove-Item
"saved $Target at $($after.ToString('HH:mm:ss'))  ($result)"
