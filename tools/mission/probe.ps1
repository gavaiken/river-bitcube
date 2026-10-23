# Mission control's status probe for bitcube (docs/mission-plan.md). Read-only unless -Action is given.
# Prints ONE line of JSON. Run from the Mac mini as:  ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass
#   -File C:\Users\user\River\river-bitcube\tools\mission\probe.ps1 [-Action ropes -Dark] [-Action hub75 -Brightness 0.6]
#   [-Action bootfile -BootFile river-local-oct-22-seasons.toe]
param([string]$Action = 'status', [switch]$Dark, [double]$Brightness = 1.0, [string]$BootFile)
$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$river = Split-Path $repo -Parent
$out = [ordered]@{ ok = $true; time = (Get-Date).ToString('s') }

$BOOT_FILES = @('river-local-oct-22-seasons.toe', 'river-online-oct-20.toe')
if ($Action -eq 'bootfile') {
    if ($BOOT_FILES -notcontains $BootFile) { $out.ok = $false; $out.error = "unknown show file $BootFile" }
    else { Set-Content -Path (Join-Path $river 'boot-file.txt') -Value $BootFile -Encoding ascii }
}

# TouchDesigner (via the bridge): status, or one of its fixed actions
$td = $null
if (Get-Process TouchDesigner -ErrorAction SilentlyContinue) {
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
$out.disk_free_gb = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
$out.uptime_h = [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalHours, 1)
$out | ConvertTo-Json -Compress -Depth 8
