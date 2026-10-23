# Mission control's status probe for bitcube (docs/mission-plan.md). Read-only unless -Action is given.
# Prints ONE line of JSON. Run from the Mac mini as:  ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass
#   -File C:\Users\user\River\river-bitcube\tools\mission\probe.ps1 [-Action ropes -Dark] [-Action hub75 -Brightness 0.6]
#   [-Action bootfile -BootFile river-local-oct-22-seasons.toe]   which show file opens at boot
#   [-Action switch -BootFile river-online-oct-23.toe]            also restart TouchDesigner on it now (~1 min dark)
#   [-Action lightsroute -LightsRoute direct|router]             which port carries the lighting network (D25, S31)
param([string]$Action = 'status', [switch]$Dark, [double]$Brightness = 1.0, [string]$BootFile, [string]$LightsRoute)
$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$river = Split-Path $repo -Parent
$out = [ordered]@{ ok = $true; time = (Get-Date).ToString('s') }

$BOOT_FILES = @('river-local-oct-22-seasons.toe', 'river-online-oct-23.toe', 'river-online-oct-20.toe', 'river-local-oct-18.toe')
$out.show_files = @($BOOT_FILES | Where-Object { Test-Path (Join-Path $repo $_) })
if ($Action -in 'bootfile', 'switch') {
    if ($out.show_files -notcontains $BootFile) { $out.ok = $false; $out.error = "no show file $BootFile on bitcube"; $Action = 'status' }
    else { Set-Content -Path (Join-Path $river 'boot-file.txt') -Value $BootFile -Encoding ascii }
}
if ($Action -eq 'switch') {
    # Quit TouchDesigner (unsaved changes are lost; its camera relays exit with it) and start the launcher in the
    # desktop session through a one-off interactive task, as at login. Start-River.cmd waits 10 s, then opens it.
    Get-Process TouchDesigner -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3
    $act = New-ScheduledTaskAction -Execute (Join-Path $repo 'Start-River.cmd') -WorkingDirectory $repo
    $prin = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive
    Register-ScheduledTask -TaskName 'MissionSwitchShow' -Action $act -Principal $prin -Force | Out-Null
    Start-ScheduledTask -TaskName 'MissionSwitchShow'
    Start-Sleep 3
    Unregister-ScheduledTask -TaskName 'MissionSwitchShow' -Confirm:$false
    $out.switched_to = $BootFile
}

if ($Action -eq 'lightsroute') {
    if ($LightsRoute -notin 'direct', 'router') { $out.ok = $false; $out.error = 'lights route is direct or router' }
    else { $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\lights_route.ps1') $LightsRoute 2>&1 }
}
$lr = Get-NetIPAddress -IPAddress '2.0.0.8' -AddressFamily IPv4 -ErrorAction SilentlyContinue
$out.lights_route = $(if (@($lr).Count -gt 1) { 'BOTH' } elseif ($lr.InterfaceAlias -eq 'Ethernet') { 'direct' } elseif ($lr.InterfaceAlias -eq 'Ethernet 2') { 'router' } else { 'none' })

# TouchDesigner (via the bridge): status, or one of its fixed actions
$td = $null
if ($Action -eq 'switch') { $td = @{ ok = $false; error = "restarting on $BootFile" } }
elseif (Get-Process TouchDesigner -ErrorAction SilentlyContinue) {
    $req = @{ action = $(if ($Action -in 'ropes', 'hub75') { $Action } else { 'status' }) }
    if ($Action -eq 'ropes') { $req.dark = [bool]$Dark }
    if ($Action -eq 'hub75') { $req.brightness = $Brightness }
    $req | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $env:TEMP 'mission_args.json') -Encoding utf8
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\td.ps1') -File (Join-Path $PSScriptRoot 'td_mission.py') -Timeout 15 2>$null
    $line = ($raw | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
    if ($line) { $td = $line | ConvertFrom-Json } else { $td = @{ ok = $false; error = 'no answer from the TD bridge' } }
} else { $td = @{ ok = $false; error = 'TouchDesigner is not running' } }
$out.td = $td

# Boot file
$bf = Join-Path $river 'boot-file.txt'
$out.boot_file = $(if (Test-Path $bf) { (Get-Content $bf -TotalCount 1).Trim() } else { 'Start-River.cmd default' })

# Modal link: processes and the newest clip per camera
$procs = @(Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like '*modal_link.py*' -and $_.CommandLine -notlike '*status*' })
$link = [ordered]@{ processes = $procs.Count }
foreach ($cam in 'gallery', 'river', 'sync') {
    $log = Join-Path $river "logs\modal-$cam.log"
    if (Test-Path $log) {
        $last = Get-Content $log -Tail 200 | Where-Object { $_ -match 'INFO' } | Select-Object -Last 1
        $link[$cam] = @{ last = $(if ($last) { $last.Substring(0, [Math]::Min(120, $last.Length)) } else { $null }); log_age_s = [int]((Get-Date) - (Get-Item $log).LastWriteTime).TotalSeconds }
    }
}
$out.modal_link = $link

