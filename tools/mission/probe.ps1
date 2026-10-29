# Mission control's status probe for bitcube (docs/mission-plan.md). Read-only unless -Action is given.
# Prints ONE line of JSON. Run from the Mac mini as:  ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass
#   -File C:\Users\user\River\river-bitcube\tools\mission\probe.ps1 [-Action ropes -Dark] [-Action hub75 -Brightness 0.6]
#   [-Action bootfile -BootFile river-local-oct-22-seasons.toe]   which show file opens at boot ("Set as default": any offered
#                                                                show in shows.json; writes River\boot-file.txt)
#   [-Action switch -BootFile river-online-oct-23.toe]            restart TouchDesigner on any offered show now (~1 min dark);
#                                                                the boot file stays as it is
#   [-Action lightsroute -LightsRoute direct|router]             which port carries the lighting network (D25, S31)
#   [-Action rebuild -BootFile river-local-oct-22-seasons.toe]   rebuild the river's year (shows.json role year) with its pinned
#                                                                LED map: refuses unless TouchDesigner has that very file open,
#                                                                then runs its build script (shows.json build) through
#                                                                tools/td.ps1, saves with tools/td_save.ps1, then the switch path
#                                                                above (restart on it, ~1 min dark). Reports rebuilt / saved /
#                                                                switched (booleans) and rebuilt_map with the status.
#   [-Action overlay -Overlay 0.25]                              combined-v0 only: save additive canvas strength (0..1)
#   [-Action modalinput -Source scene -Strength 0.6]             Combined with Modal Input Selector only: which Modal input
#                                                                steers it (off/canvas/scene/frames) and how strongly; fades
#                                                                over 4 s, saved in River\combined-modal-inputs.json
#                                                                (docs/modal-inputs.md); status then has td.modal_input
#   [-Action test -On]                                           the test pattern on the ropes and panels (without -On: back to
#                                                                what they showed before; td_mission.py keeps which)
#   [-Action remembered]                                         the remembered river's files only (docs/remembered-river.md
#                                                                section 5; mission/lib/remembered.mjs CONTRACT): no device checks,
#                                                                no TouchDesigner call; prints them and stops
#   [-Action remembered-zones -Light pool -PoolHeight 0.60]      the remembered river only: what to light to check the zones
#                                                                (off|pool|eddies) and the pool line (0..1.5 m); writes
#                                                                River\remembered\control.json for TouchDesigner, then as above
#   [-Action remembered-opening -On]                             the remembered river only: the opening-night switch (without -On: off)
#   [-Action remembered-screens -Video 0.15 -Intensity 0.82 -Threshold 0.35]   the remembered river only, any of the three: how strongly
#                                                                the river video shows under the particle windows (M9), the screens'
#                                                                intensity and their motion threshold (M7), each 0..1: screens.video,
#                                                                .intensity, .threshold in control.json
#   [-Action remembered-override -Param knob.speed -Mode fix -Value 0.7]   the remembered river v2 only (river-all-looks-v2.toe
#                                                                reporting the remembered look in looks\status.json, under 10 s old):
#                                                                one parameter's override (mission/public/remembered-schema.js params:
#                                                                its type, range and modes), merged into control.json's overrides block
#                                                                stamped at: -Mode auto (clears it), fix -Value <number | YYYY-MM-DD |
#                                                                #rrggbb,#rrggbb,#rrggbb>, or adjust -Offset:<o> -Gain:<g> (auto x gain
#                                                                + offset). headcount and lingerer_rope (simulated) get expires_at =
#                                                                at + simulated_max_s (120 s)
#   [-Action remembered-override-clear [-Param palette]]        the same: one override, or the whole overrides block
#   [-Action remembered-simulate -Headcount 8 -LingerRope 12]    the same: simulated people, either or both (rope 0-19), 2 min at most;
#   [-Action remembered-simulate -Stop]                          -Stop removes both. All three then answer as -Action remembered
#   [-Action remembered-history -Fields inputs.heard,params.knob.speed]   the inputs log's last 24 h per field (River\logs\
#                                                                inputs.jsonl through tools/remembered/history.py): its one JSON line
#                                                                The remembered river's three controls also work while river-looks.toe
#                                                                shows it (its looks\status.json, under 10 s old, says look remembered)
#   [-Action looks -Mode auto|manual [-Look remembered|fill-simple|fill-configurable|seasons|modal] [-Playlist '<json>']]
#                                                                the river (all looks) only (TouchDesigner answering on river-looks.toe,
#                                                                river-two-looks.toe or river-all-looks.toe): merges { mode, look, at }
#                                                                into River\looks\control.json atomically, every other field kept (auto
#                                                                without -Look keeps the look there; manual needs one). -Playlist (auto
#                                                                only): compact JSON [{"look":"remembered","for":{"loops":4}}, ...],
#                                                                1..12 entries, loops 1..20 only for remembered, cycles 1..20 only for
#                                                                the fills, minutes 1..120 for any look; refused whole if bad. Mission
#                                                                control sends it with each " as \" (cmd.exe and -File keep it). Then the full
#                                                                check. Every full check carries probe.looks { control, status }
#                                                                (River\looks\control.json and status.json) while River\looks exists
#   [-Action filling -Palette midnight -Brightness 0.8 -Intensity 0.6 -Speed 1]
#                                                                the filling glass only (TouchDesigner answering on river-filling.toe,
#                                                                or on river-looks.toe while a fill look shows):
#                                                                its four dials, all four every time (palette river|glacier|midnight|
#                                                                teal; brightness and intensity 0..1; speed 0.25..3); writes
#                                                                River\filling\control.json atomically for td/filling/fill.py, then
#                                                                the full check. Every full check carries probe.filling { control,
#                                                                status } (River\filling\control.json and status.json, each { age_s,
#                                                                json }) while River\filling exists (docs/mission-ui.md)
#   ropes, hub75, test, switch, rebuild, lightsroute, overlay, filling and looks are refused while a calibration runs ({ ok: false, error: "a calibration is
#   running. Stop it on the Lights page first", refused: <action> } with the status), whoever runs this script; a dry run (or a
#   decode of earlier photos) touches no lights and refuses nothing.
param([string]$Action = 'status', [switch]$Dark, [double]$Brightness = 1.0, [string]$BootFile, [string]$LightsRoute, [switch]$On, [ValidateRange(0,1)][double]$Overlay = 0.25, [ValidateSet('auto','original','channel','channel-multi','pool','pool-multi')][string]$Framing, [ValidateSet('current','gavin','recorded','manual','cycle')][string]$Screenmode, [ValidateRange(0,1)][double]$Screenblend=0, [ValidateSet(15,30,60,120)][int]$Screenhold=30, [ValidateRange(0,1)][Nullable[double]]$Screenrecorded, [ValidateRange(0,120)][Nullable[double]]$Screenoffset, [ValidateSet('off','canvas','scene','frames')][string]$Source, [ValidateRange(0,1)][Nullable[double]]$Strength, [ValidateSet('off','pool','eddies')][string]$Light, [ValidateRange(0,1.5)][Nullable[double]]$PoolHeight, [ValidateSet('river','glacier','midnight','teal')][string]$Palette, [ValidateRange(0,1)][Nullable[double]]$Intensity, [ValidateRange(0.25,3)][Nullable[double]]$Speed, [ValidateSet('auto','manual','fix','adjust')][string]$Mode, [ValidateSet('remembered','fill-simple','fill-configurable','seasons','modal')][string]$Look, [string]$Playlist, [ValidateRange(0,1)][Nullable[double]]$Video, [ValidateRange(0,1)][Nullable[double]]$Threshold, [string]$Param, [string]$Value, [Nullable[double]]$Offset, [Nullable[double]]$Gain, [ValidateRange(0,20)][Nullable[double]]$Headcount, [ValidateRange(0,19)][Nullable[int]]$LingerRope, [switch]$Stop, [string]$Fields)
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

