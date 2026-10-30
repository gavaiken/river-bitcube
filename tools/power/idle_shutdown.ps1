# Registers River-IdleShutdown (Gavin, 29 Oct 2026): every 5 minutes, as SYSTEM, tools/power/idle_shutdown.py shuts
# bitcube down once the people counter has seen nobody for 3 hours (it never does while the counter or its camera is
# down). Replaces the dated River-NightlyShutdown, which registering removes. The morning wake is unchanged
# (the Mac mini, tools/mini/wake_bitcube.sh).
#
#   .\tools\power\idle_shutdown.ps1            register (or replace) the task; remove River-NightlyShutdown
#   .\tools\power\idle_shutdown.ps1 -Status    the task, its last run, and what the checker decides right now
#   .\tools\power\idle_shutdown.ps1 -Remove    unregister it (bitcube then never shuts itself down)
# Keep it on for a while (an evening event): write a unix time into River\power\keep-on-until.txt.
# Cancel a shutdown in its last minute: shutdown /a
param([switch]$Status, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$task = 'River-IdleShutdown'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$py = Join-Path $repo '.venv\Scripts\python.exe'
$script = Join-Path $repo 'tools\power\idle_shutdown.py'

if ($Remove) {
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false; Write-Output "$task removed"
    } else { Write-Output "$task was not registered" }
    exit 0
}
if ($Status) {
    $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output "$task is not registered" }
    else {
        $i = Get-ScheduledTaskInfo -TaskName $task
        Write-Output "$task state=$($t.State) next=$($i.NextRunTime) last=$($i.LastRunTime) result=$($i.LastTaskResult)"
    }
    if (Get-ScheduledTask -TaskName 'River-NightlyShutdown' -ErrorAction SilentlyContinue) { Write-Output 'River-NightlyShutdown is still registered' }
    & $py $script --status
    exit 0
}

if (-not (Test-Path $py)) { throw "no Python at $py" }
$action = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
if (Get-ScheduledTask -TaskName 'River-NightlyShutdown' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName 'River-NightlyShutdown' -Confirm:$false
    Write-Output 'River-NightlyShutdown removed (replaced)'
}
$i = Get-ScheduledTaskInfo -TaskName $task
Write-Output "$task registered: every 5 min, next $($i.NextRunTime)"
& $py $script --status
