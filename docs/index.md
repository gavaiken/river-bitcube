---
title: A River Becoming: show machine status
---

# Welcome to bitcube

**A River Becoming** is an installation by **Colin, Justine, Will, Dave and Gavin**, with Andi and Lilian, for Gray Area, San Francisco (October 2026). This site is the team's working notes for bitcube, the show machine.

**[Execution plan](execution-plan.md)** (status table and session prompts) · **[Plan & open questions](plan.md)** · **[Log](a-river-becoming-log.md)** · **[Hardware](a-river-becoming-hardware.md)** · **[System map](system/)** (every device, IP and connection; [system.json](system/system.json) for agents)

**Status as of Tue 20 Oct 2026, 10:15.** Gray Area install starts **Wed 22 Oct**.

bitcube is the Windows mini PC that drives **A River Becoming**: 20 LED ropes over Art-Net, the HUB75 panels over HDMI, and the Reolink cameras. It runs TouchDesigner and a Claude Code session.

## Where we are
- **Working:**
  - **Local rain checkpoint** (`river-local-oct-18.toe`, no Modal): one rain/river field in the camera's view, sampled onto every pixel of the 18 working ropes and onto HUB75 quad 1. Every rope pixel's position comes from a camera structured-light pixel map (`tools/pixelmap/`). About 70–200 W in total.
  - **HUB75:** TouchDesigner's window covers the whole LED display in black, with only the panel image at its top-left, so nothing else can show on the panels.
  - **Camera calibration:** 18 of 20 ropes located, colour order confirmed. **Ropes 9 and 17 never light** (swap test deferred).
  - bitcube boots straight into the rain checkpoint (about 1 minute; restart-tested 16:54) and is on Tailscale. The gallery cam is reachable (also through bitcube on Will's tailnet); the river cam went to the river on the evening of 18 Oct.
  - **[System map](system/):** a clickable diagram of every machine, device and connection (Agape now, Gray Area planned), with IPs, ports, usernames and the Modal↔bitcube API. No secrets.
  - **Live river cam across the ropes and HUB75:** the camera at the river streams over Starlink and Tailscale to bitcube (10 fps). It replaces the rain as the image that both the ropes and the HUB75 sample, so the real river flows across the installation. If the stream drops for more than 10 s, it falls back to the rain by itself.
  - **Connected to Dave's Modal agent:** both cameras post 10 s clips to the agent, and the agent's scene (colours, speed, density, turbulence, brightness, every 5 min, plus fast camera reflexes) now shapes the look on the ropes and HUB75, and Dave's own animation plays as a layer over the live river. The river cam's look switches between day and night (infrared) settings by itself.
- **Next:**
  1. Connect quad 2, and fix ropes 9 and 17.
  2. Re-map once the ropes are hung at Gray Area.

![Rain checkpoint on the coiled ropes and HUB75, 18 Oct 15:57](img/rain-checkpoint-2026-10-18.jpg)

How we'll get there, session by session: **[execution plan](execution-plan.md)**. Full checklist and **open questions** (some are waiting on Dave, Andi and Will): **[plan](plan.md)**.

## Latest camera snapshot
<!-- docs/assets/snapshot.js loads the newest per-minute still from the snapshot branch (tools/snapshot.ps1). If nothing loads, the checkpoint still stays, never a broken image. -->
<img id="snap" src="img/rain-checkpoint-2026-10-18.jpg" alt="Latest gallery-cam snapshot" width="640">
<script src="assets/snapshot.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {   // the time and note spans come after this script
  riverSnapshot({ img: document.getElementById('snap'), time: document.getElementById('snap-time'),
                  note: document.getElementById('snap-note'),
                  failText: 'The live snapshot is unavailable, so this is the 18 Oct rain checkpoint still.' });
});
</script>

<span id="snap-time"></span> <span id="snap-note">A new still every minute, 08:00–02:00 Pacific; the <a href="live.html"><b>live page</b></a> keeps refreshing. People in the room may appear.</span>

## Using bitcube
- **Look at it:** VNC to `bitcube.tail03bc1a.ts.net` (needs access to Will's Tailscale network). VNC shows the real screens; avoid RDP, which blanks the panels.
- **Files:** `\\bitcube\River` (Finder: Network → bitcube → River).
- **Claude:** a Claude terminal opens at login in `C:\Users\user\River`. Otherwise open PowerShell, `cd C:\Users\user\River`, and run `claude`. It reads `CLAUDE.md` and the docs first.
- **Don't** shut bitcube down; restart instead. **Don't** run Will's RopeLights while TouchDesigner drives the ropes.

## Archive
- [Execution plan](execution-plan.md): status table, sessions and copy-paste prompts.
- [Running log](a-river-becoming-log.md): everything done so far, session by session.
- [Hardware reference](a-river-becoming-hardware.md): ropes, PSAC10 boxes, controller, panels, cameras.
- [Design notes](a-river-becoming-notes.md): from the team meetings.
- Code: [github.com/gavaiken/river-bitcube](https://github.com/gavaiken/river-bitcube) · Dave's agent: github.com/drocamor/river-agent (private).
