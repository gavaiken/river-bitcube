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
- 22:12 **bitcube online** (Windows booted 22:12:36, after Gavin connected a monitor and restarted it). It's on Wi-Fi `gray-river` (5 GHz, channel 124) at 192.168.8.194; Gavin joined it from the console.
- 22:14 Confirmed the range clash (D18): bitcube routes `192.168.8.0/24` via Tailscale (the river router, offline 1 day), so it can't reach the cam at 192.168.8.189 (TCP 554 fails). The router's LAN must move to 192.168.9.1.
- 22:16 S2.3 (partly): `gray-river` Wi-Fi profile → Private; removed the stale `192.168.1.99/24` and gateway `192.168.1.1` from the lighting NIC (persistent config now only `2.0.0.8/8`). Found why the wired port never showed in the router's Clients: **`Ethernet 2` had DHCP turned off with no address**. Turned DHCP on.
- 22:20 `Ethernet 2` still gets no address: its link comes up at only 10 Mbps, drops, and has received 0 packets. Suspect the flat white cable (or a port): try another cable and the router's LAN2.
- 22:17 Gavin restarted bitcube as a test: back by itself (Windows 22:17:08, online on `gray-river`). He'd seen Windows on the monitor earlier, so the evening's "offline" was only the network (Ethernet 2 with DHCP off, Wi-Fi knowing only Agape WiFi).
- 22:25 S2.1 ✅ Router LAN moved to **192.168.9.1** (Gavin). bitcube's Wi-Fi now 192.168.9.194; the cam is reconnecting.
- 22:28 S3: bitcube now advertises `192.168.9.76/32` + `192.168.9.1/32` (was `10.0.7.76/32`); waiting for Gavin's approval in the admin console.
- 22:28 "loopMIDI opens at restart": it's a virtual MIDI cable installed in Aug 2023 for the old BitCube setup, started by the HKCU `Run` key. Nothing in our show uses it (S18, Gavin to decide).
- 22:30 Credits: Andi and Lilian are now named artists on the welcome page and the gallery card. Plan updated: next steps, S16–S20, R15, learnings. System map and CLAUDE.md updated; system tests pass, including the secret scan against bitcube's real secrets.
- 22:35 Gavin: reservations in (cam .76, bitcube wired .79, Wi-Fi .80), routes approved, 2.4 GHz back to `gray-river`, new cable in. **`Ethernet 2` up at 1 Gbps with 192.168.9.79**, now bitcube's preferred route; Windows put it on the same Private `gray-river` profile. Cam answers RTSP at 192.168.9.76; router at .1. Wi-Fi stayed on .194 after a release/renew (harmless; it should take .80 when it next reconnects).
- 22:37 S3: `secrets.local.json` gallery cam 10.0.7.76 → 192.168.9.76 (edited in place, nothing printed); `cam_snap.ps1 gallery` returns a frame (the cam is on the floor among cables).
- 22:38 S18 ✅ (Gavin: remove it): loopMIDI's HKCU `Run` value removed and its window closed; the program stays installed.
- 22:40 S3 ✅ Modal link restarted through a one-off interactive scheduled task; gallery clips post again (first `gallery/video` at 22:39). The river cam still fails (river site down).
- 22:48 Forced bitcube's Wi-Fi to reconnect: it kept 192.168.9.194 until a full release; now **192.168.9.80** (reserved). VNC from the mini works (1920×1080, borrowed ASUS monitor).
- 22:50 Ceiling plan (Gavin: router and bitcube go in the ceiling, with no monitor up there): checked what's already set for unattended boot (Windows first, auto-login, SSH/Tailscale/TightVNC automatic, sleep off, updates paused to 15 Nov, `gray-river` for all users). Missing: the BIOS power-on-after-power-cut setting (S21). Wrote [ceiling.md](../ceiling.md) and steps S21–S24, R16. TD's Art-Net sender binds to `2.0.0.8`, so it follows whichever port holds that address: the basis for S22 (either port works).

### Waiting on Gavin
- S21 BIOS setting (needs the monitor). OK for S22 (either-port watcher)? Go-ahead for S1 and who runs it. S16 when the wired drop arrives.

### Waiting on Gavin (earlier)
- S2.1/S2.2 on site. Tell session N when bitcube is cabled and powered.
- After S3: approve bitcube's `192.168.9.76/32` and `192.168.9.1/32` routes in Will's Tailscale admin console (Machines → bitcube → Edit route settings).
