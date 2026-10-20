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
Session-by-session prompts, models and skills: **[execution plan](execution-plan.md)**.

| # | Item | Owner | Status |
|---|---|---|---|
| A | Public status page: tidy docs, make this repo public, GitHub Pages from `/docs` | mini | **done** 18 Oct |
| B | Panels window on the **LED** display whichever monitors are plugged in | mini | **done** 18 Oct 14:14. Found by EDID name (`LED…`) in `build_panels.py`; quad 1 test pattern verified on the HUB75 by camera. 16:46 (session C): the window now covers the whole 1920×1080 LED display in black, with the atlas pixel-exact at its top-left, in both show files ([camera check](img/hub75-full-window-2026-10-18.jpg)) |
| E | Camera-based rope identification (gallery cam on Agape WiFi, aimed at all coil piles + HUB75) | mini | **done** 18 Oct 14:11. See [rope map](img/rope-map-2026-10-18.png). 18/20 ropes found and located by pile. **Ropes 9 (box 1 OUT9) and 17 (box 2 OUT7) are dark.** Colour order **RGB confirmed** (box 1 red, box 2 green). Plug-end direction can't be told while coiled; recheck when hung. Re-run any time: `tools\rope_capture.ps1 -Cam gallery`, then `tools/rope_identify.py` |
| C | Dave's visuals into TD: run river-agent's `gallery/sync.py` mirror on port **8770** (8765 is RopeLights); Web Render TOP of `canvas.html` feeds the ropes crop and the panels; offline fallback visual | bitcube (+ Dave) | todo |
| F | At login, open Chrome frontmost on the M14 monitor with this status page (local fallback if offline) | mini | **done** 18 Oct 14:20. `Start-Status.cmd` (Startup, 40 s after login) runs `tools/status_page.ps1`: the live page if reachable (3 tries), else local `docs\index.md`. Pester tests in `tools/tests/`. Tested in the desktop session; next reboot confirms the timing |
| G | Gallery-cam snapshot every 15 min, force-pushed to orphan branch `snapshot` and shown on the status page | bitcube (session C) | **done** 18 Oct 16:37. Scheduled task `RiverSnapshot` (08:00–02:00) runs `tools/snapshot.ps1`: 640 px still, one parentless commit, log in `%LOCALAPPDATA%\river-snapshot`. The page loads the snapshot only once it has loaded, otherwise it shows the checkpoint still, so it never shows a broken image |
| D | Cameras into Dave's agent: run river-agent's `capture/capture.py` on bitcube, POSTing clips to Modal `/ingest` | bitcube (after Dave answers) | blocked |
| H | Panel quad 2 connected and checked (quad 1 verified 18 Oct: red/green/blue/yellow in the right places, marker top-left) | Andi + Gavin | todo |
| J | **Per-rope sample paths (Colin's suggestion).** Replace the straight 20×400 crop with a list of UV sample points per rope that follows how each tube actually hangs (straight, curved, meandering on the floor). Sample with TOP to CHOP's UV input, then RGB ordering, then Art-Net. Source the paths from Gavin's Chromatik pixel map or by measuring the hung tubes with the camera. Add a calibration mode that steps one pixel along a rope, to confirm pixel order and the 170/340 universe boundaries | bitcube | todo (after E) |
| L | **Local rain checkpoint:** new `river-local-oct-18.toe`, self-contained (no Modal). Camera structured-light pixel map of all ropes (`tools/pixelmap/`), with a rain/river field in camera space sampled onto the ropes and HUB75 quad 1 | bitcube (session B, Opus) | **done** 18 Oct 15:57. 18/18 working ropes mapped by Gray-code capture; field built from built-in TOPs only; verified by camera. [Still](img/rain-checkpoint-2026-10-18.jpg), [progress](sessions/B.md). Since 16:54 the login autostart opens it (session A, restart-tested) |
| M | **Interactive system documentation** for the team and their agents: a diagram where every node and link can be clicked (places, IPs, usernames, connections, the Modal↔bitcube API), plus machine-readable `docs/system/system.json` and `llms.txt` | session I (Mac mini) | **done** 18 Oct 18:25. [System map](system/): 60 nodes and 83 links in two scenarios (Agape now, Gray Area planned), the API contract with live examples, secrets by name only. `system.json` is the source of truth; `tools/system_docs.py` generates `system.md`; `docs/llms.txt` for agents. 62 tests (`.venv/bin/pytest tools/tests`): structure, secret scan including bitcube's real secrets read over ssh, and headless Chrome. [Progress](sessions/I.md) |
| N | **Live river cam across the ropes and HUB75:** the river cam (at the river; Starlink + GL.iNet + Tailscale) fills the shared field in `river-local-oct-18.toe`, so it flows across the ropes and the HUB75's patch. It falls back to rain after more than 10 s without frames. `river_local` parameters: `Fieldcam` (0 = rain, 1 = cam), `Panelcam` (1 = whole river frame on the HUB75), `Camgain` | mini (session A) | **done** 19 Oct 18:04 |
| K | Ropes 9 (box 1 OUT9) and 17 (box 2 OUT7) never light. **Still dark after Gavin tightened the cables (14:33 re-run).** Next: swap test (execution plan step P1) | Gavin | in progress |
| I | Rope mapping fixes from the identification run (order, reversed ropes, colour order) | bitcube (Will OKs his config) | blocked on E |

## Decisions
- **TouchDesigner is the single renderer** for ropes and panels: one river image, sampled by both. This agrees with Colin's recommendation (18 Oct).
- **TD sends Art-Net straight to the PSAC10 boxes** (`2.0.0.10`, `2.0.0.11`), not via the rack controller's playback. The rack controller only plays its own program when TD stops sending, so TD sends black to keep the ropes dark.
- **Art-Net sender:** we use our own Python sender inside TD (`td/ropes/artnet_out.py`). It's byte-for-byte the same as Will's RopeLights and has brightness/power caps. Colin suggests TD's DMX Out CHOP with a routing table; it's a fine alternative, but there's no need to switch while this one works.
- **Rope facts Colin asked for:** each 10 m tube has **400 individually addressable pixels** (40 ICs/m; the 240 LEDs/m are driven in groups of 6), i.e. 3 universes per rope (170+170+60 px). Will's provisional mapping reserves 4 universes per rope: box 1 = universes 0–39 (ropes 1–10), box 2 = 40–79 (ropes 11–20). 18 of 20 ropes have lit with it; ropes 9 and 17 haven't.

## Open questions
| Question | Ask | Asked | Answer |
|---|---|---|---|
| Is `SITE_TOKEN` set on Modal? Can bitcube get an `INGEST_TOKEN`? | Dave | | `SITE_TOKEN`: **not set** (session I, 18 Oct 17:21: `/data/*.json` answer without a token). `INGEST_TOKEN`: still needed |
| What location/channel names and clip cadence should bitcube use for camera ingest? Is anything already pushing these cameras? | Dave | | |
| Preferred canvas design size (`?w=&h=`) for 20×400 ropes + panels? OK to run `gallery/sync.py` on bitcube? | Dave | | |
| Receive-card layout for quad 2? (Quad 1 is correct; the 'split' was a test-pattern bar.) Thread size for the panel mounts? | Andi | | |
| Retire RopeLights or keep it as a backup? OK for Claude to edit `config.local.json` after the rope-ID run? | Will | | |
| Gallery network: dual NIC plan, and how the gallery cam reaches Tailscale at Gray Area | Will | | |
| What should the gallery show if bitcube goes down? (Today: the rack controller's SD-card colour cycle) | Team | | |
| Does the show need a TouchDesigner Commercial licence? (bitcube has Non-Commercial) | Gavin | | |
| Gallery cam is on Agape WiFi (`10.0.7.76`, DHCP). Give it a fixed address? At Gray Area, does it join the gallery network or go back on the GL.iNet router? | Will | | |
| Can the Colorlight sender run at a lower resolution? Not needed (we only use the top-left 512×128). | Andi | | |
