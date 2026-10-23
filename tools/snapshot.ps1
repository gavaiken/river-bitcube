# Gallery-cam snapshot for the status page and the live page (plan item G).
# Grabs one ~640 px wide still and force-pushes it to the orphan branch `snapshot` (always a single
# parentless commit, so the branch never grows history) as
#   gallery.jpg                 the newest still
#   m/<UTC yyyyMMdd-HHmm>.jpg   one per minute, the last $Keep minutes
#   td.jpg, t/<minute>.jpg      what TouchDesigner sends: the 20 ropes and the four screens upright (the show
#                               file's screens_preview TOP, via the Claude bridge; phase G7). Skipped, with the
#                               camera still pushed anyway, if TD isn't answering.
# raw.githubusercontent.com caches every path for 5 minutes and ignores query strings, so gallery.jpg can
# look 5 minutes old; a per-minute name is a new path, so docs/assets/snapshot.js loads the newest minute
# that exists and is never stale. Run by the scheduled task RiverSnapshot (every minute, 08:00-02:00;
# tools\snapshot_task.ps1 registers it).
#   powershell -ExecutionPolicy Bypass -File tools\snapshot.ps1          # take and push one now
#   powershell -ExecutionPolicy Bypass -File tools\snapshot.ps1 -NoPush  # just grab the still
#   . .\tools\snapshot.ps1                                               # just load the functions (tests)
# It pushes from its own bare repo under %LOCALAPPDATA%\river-snapshot, never touching this checkout,
# with the same deploy key as this repo. Log: %LOCALAPPDATA%\river-snapshot\snapshot.log.
param(
    [string]$Camera = 'gallery',
    [int]$Width = 640,
    [switch]$NoPush,
    [int]$Keep = 15,  # per-minute stills kept on the branch
    [switch]$Force   # ignore the 08:00-02:00 window
)

$SnapshotRemote = 'git@github.com:gavaiken/river-bitcube.git'
$SnapshotBranch = 'snapshot'
$SnapshotKey = 'C:/Users/user/.ssh/river_bitcube_deploy'

function Test-SnapshotWindow([datetime]$Time) {
    # On from 08:00 until 02:00 the next morning; off 02:00-07:59.
    return ($Time.Hour -ge 8 -or $Time.Hour -lt 2)
}

function Get-SnapshotFfmpegArgs([string]$Url, [string]$Out, [int]$Width = 640) {
    # One frame over TCP, scaled to $Width wide (even height), moderate JPEG quality (~50-80 KB).
    return @('-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '15000000',
             '-i', $Url, '-frames:v', '1', '-vf', "scale=${Width}:-2", '-q:v', '5', '-y', $Out)
}

function Get-SnapshotCacheInfo([string]$BlobSha, [string]$Name = 'gallery.jpg') {
    # `git update-index --cacheinfo` argument: the only file in the snapshot tree.
    return "100644,$BlobSha,$Name"
}

function Get-MinuteName([datetime]$Utc) {
    # Path of one minute's still on the branch; docs/assets/snapshot.js builds the same name.
    return 'm/' + $Utc.ToString('yyyyMMdd-HHmm', [Globalization.CultureInfo]::InvariantCulture) + '.jpg'
}

function Get-TdMinuteName([datetime]$Utc) {
    # Path of one minute's TD preview on the branch; docs/assets/snapshot.js builds the same name (prefix t/).
    return 't/' + $Utc.ToString('yyyyMMdd-HHmm', [Globalization.CultureInfo]::InvariantCulture) + '.jpg'
}

