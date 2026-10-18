---
title: Execution plan
---

# Execution plan: from today's hardware to the full Modal-driven show

## Context
bitcube now boots into TouchDesigner (TD) and drives 18 of 20 ropes (Art-Net) and HUB75 quad 1 (HDMI, verified by camera). The gallery cam (Agape WiFi, `10.0.7.76`) sees every coil pile and the HUB75. Rope ID, colour order and the panel test pattern are calibrated. The repo `gavaiken/river-bitcube` is public, with the status page, `docs/plan.md` and the log.

Gavin's goal: everything working end to end, including Dave's Modal agent. First comes a **checkpoint**: a new, self-contained TD file, **`river-local-oct-18.toe`**, that makes a coherent rain/river appear across the ropes and HUB75 *as they sit now*, mapped by their real positions, with no Modal or other outside input. Gavin won't move the hardware during that step, and he's checking the cables of the two dark ropes (9 = box 1 OUT9, 17 = box 2 OUT7) meanwhile.

The ropes are coiled in four piles, so we don't know where each of the 8,000 pixels physically is. **Key idea:** measure it with the camera. Structured light (Gray-code patterns) lets the camera decode, for every visible LED pixel, which rope and which pixel index it is. That gives a pixel → camera-image map in about 2 minutes. Then render one rain/river field in the camera's view, and sample it at each pixel's position (and across the HUB75's rectangle). From the camera's viewpoint, which stands in for a visitor's, rain falls coherently through the coils and the panels. The same tool remaps everything after the install at Gray Area (plan item J), so it isn't throwaway work.

## How to run the sessions
- **Where:** do device work in **Claude Code on bitcube**: the terminal opened at login in `C:\Users\user\River`, or PowerShell → `cd C:\Users\user\River\river-bitcube` → `claude`. Use the **Mac mini** Claude only for docs, GitHub, Signal and checking from outside.
- **New conversation per session.** This mini conversation is very long, so start fresh each time; the repo carries the context (`CLAUDE.md`, `docs/plan.md`, the log). In an existing bitcube terminal, run `/clear` first. Only one Claude works at a time.
- **Model:** **Opus 5.5** for sessions with real design or debugging (1, 3, 4). **Sonnet 5** for well-specified, mechanical ones (2, 5). Switch with `/model`.
- **Mode:** start sessions 1, 3 and 4 in **plan mode** (Shift+Tab until it shows "plan mode") so you approve the approach first, then auto mode to execute.
- **Every session ends** by ticking `docs/plan.md`, updating `docs/index.md` + the log, and pushing (already the rule in `CLAUDE.md`).

## Session 0 (now, Gavin, no Claude needed)
Check ropes 9 and 17: plugs, adapter cables, OUT9 on box 1 and OUT7 on box 2 (try swapping a known-good rope onto those ports to tell a port fault from a rope fault). Then, from any Claude session, re-run `tools\rope_capture.ps1 -Cam gallery` + `tools/rope_identify.py` to confirm all 20.

## Session 1: local rain checkpoint `river-local-oct-18.toe` (bitcube, Opus 5.5, plan mode)
**Skills:** `mattpocock-skills:tdd` for the pure Python (Gray-code encode/decode, map clean-up and interpolation, at the `tools/pixelmap/*.py` seam), `mattpocock-skills:diagnosing-bugs` if hardware output misbehaves, `code-review` at the end. Optional: `mattpocock-skills:prototype` for a quick look-and-feel pass on the visual before polishing.

**Prompt to paste:**
```
Read CLAUDE.md, docs/plan.md and the end of docs/a-river-becoming-log.md, then git pull. Goal for this session: a CHECKPOINT — a new, self-contained TouchDesigner file C:\Users\user\River\river-bitcube\river-local-oct-18.toe that makes a beautiful, coherent rain/river appear across ALL working hardware (the 18–20 lit ropes over Art-Net and HUB75 quad 1 over HDMI), mapped by where the pixels physically are right now. No Modal, no web, no outside input. Gavin will not move the ropes, HUB75 or gallery camera during this session. Start in plan mode and show me the plan first.

Approach (adapt if you find better):
1. Pixel map by structured light, using the gallery cam (secrets.local.json 'gallery', aimed at all coils + HUB75; don't move it — tools/cameras/ptz.py exists but leave the aim alone).
   - New tools/pixelmap/: capture script (PowerShell or Python) that drives /project1/ropes (or a test source you add to td/ropes/artnet_out.py) through Gray-code patterns encoding rope index (5 bits) and pixel index (9 bits), each bit plus its inverse, plus black/white references; one camera frame per pattern (keep one ffmpeg RTSP reader open if per-frame connects are too slow). Brightness ≤ the 0.4 cap, never full white on all ropes at once.
   - Decoder (Python 3.13 + numpy/pillow — pip install into a venv under river-bitcube, gitignored): per camera pixel → (rope, px) with confidence; per (rope, px) → median camera (u,v). Fill pixels hidden inside coils by interpolating along the rope between visible neighbours; ropes 9/17 if still dark get no samples. Write tools/pixelmap/pixelmap-<date>.json (rope, px, u, v, visible) and an annotated overlay image in frames/. Pure functions under TDD with pytest.
   - Also find the HUB75's 4 corners in camera space from the panels test pattern (Source='test').
2. River/rain field in camera space in the new .toe — NO custom GLSL (Intel Iris Xe hangs; see CLAUDE.md gotchas). Built-in TOPs only: Noise/Ramp/Feedback/Transform/Level/Composite. Something that reads as rain falling (streaks moving down) blended with a slow river flow (horizontal drift, breathing brightness between blue/teal and white highlights), on black. High contrast, black background, slow enough to feel calm, with a few visible "drops" travelling through the coil piles top to bottom.
3. Sampling: TOP to CHOP with UV input from the pixel map (8000 samples) → CHOP to TOP shaped 20×400 (column per rope, row 0 = plug end, matching /project1/ropes/rope_tex) → set the ropes COMP's Canvas parameter to it (Source='canvas', crops 0..1). For the HUB75: perspective-correct the field's quad-1 region from the camera corners to 256×128 and feed panels Quad1 (Source='canvas').
4. Build river-local-oct-18.toe from a copy of river.toe so it keeps the bridge, ropes and panels COMPs; build the new network with an idempotent td/build/build_river_local.py. Save only with tools\td_save.ps1 (extend it with a -Target parameter for this file). Do NOT change the login autostart (Start-River.cmd keeps opening river.toe) unless I say so.
5. Verify with the camera: grab frames/clips of the result (tools\cam_snap.ps1 gallery, a short ffmpeg clip), confirm the motion is coherent across piles and the HUB75, and iterate on the look. Report power (artnet_out status watts) and fps.
6. Finish: add a docs/img checkpoint still (no people in it), tick a new plan item L "Local rain checkpoint", update docs/index.md and the log, commit and push in small steps. Ask before anything outside TD and the repo.
```
**Done when:** the ropes and HUB75 show one continuous rain/river that moves coherently when seen from the camera; there's a checkpoint photo on the status page; `pixelmap-<date>.json` and the tools are in the repo.

