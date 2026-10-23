# Which of bitcube's ports carries the lighting network (D25, S31). Run on bitcube (or from the mini with
# tools/mini/bitcube_ps.sh), as the admin user:
#   powershell -ExecutionPolicy Bypass -File tools\lights_route.ps1 status   # where 2.0.0.8 is, links, boxes, TD sender
#   powershell -ExecutionPolicy Bypass -File tools\lights_route.ps1 direct   # the plan: lights cabled into LIGHTS
#   powershell -ExecutionPolicy Bypass -File tools\lights_route.ps1 router   # fallback: lighting switch into a router LAN port
#
# direct: LIGHTS (`Ethernet`) holds 2.0.0.8/8 (fixed); ROUTER (`Ethernet 2`) is DHCP only (192.168.9.79).
# router: ROUTER keeps its DHCP address and also holds 2.0.0.8/8 (Windows "DHCP/static coexistence"), marked
#         SkipAsSource so Windows never uses it for other traffic (otherwise it could pick 2.0.0.8 as the source
#         for internet traffic); LIGHTS has no lighting address. The PSAC10s (2.0.0.10/.11) and the rack controller
#         then sit on the router's LAN beside it; TD's sender binds 2.0.0.8 wherever it is and reopens within 2 s.
# Never put 2.0.0.8 on both ports at once (two routes to 2.0.0.0/8). Each switch is logged in River\logs\lights-route.log.
param([ValidateSet('status', 'direct', 'router')][string]$Mode = 'status')
$ErrorActionPreference = 'Stop'
$LIGHTS = 'Ethernet'; $ROUTER = 'Ethernet 2'; $IP = '2.0.0.8'; $LEN = 8
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path (Split-Path $repo -Parent) 'logs\lights-route.log'

function Holds([string]$nic) { [bool](Get-NetIPAddress -InterfaceAlias $nic -IPAddress $IP -AddressFamily IPv4 -ErrorAction SilentlyContinue) }
function Drop([string]$nic) {
    Get-NetIPAddress -InterfaceAlias $nic -IPAddress $IP -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false
}
function Note([string]$line) {
    New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
    Add-Content $log ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $line)
}

if ($Mode -eq 'router') {
    netsh interface ipv4 set interface "$ROUTER" dhcpstaticipcoexistence=enabled | Out-Null
    Drop $LIGHTS
    if (-not (Holds $ROUTER)) {
        New-NetIPAddress -InterfaceAlias $ROUTER -IPAddress $IP -PrefixLength $LEN -SkipAsSource $true | Out-Null
    } else {
        Set-NetIPAddress -InterfaceAlias $ROUTER -IPAddress $IP -SkipAsSource $true
    }
    Note "router: $IP on $ROUTER (with DHCP), removed from $LIGHTS"
} elseif ($Mode -eq 'direct') {
    Drop $ROUTER
    netsh interface ipv4 set interface "$ROUTER" dhcpstaticipcoexistence=disabled | Out-Null
    if (-not (Holds $LIGHTS)) { New-NetIPAddress -InterfaceAlias $LIGHTS -IPAddress $IP -PrefixLength $LEN | Out-Null }
    Note "direct: $IP on $LIGHTS, removed from $ROUTER"
}

# status (always)
$out = [ordered]@{ mode = $(if ((Holds $LIGHTS) -and -not (Holds $ROUTER)) { 'direct' } elseif ((Holds $ROUTER) -and -not (Holds $LIGHTS)) { 'router' } elseif ((Holds $LIGHTS) -and (Holds $ROUTER)) { 'BOTH (fix this)' } else { 'none' }) }
foreach ($n in $LIGHTS, $ROUTER) {
    $a = Get-NetAdapter -Name $n
    $out[$n] = [ordered]@{
        link = "$($a.Status) $($a.LinkSpeed)"
        dhcp = (Get-NetIPInterface -InterfaceAlias $n -AddressFamily IPv4).Dhcp.ToString()
        addresses = @(Get-NetIPAddress -InterfaceAlias $n -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } |
            ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength) $($_.PrefixOrigin)$(if ($_.SkipAsSource) { ' skip-as-source' })" })
        coexistence = ((netsh interface ipv4 show interface "$n" | Select-String 'Coexistence') -replace '.*:\s*', '').Trim()
    }
}
$p = New-Object Net.NetworkInformation.Ping
$out.boxes = [ordered]@{ psac10_1 = ($p.Send('2.0.0.10', 800).Status -eq 'Success'); psac10_2 = ($p.Send('2.0.0.11', 800).Status -eq 'Success') }
$td = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\td.ps1') "op('/project1/ropes/artnet_out').module.status(op('/project1/ropes'))" 2>$null | Select-Object -Last 1
$out.td_sender = "$td"
$out | ConvertTo-Json -Depth 4
