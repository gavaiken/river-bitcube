# Screenshot of bitcube's desktop (every display), saved as a PNG under frames\ and its path printed.
#   .\tools\screenshot.ps1                 # whole desktop, scaled to at most 1600 px wide
#   .\tools\screenshot.ps1 -MaxWidth 0     # full resolution
# From the Mac mini:
#   p=$(ssh bitcube 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\River\river-bitcube\tools\screenshot.ps1' | tr -d '\r' | tail -1)
#   scp "bitcube:/${p//\\//}" .
#
# An SSH shell runs in session 0, which has no desktop, so there the script re-runs itself in the
# logged-in user's session through a one-off interactive scheduled task, waits for the PNG, then removes
# the task. Run from the desktop session (e.g. Claude on bitcube), it captures directly.
param(
    [int]$MaxWidth = 1600,
    [string]$Out,
    [switch]$Capture          # internal: do the capture in this process
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Out) {
    New-Item -ItemType Directory -Force (Join-Path $repo 'frames') | Out-Null
    $Out = Join-Path $repo ('frames\desktop-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
}

if ($Capture -or (Get-Process -Id $PID).SessionId -ne 0) {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    Add-Type -Namespace W -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
    [W.Dpi]::SetProcessDPIAware() | Out-Null          # real pixels, not scaled ones
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $g.Dispose()
    if ($MaxWidth -gt 0 -and $bmp.Width -gt $MaxWidth) {
        $h = [int]($bmp.Height * $MaxWidth / $bmp.Width)
        $small = New-Object System.Drawing.Bitmap $bmp, $MaxWidth, $h
        $bmp.Dispose(); $bmp = $small
    }
    $bmp.Save("$Out.part", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Move-Item -Force "$Out.part" $Out           # appears whole, so the waiting SSH side never reads half a file
    $Out
    return
}

# Session 0 (SSH): hand the capture to the desktop session.
$task = 'RiverScreenshot-' + $PID
$arg = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Capture -MaxWidth $MaxWidth -Out `"$Out`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force | Out-Null
try {
    Start-ScheduledTask -TaskName $task
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path $Out) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path $Out)) { throw "No screenshot after 20 s (is anyone logged in to the desktop?)" }
} finally {
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
}
$Out