function Get-TdPreview([string]$Out, [string]$Ffmpeg) {
    # Ask the running show file for its screens_preview TOP (TD writes a PNG, ~800 KB) and keep it as a JPEG
    # (~40 KB: this goes up the gallery's internet every minute). $true if $Out was written.
    $png = [IO.Path]::ChangeExtension($Out, '.png')
    foreach ($top in '/project1/seasons/screens_preview', '/project1/river_local/screens_preview') {
        try {
            Remove-Item $png -ErrorAction SilentlyContinue
            $q = 'op=' + [uri]::EscapeDataString($top) + '&path=' + [uri]::EscapeDataString(($png -replace '\\', '/'))
            $r = Invoke-RestMethod -Uri "http://127.0.0.1:9980/screenshot?$q" -Method Get -TimeoutSec 8
            if ($r.ok -ne $false -and (Test-Path $png) -and (Get-Item $png).Length -gt 0) {
                & $Ffmpeg -hide_banner -loglevel error -y -i $png -q:v 4 $Out 2>&1 | Out-Null
                Remove-Item $png -ErrorAction SilentlyContinue
                return (Test-Path $Out)
            }
        } catch { }
    }
    return $false
}

function Select-KeptMinutes([string[]]$Names, [int]$Keep) {
    # The newest $Keep per-minute names (they sort by time).
    return @($Names | Sort-Object -Descending | Select-Object -First $Keep)
}

function Get-SnapshotMessage([datetime]$Time) {
    return 'Gallery snapshot ' + $Time.ToString('yyyy-MM-dd HH:mm')
}

function Hide-Secrets([string]$Text) {
    # Camera URLs carry the login; keep it out of logs and errors.
    return ($Text -replace '(rtsp://)[^@/\s]*@', '$1***@')
}

function Invoke-Git([string]$GitDir, [string[]]$GitArgs) {
    $ErrorActionPreference = 'Continue'   # PS 5.1 turns native stderr lines into errors under 'Stop'
    $out = & git --git-dir $GitDir @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed: $out" }
    return ($out | Out-String).Trim()
}

function Publish-Snapshot([hashtable]$Files, [string]$GitDir, [datetime]$Time) {
    # $Files: branch path -> local file. The previous commit stays referenced locally, so a push only
    # uploads the new still (the remote already has the rest).
    if (-not (Test-Path (Join-Path $GitDir 'HEAD'))) { & git init -q --bare $GitDir | Out-Null }
    $env:GIT_SSH_COMMAND = "ssh -i $SnapshotKey -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
    $env:GIT_AUTHOR_NAME = 'bitcube snapshot'; $env:GIT_AUTHOR_EMAIL = 'snapshot@bitcube.invalid'
    $env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME; $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL
    $env:GIT_INDEX_FILE = Join-Path $GitDir 'snapshot.index'
    Remove-Item $env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
    foreach ($name in $Files.Keys) {
        $blob = Invoke-Git $GitDir @('hash-object', '-w', '--', $Files[$name])
        Invoke-Git $GitDir @('update-index', '--add', '--cacheinfo', (Get-SnapshotCacheInfo $blob $name)) | Out-Null
    }
    $tree = Invoke-Git $GitDir @('write-tree')
    $commit = Invoke-Git $GitDir @('commit-tree', $tree, '-m', (Get-SnapshotMessage $Time))
    Invoke-Git $GitDir @('push', '-q', '--force', $SnapshotRemote, "${commit}:refs/heads/$SnapshotBranch") | Out-Null
    # The local ref is only bookkeeping (the push above is what counts). A power cut can leave it broken
    # (22 Oct 23:53: "reference broken" on every run since); drop it so update-ref can write it fresh.
    $ref = Join-Path $GitDir "refs/heads/$SnapshotBranch"
    try { Invoke-Git $GitDir @('rev-parse', '--verify', '-q', "refs/heads/$SnapshotBranch") | Out-Null }
    catch { Remove-Item $ref -Force -ErrorAction SilentlyContinue }
    Invoke-Git $GitDir @('update-ref', "refs/heads/$SnapshotBranch", $commit) | Out-Null
    # Older commits and stills nothing refers to any more: drop them so the bare repo stays small.
    Invoke-Git $GitDir @('prune', '--expire=now') | Out-Null
    return $commit
}

