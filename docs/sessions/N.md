# Session N: install network at Gray Area

## 2026-10-22 21:38 start: Mac mini
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
- 22:58 S21 ✅ BIOS (Aptio, Advanced → Customer Exclusive Functions): **Auto Power On already Enabled**, Wake On LAN Enabled. Nothing changed. Next: the S23 pull-the-plug test.
- 23:02 S23 pull-the-plug (bitcube + router at the wall): bitcube powered on by itself (Windows 23:02:38). The router wasn't plugged in properly, so bitcube stayed offline (its status page showed the offline copy) until the router was fixed; then online over the wire at 23:07:40, about 1.5 min after router power. bitcube's Wi-Fi didn't join `gray-river` by itself while the cable worked (Windows avoids a second connection while wired); connected by hand at 23:10.
- 23:11 Fallback test: Gavin unplugged bitcube's Ethernet; its route moved to Wi-Fi (192.168.9.80) with no gap seen from the mini. (Wi-Fi was already connected; still to test with Wi-Fi idle when the cable drops.)
- 23:13 Gallery cam on a cable to the router: it answers at **192.168.9.103** with the **same MAC as on Wi-Fi** (`EC:71:DB:EB:EB:23`), so the .76 reservation already covers it. Likely the router still holds the Wi-Fi lease for .76 under another client ID; clearing it (delete the old entry or reboot the router) and power-cycling the cam should give .76.
- 23:17 **Correction:** the cam's wired port has **its own MAC, `EC:71:DB:B5:45:FD`** (read from the cam's API, `GetLocalLink`: active link LAN, DHCP). bitcube's ARP entry at 23:13 still showed the Wi-Fi MAC, so the "same MAC" line above is wrong. On a cable it gets `.103` because only its Wi-Fi MAC is reserved. Rebooted the cam remotely through its API from bitcube (Login → Reboot); back at `.103` with the wired MAC within a minute. Fix (S22): one static lease with both MACs → `.76`.
- 23:25 Synced with session A's 22:57 commit (rigging layout, its S21–S24). Merged the clashing numbers: A's S21 (power-cut recovery) is done; A's S22–S24 stay; session N's became S25 (port labels), S26 (tests), S27 (dummy plug); new S28 (router's own Tailscale + SSH key, D24), S29 (5 GHz radar wait after power-up), S30 (optional smart plugs). Wrote the before-the-lift list in the execution plan and on the ceiling page.
- 23:24 S25 live check: Gavin plugged the router cable into one port; **`Ethernet 2` came up** (1 Gbps, `.79`, internet via it). So the port he used is **ROUTER**, and the other is **LIGHTS** (`Ethernet`, `2.0.0.8`). Which side physically: to record from Gavin.
- 23:27 S25 ✅ Ports labelled with blue tape (Gavin). Double-checked: ROUTER = `Ethernet 2`, up at 1 Gbps, `192.168.9.79`, internet goes through it, router and github.com reachable, 0 receive errors. LIGHTS = `Ethernet` (`2.0.0.8`), unplugged. Wi-Fi also up on `.80` as the fallback.
- 23:35 Gavin's tape marks (colour only, no writing): **blue** = the bitcube ↔ router cable (both ends), bitcube's ROUTER port and the router port; **white** = bitcube's LIGHTS port.
- 23:45 S28: the router is on Will's tailnet as **`router-gray-area-gl-axt1800`** (100.127.193.8, owner gav.aiken@), with LAN and WAN access and exit nodes off. Gavin renamed the river router **`router-river-gl-axt1800`**. The mini's SSH key is in (LuCI). From the mini, `ssh -J bitcube root@192.168.9.1` works. The share into Gavin's tailnet isn't visible from the mini yet.
- 23:50 S22: on the router, the cam's static lease now lists **both MACs → `192.168.9.76`** (`uci`, backup `/etc/config/dhcp.bak-20261022`). dnsmasq now has `dhcp-host=EC:71:DB:EB:EB:23,EC:71:DB:B5:45:FD,…,192.168.9.76`; dnsmasq hands the address to whichever MAC asks and drops the other's lease. Cleared both old cam leases. Not proven on a cable yet: the cam isn't on one now (Gavin stopped the remote reboot test). Note: GL.iNet stores each reservation's description as dnsmasq tags (harmless).
- 23:45 S28: share of `router-gray-area-gl-axt1800` into Gavin's tailnet done by Gavin; not visible from the mini yet at 23:49 (check again).
- 23:53 **Combined power-cut test** (Gavin: monitor, HDMI and lights unplugged; bitcube, router and cam powered off at once, then on; cam and bitcube on cables): bitcube Windows up 23:53:41, online over its cable 23:54:52, TD running. **VNC works with no monitor** (normal 1920×1080 desktop), so no dummy plug needed. The router came back with internet. **The cam didn't ask for an address over its cable** for 3+ min (link up at 100 Mbps); it surfaced at 23:58:54 **on Wi-Fi** (`.76`, Wi-Fi MAC).
- 00:00 **Cable-pull test with Wi-Fi idle** (the real case): bitcube unreachable at 00:00:33, back over Wi-Fi at 00:00:36: **a 3 s gap**. ✅
- 00:00 Cam power-cycled with its cable in: by 00:03 it hadn't asked for an address and didn't answer at `.76`. **Open:** the cam on a cable isn't reliable after power cycles; on Wi-Fi it has come back on `.76` every time. Recommendation: leave the cam on Wi-Fi only (no cable) unless we debug its wired behaviour on the ground.

### SESSION N SUMMARY — Fri 23 Oct 2026, 00:05 (Mac mini)
**Done**
- **S2/S2.1–S2.3, S3, S17–S19: install network.**
  - Router: our second GL-AXT1800 at Gray Area, LAN `192.168.9.1/24`, Wi-Fi `gray-river` on 2.4 + 5 GHz, Multi-WAN failover Ethernet → Repeater → Tethering → Cellular. Uplink for now: Repeater on Gray Area Staff Wi-Fi.
  - Reservations: cam `.76` (both MACs), bitcube wired `.79`, bitcube Wi-Fi `.80`.
  - bitcube:
    - `Ethernet 2` had DHCP off with no address; now DHCP.
    - Stale `192.168.1.99` and its gateway removed from the lighting NIC.
    - `gray-river` profile set to Private.
    - Tailscale routes `192.168.9.76/32` + `192.168.9.1/32` approved (replacing `10.0.7.76/32`).
    - `secrets.local.json` cam host → `192.168.9.76`.
    - Modal link restarted; gallery clips posting.
    - loopMIDI removed from login.
- **S21:** BIOS *Auto Power On* is Enabled; bitcube powers on by itself after a power cut.
- **S22:** the cam's lease lists both MACs (Wi-Fi `EC:71:DB:EB:EB:23`, wired `EC:71:DB:B5:45:FD`) → `.76`. Set over SSH; backup `/etc/config/dhcp.bak-20261022`.
- **S25:** ports marked with tape: blue = bitcube ↔ router (cable ends and ports), white = bitcube's LIGHTS port. Checked live: ROUTER = `Ethernet 2`.
- **S26 tests:** ✅ restarts; ✅ power cut of all three (bitcube online in ~80 s, TD running); ✅ VNC with no monitor; ✅ bitcube's cable pulled with Wi-Fi idle (3 s gap).
- **S28 (mostly):** router on Will's tailnet as `router-gray-area-gl-axt1800` (100.127.193.8), LAN/WAN access and exit nodes off, no routes. River router renamed `router-river-gl-axt1800`. Mini's SSH key on the router.
- **Docs:**
  - [ceiling page](../ceiling.md): setup, addresses, tape colours, fallbacks, router access steps, status;
  - execution plan: before-the-lift list, S16–S31, R15–R16, D18–D25;
  - welcome page and gallery card credit Andi and Lilian as artists;
  - system map updated;
  - `tools/mini/bitcube_ps.sh` (run PowerShell on bitcube from the mini).

**Not done / open**
- ⚠️ **Gallery cam on a cable is unreliable:** after power cycles it didn't request an address over the cable; on Wi-Fi it returns on `.76`. **Recommendation: cam on Wi-Fi only, cable unplugged.** Last seen 00:03: not answering, after Gavin's power cycle with the cable in. Check it's back on `.76` (Wi-Fi) once the cable is out.
- **S28:** the share into Gavin's tailnet isn't visible from the mini yet. Until it is, the router is only reachable through bitcube (`ssh -J bitcube root@192.168.9.1`).
- **S16:** Gray Area's wired drop not connected yet; the WAN failover test waits on it.
- **S29:** after a power cut, 5 GHz `gray-river` can wait 1–10 min (radar check) while the router repeats a DFS channel. Fix with the wired drop + a fixed non-DFS 5 GHz channel.
- **S20:** lights not tested on the ground. LIGHTS port (white) → switch → rack + PSAC10s; HDMI → Colorlight.
- **S23:** cam position (Colin, Lilian).
- **S1:** seasons show file not deployed. **S24:** system map for the rig.
- D24 and D25 recorded as decided/recommended; Gavin confirmed D24 (Will's tailnet).

**Evidence:** commits `bb773e9` … `fc1398c` on main; router config backup on the router; logs above.

**Hardware state now (00:05):**
- bitcube on, TD running, online over Wi-Fi `.80` (blue cable pulled for the test; plug it back in).
- Router on; its internet comes from Gray Area Staff Wi-Fi.
- Cam: power-cycled, with its cable in at 00:00.
- No HDMI, monitor or lights connected.

**Changed outside the repo:**
- On bitcube:
  - network settings;
  - Tailscale routes;
  - `secrets.local.json` (cam IP);
  - HKCU `Run` (loopMIDI);
  - Modal link restarted.
- On the router: everything above, plus `/etc/config/dhcp`.
- bitcube's own checkout of this repo is behind (`d3ec7e5`); the next bitcube session starts with `git pull`.

**How to reach things from the mini**
- bitcube:
  - `ssh bitcube`;
  - PowerShell via `tools/mini/bitcube_ps.sh`;
  - VNC via `~/claude/local/bitcube-vnc/vnc.py shot x.png`.
- Router: `ssh -J bitcube root@192.168.9.1`.
- Cam API (Login → Reboot / GetLocalLink / SetWifi): from bitcube, with the login from `secrets.local.json`.

**Decisions or answers needed from Gavin:** cam on Wi-Fi only (recommended)? Accept the router share on Gavin's tailnet if it isn't. D25 (lights straight into bitcube) to confirm.

**Suggested next steps:**
- Plug bitcube's blue cable back in.
- Unplug the cam's cable.
- Then S20 on the ground → lift → S1 (remote) → S4/S7.
