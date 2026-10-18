# Rope calibration tests through TD (/project1/ropes). Needs TD running with the bridge.
#   .\tools\rope_tests.ps1 colour      # box 1 pure red 5 s, then box 2 pure green 5 s (x2)
#   .\tools\rope_tests.ps1 order       # one rope at a time, full length, 4 s each, ropes 1-20
#   .\tools\rope_tests.ps1 direction   # first 20 px (plug end) of every rope, white; stays on
#   .\tools\rope_tests.ps1 all         # the three above in sequence
# Rope numbers printed 1-20; box/OUT assume the wiring plan (ropes 1-10 = box 1 OUT1-10, 11-20 = box 2).
param([Parameter(Position = 0)][ValidateSet('colour', 'order', 'direction', 'all')][string]$Test = 'all',
      [double]$Brightness = 0.15, [int]$Seconds = 4)

$td = Join-Path $PSScriptRoot 'td.ps1'
function Set-Ropes([string]$py) { & $td "r=op('/project1/ropes'); $py" | Out-Null }
function Say([string]$msg) { '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg }

& $td "r=op('/project1/ropes'); r.storage['error']=None; r.par.Active=True" | Out-Null

if ($Test -in 'colour', 'all') {
    # Pure colours at the brightness cap (0.4 -> value 102): the hue is what matters for colour order.
    Set-Ropes "r.par.Brightness=r.par.Maxbrightness.eval()"
    foreach ($round in 1, 2) {
        Set-Ropes "r.par.Source='box1_red'";   Say 'COLOUR: box 1 (ropes 1-10) should be RED, box 2 dark'; Start-Sleep 5
        Set-Ropes "r.par.Source='box2_green'"; Say 'COLOUR: box 2 (ropes 11-20) should be GREEN, box 1 dark'; Start-Sleep 5
    }
}
if ($Test -in 'order', 'all') {
    Set-Ropes "r.par.Brightness=$Brightness; r.par.Source='rope'"
    for ($i = 0; $i -lt 20; $i++) {
        Set-Ropes "r.par.Identify=$i"
        Say ('ORDER: rope {0,2} lit  (box {1} OUT{2}, universes {3}-{4})' -f ($i + 1), ([math]::Floor($i / 10) + 1), ($i % 10 + 1), ($i * 4), ($i * 4 + 2))
        Start-Sleep $Seconds
    }
}
if ($Test -in 'direction', 'all') {
    Set-Ropes "r.par.Brightness=$Brightness; r.par.Source='heads'"
    Say 'DIRECTION: first 20 px of every rope white (should be the plug end); left on'
}
& $td "op('/project1/ropes/artnet_out').module.status(op('/project1/ropes'))"
