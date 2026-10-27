---
title: A River Becoming: show machine status
---

# Welcome to bitcube

**A River Becoming** is an installation by **Colin, Justine, Andi, Lilian, Will, Dave and Gavin**, for Gray Area, San Francisco (October 2026). This site is the team's working notes for bitcube, the show machine.

**[Show files](show-files.md)** (what the piece is doing) · **[Where things stand](https://github.com/gavaiken/river-bitcube/blob/main/HANDOFF.md)** (the handoff) · **[Rules for agents](https://github.com/gavaiken/river-bitcube/blob/main/AGENTS.md)** · **[Hardware](a-river-becoming-hardware.md)** · **[System map](system/)** (every device, IP and connection; [system.json](system/system.json) for agents) · **[Ceiling install](ceiling.md)** · **[Mission control](mission-ui.md)** (the team's web app: how its pages read and why)

**Status as of Mon 26 Oct 2026.** At Gray Area, the river's year remains the default. Will's new [Combined v0](files/river-combined-v0.md) adds live river video (recorded fallback), a fixed summer treatment and Dave's adjustable canvas overlay. Select it through mission control's What's showing card; its overlay slider appears while it runs.

bitcube is the Windows mini PC that drives **A River Becoming**: 20 LED ropes over Art-Net, the HUB75 panels over HDMI, and the Reolink cameras. It runs TouchDesigner and a Claude Code session.

## Where we are
- **The river's year** is the default: recorded river through the seasons, with automatic, people-driven or manual steering. It works without Modal or the live river site.
- **The live river** combines live river video, Dave's Modal decisions and his animated canvas.
- **Combined v0** is Will's independent visualization: live video with recorded fallback, fixed summer, and an additive Modal canvas overlay. No audio or gallery interaction yet. The baseline remains available for making other visualizations.
- **Verified 26 Oct:** combined-v0 built at about 60 fps with no project errors; live input, recorded fallback and overlay values 0%, 25% and 100% exercised. Existing rope brightness and power caps retained. All show files use their own pinned calibration.
- **Controls:** mission control → Change → choose a show → Switch. Back to default returns to the river's year. Switching leaves the default unchanged.

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
- **Claude:** a Claude terminal opens at login in `C:\Users\user\River`. Otherwise open PowerShell, `cd C:\Users\user\River`, and run `claude`. It reads `AGENTS.md` (the rules every agent follows), `HANDOFF.md` and the docs first.
- **Don't** shut bitcube down; restart instead. **Don't** run Will's RopeLights while TouchDesigner drives the ropes.

## Archive
- [Execution plan](execution-plan.md): status table, sessions and copy-paste prompts.
- [Running log](a-river-becoming-log.md): everything done so far, session by session.
- [Hardware reference](a-river-becoming-hardware.md): ropes, PSAC10 boxes, controller, panels, cameras.
- [Design notes](a-river-becoming-notes.md): from the team meetings.
- Code: [github.com/gavaiken/river-bitcube](https://github.com/gavaiken/river-bitcube) · Dave's agent: github.com/drocamor/river-agent (private).