# Run only when executed as a script, not when dot-sourced by the tests.
if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    $work = Join-Path $env:LOCALAPPDATA 'river-snapshot'
    New-Item -ItemType Directory -Force $work | Out-Null
    $log = Join-Path $work 'snapshot.log'
    $now = Get-Date
    function Write-Log([string]$Line) { Add-Content -Path $log -Value ($now.ToString('yyyy-MM-dd HH:mm:ss') + ' ' + (Hide-Secrets $Line)); Hide-Secrets $Line }
    try {
        if (-not $Force -and -not (Test-SnapshotWindow $now)) { Write-Log 'outside 08:00-02:00, skipped'; exit 0 }
        $secrets = Join-Path (Split-Path $PSScriptRoot -Parent) 'secrets.local.json'
        $url = (Get-Content -Raw $secrets | ConvertFrom-Json).cameras.$Camera
        if (-not $url) { throw "no camera '$Camera' in secrets.local.json" }
        $jpeg = Join-Path $work 'gallery.jpg'
        Remove-Item $jpeg -ErrorAction SilentlyContinue
        $ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
        if (-not $ffmpeg) { $ffmpeg = 'C:\Program Files\WinGet\Links\ffmpeg.exe' }
        $ErrorActionPreference = 'Continue'
        $err = & $ffmpeg @(Get-SnapshotFfmpegArgs $url $jpeg $Width) 2>&1
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $jpeg)) { throw "ffmpeg failed: $err" }
        $ErrorActionPreference = 'Stop'
        $size = (Get-Item $jpeg).Length
        if ($NoPush) { Write-Log "grabbed $jpeg ($size bytes), not pushed"; exit 0 }
        $minutes = Join-Path $work 'm'
        New-Item -ItemType Directory -Force $minutes | Out-Null
        $name = Get-MinuteName $now.ToUniversalTime()
        Copy-Item $jpeg (Join-Path $work $name) -Force
        $all = @(Get-ChildItem $minutes -Filter '*.jpg' | ForEach-Object { 'm/' + $_.Name })
        $kept = Select-KeptMinutes $all $Keep
        foreach ($old in $all) { if ($kept -notcontains $old) { Remove-Item (Join-Path $work $old) } }
        $files = @{ 'gallery.jpg' = $jpeg }
        foreach ($k in $kept) { $files[$k] = Join-Path $work $k }
        $tdOut = Join-Path $work 'td.jpg'
        Remove-Item $tdOut -ErrorAction SilentlyContinue
        $tdNote = 'no TD preview'
        if (Get-TdPreview $tdOut $ffmpeg) {
            $tdDir = Join-Path $work 't'
            New-Item -ItemType Directory -Force $tdDir | Out-Null
            Copy-Item $tdOut (Join-Path $work (Get-TdMinuteName $now.ToUniversalTime())) -Force
            Get-ChildItem $tdDir -Filter '*.png' | Remove-Item -ErrorAction SilentlyContinue
            $allTd = @(Get-ChildItem $tdDir -Filter '*.jpg' | ForEach-Object { 't/' + $_.Name })
            $keptTd = Select-KeptMinutes $allTd $Keep
            foreach ($old in $allTd) { if ($keptTd -notcontains $old) { Remove-Item (Join-Path $work $old) } }
            $files['td.jpg'] = $tdOut
            foreach ($k in $keptTd) { $files[$k] = Join-Path $work $k }
            $tdNote = 'TD preview ' + (Get-Item $tdOut).Length + ' bytes'
        }
        $commit = Publish-Snapshot $files (Join-Path $work 'repo.git') $now
        Write-Log "pushed $size bytes as $name ($($kept.Count) minutes kept), $tdNote, $commit"
    } catch {
        Write-Log "ERROR $($_.Exception.Message)"
        exit 1
    }
}
