# Mission control's status probe for bitcube (docs/mission-plan.md). Read-only unless -Action is given.
# Prints ONE line of JSON. Run from the Mac mini as:  ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass
#   -File C:\Users\user\River\river-bitcube\tools\mission\probe.ps1 [-Action ropes -Dark] [-Action hub75 -Brightness 0.6]
#   [-Action bootfile -BootFile river-local-oct-22-seasons.toe]   which show file opens at boot
#   [-Action switch -BootFile river-online-oct-23.toe]            also restart TouchDesigner on it now (~1 min dark)
#   [-Action lightsroute -LightsRoute direct|router]             which port carries the lighting network (D25, S31)
#   [-Action rebuild -BootFile river-local-oct-22-seasons.toe]   bake the newest LED map into the river's year: refuses unless
#                                                                TouchDesigner has that very file open, then runs
#                                                                td/build/build_seasons_local.py through tools/td.ps1, saves with
#                                                                tools/td_save.ps1, then the switch path above (restart on it, ~1 min
#                                                                dark). Reports rebuilt / saved / switched (booleans) with the status.
#   [-Action test -On]                                           the test pattern on the ropes and panels (without -On: back to
#                                                                what they showed before; td_mission.py keeps which)
#   ropes, hub75, test, switch, rebuild and lightsroute are refused while a calibration runs ({ ok: false, error: "a calibration is
#   running. Stop it on the Lights page first", refused: <action> } with the status), whoever runs this script; a dry run (or a
#   decode of earlier photos) touches no lights and refuses nothing.
param([string]$Action = 'status', [switch]$Dark, [double]$Brightness = 1.0, [string]$BootFile, [string]$LightsRoute, [switch]$On)
$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$river = Split-Path $repo -Parent
$out = [ordered]@{ ok = $true; time = (Get-Date).ToString('s') }
# A camera's login never leaves bitcube: masked up to the authority's LAST @ (as mission/lib/scrub.mjs; ffmpeg takes the last
# @ too), and masked BEFORE a line is cut, or a cut between two @ leaves a tail nobody can recognise as a login. The camera's own
# HTTP API takes it as a JSON field or a query ("password":"...", ?password=...) and answers its token as one ({"Token":{"name":
# "..."}}): those values are masked too, as scrubCreds does: a quoted value to its own closing quote, past an escaped quote inside
# it; an object or array whole; a bare value in JSON text as "***" so the JSON stays JSON; null, true and false left alone. A key
# with a prefix too (cam_password, access_token, X-Auth-Token, *_TOKEN=), and a command line's login forms: an Authorization
# header, Bearer, curl -u user:pw, --password pw, sshpass -p pw (R8 #38).
# The very patterns of mission/lib/scrub.mjs PATTERNS (mission/test/review-cr7.test.mjs compares them; tools/tests/test_masks.py
# runs them): change both together.
$CRED_URL = '(?<![a-z0-9+.-])([0-9+.-]*[a-z][a-z0-9+.-]*:\/\/)[^\s/?#"<>]*@'
$CRED_SMB = '((?<![:\w/])\/\/[^\s/@:"''<>]+:)[^\s/"''<>]*@'
$CRED_QUOTED = '((?<![\w-])(?:[\w-]*?(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key|psk|(?:wpa|wep|auth)[_-]?key|pw)|(?:[\w-]*[_-])pass|sshpass|pass(?==)|key(?=\\?["'']\s*:\s*\\?["''])|\\?["''](?:user(?:name)?|login|usr)\\?["'']\s*:\s*(?:\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']|[\w.@-]+)\s*,\s*\\?["'']pass(?=\\?["'']\s*:)|pass(?=\\?["'']\s*:\s*\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']\s*,\s*\\?["''](?:user(?:name)?|login|usr)\\?["'']))(?![\w-])(?:\\?["''])?\s*[:=]\s*)(["''])((?:\\(?:[\s\S]|$)|(?!\2)[^\\])*)(\2|$)'
$CRED_ESCAPED = '((?<![\w-])(?:[\w-]*?(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key|psk|(?:wpa|wep|auth)[_-]?key|pw)|(?:[\w-]*[_-])pass|sshpass|pass(?==)|key(?=\\?["'']\s*:\s*\\?["''])|\\?["''](?:user(?:name)?|login|usr)\\?["'']\s*:\s*(?:\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']|[\w.@-]+)\s*,\s*\\?["'']pass(?=\\?["'']\s*:)|pass(?=\\?["'']\s*:\s*\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']\s*,\s*\\?["''](?:user(?:name)?|login|usr)\\?["'']))(?![\w-])(?:\\?["''])?\s*[:=]\s*)(\\(["'']))((?:\\\\\\\\|\\\\\\\3|\\(?:\\\\)?(?!\\|\3)[\s\S]|\\\\(?!\\|\3)|(?!\3)[^\\]|\\+$)*)(\\\3|$)'
$CRED_BARE_JSON = '((?<![\w-])(?:[\w-]*?(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key|psk|(?:wpa|wep|auth)[_-]?key|pw)|(?:[\w-]*[_-])pass|sshpass|pass(?==)|key(?=\\?["'']\s*:\s*\\?["''])|\\?["''](?:user(?:name)?|login|usr)\\?["'']\s*:\s*(?:\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']|[\w.@-]+)\s*,\s*\\?["'']pass(?=\\?["'']\s*:)|pass(?=\\?["'']\s*:\s*\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']\s*,\s*\\?["''](?:user(?:name)?|login|usr)\\?["'']))(?![\w-])(\\?["''])\s*:\s*)(?!\\?["''])(?!(?:null|true|false)(?![^\s"''&,;}\]]))([{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]|[{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]|[{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]|[{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\])*[}\]])*[}\]])*[}\]])*[}\]]|[{\[][^\r\n]*|[^\s"''&,;}\]]+)'
$CRED_BARE = '((?<![\w-])(?:[\w-]*?(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key|psk|(?:wpa|wep|auth)[_-]?key|pw)|(?:[\w-]*[_-])pass|sshpass|pass(?==)|key(?=\\?["'']\s*:\s*\\?["''])|\\?["''](?:user(?:name)?|login|usr)\\?["'']\s*:\s*(?:\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']|[\w.@-]+)\s*,\s*\\?["'']pass(?=\\?["'']\s*:)|pass(?=\\?["'']\s*:\s*\\?["''](?:\\[\s\S]|[^"''\\\r\n])*?\\?["'']\s*,\s*\\?["''](?:user(?:name)?|login|usr)\\?["'']))(?![\w-])(?:\\?["''])?\s*[:=]\s*)(?!\\?["''])(?!(?:null|true|false)(?![^\s"''&,;}\]]))([{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]|[{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]|[{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]|[{\[](?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\])*[}\]])*[}\]])*[}\]])*[}\]]|[{\[][^\r\n]*|[^\s"''&,;}\]]+)'
$CRED_AUTH = '(\bAuthorization\s*[:=]\s*["'']?(?:(?:Bearer|Basic|Token|Digest)\s+)?)([^\s"'',;]+)'
$CRED_BEARER = '(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})'
$CRED_USER = '((?:^|[\s"''\\/])(?:curl|wget|https?|xh)(?:\.exe)?\s(?:(?:(?![\s"''\\/](?:curl|wget|https?|xh)(?:\.exe)?\s)[^\n;&|])*?[\s"''])?(?:-u|--user)(?:[\s=]+|(?=[^\s=-]))[^\s:"''*]+:)([^\s"'']+)'
$CRED_FLAG = '((?:^|\s)--?(?:[\w-]*[_-])?(?:password|passwd|pwd|passphrase|pass|token|secret|api[_-]?key|auth[_-]?key|psk)\s+)(?![-*])([^\s"'']+)'
$CRED_SSHPASS = '(\bsshpass\s+-p\s*)([^\s"'']+)'
$CRED_MYSQL = '(\b(?:mysql|mysqldump|mysqladmin|mariadb)(?:\.exe)?\s(?:(?:(?!\b(?:mysql|mysqldump|mysqladmin|mariadb)(?:\.exe)?\s)[^\n;&|])*?\s)?(?-i:-p))(''[^''\r\n]*''|"[^"\r\n]*"|[^\s"''-][^\s"'']*)'
$CRED_UCI = '((?<=[\w\]@-])\.key[1-4]?=["'']?|\boption\s+key[1-4]?\s+["'']?)((?<='')(?:[^''\r\n]|''\\'''')*|(?<=")[^"\r\n]*|(?<![''"])[^\s"'']+)'
$CRED_SKANT = '(\bsk-ant-)([A-Za-z0-9_-]{8,})'
$CRED_LOGIN = '((?-i:\s-U)\s*[^\s%"'']+%|(?<=\s)\/rp\s+|(?<=\s)\/user:[^\s"'']+\s+(?![\/-])|\bConvertTo-SecureString\s+(?:-String\s+)?["'']?|\bset_network\s+\S+\s+(?:psk|password|sae_password|wep_key[0-3])\s+["'']?)((?<='')[^''\r\n]*|(?<=")[^"\r\n]*|(?<![''"])[^\s"'']+)'
$CRED_TOKEN = '(\b(?:gh[pousr]_|github_pat_|tskey-|mc=)|\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=]))([A-Za-z0-9_+/-]{16,}={0,2})'
function Mask-Creds([string]$s) {
    if ($null -eq $s) { return $null }
    $s = $s -replace $CRED_URL, '$1***@'
    $s = $s -replace $CRED_SMB, '$1***@'
    $s = $s -replace $CRED_QUOTED, '$1$2***$4'
    $s = $s -replace $CRED_ESCAPED, '$1$2***$5'
    $s = $s -replace $CRED_BARE_JSON, '$1$2***$2'
    $s = $s -replace $CRED_BARE, '$1***'
    $s = $s -replace $CRED_AUTH, '$1***'
    $s = $s -replace $CRED_BEARER, '$1***'
    $s = $s -replace $CRED_USER, '$1***'
    $s = $s -replace $CRED_FLAG, '$1***'
    $s = $s -replace $CRED_SSHPASS, '$1***'
    $s = $s -replace $CRED_MYSQL, '$1***'
    $s = $s -replace $CRED_UCI, '$1***'
    $s = $s -replace $CRED_SKANT, '$1***'
    $s = $s -replace $CRED_LOGIN, '$1***'
    return ($s -replace $CRED_TOKEN, '$1***')
}

$BOOT_FILES = @('river-local-oct-22-seasons.toe', 'river-online-oct-23.toe')   # retired show files start with old- (D27): never offered
$REBUILD_FILES = @('river-local-oct-22-seasons.toe')     # the only file build_seasons_local.py rebuilds (its own guard agrees)
$out.show_files = @($BOOT_FILES | Where-Object { Test-Path (Join-Path $repo $_) })
$tdPs1 = Join-Path $repo 'tools\td.ps1'
# A calibration photographs the ropes and the panels: while one runs (calibration.json says running and its job's process is
# alive), nothing that changes them, restarts TouchDesigner or moves the lighting port may run, whoever asks (a phone, the
# studio chat, a hand-run SSH). The same rule as mission control's calBlocked (mission/lib/mission.mjs CAL_BLOCKED). The
# action is refused and only the status is reported; Stop goes through calibrate.ps1 -Action cancel, never through here. A dry
# run (or a decode of earlier photos) photographs nothing and touches no lights or TouchDesigner: it refuses nothing.
$CAL_BLOCKED = @('ropes', 'hub75', 'test', 'switch', 'rebuild', 'lightsroute')
if ($CAL_BLOCKED -contains $Action) {
    $calRun = $null
    $calFile = Join-Path $river 'calibration.json'
    if (Test-Path -LiteralPath $calFile) {
        foreach ($try in 1..3) {        # the job replaces the file atomically; a read can still land on the swap
            try { $calRun = Get-Content -Raw -LiteralPath $calFile -ErrorAction Stop | ConvertFrom-Json; break } catch { Start-Sleep -Milliseconds 100 }
        }
    }
    $calDry = $calRun -and ($calRun.dry_run -or $calRun.decode_only -or $calRun.mode -eq 'dry-run' -or $calRun.mode -eq 'decode-only')
    $calAlive = $calRun -and $calRun.running -and -not $calDry -and ([int]$calRun.pid -gt 0) -and [bool](Get-Process -Id ([int]$calRun.pid) -ErrorAction SilentlyContinue)
    if ($calAlive) {
        $out.ok = $false; $out.error = 'a calibration is running. Stop it on the Lights page first'; $out.refused = $Action
        $Action = 'status'
    }
}
if ($Action -eq 'rebuild') {
    # Rebuild = build + save + switch, each step reported; any failure stops the chain and the JSON says where.
    $out.rebuilt = $false; $out.saved = $false; $out.switched = $false
    $running = Get-Process TouchDesigner -ErrorAction SilentlyContinue
    if ($REBUILD_FILES -notcontains $BootFile) { $out.ok = $false; $out.error = "rebuild is only for the river's year ($($REBUILD_FILES -join ', '))" }
    elseif (-not $running) { $out.ok = $false; $out.error = 'TouchDesigner is not running: nothing to rebuild' }
    else {
        $open = (& powershell -NoProfile -ExecutionPolicy Bypass -File $tdPs1 'project.name' -Timeout 15 2>$null | Select-Object -Last 1)
        $open = "$open".Trim()
        if ($LASTEXITCODE -ne 0 -or -not $open) { $out.ok = $false; $out.error = 'TouchDesigner did not answer: rebuild refused' }
        elseif ($open -ne $BootFile) { $out.ok = $false; $out.error = "TouchDesigner is running $open, not $($BootFile): rebuild refused" }
        else {
            $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $tdPs1 -File (Join-Path $repo 'td\build\build_seasons_local.py') -Timeout 300 2>&1
            if ($LASTEXITCODE -ne 0) { $out.ok = $false; $out.error = 'the rebuild failed inside TouchDesigner (see td.ps1); nothing was saved' }
            else {
                $out.rebuilt = $true
                $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\td_save.ps1') 2>&1
                if ($LASTEXITCODE -ne 0) { $out.ok = $false; $out.error = 'rebuilt, but the save failed: not restarting (TouchDesigner still runs the rebuilt file unsaved)' }
                else { $out.saved = $true }
            }
        }
    }
    $Action = $(if ($out.saved) { 'switch' } else { 'status' })     # saved: restart on the file, the existing switch path
}
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
    if ($out.Contains('rebuilt')) { $out.switched = $true }
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
    $req = @{ action = $(if ($Action -in 'ropes', 'hub75', 'test') { $Action } else { 'status' }) }
    if ($Action -eq 'ropes') { $req.dark = [bool]$Dark }
    if ($Action -eq 'hub75') { $req.brightness = $Brightness }
    if ($Action -eq 'test') { $req.on = [bool]$On }
    $req | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $env:TEMP 'mission_args.json') -Encoding utf8
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\td.ps1') -File (Join-Path $PSScriptRoot 'td_mission.py') -Timeout 15 2>$null
    $line = ($raw | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
    if ($line) { $td = $line | ConvertFrom-Json } else { $td = @{ ok = $false; error = 'no answer from the TD bridge' } }
} else { $td = @{ ok = $false; error = 'TouchDesigner is not running' } }
$out.td = $td
# ropes / hub75 / test act through TouchDesigner: if it didn't carry the action out, the action failed (the page must not say done)
if ($Action -in 'ropes', 'hub75', 'test' -and $td -and $td.ok -eq $false) { $out.ok = $false; $out.error = "$($td.error)" }

# Boot file: the show file Start-River.cmd opens at the next start, worked out as it does: boot-file.txt's file when that file
# exists (mission control sets it; the last such line wins), else the river's year, else the live river. boot_file_chosen says
# whether boot-file.txt chose it; boot_file is null when there is no show file at all (TouchDesigner would open empty).
$bf = Join-Path $river 'boot-file.txt'
$boot = $null; $chosen = $false
if (Test-Path -LiteralPath $bf) {
    foreach ($line in @(Get-Content -LiteralPath $bf -ErrorAction SilentlyContinue)) {
        $name = "$line".Trim()
        if ($name -and -not $name.StartsWith(';') -and (Test-Path -LiteralPath (Join-Path $repo $name))) { $boot = $name; $chosen = $true }
    }
}
if (-not $boot) { $boot = @('river-local-oct-22-seasons.toe', 'river-online-oct-23.toe') | Where-Object { Test-Path -LiteralPath (Join-Path $repo $_) } | Select-Object -First 1 }
$out.boot_file = $boot
$out.boot_file_chosen = $chosen

# Modal link: processes and the newest clip per camera
$procs = @(Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like '*modal_link.py*' -and $_.CommandLine -notlike '*status*' })
$link = [ordered]@{ processes = $procs.Count }
foreach ($cam in 'gallery', 'river', 'sync') {
    $log = Join-Path $river "logs\modal-$cam.log"
    if (Test-Path $log) {
        $last = Get-Content $log -Tail 200 | Where-Object { $_ -match 'INFO' } | Select-Object -Last 1
        $link[$cam] = @{ last = $(if ($last) { $m = Mask-Creds $last; $m.Substring(0, [Math]::Min(120, $m.Length)) } else { $null }); log_age_s = [int]((Get-Date) - (Get-Item $log).LastWriteTime).TotalSeconds }
    }
}
$out.modal_link = $link

# River recorder
$rlog = Join-Path $river 'recordings\river\record.log'
$out.recorder = [ordered]@{
    clips = @(Get-ChildItem (Join-Path $river 'recordings\river') -Filter '*.mp4' -ErrorAction SilentlyContinue).Count
    last = $(if (Test-Path $rlog) { $l = Mask-Creds (Get-Content $rlog -Tail 1); if ($l) { $l.Substring(0, [Math]::Min(120, $l.Length)) } else { $null } } else { $null })
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
