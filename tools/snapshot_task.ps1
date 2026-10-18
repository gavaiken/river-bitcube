# Register (or re-register) the scheduled task RiverSnapshot: tools\snapshot.ps1 every 15 min from 08:00 to 02:00.
#   powershell -ExecutionPolicy Bypass -File tools\snapshot_task.ps1
# Runs as this user without a window (S4U, like RopeLights), so nothing flashes up on the screens.
# If S4U isn't allowed (needs an elevated shell), it falls back to an interactive task, still windowless.
$script = Join-Path $PSScriptRoot 'snapshot.ps1'
# conhost --headless gives powershell no console window at all (-WindowStyle Hidden still flashes one).
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
    -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
# Daily at 08:00, repeating every 15 min for 18 h (last run 01:45). snapshot.ps1 also skips 02:00-07:59 itself.
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$repeat = New-ScheduledTaskTrigger -Once -At '08:00' -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Hours 18)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$user = "$env:USERDOMAIN\$env:USERNAME"
$desc = 'A River Becoming: gallery-cam still to the snapshot branch for the status page (river-bitcube tools\snapshot.ps1).'
try {
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName 'RiverSnapshot' -Action $action -Trigger $trigger -Settings $settings `
        -Principal $principal -Description $desc -Force -ErrorAction Stop | Out-Null
    'registered RiverSnapshot (S4U, no window)'
} catch {
    Write-Warning "S4U registration failed ($($_.Exception.Message)); registering an interactive task instead."
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName 'RiverSnapshot' -Action $action -Trigger $trigger -Settings $settings `
        -Principal $principal -Description $desc -Force | Out-Null
    'registered RiverSnapshot (interactive)'
}
