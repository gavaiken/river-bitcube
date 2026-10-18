---
title: A River Becoming: show machine status
---

# Welcome to bitcube

**[Execution plan](execution-plan.md)** (status table and session prompts) · **[Plan & open questions](plan.md)** · **[Log](a-river-becoming-log.md)** · **[Hardware](a-river-becoming-hardware.md)**

**Status as of Sun 18 Oct 2026, 16:00.** Gray Area install starts **Wed 22 Oct**.

bitcube is the Windows mini PC that drives **A River Becoming**: 20 LED ropes over Art-Net, the HUB75 panels over HDMI, and the Reolink cameras. It runs TouchDesigner and a Claude Code session.

## Where we are
- **Working:**
  - **Local rain checkpoint** (`river-local-oct-18.toe`, no Modal): one rain/river field in the camera's view, sampled onto every pixel of the 18 working ropes and onto HUB75 quad 1. Every rope pixel's position comes from a camera structured-light pixel map (`tools/pixelmap/`). About 70–200 W in total.
  - **Camera calibration:** 18 of 20 ropes located, colour order confirmed. **Ropes 9 and 17 never light** (swap test deferred).
  - Both cameras are reachable. bitcube boots straight into the show (about 1 minute) and is on Tailscale. *After a reboot it opens `river.toe` (ropes black), not the checkpoint.*
- **Next:**
  1. Feed Dave's Modal visuals into the ropes and panels through the same pixel map.
  2. Connect quad 2, and fix ropes 9 and 17.
  3. Push the cameras into Dave's agent.
  4. Re-map once the ropes are hung at Gray Area.

![Rain checkpoint on the coiled ropes and HUB75, 18 Oct 15:57](img/rain-checkpoint-2026-10-18.jpg)

How we'll get there, session by session: **[execution plan](execution-plan.md)**. Full checklist and **open questions** (some are waiting on Dave, Andi and Will): **[plan](plan.md)**.

## Latest camera snapshot
![Latest gallery-cam snapshot](https://raw.githubusercontent.com/gavaiken/river-bitcube/snapshot/gallery.jpg)

*Updated every 15 minutes once item G is live. People in the room may appear.*

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