# The show registry (shows.json, docs/shows.md; tools/shows.ps1): what may be switched to or set as default (offered),
# and what a rebuild may bake (role year: the river's year, through its own build script). Retired files aren't listed.
. (Join-Path $repo 'tools\shows.ps1')
$reg = Get-ShowRegistry
if (-not $reg) { $out.registry_error = 'shows.json is missing or unreadable' }
$out.show_files = @(Get-OfferedShows $reg)                       # offered and present: mission control's switch list
$REBUILD = @($(if ($reg) { $reg.shows | Where-Object { $_.role -eq 'year' -and $_.build -and ($out.show_files -contains $_.file) } }))
$REBUILD_FILES = @($REBUILD | ForEach-Object { [string]$_.file })
$tdPs1 = Join-Path $repo 'tools\td.ps1'
# A calibration photographs the ropes and the panels: while one runs (calibration.json says running and its job's process is
# alive), nothing that changes them, restarts TouchDesigner or moves the lighting port may run, whoever asks (a phone, the
# studio chat, a hand-run SSH). The same rule as mission control's calBlocked (mission/lib/mission.mjs CAL_BLOCKED). The
# action is refused and only the status is reported; Stop goes through calibrate.ps1 -Action cancel, never through here. A dry
# run (or a decode of earlier photos) photographs nothing and touches no lights or TouchDesigner: it refuses nothing.
$CAL_BLOCKED = @('ropes', 'hub75', 'test', 'switch', 'rebuild', 'lightsroute', 'overlay', 'filling', 'looks')
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
# The remembered river (docs/remembered-river.md section 5): its files, and its two controls. Each file is { age_s, json },
# { missing = true } or { error }. A control is taken only while TouchDesigner's own status file says the remembered river runs (written
# twice a second: under 10 s old, show river-remembered.toe); it writes control.json (td/remembered/control_schema.py's flat shape, merged
# with what was there) to a temporary file and swaps it in, so TouchDesigner never reads half a file. Nothing else runs.
# A file a show writes for mission control (the remembered river's, the filling glass's): { age_s, json }, { missing = $true } or { error }.
function Read-RiverJson([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return [ordered]@{ missing = $true } }
    foreach ($try in 1..3) {        # TouchDesigner replaces its status file every second or faster; a read can land on the swap
        try {
            $item = Get-Item -LiteralPath $path -ErrorAction Stop
            $json = Get-Content -Raw -LiteralPath $path -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            return [ordered]@{ age_s = [math]::Round(((Get-Date) - $item.LastWriteTime).TotalSeconds, 1); json = $json }
        } catch { Start-Sleep -Milliseconds 60 }
    }
    return [ordered]@{ error = "unreadable $(Split-Path $path -Leaf)" }
}
# The river (all looks) (river-looks.toe; docs/mission-ui.md "Looks"): its own report, looks\status.json, written twice a second.
# The look it shows now, when that report is under 10 s old and names river-looks.toe; else $null.
# The three files that share River\looks (river-all-looks.toe also plays a playlist and has five looks).
$ldir = Join-Path $river 'looks'
# the all-looks file and its v2 (river-all-looks-v2.toe, 29 Oct): mission/public/model.js isAllLooksFile, the same pattern
function Test-AllLooksFile([string]$name) { return $name -cmatch '^river-all-looks(-v2)?\.toe$' }
$LOOKS_FILES = @('river-looks.toe', 'river-two-looks.toe', 'river-all-looks.toe', 'river-all-looks-v2.toe')
$LOOK_NAMES = @('remembered', 'fill-simple', 'fill-configurable', 'seasons', 'modal')
function Get-LookShowing {
    $ls = Read-RiverJson (Join-Path $ldir 'status.json')
    if ($ls.json -and ($ls.json.show -in $LOOKS_FILES -or (Test-AllLooksFile $ls.json.show)) -and $ls.age_s -lt 10) { return [string]$ls.json.look }
    return $null
}
# The remembered river v2's overrides and simulated people (docs/remembered-river.md section 5 "Overrides"; mission/lib/remembered.mjs
# CONTRACT): taken only while river-all-looks-v2.toe reports the remembered look (looks\status.json under 10 s old), each value checked
# against the one schema (mission/public/remembered-schema.js, generated from td/remembered/control_schema.py, which TouchDesigner
# checks again when it reads the file), merged into control.json's overrides block (every other field kept) and written to a
# temporary file swapped in. Then the answer is -Action remembered's.
function Get-RememberedSchema {
    $t = [IO.File]::ReadAllText((Join-Path $repo 'mission\public\remembered-schema.js'))
    $i = $t.IndexOf('export default ') + 'export default '.Length
    return ($t.Substring($i, $t.LastIndexOf('}') - $i + 1) | ConvertFrom-Json)
}
function Test-OverrideValue($schema, $p, [string]$name, [string]$v) {
    $inv = [Globalization.CultureInfo]::InvariantCulture
    switch ($p.type) {
        'number' { $d = 0.0; if ([double]::TryParse($v, [Globalization.NumberStyles]::Float, $inv, [ref]$d) -and $d -ge $p.min -and $d -le $p.max) { return @{ value = [math]::Round($d, 3) } }; return @{ error = "$name is $($p.min) to $($p.max)" } }
        'int' { $n = 0; if ([int]::TryParse($v, [ref]$n) -and $n -ge $p.min -and $n -le $p.max) { return @{ value = $n } }; return @{ error = "$name is a whole number, $($p.min) to $($p.max)" } }
        'date' {
            $dt = [datetime]::MinValue
            if ($v -match '^\d{4}-\d{2}-\d{2}$' -and [datetime]::TryParseExact($v, 'yyyy-MM-dd', $inv, [Globalization.DateTimeStyles]::None, [ref]$dt)) {
                $days = $schema.overrides.days
                if ((-not $days.first -or $v -ge $days.first) -and (-not $days.last -or $v -le $days.last)) { return @{ value = $v } }
            }
            return @{ error = "day is a remembered day, YYYY-MM-DD" }
        }
        'palette' { $c = @($v -split ','); if ($c.Count -eq 3 -and -not ($c | Where-Object { $_ -notmatch '^#[0-9a-fA-F]{6}$' })) { return @{ value = @($c | ForEach-Object { $_.ToLower() }) } }; return @{ error = 'palette is three colours: #rrggbb,#rrggbb,#rrggbb' } }
    }
    return @{ error = "$name can't be fixed" }
}
$remAsked = $null
if ($Action -in 'remembered-override', 'remembered-override-clear', 'remembered-simulate') {
    $remAsked = $Action
    $rdir = Join-Path $river 'remembered'
    $ctlFile = Join-Path $rdir 'control.json'
    $ls = Read-RiverJson (Join-Path $ldir 'status.json')
    $err = $null
    $schema = $null
    try { $schema = Get-RememberedSchema } catch { $err = "couldn't read the control schema (remembered-schema.js): $($_.Exception.Message)" }
    $p = $(if ($schema -and $Param) { $schema.params.PSObject.Properties[$Param].Value } else { $null })
    $sim = @($(if ($schema) { $schema.overrides.simulated } else { @('headcount', 'lingerer_rope') }))
    $entry = $null
    if ($err) { }
    elseif (-not ($ls.json -and $ls.json.show -eq 'river-all-looks-v2.toe' -and $ls.age_s -lt 10)) { $err = "the river v2 isn't running (overrides work only in it)" }
    elseif ($ls.json.look -ne 'remembered') { $err = "the remembered river isn't the look showing now (pick it under Looks on Status first)" }
    elseif ($Action -eq 'remembered-override') {
        if (-not $p) { $err = 'remembered-override needs -Param <one of the schema''s params>' }
        elseif (-not $Mode -or $Mode -notin @($p.modes)) { $err = "$Param's -Mode is $(@($p.modes) -join ', ')" }
        elseif ($Mode -eq 'fix') { $c = Test-OverrideValue $schema $p $Param $Value; if ($c.error) { $err = $c.error } else { $entry = [ordered]@{ mode = 'fix'; value = $c.value } } }
        elseif ($Mode -eq 'adjust') {
            $span = [double]$p.max - [double]$p.min
            $o = $(if ($null -ne $Offset) { [double]$Offset } else { 0.0 }); $g = $(if ($null -ne $Gain) { [double]$Gain } else { 1.0 })
            if ($o -lt -$span -or $o -gt $span) { $err = "offset is -$span to $span" }
            elseif ($g -lt $schema.overrides.gain[0] -or $g -gt $schema.overrides.gain[1]) { $err = "gain is $($schema.overrides.gain[0]) to $($schema.overrides.gain[1])" }
            else { $entry = [ordered]@{ mode = 'adjust'; offset = [math]::Round($o, 3); gain = [math]::Round($g, 2) } }
        }
    }
    elseif ($Action -eq 'remembered-override-clear') { if ($Param -and -not $p) { $err = 'remembered-override-clear: -Param is one of the schema''s params (or none: every override)' } }
    elseif (-not $Stop -and $null -eq $Headcount -and $null -eq $LingerRope) { $err = 'remembered-simulate needs -Headcount 0..20, -LingerRope 0..19 or -Stop' }
    if ($err) { $out.ok = $false; $out.error = $err; $out.refused = $Action }
    else {
        $ctl = [ordered]@{}
        $was = Read-RiverJson $ctlFile
        if ($was.json) { foreach ($pp in $was.json.PSObject.Properties) { if ($null -ne $pp.Value) { $ctl[$pp.Name] = $pp.Value } } }
        $ov = [ordered]@{}
        if ($ctl.Contains('overrides') -and $ctl.overrides -is [Management.Automation.PSCustomObject]) { foreach ($pp in $ctl.overrides.PSObject.Properties) { $ov[$pp.Name] = $pp.Value } }
        $nowUtc = (Get-Date).ToUniversalTime()
        $nowIso = $nowUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
        $expIso = $nowUtc.AddSeconds($(if ($schema.overrides.simulated_max_s) { [double]$schema.overrides.simulated_max_s } else { 120.0 })).ToString('yyyy-MM-ddTHH:mm:ssZ')
        if ($Action -eq 'remembered-override') {
            if ($Mode -eq 'auto') { $ov.Remove($Param) }
            else { $entry.at = $nowIso; $entry.expires_at = $(if ($Param -in $sim) { $expIso } else { $null }); $ov[$Param] = $entry }
        }
        elseif ($Action -eq 'remembered-override-clear') { if ($Param) { $ov.Remove($Param) } else { $ov.Clear() } }
        elseif ($Stop) { foreach ($k in $sim) { $ov.Remove($k) } }
        else {
            if ($null -ne $Headcount) { $ov['headcount'] = [ordered]@{ mode = 'fix'; value = [math]::Round([double]$Headcount, 1); at = $nowIso; expires_at = $expIso } }
            if ($null -ne $LingerRope) { $ov['lingerer_rope'] = [ordered]@{ mode = 'fix'; value = [int]$LingerRope; at = $nowIso; expires_at = $expIso } }
        }
        if ($ov.Count) { $ctl.overrides = $ov } else { $ctl.Remove('overrides') }
        $ctl.at = $nowIso
        try {
            $null = New-Item -ItemType Directory -Force -Path $rdir
            $tmp = "$ctlFile.tmp"
            [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $ctl -Compress -Depth 8), (New-Object Text.UTF8Encoding $false))
            Move-Item -LiteralPath $tmp -Destination $ctlFile -Force   # (not IO.File::Replace: its $null backup arg fails under -EncodedCommand)
            $out.written = $ctl
        } catch { $out.ok = $false; $out.error = "couldn't write the remembered river's control file: $($_.Exception.Message)" }
    }
    $Action = 'remembered'             # then the answer is the remembered river's files, as below
}
# The inputs log for the v2 page's sparklines: tools/remembered/history.py prints its own one line of JSON (read-only).
if ($Action -eq 'remembered-history') {
    if ($Fields -cnotmatch '^(inputs|params)\.[A-Za-z0-9_.]{1,40}(,(inputs|params)\.[A-Za-z0-9_.]{1,40}){0,23}$') {
        $out.ok = $false; $out.action = $Action; $out.refused = $Action; $out.error = 'remembered-history needs -Fields inputs.<name>,params.<name>'
        $out | ConvertTo-Json -Compress
        exit 0
    }
    $py = Join-Path $repo '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $py)) { $py = 'python' }
    $lines = @(& $py (Join-Path $repo 'tools\remembered\history.py') --fields $Fields --river $river 2>&1 | ForEach-Object { "$_" })
    $line = $lines | Where-Object { $_.StartsWith('{') } | Select-Object -Last 1
    if ($line) { Write-Output $line }
    else {
        $out.ok = $false; $out.action = $Action
        $msg = Mask-Creds (($lines -join ' ').Trim())
        $out.error = "history.py didn't answer: $($msg.Substring(0, [math]::Min(200, $msg.Length)))"
        $out | ConvertTo-Json -Compress
    }
    exit 0
}
if ($Action -in 'remembered', 'remembered-zones', 'remembered-opening', 'remembered-screens') {
    $rdir = Join-Path $river 'remembered'
    $out.action = $(if ($remAsked) { $remAsked } else { $Action })
    $out.now_s = [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) / 1000.0, 2)
    $ctlFile = Join-Path $rdir 'control.json'
    if ($Action -ne 'remembered') {
        # runs: the remembered river's own file fresh, or river-looks.toe reporting the remembered river as the look showing (then only
        # its look counts: the remembered look may write its status as river-remembered.toe's own)
        $st = Read-RiverJson (Join-Path $rdir 'status.json')
        $lookNow = Get-LookShowing
        $runs = $(if ($lookNow) { $lookNow -eq 'remembered' } else { $st.json -and $st.json.show -eq 'river-remembered.toe' -and $st.age_s -lt 10 })
        if (-not $runs) {
            $out.ok = $false; $out.refused = $Action
            $out.error = $(if ($lookNow) { "the remembered river isn't the look showing now (pick it under Looks on Status first)" } else { "the remembered river isn't running (its controls work only while it runs)" })
        }
        elseif ($Action -eq 'remembered-zones' -and -not $Light) { $out.ok = $false; $out.error = 'remembered-zones needs -Light off|pool|eddies'; $out.refused = $Action }
        elseif ($Action -eq 'remembered-screens' -and $null -eq $Video -and $null -eq $Intensity -and $null -eq $Threshold) { $out.ok = $false; $out.error = 'remembered-screens needs -Video, -Intensity or -Threshold 0..1'; $out.refused = $Action }
        else {
            # merged with what was there: every field kept (screens too), only the one asked for changed. The canonical shape
            # (td/remembered/control_schema.py): flat keys, nothing seeded (opening night is TouchDesigner's default, on, until
            # remembered-opening writes it). The nested zones block zones.py light --write leaves is folded into flat keys
            # (a flat key wins) and dropped, its t becoming light_at, so TouchDesigner reads one answer.
            $ctl = [ordered]@{}
            $was = Read-RiverJson $ctlFile
            if ($was.json) { foreach ($pp in $was.json.PSObject.Properties) { if ($null -ne $pp.Value) { $ctl[$pp.Name] = $pp.Value } } }
            if ($ctl.Contains('zones')) {
                $z = $ctl.zones
                if ($z -is [Management.Automation.PSCustomObject]) {
                    foreach ($k in 'pool_height_m', 'light', 'leds') { if (-not $ctl.Contains($k) -and $null -ne $z.$k) { $ctl[$k] = $z.$k } }
                    if ($null -ne $z.light -and -not $ctl.Contains('light_at') -and $ctl.Contains('t')) {
                        try { $ctl.light_at = [DateTimeOffset]::FromUnixTimeMilliseconds([long]([double]$ctl.t * 1000)).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ') } catch {}
                    }
                }
                $ctl.Remove('zones')
            }
            $ctl.Remove('t')
            if ($ctl.Contains('opening') -and -not $ctl.Contains('opening_night') -and $ctl.opening -is [Management.Automation.PSCustomObject] -and $ctl.opening.on -is [bool]) { $ctl.opening_night = $ctl.opening.on }
            $ctl.Remove('opening')
            $nowIso = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
            if ($Action -eq 'remembered-zones') {
                # light_at: TouchDesigner drops a light set before it started, or over 10 minutes ago (control_schema.LIGHT_MAX_S)
                $ctl.light = $Light; $ctl.light_at = $nowIso
                if ($Light -eq 'off') { $ctl.Remove('leds') }
                if ($null -ne $PoolHeight) { $ctl.pool_height_m = [math]::Round([double]$PoolHeight, 2) }
            }
            elseif ($Action -eq 'remembered-screens') {
                $sc = [ordered]@{}
                if ($ctl.Contains('screens') -and $ctl.screens) { foreach ($pp in $ctl.screens.PSObject.Properties) { $sc[$pp.Name] = $pp.Value } }
                if ($null -ne $Video) { $sc.video = [math]::Round([double]$Video, 2) }
                if ($null -ne $Intensity) { $sc.intensity = [math]::Round([double]$Intensity, 2) }
                if ($null -ne $Threshold) { $sc.threshold = [math]::Round([double]$Threshold, 2) }
                $ctl.screens = $sc
            }
            elseif ($Action -eq 'remembered-opening') { $ctl.opening_night = [bool]$On }
            $ctl.at = $nowIso
            $null = New-Item -ItemType Directory -Force -Path $rdir
            $tmp = "$ctlFile.tmp"
            [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $ctl -Compress -Depth 6), (New-Object Text.UTF8Encoding $false))
            Move-Item -LiteralPath $tmp -Destination $ctlFile -Force   # (not IO.File::Replace: its $null backup arg fails under -EncodedCommand)
            $out.written = $ctl
        }
    }
    $out.status = Read-RiverJson (Join-Path $rdir 'status.json')
    $state = Read-RiverJson (Join-Path $river 'gallery_state\state.json')
    if ($state.json) { $state.json = [ordered]@{ memory = $state.json.memory; surge_at = $state.json.surge_at; scene = $state.json.scene; set_at = $state.json.set_at } }
    $out.state = $state
    $out.reflex = Read-RiverJson (Join-Path $river 'gallery_state\reflex.json')
    $out.presence = Read-RiverJson (Join-Path $river 'presence.json')
    $out.control = Read-RiverJson $ctlFile
    if (Test-Path -LiteralPath $ldir) { $out.looks = Read-RiverJson (Join-Path $ldir 'status.json') }
    $out | ConvertTo-Json -Compress -Depth 10
    exit 0
}
if ($Action -eq 'rebuild') {
    # Rebuild = build + save + switch, each step reported; any failure stops the chain and the JSON says where.
    $out.rebuilt = $false; $out.saved = $false; $out.switched = $false
    $running = Get-Process TouchDesigner -ErrorAction SilentlyContinue
    if ($REBUILD_FILES -notcontains $BootFile) { $out.ok = $false; $out.error = "rebuild is only for the river's year ($($REBUILD_FILES -join ', '))" }
    elseif (-not $running) { $out.ok = $false; $out.error = 'TouchDesigner is not running: nothing to rebuild' }
    else {
        $open = (& powershell -NoProfile -ExecutionPolicy Bypass -File $tdPs1 'project.name' -Timeout 15 2>$null | Select-Object -Last 1)
        $open = "$open".Trim().Trim("'", '"')      # td.ps1 prints a string value as Python's repr: 'river-....toe'
        if ($LASTEXITCODE -ne 0 -or -not $open) { $out.ok = $false; $out.error = 'TouchDesigner did not answer: rebuild refused' }
        elseif ($open -ne $BootFile) { $out.ok = $false; $out.error = "TouchDesigner is running $open, not $($BootFile): rebuild refused" }
        else {
            $build = [string]($REBUILD | Where-Object { $_.file -eq $BootFile } | Select-Object -First 1).build
            $out.rebuilt_map = [string]($REBUILD | Where-Object { $_.file -eq $BootFile } | Select-Object -First 1).calibration.pixelmap -replace '^.*/', ''
            $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $tdPs1 -File (Join-Path $repo ($build -replace '/', '\')) -Timeout 300 2>&1
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
    # A switch opens the file now and leaves the boot file alone; only bootfile ("Set as default") writes boot-file.txt.
    if ($out.show_files -notcontains $BootFile) { $out.ok = $false; $out.error = "no show file $BootFile on bitcube"; $Action = 'status' }
    elseif ($Action -eq 'bootfile') { Set-Content -Path (Join-Path $river 'boot-file.txt') -Value $BootFile -Encoding ascii }
}
if ($Action -eq 'switch') {
    # Quit TouchDesigner (unsaved changes are lost; its camera relays exit with it) and start the launcher in the
    # desktop session through a one-off interactive task, as at login. Start-River.cmd waits 10 s, then opens it.
    Get-Process TouchDesigner -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3
    $act = New-ScheduledTaskAction -Execute (Join-Path $repo 'Start-River.cmd') -Argument $BootFile -WorkingDirectory $repo
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

if ($Action -eq 'modalinput' -and (-not $Source -or $null -eq $Strength)) {
    $out.ok = $false; $out.error = 'modalinput needs -Source off|canvas|scene|frames and -Strength 0..1'; $out.refused = $Action
    $Action = 'status'
}
# TouchDesigner (via the bridge): status, or one of its fixed actions
$td = $null
if ($Action -eq 'switch') { $td = @{ ok = $false; error = "restarting on $BootFile" } }
elseif (Get-Process TouchDesigner -ErrorAction SilentlyContinue) {
    $req = @{ action = $(if ($Action -in 'ropes', 'hub75', 'test', 'overlay', 'modalinput') { $Action } else { 'status' }) }
    if ($Action -eq 'modalinput') { $req.source = $Source; $req.strength = $Strength }
    if ($Action -eq 'ropes') { $req.dark = [bool]$Dark }
    if ($Action -eq 'hub75') { $req.brightness = $Brightness }
    if ($Action -eq 'test') { $req.on = [bool]$On }
    if ($Action -eq 'overlay') { $req.strength = $Overlay; if ($Framing) { $req.framing = $Framing }; if ($Screenmode) { $req.screens = @{mode=$Screenmode; blend=$Screenblend; hold=$Screenhold}; if ($PSBoundParameters.ContainsKey('Screenrecorded')) { $req.screens.recorded = [double]$Screenrecorded }; if ($PSBoundParameters.ContainsKey('Screenoffset')) { $req.screens.offset = [double]$Screenoffset } } }
    $req | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $env:TEMP 'mission_args.json') -Encoding utf8
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\td.ps1') -File (Join-Path $PSScriptRoot 'td_mission.py') -Timeout 15 2>$null
    $line = ($raw | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
    if ($line) { $td = $line | ConvertFrom-Json } else { $td = @{ ok = $false; error = 'no answer from the TD bridge' } }
} else { $td = @{ ok = $false; error = 'TouchDesigner is not running' } }
$out.td = $td
# ropes / hub75 / test act through TouchDesigner: if it didn't carry the action out, the action failed (the page must not say done)
if ($Action -in 'ropes', 'hub75', 'test', 'overlay', 'modalinput' -and $td -and $td.ok -eq $false) { $out.ok = $false; $out.error = "$($td.error)" }

# The filling glass (river-filling.toe; docs/mission-ui.md "Filling glass dials"): its four dials go to control.json, which
# td/filling/fill.py reads every second; it answers in status.json { t, palette, brightness, intensity, speed, level, phase }. Taken
# only while TouchDesigner (just asked, above) answers on that very file; written to a temporary file and swapped in, so the show
# never reads half a file. -Brightness is hub75's parameter too (no range of its own there): its range is checked here.
$fdir = Join-Path $river 'filling'
if ($Action -eq 'filling') {
    if (-not $Palette -or -not $PSBoundParameters.ContainsKey('Brightness') -or $Brightness -lt 0 -or $Brightness -gt 1 -or $null -eq $Intensity -or $null -eq $Speed) {
        $out.ok = $false; $out.error = 'filling needs -Palette river|glacier|midnight|teal, -Brightness 0..1, -Intensity 0..1 and -Speed 0.25..3'; $out.refused = $Action
    } elseif (-not $td -or $td.ok -eq $false -or ($td.file -notin 'river-filling.toe', 'river-looks.toe' -and $td.file -notin $LOOKS_FILES -and -not (Test-AllLooksFile $td.file))) {
        $out.ok = $false; $out.error = "the filling glass isn't running (its dials work only while it runs)"; $out.refused = $Action
    } elseif ($td.file -in $LOOKS_FILES -and (Get-LookShowing) -notin 'fill-simple', 'fill-configurable') {
        $out.ok = $false; $out.error = "Fill my cup isn't the look showing now (pick it under Looks on Status first)"; $out.refused = $Action
    } else {
        $ctl = [ordered]@{ palette = $Palette; brightness = [math]::Round([double]$Brightness, 2); intensity = [math]::Round([double]$Intensity, 2)
                           speed = [math]::Round([double]$Speed, 2); at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
        $ctlFile = Join-Path $fdir 'control.json'
        try {
            $null = New-Item -ItemType Directory -Force -Path $fdir -ErrorAction Stop
            $tmp = "$ctlFile.tmp"
            [IO.File]::WriteAllText($tmp, ($ctl | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
            Move-Item -LiteralPath $tmp -Destination $ctlFile -Force   # (not IO.File::Replace: its $null backup arg fails under -EncodedCommand)
            $out.written = $ctl
        } catch { $out.ok = $false; $out.error = "couldn't write the filling glass's control file: $($_.Exception.Message)" }
    }
}
if (Test-Path -LiteralPath $fdir) {
    $out.filling = [ordered]@{ control = Read-RiverJson (Join-Path $fdir 'control.json'); status = Read-RiverJson (Join-Path $fdir 'status.json') }
}

# The river (all looks) (river-looks.toe; docs/mission-ui.md "Looks"): Auto or Manual and the look go to looks\control.json
# { mode, look, at }, which TouchDesigner reads; it answers in looks\status.json { t, show, mode, look, target, fading, fade, auto,
# looks }. Taken only while TouchDesigner (just asked, above) answers on that very file; written to a temporary file and swapped in.
# -Playlist as mission control checks it (mission/public/looks.js playlistProblem): the entries, or an error in words.
function Test-Playlist([string]$text) {
    $t = $text.Trim()
    if ($t.Length -ge 2 -and $t.StartsWith("'") -and $t.EndsWith("'")) { $t = $t.Substring(1, $t.Length - 2) }
    # Windows PowerShell 5.1 hands a JSON array back as one object: piped, it is the entries again
    try { $parsed = ConvertFrom-Json -InputObject $t -ErrorAction Stop; $list = @($parsed | ForEach-Object { $_ }) } catch { return @{ error = 'playlist is a list of { look, for }' } }
    if ($t -notmatch '^\s*\[') { return @{ error = 'playlist is a list of { look, for }' } }
    if ($list.Count -lt 1 -or $list.Count -gt 12) { return @{ error = 'playlist has 1 to 12 entries' } }
    $out = New-Object System.Collections.ArrayList; $i = 0
    foreach ($e in $list) {
        $i++; $at = "playlist entry $i"
        if ($e -isnot [PSCustomObject]) { return @{ error = "$at is { look, for }" } }
        if ([string]$e.look -notin $LOOK_NAMES) { return @{ error = "${at}: look is $($LOOK_NAMES -join ', ')" } }
        $props = @(if ($e.for -is [PSCustomObject]) { $e.for.PSObject.Properties })
        if ($props.Count -ne 1 -or $props[0].Name -notin 'loops', 'cycles', 'minutes') { return @{ error = "${at}: for is { loops: n }, { cycles: n } or { minutes: m }" } }
        $u = $props[0].Name; $n = $props[0].Value
        $ok = $(switch ($u) { 'loops' { $e.look -eq 'remembered' } 'cycles' { $e.look -in 'fill-simple', 'fill-configurable' } default { $true } })
        if (-not $ok) { return @{ error = "${at}: $($e.look) can't play for $u" } }
        $hi = $(if ($u -eq 'minutes') { 120 } else { 20 })
        if (-not ($n -is [int] -or $n -is [long]) -or $n -lt 1 -or $n -gt $hi) { return @{ error = "${at}: $u is a whole number from 1 to $hi" } }
        [void]$out.Add([ordered]@{ 'look' = [string]$e.look; 'for' = [ordered]@{ $u = [int]$n } })
    }
    return @{ list = $out }
}
if ($Action -eq 'looks') {
    $pl = $null
    if ($PSBoundParameters.ContainsKey('Playlist')) { $pl = Test-Playlist $Playlist }
    if (-not $Mode -or $Mode -notin 'auto', 'manual' -or ($Mode -eq 'manual' -and -not $Look)) {
        $out.ok = $false; $out.error = 'looks needs -Mode auto|manual (manual with -Look remembered|fill-simple|fill-configurable|seasons|modal)'; $out.refused = $Action
    } elseif ($pl -and $Mode -ne 'auto') {
        $out.ok = $false; $out.error = 'a playlist goes with -Mode auto'; $out.refused = $Action
    } elseif ($pl -and $pl.error) {
        $out.ok = $false; $out.error = $pl.error; $out.refused = $Action
    } elseif (-not $td -or $td.ok -eq $false -or ($td.file -ne 'river-looks.toe' -and $td.file -notin $LOOKS_FILES -and -not (Test-AllLooksFile $td.file))) {
        $out.ok = $false; $out.error = "the river (all looks) isn't running (its looks can be picked only while it runs)"; $out.refused = $Action
    } else {
        $ctlFile = Join-Path $ldir 'control.json'
        $was = Read-RiverJson $ctlFile
        $keep = $Look
        if (-not $keep) { $keep = $(if ($was.json -and $was.json.look -in $LOOK_NAMES) { [string]$was.json.look } else { 'remembered' }) }
        # merged with what was there: every field kept (the playlist too), only mode, look, at (and a new playlist) changed
        $ctl = [ordered]@{}
        if ($was.json) { foreach ($p in $was.json.PSObject.Properties) { $ctl[$p.Name] = $p.Value } }
        $ctl.mode = $Mode; $ctl.look = $keep
        if ($pl) { $ctl.playlist = @($pl.list.ToArray()) }
        $ctl.at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        try {
            $null = New-Item -ItemType Directory -Force -Path $ldir -ErrorAction Stop
            $tmp = "$ctlFile.tmp"
            [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $ctl -Compress -Depth 6), (New-Object Text.UTF8Encoding $false))
            Move-Item -LiteralPath $tmp -Destination $ctlFile -Force   # (not IO.File::Replace: its $null backup arg fails under -EncodedCommand)
            $out.written = $ctl
        } catch { $out.ok = $false; $out.error = "couldn't write the looks control file: $($_.Exception.Message)" }
    }
}
if (Test-Path -LiteralPath $ldir) {
    $out.looks = [ordered]@{ control = Read-RiverJson (Join-Path $ldir 'control.json'); status = Read-RiverJson (Join-Path $ldir 'status.json') }
}

# Boot file: the show file Start-River.cmd opens at the next start, worked out as it does (tools/shows.ps1 Resolve-BootFile):
# boot-file.txt's file when it names a listed show that exists (mission control sets it; the last such line wins),
# else shows.json's boot_default. boot_file_chosen says whether boot-file.txt chose it; boot_file is null when there is no
# show file at all (TouchDesigner would open empty).
$bootPick = Resolve-BootFile $reg
$boot = $bootPick.file; $chosen = [bool]$bootPick.chosen
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
