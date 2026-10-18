# Open the public status page in Chrome, frontmost on the primary (human) monitor, at login.
# Started by Start-Status.cmd from the Startup folder after TouchDesigner and Claude.
# Shows the live GitHub Pages site; if it can't be reached (no internet), opens the local docs\index.md instead.
#   powershell -ExecutionPolicy Bypass -File tools\status_page.ps1        # open it now
#   . .\tools\status_page.ps1                                             # just load the functions (tests)
param(
    [string]$Url = 'https://gavaiken.github.io/river-bitcube/',
    [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)

function Test-StatusUrl([string]$Url) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Head -TimeoutSec 8
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Resolve-StatusTarget {
    param([string]$Url, [string]$FallbackPath, [scriptblock]$Probe = { param($u) Test-StatusUrl $u })
    $ok = $false
    try { $ok = [bool](& $Probe $Url) } catch { $ok = $false }
    if ($ok) { return $Url }
    return 'file:///' + ($FallbackPath -replace '\\', '/')
}

function Get-StatusChromeArgs([string]$Target) {
    # A new window, so it lands in front of TouchDesigner's editor and the Claude terminal on the primary monitor.
    return @('--new-window', '--start-maximized', $Target)
}

# Run only when executed as a script, not when dot-sourced by the tests.
if ($MyInvocation.InvocationName -ne '.') {
    $fallback = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs\index.md'
    $target = $null
    # The network can lag behind login, so give the live page a few tries before falling back.
    foreach ($attempt in 1..3) {
        $target = Resolve-StatusTarget -Url $Url -FallbackPath $fallback
        if ($target -eq $Url) { break }
        Start-Sleep -Seconds 10
    }
    Start-Process -FilePath $Chrome -ArgumentList (Get-StatusChromeArgs $target)
    "opened $target"
}
