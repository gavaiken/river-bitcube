# Register (or re-register) the scheduled task RiverRecord: every hour, tools\cameras\record.py tries for up to
# 55 minutes to record 5 minutes of the river cam (main + sub, in parts across drops) into River\recordings\river.
#   powershell -ExecutionPolicy Bypass -File tools\record_task.ps1
# Windowless (pythonw, S4U like RiverSnapshot); one run at a time.
$repo = Split-Path $PSScriptRoot -Parent
$action = New-ScheduledTaskAction -Execute (Join-Path $repo '.venv\Scripts\pythonw.exe') `
    -Argument 'tools\cameras\record.py river --minutes 5 --give-up 55' -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 58) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$user = "$env:COMPUTERNAME\$env:USERNAME"
$desc = 'A River Becoming: 5 min of the river cam every hour into River\recordings (river-bitcube tools\cameras\record.py).'
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName 'RiverRecord' -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description $desc -Force | Out-Null
'registered RiverRecord (hourly, S4U)'