## Session 2: housekeeping (bitcube, Sonnet 5)
**Skills:** `mattpocock-skills:tdd` for the snapshot script's pure parts, `code-review`.

**Prompt:**
```
Read CLAUDE.md and docs/plan.md, git pull. Do plan items G and the rest of B:
- G: a scheduled task (every 15 min, 08:00–02:00) that grabs a gallery-cam still (~640 px wide JPEG), and force-pushes it as gallery.jpg to an orphan branch `snapshot` of this repo via the deploy key (no history growth: one commit, amended). docs/index.md already embeds raw.githubusercontent.com/gavaiken/river-bitcube/snapshot/gallery.jpg — until the first push, the image is broken; make the page show a placeholder or the latest calibration image instead, then switch back once live.
- B remainder: make the panels window cover the whole LED display (1920×1080) in black with the panel atlas at its top-left, in td/build/build_panels.py, so nothing else can ever appear on the HUB75.
Tick both in docs/plan.md, update docs/index.md and the log, commit and push.
```

## Session 3: Dave's visuals on the hardware (bitcube, Opus 5.5, plan mode; after Dave answers the open questions)
**Skills:** `mattpocock-skills:diagnosing-bugs`, `code-review`.

**Prompt:**
```
Read CLAUDE.md, docs/plan.md (item C and the open questions to Dave) and ..\river-agent\CLAUDE.md, docs/gallery-kit.md, gallery/sync.py, tools/site.py, web/canvas.html. git pull both repos (river-agent may need pulling via the Mac mini — bitcube has no credentials for it).
Goal: Dave's Modal agent drives the ropes and HUB75 through the same pixel-map sampling as river-local-oct-18.
1. Run river-agent's gallery/sync.py + site.py serve on bitcube on port 8770 (8765 is RopeLights), as a login task; venv under river-agent (gitignored); any SITE_TOKEN in river-bitcube\secrets.local.json.
2. In river.toe: Web Render TOP of http://127.0.0.1:8770/canvas.html?w=..&h=.. (pick a design size suited to the camera-space field), feeding the same UV sampling to ropes and HUB75 as river-local-oct-18 (reuse its build script; make the source switchable: local rain / Dave's canvas).
3. Fallback: if the mirror or canvas stalls (no new frames for N s), crossfade to the local rain — never let the ropes fall back to the hardware colour cycle.
4. Verify by forcing a scene change (edit the local mirror's state.json), with camera clips as evidence. Measure fps/CPU on the Iris Xe; if the Web Render TOP is too heavy, write up Dave's documented fallback (render the 8 animations natively from state.json + reflex.json) as a plan item instead.
Tick C, update index + log, push.
```

## Session 4: cameras into Dave's agent (bitcube, Opus 5.5; needs `INGEST_TOKEN` from Dave)
**Prompt:**
```
Read CLAUDE.md, docs/plan.md item D and ..\river-agent\capture\capture.py + modal_deploy/app.py (/ingest). Put INGEST_TOKEN in secrets.local.json (never in git). Run capture.py on bitcube for the gallery cam (location/channel names and cadence as Dave answered in plan.md) as a resilient scheduled task with logging and backoff; add the river cam when it's at the river (its Starlink kit pushes on its own or via the GL.iNet router — check with Will). Verify on Modal: /data/status.json sensor freshness updates and reflex.json reacts. Tick D, update index + log, push.
```

## Session 5: comms and docs (Mac mini, Sonnet 5, any time)
**Prompt:**
```
cd ~/claude/Source/river-bitcube && git pull. Re-export the Signal group "A river becoming" (Signal Desktop must be running), fold any answers into docs/plan.md open questions, and draft a short Signal update for the team from docs/index.md (I'll send it). Push doc changes.
```

## Later, at Gray Area (Oct 22–27)
Rerun the Session 1 pixel-mapping tool once the ropes and HUB75 are hung (this is plan item J, real hang paths). Re-aim or re-position the gallery cam for a viewer's eye height. Confirm the dual-NIC gallery network and the camera's network (open questions to Will).

## Verification of the whole path
- **Checkpoint:** camera clip of coherent rain across all piles and the HUB75; status page photo.
- **End to end:** a Modal scene change visibly changes ropes and HUB75 within a tick. Unplug bitcube's internet: the last scene keeps playing, then crossfades to local rain. Reboot: everything comes back by itself (boot fix, auto-login, launchers already verified).
