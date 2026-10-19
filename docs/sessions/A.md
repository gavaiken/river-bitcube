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

## 2026-10-18 17:55
- **Gallery cam shared over Tailscale through bitcube:** `tailscale set --advertise-routes=10.0.7.76/32` on bitcube, approved by Gavin in Will's console (bitcube's `PrimaryRoutes` = `10.0.7.76/32`). Devices **on Will's tailnet** can now reach the cam at `10.0.7.76` (RTSP 554, PTZ HTTPS) via bitcube. Node *sharing* doesn't carry routes, so on Gavin's own tailnet it isn't visible; use the account switcher to Will's tailnet. At Gray Area, advertise the gallery cam's new address the same way (and remove this one).
- **HUB75 brightened:** new `quad1_gain` Level TOP in `/project1/river_local` (`Panelgain` 3.0, `Panelgamma` 0.7 on the COMP's River page), panels `Brightness` 1.0, in `td/build/build_river_local.py` (19d8919); rebuilt and saved `river-local-oct-18.toe` (f5e7cee). Panel output went from a peak of 0.17 to 1.0 (mean 4–14%); the camera shows a bright blue-white wash crossing the HUB75 in step with the coils. Turn `Panelgain` down to about 2 if it's too strong in person.

## 2026-10-18 18:05
- **Rope sender now survives the lights being switched off** (Gavin turned the ropes off for the noise; bitcube and the HUB75 stay on). Before, any send error set `Active = False`, so after power-on the ropes would have played the hardware's colour cycle until someone re-enabled TD. Now network `OSError`s close the socket and retry every 2 s (`retry_at` in storage, clock-safe after a reload); a successful send clears the error. Non-network errors still stop the sender. Test first: `tools/tests/test_artnet_retry.py` (3 tests: recover after an outage, stale `retry_at` after reload, a real bug still stops).
