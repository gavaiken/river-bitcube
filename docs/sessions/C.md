---
title: Session C progress
---

# Session C: housekeeping

## 2026-10-18 16:26 start: bitcube · Opus 5.5
(The execution plan names Sonnet 5 for this session; this conversation runs on Opus 5.5.)

Steps:
- **C1** Scheduled task `RiverSnapshot` (every 15 min, 08:00–02:00): gallery-cam still, ~640 px JPEG, force-pushed as `gallery.jpg` to orphan branch `snapshot` with the deploy key (one commit, amended each time). Pure parts tested with Pester.
- **C2** Status page: no broken image before the branch exists (fallback to the checkpoint still), then confirm the live snapshot shows.
- **C3** `td/build/build_panels.py`: panels window covers the whole 1920×1080 LED display in black with the atlas at top-left. Rebuild and save in `river-local-oct-18.toe` and `river.toe`, reopen the autostart file, verify by gallery-cam frame.

Progress:
- 16:37 C1 ✅ `tools/snapshot.ps1` + scheduled task `RiverSnapshot` (`tools/snapshot_task.ps1`: daily 08:00, every 15 min for 18 h, run through `conhost --headless` so no window appears). Each run pushes one parentless commit to `snapshot` from a bare repo in `%LOCALAPPDATA%\river-snapshot`, never touching this checkout. 640×360, about 60 KB, 2–3 s per run. Registering it as S4U (runs with nobody logged in) needs an elevated shell, so it's an Interactive task: it runs while the auto-logged-in user is signed in. 13 new Pester tests pass. (commit b7affbf)
- 16:38 C2 ✅ `docs/index.md`: the `<img>` starts as the checkpoint still and switches to the live snapshot only after it loads; the caption shows "Taken …" from the GitHub API. Checked in headless Chrome: the live page shows the 16:36 snapshot, and a copy pointing at a missing branch shows the checkpoint still with a note, not a broken image. Plan item G ticked. (commit 4b5eb6f)
- 16:50 C3 ✅ `panels/window` now shows `panels/screen`, a black Container COMP sized to the LED monitor (1920×1080), with an `atlas` child showing `panel_out` at native pixels pinned to the top-left. It's a container because the Non-Commercial key caps TOPs at 1280×1280. Rebuilt and saved in `river-local-oct-18.toe`, then `river.toe`, then reloaded `river.toe` (the autostart file) from disk: the window comes back at 1920×1080. DPI-aware capture of the LED display: content only at x 0–255, y 0–127 (pixel-exact), the rest black. Gallery cam: only quad 1's test pattern on the HUB75 ([still](../img/hub75-full-window-2026-10-18.jpg)). Plan item B ticked. (commit 4c40b0e)
- 16:50 **Bug found and fixed (outside C's scope, needed to leave the ropes safe):** after loading `river.toe`, the rope sender sent nothing. `absTime` restarts at 0 on load, but `last_send` (6365 s) came back from `comp.storage` in the `.toe`, so `tick()` waited about 1¾ h. Meanwhile the hardware played its own program, and the coils went **full red for about a minute** (16:44). A reboot would do the same. Fixed in `artnet_out.tick` (a `last_send` ahead of the clock is reset). Verified with save and reload: Art-Net resumes 1.4 s after load, and the camera shows the ropes dark. (commit 4c40b0e)

### Waiting on Gavin
- ~~**TD now runs `river.toe`** (ropes black, panels test pattern), as the C3 prompt asked, so the rain checkpoint isn't showing.~~ **Resolved 16:54** (session A, Gavin's call): the autostart now opens `river-local-oct-18.toe`, and a restart brought the rain back by itself.
- Optional: to make `RiverSnapshot` run with nobody logged in, run `tools\snapshot_task.ps1` once from an elevated PowerShell (it registers as S4U then). Not needed while auto-login is on.

### SESSION C SUMMARY — 2026-10-18 16:50
Done:
- C1: scheduled task `RiverSnapshot` (08:00–02:00, every 15 min, windowless) runs `tools/snapshot.ps1`. It force-pushes a 640×360 gallery still as `gallery.jpg` to orphan branch `snapshot`, always one parentless commit. Pester tests (18 in total pass).
- C2: the status page shows the live snapshot with its time, and falls back to the checkpoint still, never a broken image. Checked live and with a missing branch.
- C3: the panels window covers the whole 1920×1080 LED display in black, with the atlas pixel-exact at top-left, in both show files. Verified by desktop capture and gallery cam.
- Extra: fixed the rope sender stalling after a project load or reboot (`artnet_out.tick`).

Not done / blocked: none.

Evidence: commits b7affbf (C1), 4b5eb6f (C2), 4c40b0e (C3 + sender fix); `docs/img/hub75-full-window-2026-10-18.jpg`; branch `snapshot`; `%LOCALAPPDATA%\river-snapshot\snapshot.log`.

Hardware state now: TD runs `river.toe`. Ropes Active, Source black, sending (dark). Panels window full-screen on the LED display, quad 1 test pattern, quad 2 blanked. `RiverSnapshot` task active, next run on the quarter hour. RopeLights still stopped.

Decisions or answers needed from Gavin/team: whether to switch TD back to the rain checkpoint (`river-local-oct-18.toe`) now, and whether the autostart should open it. Optional: elevated re-registration of the snapshot task as S4U.

Suggested next step: D1 when Dave answers; otherwise Gavin decides which show file runs.
