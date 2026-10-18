# Run Python inside the running TouchDesigner project via the Claude bridge.
#   .\tools\td.ps1 "app.build"                     # single expression -> value
#   .\tools\td.ps1 -File .\td\scripts\something.py # run a file
#   .\tools\td.ps1 -Errors                         # list operator errors/warnings
#   .\tools\td.ps1 -Screenshot /project1/out1      # save a TOP to frames\ and print the path
param(
    [Parameter(Position = 0)][string]$Code,
    [string]$File,
    [switch]$Errors,
    [string]$Screenshot,
    [int]$Port = 9980
)

$base = "http://127.0.0.1:$Port"
try {
    if ($Errors) {
        $r = Invoke-RestMethod -Uri "$base/errors" -Method Get
    } elseif ($Screenshot) {
        $frames = Join-Path (Split-Path $PSScriptRoot -Parent) 'frames'
        New-Item -ItemType Directory -Force $frames | Out-Null
        $name = ($Screenshot.Trim('/') -replace '/', '_') + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png'
        $path = (Join-Path $frames $name) -replace '\\', '/'
        $q = 'op=' + [uri]::EscapeDataString($Screenshot) + '&path=' + [uri]::EscapeDataString($path)
        $r = Invoke-RestMethod -Uri "$base/screenshot?$q" -Method Get
    } else {
        if ($File) { $Code = Get-Content -Raw $File }
        if (-not $Code) { throw 'Pass Python code, -File, -Errors or -Screenshot.' }
        $r = Invoke-RestMethod -Uri "$base/exec" -Method Post -Body $Code -ContentType 'text/plain; charset=utf-8'
    }
    if ($Errors) { $r.result | ConvertTo-Json -Depth 6; exit 0 }
    if ($r.stdout) { $r.stdout.TrimEnd() }
    if ($null -ne $r.result) { $r.result }
    if (-not $r.ok -or $r.error) { Write-Error $r.error; exit 1 }
} catch {
    Write-Error "TD bridge call failed (is TouchDesigner open with claude_bridge installed on port $Port?): $_"
    exit 1
}
