# Session N: install network at Gray Area

## 2026-10-22 21:38 start: Mac mini · Opus 5.5
Gavin is on site at Gray Area with the new GL-AXT1800 (Slate AX). Plan: steps S2.1–S2.3 and S3 in the [execution plan](../execution-plan.md), decisions D18–D23.

```
Gray Area drop ──► router WAN
router LAN ──► bitcube "Ethernet 2" (spare port)          internet, reserved 192.168.9.79
router LAN ──► gallery cam (Ethernet; else Wi-Fi "gray-river") reserved 192.168.9.76
router Wi-Fi "gray-river" ◄── phones, laptops
bitcube "Ethernet" (2.0.0.8) ──► switch ──► rack controller + both PSAC10s
bitcube HDMI ──► Colorlight sender ──► receive card ──► panels
```
Keep the lighting switch and the Colorlight cable off the router.

- 21:38 Recorded D18–D23 (router 192.168.9.0/24, Wi-Fi `gray-river`, one drop into WAN, stale IP removal, no Tailscale on the router, session N does bitcube's side). System map: new node `router-gallery`, show-scenario links updated. The gallery cam turns out to have an Ethernet port, so it goes on a cable (no temporary `Agape WiFi` needed if a cable reaches).
- 21:38 S2.1 ➡️ Gavin configuring the router on site.
- 21:39 S2.1: 5 GHz Wi-Fi named `gray-river` (Gavin). 2.4 GHz name to confirm.
- 21:42 S2.1: no cable to the router's WAN yet, so its uplink is **Repeater → Gray Area's staff Wi-Fi** (5 GHz, DFS channel; router WAN 10.30.0.101, gateway 10.30.0.1). That's the planned fallback (D20); Ethernet takes over when the drop arrives. Router LAN still 192.168.8.1 (step 3 pending). Because the 5 GHz AP shares the repeater's DFS channel, the camera may not see `gray-river` on 5 GHz: it goes on 2.4 GHz (or a cable).
- 21:46 S2.1: Multi-WAN confirmed: Failover, Ethernet → Repeater → Tethering → Cellular. Gallery cam can't have a cable at its spot, so it stays on Wi-Fi: cabled to LAN1 for a moment, 2.4 GHz renamed `Agape WiFi` → `gray-river`, then the cam switched to `gray-river` in the Reolink app (in progress).
- 21:55 S2.1/S2.2: gallery cam on Wi-Fi `gray-river`, no cable; both bands now `gray-river` (`Agape WiFi` gone); Multi-WAN failover. bitcube powered on and cabled to the router, but **offline on Tailscale** (last seen ~3 h ago): check it's in the router's Clients, else its cable is in the lighting port (static 2.0.0.8) and goes in the other one. Lights not connected tonight (Gavin). Router LAN still 192.168.8.1: must move to 192.168.9.1 (D18) before bitcube's camera traffic works, then reservations.
- 21:58 Router Clients: gallery cam online at 192.168.8.189 on **5 GHz** (so it does handle the DFS channel); no wired clients, so **bitcube isn't on the router**. Likely cause: cable in bitcube's lighting port (static 2.0.0.8 + 192.168.1.99, never asks for an address). Next: the cam's known-good cable into the router's LAN1 and bitcube's other port.
- 22:01 Still no bitcube: Gavin moved the cable to the other port (the first port had link lights, so the cable and link were fine) and put `Agape WiFi` back on 2.4 GHz for bitcube's saved Wi-Fi; still not in Clients and offline on Tailscale. Neither NIC is asking for an address, so **bitcube probably hasn't reached Windows**. Suspect its firmware settings reset while it was unplugged (GRUB menu or a BIOS prompt) or a stuck boot. Next: an HDMI monitor and USB keyboard from Gray Area. No monitor came with the kit.

### Waiting on Gavin
- A monitor + keyboard on bitcube; report what's on screen.

### Waiting on Gavin (earlier)
- S2.1/S2.2 on site. Tell session N when bitcube is cabled and powered.
- After S3: approve bitcube's `192.168.9.76/32` and `192.168.9.1/32` routes in Will's Tailscale admin console (Machines → bitcube → Edit route settings).
