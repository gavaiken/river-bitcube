# The show registry (shows.json at the repo root; docs/shows.md) for bitcube's PowerShell: Start-River.cmd and
# tools/mission/probe.ps1 read it here instead of keeping their own lists.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\shows.ps1 [-Open <file.toe>]
#     prints the show file Start-River.cmd should open (a name in the repo folder), or nothing (exit 1) if none can be found.
#     -Open: a show file to open now (mission control's switch): used when the registry offers it and it exists.
#     Otherwise the boot file: River\boot-file.txt when it names a listed show that exists (the last such line wins;
#     mission control's "Set as default" writes it), else shows.json's boot_default, else the first offered show that exists.
#   . tools\shows.ps1   (dot-sourced) defines the functions below and prints nothing.
param([string]$Open)

$ShowsRepo = Split-Path $PSScriptRoot -Parent
$ShowsRiver = Split-Path $ShowsRepo -Parent

function Get-ShowRegistry {
    # shows.json as an object, or $null when it is missing or unreadable.
    try { return Get-Content -Raw -LiteralPath (Join-Path $ShowsRepo 'shows.json') -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}
function Get-OfferedShows($reg) {
    # Show files mission control may switch to (offered), in registry order, that exist in the repo folder.
    if (-not $reg) { return @() }
    return @($reg.shows | Where-Object { $_.offered -eq $true -and $_.file -and (Test-Path -LiteralPath (Join-Path $ShowsRepo $_.file)) } | ForEach-Object { [string]$_.file })
}
function Get-ListedShows($reg) {
    # Every show file the registry lists that is present (boot-file.txt may name any of them).
    if (-not $reg) { return @() }
    return @($reg.shows | Where-Object { $_.file -and (Test-Path -LiteralPath (Join-Path $ShowsRepo $_.file)) } | ForEach-Object { [string]$_.file })
}
function Resolve-BootFile($reg) {
    # @{ file; chosen }: the show file that opens at the next start, as Start-River.cmd works it out. chosen: boot-file.txt chose it.
    $listed = Get-ListedShows $reg
    $bf = Join-Path $ShowsRiver 'boot-file.txt'
    $boot = $null
    if (Test-Path -LiteralPath $bf) {
        foreach ($line in @(Get-Content -LiteralPath $bf -ErrorAction SilentlyContinue)) {
            $name = "$line".Trim()
            if ($name -and -not $name.StartsWith(';') -and ($listed -contains $name)) { $boot = $name }
        }
    }
    if ($boot) { return @{ file = $boot; chosen = $true } }
    if ($reg -and ($listed -contains [string]$reg.boot_default)) { return @{ file = [string]$reg.boot_default; chosen = $false } }
    return @{ file = (Get-OfferedShows $reg | Select-Object -First 1); chosen = $false }
}

if ($MyInvocation.InvocationName -ne '.') {
    $reg = Get-ShowRegistry
    $pick = $null
    if ($Open -and ((Get-OfferedShows $reg) -contains $Open)) { $pick = $Open }
    if (-not $pick) { $pick = (Resolve-BootFile $reg).file }
    if ($pick) { Write-Output $pick; exit 0 }
    exit 1
}