# River recorder
$rlog = Join-Path $river 'recordings\river\record.log'
$out.recorder = [ordered]@{
    clips = @(Get-ChildItem (Join-Path $river 'recordings\river') -Filter '*.mp4' -ErrorAction SilentlyContinue).Count
    last = $(if (Test-Path $rlog) { $l = Get-Content $rlog -Tail 1; $l.Substring(0, [Math]::Min(120, $l.Length)) } else { $null })
}
# Calibration job (tools/mission/calibrate.py, started by calibrate.ps1): its progress file when it is from the last 24 h,
# with alive (is its process still there) and stale (running is still true but the process is gone). Shape: mission/lib/lights.mjs.
$cal = Join-Path $river 'calibration.json'
$out.calibration = $null
if ((Test-Path $cal) -and ((Get-Date) - (Get-Item $cal).LastWriteTime).TotalHours -lt 24) {
    try {
        $c = Get-Content -Raw $cal | ConvertFrom-Json
        $alive = ($c.pid -gt 0) -and [bool](Get-Process -Id ([int]$c.pid) -ErrorAction SilentlyContinue)
        $c | Add-Member -NotePropertyName alive -NotePropertyValue $alive -Force
        if ($c.running -and -not $alive) { $c | Add-Member -NotePropertyName stale -NotePropertyValue $true -Force }
        $out.calibration = $c
    } catch { $out.calibration = @{ error = 'unreadable calibration.json' } }
}
# Newest rope pixel map (tools/pixelmap/pixelmap-YYYY-MM-DD.json): a summary; pixelmap.ps1 prints the whole file.
# Rope numbers are 1-based (as in the rope map); dark = no visible pixel in the map (unmapped or unlit, e.g. ropes 9 and 17).
$out.pixelmap = $null
$pm = Get-ChildItem (Join-Path $repo 'tools\pixelmap') -Filter 'pixelmap-????-??-??.json' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
if ($pm) {
    try {
        $m = Get-Content -Raw $pm.FullName | ConvertFrom-Json
        $found = @(); $dark = @()
        foreach ($r in 1..20) {
            $e = $m.ropes.PSObject.Properties[[string]($r - 1)]
            if ($e -and $e.Value.visible -gt 0) { $found += $r } else { $dark += $r }
        }
        $quads = @($m.PSObject.Properties.Name | Where-Object { $_ -match '^hub75_quad\d+$' } | Sort-Object)
        $date = $(if ($pm.Name -match '(\d{4}-\d{2}-\d{2})') { $Matches[1] } else { $null })
        $out.pixelmap = [ordered]@{ file = $pm.Name; date = $date; points = @($m.points).Count; ropes = $found.Count; ropes_found = $found
                                    ropes_dark = $dark; hub75_quads = $quads; camera = $m.meta.camera; frame_size = $m.meta.frame_size
                                    drift_px = $m.meta.drift; modified = $pm.LastWriteTime.ToString('s') }
    } catch { $out.pixelmap = @{ file = $pm.Name; error = 'unreadable pixel map' } }
}
# Network: what bitcube can reach (the mini can't see the install LAN or the river router directly)
function Tcp([string]$h, [int]$p) {
    try { $c = New-Object Net.Sockets.TcpClient; $ok = $c.ConnectAsync($h, $p).Wait(1500) -and $c.Connected; $c.Close(); return $ok } catch { return $false }
}
function Ping([string]$h) { try { return ((New-Object Net.NetworkInformation.Ping).Send($h, 1000).Status -eq 'Success') } catch { return $false } }
$out.devices = [ordered]@{
    internet     = Tcp '1.1.1.1' 443
    router       = Tcp '192.168.9.1' 80          # our GL.iNet at Gray Area
    gallery_cam  = Tcp '192.168.9.76' 554
    river_cam    = Tcp '192.168.8.217' 554       # at the river, over Starlink + Will's tailnet
    psac10_1     = Ping '2.0.0.10'                # rope box 1 (ropes 1-10)
    psac10_2     = Ping '2.0.0.11'                # rope box 2 (ropes 11-20)
    seasons_page = Tcp '127.0.0.1' 9981
}
$out.addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { [ordered]@{ nic = $_.InterfaceAlias; ip = $_.IPAddress } })
$out.displays = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue |
    ForEach-Object { (($_.UserFriendlyName | Where-Object { $_ -ne 0 }) | ForEach-Object { [char]$_ }) -join '' })
$out.disk_free_gb = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
$out.uptime_h = [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalHours, 1)
$out | ConvertTo-Json -Compress -Depth 8
