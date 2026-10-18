---
title: Plan and open questions
---

# Plan and open questions

The shared checklist for **A River Becoming**'s show machine, bitcube. Install at Gray Area starts **Wed 22 Oct 2026**.

**How we work:**
- This repo is how people and Claude sessions coordinate.
- Whoever does an item ticks it off **in the same commit as the work** and adds a line to the [log](a-river-becoming-log.md).
- Owners: **bitcube** = Claude Code on bitcube (devices, TouchDesigner, cameras, Windows). **mini** = Claude on Gavin's Mac mini (docs, GitHub). Or a named person.
- Only one Claude works at a time. Start with `git pull`; finish by updating this file, [the status page](index.md) and the log, then push.

## Done so far (details in the [log](a-river-becoming-log.md))
- [x] bitcube on Tailscale, shared with the team. SSH (key-based), VNC and the `\\bitcube\River` file share all work.
- [x] TouchDesigner 2025 installed. `river.toe` opens at login with the Claude↔TD bridge.
- [x] TD drives the 20 ropes over Art-Net (same packets as Will's RopeLights, brightness and power capped). RopeLights is stopped.
- [x] TD drives HUB75 quad 1 over HDMI (test pattern).
- [x] Both Reolink cameras reachable from bitcube, with snapshot tool `tools/cam_snap.ps1`.
- [x] Boot fixed: no GRUB menu, auto-login, Tailscale before login, no sleep or hibernate. A restart takes about 1 minute.
- [x] At login, a Claude terminal opens in `C:\Users\user\River` and reads the docs.
- [x] Repo split: `River\river-bitcube` (this repo) and `River\river-agent` (Dave's).

## Now
| # | Item | Owner | Status |
|---|---|---|---|
| A | Public status page: tidy docs, make this repo public, GitHub Pages from `/docs` | mini | **done** 18 Oct |
| B | Panels window on the **LED** display whichever monitors are plugged in. Pick the monitor whose name starts with `LED`, cover all 1920×1080 in black, panel atlas top-left. Fall back to primary. (`td/build/build_panels.py`) | bitcube | todo |
| E | Camera-based rope identification with the **`river` cam** (E1 Outdoor Pro, `.217`), sitting on the LED controller and watching the three coil piles. `tools\rope_capture.ps1` lights each rope alone and grabs a frame; `tools/rope_identify.py` finds it. **First run, 18 Oct 13:13:** the camera moved partway through, so only ropes 1–14 are usable. Right pile: 1, 4, 8, 10. Middle: 2, 3, 5, 6, 7. Left: 11, 13, 14. **Ropes 9 (box 1 OUT9) and 12 (box 2 OUT2) lit nothing**, probably the two dead ropes. Next: re-run with the camera still and the HUB75 in view, then the plug-end and colour-order frames | mini (Gavin keeps the camera still) | **in progress** |
| C | Dave's visuals into TD: run river-agent's `gallery/sync.py` mirror on port **8770** (8765 is RopeLights); Web Render TOP of `canvas.html` feeds the ropes crop and the panels; offline fallback visual | bitcube (+ Dave) | todo |
| F | At login, open Chrome frontmost on the M14 monitor with this status page (local fallback if offline) | bitcube | todo |
| G | Gallery-cam snapshot every 15 min, force-pushed to orphan branch `snapshot` and shown on the status page | bitcube | todo |
| D | Cameras into Dave's agent: run river-agent's `capture/capture.py` on bitcube, POSTing clips to Modal `/ingest` | bitcube (after Dave answers) | blocked |
| H | Panel quad 2 connected and checked | Andi + Gavin | todo |
| J | **Per-rope sample paths (Colin's suggestion).** Replace the straight 20×400 crop with a list of UV sample points per rope that follows how each tube actually hangs (straight, curved, meandering on the floor). Sample with TOP to CHOP's UV input, then RGB ordering, then Art-Net. Source the paths from Gavin's Chromatik pixel map or by measuring the hung tubes with the camera. Add a calibration mode that steps one pixel along a rope, to confirm pixel order and the 170/340 universe boundaries | bitcube | todo (after E) |
| I | Rope mapping fixes from the identification run (order, reversed ropes, colour order) | bitcube (Will OKs his config) | blocked on E |

## Decisions
- **TouchDesigner is the single renderer** for ropes and panels: one river image, sampled by both. This agrees with Colin's recommendation (18 Oct).
- **TD sends Art-Net straight to the PSAC10 boxes** (`2.0.0.10`, `2.0.0.11`), not via the rack controller's playback. The rack controller only plays its own program when TD stops sending, so TD sends black to keep the ropes dark.
- **Art-Net sender:** we use our own Python sender inside TD (`td/ropes/artnet_out.py`). It's byte-for-byte the same as Will's RopeLights and has brightness/power caps. Colin suggests TD's DMX Out CHOP with a routing table; it's a fine alternative, but there's no need to switch while this one works.
- **Rope facts Colin asked for:** each 10 m tube has **400 individually addressable pixels** (40 ICs/m; the 240 LEDs/m are driven in groups of 6), i.e. 3 universes per rope (170+170+60 px). Will's provisional mapping reserves 4 universes per rope: box 1 = universes 0–39 (ropes 1–10), box 2 = 40–79 (ropes 11–20). 18 of 20 ropes have lit with it; ropes 9 and 12 haven't.

## Open questions
| Question | Ask | Asked | Answer |
|---|---|---|---|
| Is `SITE_TOKEN` set on Modal? Can bitcube get an `INGEST_TOKEN`? | Dave | | |
| What location/channel names and clip cadence should bitcube use for camera ingest? Is anything already pushing these cameras? | Dave | | |
| Preferred canvas design size (`?w=&h=`) for 20×400 ropes + panels? OK to run `gallery/sync.py` on bitcube? | Dave | | |
| Receive-card layout for quads 1–2 (quad 1's right column looked split). Thread size for the panel mounts? | Andi | | |
| Retire RopeLights or keep it as a backup? OK for Claude to edit `config.local.json` after the rope-ID run? | Will | | |
| Gallery network: dual NIC plan, and how the gallery cam reaches Tailscale at Gray Area | Will | | |
| What should the gallery show if bitcube goes down? (Today: the rack controller's SD-card colour cycle) | Team | | |
| Does the show need a TouchDesigner Commercial licence? (bitcube has Non-Commercial) | Gavin | | |
| Gallery cam is on Agape WiFi (`10.0.7.76`, DHCP). Give it a fixed address? At Gray Area, does it join the gallery network or go back on the GL.iNet router? | Will | | |
| Can the Colorlight sender run at a lower resolution? Not needed (we only use the top-left 512×128). | Andi | | |
