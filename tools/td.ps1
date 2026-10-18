# Run Python inside the running TouchDesigner project via the Claude bridge.
#   .\tools\td.ps1 "app.build"                     # single expression -> value
#   .\tools\td.ps1 -File .\td\scripts\something.py # run a file
#   .\tools\td.ps1 -Errors                         # list operator errors/warnings
#   .\tools\td.ps1 -Screenshot /project1/out1      # save a TOP to frames\ and print the path
# Every call times out after -Timeout seconds (default 20). A modal TD dialog (e.g. a save prompt)
# blocks TD's main thread and so the bridge; on timeout this lists TD's open windows to show it.
param(
    [Parameter(Position = 0)][string]$Code,
    [string]$File,
    [switch]$Errors,
    [string]$Screenshot,
    [int]$Port = 9980,
    [int]$Timeout = 20
)

function Get-TDWindows {
    # Visible top-level windows of TouchDesigner.exe (MainWindowTitle only shows one of them).
    Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public class TDWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> Titles(uint pid) {
    var r = new List<string>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.Length > 0) r.Add(sb.ToString()); }
      return true; }, IntPtr.Zero);
    return r;
  }
}
'@ -ErrorAction SilentlyContinue
    foreach ($p in Get-Process TouchDesigner -ErrorAction SilentlyContinue) { [TDWin]::Titles([uint32]$p.Id) }
}

$base = "http://127.0.0.1:$Port"
try {
    if ($Errors) {
        $r = Invoke-RestMethod -Uri "$base/errors" -Method Get -TimeoutSec $Timeout
    } elseif ($Screenshot) {
        $frames = Join-Path (Split-Path $PSScriptRoot -Parent) 'frames'
        New-Item -ItemType Directory -Force $frames | Out-Null
        $name = ($Screenshot.Trim('/') -replace '/', '_') + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png'
        $path = (Join-Path $frames $name) -replace '\\', '/'
        $q = 'op=' + [uri]::EscapeDataString($Screenshot) + '&path=' + [uri]::EscapeDataString($path)
        $r = Invoke-RestMethod -Uri "$base/screenshot?$q" -Method Get -TimeoutSec $Timeout
    } else {
        if ($File) { $Code = Get-Content -Raw $File }
        if (-not $Code) { throw 'Pass Python code, -File, -Errors or -Screenshot.' }
        $r = Invoke-RestMethod -Uri "$base/exec" -Method Post -Body $Code -ContentType 'text/plain; charset=utf-8' -TimeoutSec $Timeout
    }
    if ($Errors) { $r.result | ConvertTo-Json -Depth 6; exit 0 }
    if ($r.stdout) { $r.stdout.TrimEnd() }
    if ($null -ne $r.result) { $r.result }
    if (-not $r.ok -or $r.error) { Write-Error $r.error; exit 1 }
    exit 0      # callers check $LASTEXITCODE; don't leave a stale value from an earlier command
} catch {
    $detail = $_.ErrorDetails.Message
    if ($detail) {
        # The bridge answered with an error (e.g. a Python traceback): show it plainly.
        try { $j = $detail | ConvertFrom-Json; Write-Error ("TD error:`n" + $j.error) } catch { Write-Error $detail }
        exit 1
    }
    if (-not (Get-Process TouchDesigner -ErrorAction SilentlyContinue)) {
        Write-Error 'TouchDesigner is not running.'
        exit 2
    }
    if ("$_" -match 'timed out') {
        # Not dialogs: the main window, the Textport, and Window COMP outputs (titled by op path).
        $other = Get-TDWindows | Where-Object { $_ -notlike 'TouchDesigner 20*' -and $_ -ne 'Textport' -and $_ -ne 'perform' -and $_ -notlike '/*' }
        if ($other) {
            Write-Error ("TD is blocked by a dialog: '" + ($other -join "', '") + "'. Someone must answer it on the console (VNC); the bridge is stuck until then.")
            exit 3
        }
        Write-Error "TD bridge timed out after $Timeout s with no dialog visible (long-running code, or TD hung). TD windows: $((Get-TDWindows) -join ' | ')"
        exit 4
    }
    Write-Error "TD bridge call failed (is claude_bridge installed and listening on port $Port?): $_"
    exit 1
}
