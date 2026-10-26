# Mission control's calibration job on bitcube (tools/mission/calibrate.py). Prints ONE line of JSON. From the mini:
#   ssh bitcube powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\River\river-bitcube\tools\mission\calibrate.ps1
#       -Action start [-DryRun] [-DecodeOnly pixelmap-YYYYMMDD-HHMMSS] [-Task]    launch the job detached; returns at once
#       -Action status                                                            calibration.json, or {"running": false, "none": true}
#       -Action cancel                                                            stop the job; the ropes are put back
# start: {ok, started: true, running, pid, requested, log, calibration} once the job is launched and has written its first
# state (started is true whenever the job was launched; requested is this script's clock as it launched it, bitcube's, so the
# run's own progress file has started >= requested - 1). A refusal before anything was launched: {ok: false, started: false,
# error}. Launched, but no first write within 6 s (a cold Python, the -Task path): {ok: false, maybe: true, started: true, pid,
# requested, error} and no calibration (the file there is the run before): mission control keeps its lock and reads the
# progress until the run shows up. cancel: {ok, cancelled, forced, calibration}.
# The job runs with the repo's venv python, hidden, with its own console, so it outlives this SSH session (Start-Process).
# -Task launches it through a one-off interactive scheduled task instead (as probe.ps1 -Action switch does), the fallback
# if a detached process turns out to die with the SSH session.
# cancel is cooperative: calibration.cancel makes the job stop its child and restore the ropes itself (Stop-Process would
# skip capture.py's own restore). Only if the job has not stopped after 20 s is it killed, and then "forced": true and
# "restored": false tell the portal the ropes may still show a pattern (the Ropes control puts them back).
param([ValidateSet('start', 'status', 'cancel')][string]$Action = 'status', [switch]$DryRun, [string]$DecodeOnly,
      [switch]$Task, [ValidateSet('gallery', 'river')][string]$Cam = 'gallery')
$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$river = Split-Path $repo -Parent
$state = Join-Path $river 'calibration.json'
$lock = Join-Path $river 'calibration.lock'
$cancelFile = Join-Path $river 'calibration.cancel'
$py = Join-Path $repo '.venv\Scripts\python.exe'
$script = Join-Path $PSScriptRoot 'calibrate.py'

