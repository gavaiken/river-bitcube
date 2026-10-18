# Rope identification capture (plan item E). Drives /project1/ropes through each test mode and grabs a camera frame per step into frames\ropeid-<time>\. Then: python tools\rope_identify.py <that folder>.
# Keep the camera still for the whole run (about 2 minutes). Ends with the ropes black.
param([string]$Cam = 'river', [double]$Brightness = 0.4, [double]$Settle = 1.5)
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';C:\Program Files\WinGet\Links'
$repo = 'C:\Users\user\River\river-bitcube'
$td = "$repo\tools\td.ps1"
$url = (Get-Content -Raw "$repo\secrets.local.json" | ConvertFrom-Json).cameras.$Cam
$out = "$repo\frames\ropeid-" + (Get-Date -Format 'yyyyMMdd-HHmmss'); New-Item -ItemType Directory -Force $out | Out-Null
function Set-R([string]$py) { & $td "r=op('/project1/ropes'); $py" | Out-Null }
function Snap([string]$name) {
  Start-Sleep -Milliseconds ([int]($Settle * 1000))
  & ffmpeg -hide_banner -loglevel error -rtsp_transport tcp -i $url -frames:v 1 -q:v 2 -y "$out\$name.jpg"
  '{0} {1}' -f (Get-Date -Format 'HH:mm:ss'), $name
}
Set-R "r.par.Active=True; r.par.Brightness=$Brightness; r.par.Source='black'"; Snap 'base_black'
Set-R "r.par.Source='rope'"
for ($i = 0; $i -lt 20; $i++) { Set-R "r.par.Identify=$i"; Snap ('rope{0:d2}' -f $i) }
Set-R "r.par.Source='heads'"; Snap 'heads'
Set-R "r.par.Brightness=r.par.Maxbrightness.eval(); r.par.Source='box1_red'"; Snap 'box1_red'
Set-R "r.par.Source='box2_green'"; Snap 'box2_green'
Set-R "r.par.Source='black'"; Snap 'base_black_end'
Set-R "r.par.Brightness=0.15; r.par.Source='black'"
"OUT $out"
