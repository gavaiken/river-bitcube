# Gallery-cam snapshot for the status page (plan item G).
# Grabs one ~640 px wide still and force-pushes it as gallery.jpg to the orphan branch `snapshot`
# (always a single parentless commit, so the branch never grows history). The status page shows
#   https://raw.githubusercontent.com/gavaiken/river-bitcube/snapshot/gallery.jpg
# Run by the scheduled task RiverSnapshot (every 15 min, 08:00-02:00; tools\snapshot_task.ps1 registers it).
#   powershell -ExecutionPolicy Bypass -File tools\snapshot.ps1          # take and push one now
#   powershell -ExecutionPolicy Bypass -File tools\snapshot.ps1 -NoPush  # just grab the still
#   . .\tools\snapshot.ps1                                               # just load the functions (tests)
# It pushes from its own bare repo under %LOCALAPPDATA%\river-snapshot, never touching this checkout,
# with the same deploy key as this repo. Log: %LOCALAPPDATA%\river-snapshot\snapshot.log.
param(
    [string]$Camera = 'gallery',
    [int]$Width = 640,
    [switch]$NoPush,
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

function Publish-Snapshot([string]$Jpeg, [string]$GitDir, [datetime]$Time) {
    if (-not (Test-Path (Join-Path $GitDir 'HEAD'))) { & git init -q --bare $GitDir | Out-Null }
    $env:GIT_SSH_COMMAND = "ssh -i $SnapshotKey -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
    $env:GIT_AUTHOR_NAME = 'bitcube snapshot'; $env:GIT_AUTHOR_EMAIL = 'snapshot@bitcube.invalid'
    $env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME; $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL
    $env:GIT_INDEX_FILE = Join-Path $GitDir 'snapshot.index'
    Remove-Item $env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
    $blob = Invoke-Git $GitDir @('hash-object', '-w', '--', $Jpeg)
    Invoke-Git $GitDir @('update-index', '--add', '--cacheinfo', (Get-SnapshotCacheInfo $blob)) | Out-Null
    $tree = Invoke-Git $GitDir @('write-tree')
    $commit = Invoke-Git $GitDir @('commit-tree', $tree, '-m', (Get-SnapshotMessage $Time))
    Invoke-Git $GitDir @('push', '-q', '--force', $SnapshotRemote, "${commit}:refs/heads/$SnapshotBranch") | Out-Null
    # Nothing local refers to these objects; drop them so the bare repo stays tiny.
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
        $commit = Publish-Snapshot $jpeg (Join-Path $work 'repo.git') $now
        Write-Log "pushed $size bytes as $commit"
    } catch {
        Write-Log "ERROR $($_.Exception.Message)"
        exit 1
    }
}