function Read-State {
    if (-not (Test-Path $state)) { return $null }
    foreach ($try in 1..3) {        # the job replaces the file atomically; a read can still land on the swap
        try { return (Get-Content -Raw $state -ErrorAction Stop | ConvertFrom-Json) } catch { Start-Sleep -Milliseconds 100 }
    }
    return $null
}
function Test-Alive($p) { if (-not $p -or [int]$p -le 0) { return $false }; return [bool](Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue) }
function Write-State($o) { [IO.File]::WriteAllText($state, ($o | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding $false)) }
function Out-Json($o) { $o | ConvertTo-Json -Compress -Depth 12 }
function Set-Field($o, $name, $value) { $o | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }
function Epoch { [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }

$s = Read-State
if ($s) { Set-Field $s 'alive' (Test-Alive $s.pid); if ($s.running -and -not $s.alive) { Set-Field $s 'stale' $true } }   # died without a final write

if ($Action -eq 'status') {
    if ($s) { Out-Json $s } else { Out-Json ([ordered]@{ running = $false; none = $true }) }
    exit 0
}

if ($Action -eq 'start') {
    # refusals: nothing was launched (started false), so mission control holds no lock for them
    if ($s -and $s.running -and $s.alive) { Out-Json @{ ok = $false; started = $false; error = 'a calibration is already running'; calibration = $s }; exit 0 }
    if ($DecodeOnly -and $DecodeOnly -notmatch '^(pixelmap|hub75)-\d{8}-\d{6}$') { Out-Json @{ ok = $false; started = $false; error = 'DecodeOnly is a frames folder name like pixelmap-20261018-154155' }; exit 0 }
    if (-not $DryRun -and -not $DecodeOnly -and -not (Get-Process TouchDesigner -ErrorAction SilentlyContinue)) { Out-Json @{ ok = $false; started = $false; error = 'TouchDesigner is not running' }; exit 0 }
    if (-not (Test-Path $py)) { Out-Json @{ ok = $false; started = $false; error = "no venv python at $py" }; exit 0 }
    Remove-Item $cancelFile -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force (Join-Path $river 'logs') | Out-Null
    $log = Join-Path $river ('logs\calibrate-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    $jobArgs = "`"$script`" --cam $Cam --log `"$log`""
    if ($DryRun) { $jobArgs += ' --dry-run' }
    if ($DecodeOnly) { $jobArgs += " --decode-only $DecodeOnly" }
    $t0 = Epoch
    $procId = $null
    try {
        if ($Task) {
            $act = New-ScheduledTaskAction -Execute $py -Argument $jobArgs -WorkingDirectory $repo
            $prin = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive
            Register-ScheduledTask -TaskName 'MissionCalibrate' -Action $act -Principal $prin -Force -ErrorAction Stop | Out-Null
            Start-ScheduledTask -TaskName 'MissionCalibrate' -ErrorAction Stop
        } else {
            $p = Start-Process -FilePath $py -ArgumentList $jobArgs -WorkingDirectory $repo -WindowStyle Hidden -PassThru -ErrorAction Stop
            $procId = $p.Id
        }
    } catch {
        # the job could not be launched at all: a clear refusal, nothing runs
        Out-Json ([ordered]@{ ok = $false; started = $false; error = "the calibration job could not be launched: $($_.Exception.Message)" }); exit 0
    }
    # Wait (briefly) for the job's first progress write, so the answer carries its initial state.
    $deadline = (Get-Date).AddSeconds(6)
    do { Start-Sleep -Milliseconds 250; $n = Read-State } while ((Get-Date) -lt $deadline -and -not ($n -and $n.started -ge ($t0 - 1)))
    if ($Task) { Unregister-ScheduledTask -TaskName 'MissionCalibrate' -Confirm:$false -ErrorAction SilentlyContinue }
    if ($n -and $n.started -ge ($t0 - 1)) {
        if (-not $procId) { $procId = $n.pid }
        Out-Json ([ordered]@{ ok = [bool]$n.running -or [bool]$n.ok; started = $true; running = [bool]$n.running; pid = $procId; requested = $t0; log = $log; calibration = $n; error = $(if ($n.reason) { $n.reason } else { $n.error }); raw = $n.error })
    } else {
        # Launched (Start-Process gave a pid), but no first write yet (a cold venv loading numpy and OpenCV, or the -Task path):
        # it is starting. Not a refusal and not a maybe: this script knows it launched the job. Mission control keeps the
        # starting lock and reads the progress until the run shows up. No calibration here: the file there now is the run before.
        $tail = @(if (Test-Path $log) { Get-Content $log -Tail 5 })
        Out-Json ([ordered]@{ ok = $true; started = $true; pending = $true; pid = $procId; requested = $t0; note = "the calibration was launched; its first progress is still to come"; log = $log; log_tail = $tail })
    }
    exit 0
}

if ($Action -eq 'cancel') {
    if (-not ($s -and $s.running -and $s.alive)) { Out-Json ([ordered]@{ ok = $true; cancelled = $false; forced = $false; note = 'nothing is running'; calibration = $s }); exit 0 }
    Set-Content -Path $cancelFile -Value ([string]$s.pid) -Encoding ascii
    # Wait for the job to write its final state (running false) or to vanish; a momentary unreadable file is neither.
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $n = Read-State
        $wroteFinal = [bool]($n -and -not $n.running)
    } while (-not $wroteFinal -and (Test-Alive $s.pid) -and (Get-Date) -lt $deadline)
    if ($wroteFinal) { $limit = (Get-Date).AddSeconds(3); while ((Test-Alive $s.pid) -and (Get-Date) -lt $limit) { Start-Sleep -Milliseconds 200 } }   # it is exiting
    $forced = $false
    if (-not $wroteFinal -and (Test-Alive $s.pid)) {
        # The job did not stop by itself: kill it and its children (capture.py; its ffmpeg exits when the pipe breaks).
        Get-CimInstance Win32_Process -Filter "ParentProcessId = $($s.pid)" -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $s.pid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        $forced = $true
        $n = Read-State
        if ($n) {
            $final = @{ running = $false; ok = $false; cancelled = $true; restored = $false; updated = (Epoch)
                        error = 'cancelled (killed: the job did not stop by itself)'; message = 'cancelled (killed)' }
            foreach ($name in $final.Keys) { Set-Field $n $name $final[$name] }
            Write-State $n
        }
        Remove-Item $lock -ErrorAction SilentlyContinue
    }
    Remove-Item $cancelFile -ErrorAction SilentlyContinue
    Out-Json ([ordered]@{ ok = $true; cancelled = $true; forced = $forced; calibration = (Read-State) })
    exit 0
}
