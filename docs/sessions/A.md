---
title: Session A (coordinator) notes
---

# Session A: coordinator notes (Mac mini · Opus 5.5)
Notes kept here while another session is editing the shared docs; folded into the log afterwards.

## 2026-10-18 17:50
- **The GL.iNet router (`GL-AXT1800`) left with Casper for the river,** along with the river cam. On Will's tailnet it had been advertising **`10.0.7.0/24` (the Agape house LAN)** as well as `192.168.8.0/24`. bitcube accepts routes (`RouteAll: true`), so all its house traffic went into Tailscale. With the router offline, bitcube couldn't reach the gallery cam (`10.0.7.76`) or even the eero (`10.0.7.1`), though Tailscale itself still worked.
- **Fix (Gavin, admin console):** un-approved `10.0.7.0/24` on GL-AXT1800 and kept `192.168.8.0/24` (the river cam's network, which bitcube will need for session E). Verified 17:47: bitcube routes `10.0.7.76` via Wi-Fi again, the eero answers, gallery-cam RTSP is reachable, and a camera frame shows the rain on the ropes.
- **Rule:** never advertise the venue's own LAN as a Tailscale subnet from another device. It hijacks bitcube's local traffic. (For session I's system docs and for the Gray Area setup.)
- Lighting path unaffected by removing the "switch": Ethernet up at 100 Mbps, both PSAC10s (`2.0.0.10`/`.11`) reachable, TD 60 fps.
- HUB75 rain is very dim: `panel_out` peaks at about 0.17 (panels Brightness 0.5, and the HUB75's camera-space region is mostly dark). Tuning item, not a fault.
- Proposed next (awaiting Gavin): bitcube advertises only `10.0.7.76/32` (gallery cam) on Will's tailnet, approved in the console, so teammates reach the camera through bitcube.
