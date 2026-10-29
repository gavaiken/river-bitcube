# bitcube shuts itself down cleanly after the gallery closes (Gavin, 28 Oct 2026), so the staff pulling the power at
# night never cuts Windows, TouchDesigner or the mirror mid-write. One scheduled task, River-NightlyShutdown, with one
# dated trigger per show night (closing + 5 min); nothing fires after the show. The morning is BIOS Auto Power On (when
# the plug was pulled) or the wake from the Mac mini (tools/mini/wake_bitcube.sh, an hour before opening).
#
#   .\tools\power\nightly_shutdown.ps1                      register (or replace) the task with the default times
#   .\tools\power\nightly_shutdown.ps1 -Times '2026-11-02 20:05','2026-11-03 18:05'   other nights (local time)
#   .\tools\power\nightly_shutdown.ps1 -Status               the triggers, state, last run and result
#   .\tools\power\nightly_shutdown.ps1 -Remove               unregister it
#
# Runs as SYSTEM (with or without the desktop session). shutdown /f so no dialog (TouchDesigner's "save?") can hold it:
# nothing is lost, the show file is only ever saved with td_save.ps1. From the Mac mini: tools/mini/bitcube_ps.sh.
param(
    [string[]]$Times = @('2026-10-29 18:30', '2026-10-30 20:30', '2026-10-31 20:30', '2026-11-01 20:30'),
    [switch]$Status,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$task = 'River-NightlyShutdown'

if ($Remove) {
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false
        Write-Output "$task removed"
    } else { Write-Output "$task was not registered" }
    exit 0
}

if ($Status) {
    $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output "$task is not registered"; exit 1 }
    $i = Get-ScheduledTaskInfo -TaskName $task
    Write-Output "$task state=$($t.State) next=$($i.NextRunTime) last=$($i.LastRunTime) result=$($i.LastTaskResult)"
    foreach ($tr in $t.Triggers) { Write-Output "  trigger $($tr.StartBoundary) enabled=$($tr.Enabled)" }
    Write-Output "  action: $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
    exit 0
}

$triggers = foreach ($s in $Times) {
    $at = [datetime]::ParseExact($s, 'yyyy-MM-dd HH:mm', $null)
    if ($at -lt (Get-Date)) { Write-Warning "$s is in the past; skipped"; continue }
    New-ScheduledTaskTrigger -Once -At $at
}
if (-not $triggers) { throw 'no future times' }
$action = New-ScheduledTaskAction -Execute 'shutdown.exe' `
    -Argument '/s /f /t 60 /c "A River Becoming: the gallery is closed; bitcube shuts down in a minute (tools/power/nightly_shutdown.ps1)"'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
# StartWhenAvailable off on purpose: a trigger missed while bitcube was off must never fire on the next morning's boot
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $task -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
$i = Get-ScheduledTaskInfo -TaskName $task
Write-Output "$task registered: $($triggers.Count) nights, next $($i.NextRunTime)"
