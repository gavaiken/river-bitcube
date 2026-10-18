---
title: A River Becoming: show machine status
---

# Welcome to bitcube

**Status as of Sun 18 Oct 2026, 13:00.** Gray Area install starts **Wed 22 Oct**.

bitcube is the Windows mini PC that drives **A River Becoming**: 20 LED ropes over Art-Net, the HUB75 panels over HDMI, and the Reolink cameras. It runs TouchDesigner and a Claude Code session.

## Where we are
- **Working:**
  - TouchDesigner drives all 20 ropes and HUB75 quad 1 from one show file.
  - Both cameras are reachable.
  - bitcube boots straight into the show (about 1 minute) and is on Tailscale.
- **In progress:**
  - The panels window is moving to the LED display (it currently lands on the USB-C monitor).
  - This status page.
- **Next:**
  1. Identify the ropes automatically with the camera.
  2. Feed Dave's Modal visuals into the ropes and panels.
  3. Connect quad 2.
  4. Push the cameras into Dave's agent.

Full checklist and **open questions** (some are waiting on Dave, Andi and Will): **[plan](plan.md)**.

## Latest camera snapshot
![Latest gallery-cam snapshot](https://raw.githubusercontent.com/gavaiken/river-bitcube/snapshot/gallery.jpg)

*Updated every 15 minutes once item G is live. People in the room may appear.*

## Using bitcube
- **Look at it:** VNC to `bitcube.tail03bc1a.ts.net` (needs access to Will's Tailscale network). VNC shows the real screens; avoid RDP, which blanks the panels.
- **Files:** `\\bitcube\River` (Finder: Network → bitcube → River).
- **Claude:** a Claude terminal opens at login in `C:\Users\user\River`. Otherwise open PowerShell, `cd C:\Users\user\River`, and run `claude`. It reads `CLAUDE.md` and the docs first.
- **Don't** shut bitcube down; restart instead. **Don't** run Will's RopeLights while TouchDesigner drives the ropes.

## Archive
- [Running log](a-river-becoming-log.md): everything done so far, session by session.
- [Hardware reference](a-river-becoming-hardware.md): ropes, PSAC10 boxes, controller, panels, cameras.
- [Design notes](a-river-becoming-notes.md): from the team meetings.
- Code: [github.com/gavaiken/river-bitcube](https://github.com/gavaiken/river-bitcube) · Dave's agent: github.com/drocamor/river-agent (private).
