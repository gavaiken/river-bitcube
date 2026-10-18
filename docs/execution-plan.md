---
title: Execution plan
---

# Execution plan: from today's hardware to the full Modal-driven show

**Updated Sun 18 Oct 2026, 16:15, by session A (coordinator).**

## Status
✅ done · ➡️ next (in order) · ❌ blocked

| | Step | What | Session (machine · model) | Owner |
|---|---|---|---|---|
| ✅ | A1 | Public repo and status page, `plan.md`, coordination rules | A (Mac mini · Opus 5.5) | Claude |
| ✅ | A2 | Rope identification by camera (18/20 located, colour order RGB) and HUB75 quad 1 test pattern verified | A (Mac mini · Opus 5.5) | Claude |
| ✅ | A3 | Status page opens in Chrome at login (plan item F) | A (Mac mini · Opus 5.5) | Claude |
| ✅ | A4 | This execution plan | A (Mac mini · Opus 5.5) | Claude |
| ✅ | A5 | Recheck ropes 9 and 17 after cables were tightened: **still dark** (14:33 run) | A (Mac mini · Opus 5.5) | Claude |
| ❌ | P1 | Swap test for ropes 9 and 17. *Deferred by Gavin (18 Oct): carry on with 18 ropes* | Gavin, in person | Gavin |
| ✅ | B1 | **Checkpoint** ([plan](sessions/B-plan.md), [progress](sessions/B.md)): structured-light capture of all ropes with the gallery cam | B (bitcube · Opus 5.5) | Claude |
| ✅ | B2 | Decoder + pixel map `tools/pixelmap/pixelmap-2026-10-18.json` (TDD) | B (bitcube · Opus 5.5) | Claude |
| ✅ | B3 | HUB75 quad 1 corners in camera space | B (bitcube · Opus 5.5) | Claude |
| ✅ | B4 | Rain/river field in camera space (built-in TOPs) | B (bitcube · Opus 5.5) | Claude |
| ✅ | B5 | Sampling onto the ropes and HUB75 quad 1 | B (bitcube · Opus 5.5) | Claude |
| ✅ | B6 | `river-local-oct-18.toe` + `build_river_local.py` + `td_save.ps1 -Target` | B (bitcube · Opus 5.5) | Claude |
| ✅ | B7 | Verify by camera, tune, watts and fps | B (bitcube · Opus 5.5) | Claude |
| ✅ | B8 | Checkpoint still on the status page, tick L, summary | B (bitcube · Opus 5.5) | Claude |
| ✅ | C1 | Gallery-cam snapshot every 15 min (08:00–02:00), force-pushed to orphan branch `snapshot` | C (bitcube · Opus 5.5) | Claude |
| ✅ | C2 | Status page never shows a broken image; live snapshot confirmed | C (bitcube · Opus 5.5) | Claude |
| ➡️ | C3 | Panels window covers the whole LED display in black (both show files) | C (bitcube · Opus 5.5) | Claude |
| ❌ | D1–D4 | Dave's Modal visuals on the ropes and HUB75. *Blocked: waiting on Dave (OK to run `gallery/sync.py`; is `SITE_TOKEN` set?)* | D (bitcube · Opus 5.5) | Claude |
| ❌ | E1–E3 | Cameras pushing clips to Dave's agent. *Blocked: needs `INGEST_TOKEN` and channel names from Dave* | E (bitcube · Opus 5.5) | Claude |
| ❌ | P2 | Panel quad 2 connected. *Blocked: Andi (receive-card layout)* | Andi + Gavin, in person | Andi |
| ❌ | G1–G3 | Remap the hung installation at Gray Area. *Blocked: install starts Wed 22 Oct* | G (bitcube · Opus 5.5) | Claude |

Bitcube sessions update this table themselves, as they finish each step. Session A reads it on **sync**.

## How we work
- **Session A is the coordinator:** the Mac mini conversation Gavin keeps open. It tracks this plan, docs, GitHub and Signal, and doesn't touch devices while another session is working.
- **Sessions B–G each run in a fresh Claude Code conversation on bitcube:** the terminal opened at login in `C:\Users\user\River`, or PowerShell → `cd C:\Users\user\River\river-bitcube` → `claude`. In an existing terminal, `/clear` first. Set the model with `/model`. Start in **plan mode** (Shift+Tab) where marked, approve, then let it run in auto mode.
- **Only one Claude works at a time.** Every session starts with `git pull` and ends by ticking `docs/plan.md`, updating `docs/index.md` + the log, and pushing.
- **Coordination happens through the repo:** see the contract below. Gavin says **"sync"** to session A, which runs `git pull` and reports from the files. No copy-pasting needed.

## Coordination contract (every bitcube session follows this)
1. **Start:** `git pull`. Create or append `docs/sessions/<letter>.md` with a header line `## <date time> start: <machine> · <model>` and the steps you plan to do.
2. **After each step:**
   - Append a line to `docs/sessions/<letter>.md`: `- <time> <step id> ✅ <one line> (commit <hash>)`, or `❌ <why>` if blocked.
   - Set that step's mark in the Status table above (✅ done, ➡️ next, ❌ blocked). When a session has several steps, split its row (e.g. `B1`, `B2`…) as you go.
   - Commit and **push**.
3. **Keep the shared pages current:** tick `docs/plan.md`; refresh `docs/index.md` (the public status page; keep it to one screen and update its "Status as of" line); add a log entry for anything notable.
4. **Need a decision?** Write it under `### Waiting on Gavin` in your session file, push, and stop asking in the terminal only. Session A sees it on sync.
5. **End:** append the summary below to `docs/sessions/<letter>.md` and push. Also print it in the terminal.

```
### SESSION <letter> SUMMARY — <date, time>
Done: <step id> <one line each>
Not done / blocked: <step id> <why>
Evidence: <commit hashes, files, images>
Hardware state now: <ropes/panels showing what; anything left running>
Decisions or answers needed from Gavin/team: <list or "none">
Suggested next step: <step id>
```

## Step P1 (Gavin, deferred)
**P1.** Swap test for ropes 9 and 17:
1. Plug a rope that works into **box 1 OUT9**, and the rope from OUT9 into a working port. Same for **box 2 OUT7**.
2. Tell session A what changed.
3. Session A re-runs `tools\rope_capture.ps1 -Cam gallery` + `tools/rope_identify.py`. If the good rope lights on the "dead" port, the rope or its adapter is the fault; if not, the port or box is.

Don't move the gallery cam before session B. Its view changed between 14:11 and 14:33 (it was bumped), and B's pixel map depends on it staying put.

## Session B: local rain checkpoint (bitcube · Opus 5.5 · plan mode)
**Skills:** `mattpocock-skills:tdd` for the pure Python in `tools/pixelmap/`, `mattpocock-skills:diagnosing-bugs` if output misbehaves, `code-review` at the end. Optional: `mattpocock-skills:prototype` for a quick look-and-feel pass.

**Steps:**
- **B1:** structured-light capture.
- **B2:** decoder and pixel map (TDD).
- **B3:** HUB75 corners in camera space.
- **B4:** rain/river field.
- **B5:** sampling onto the ropes and HUB75.
- **B6:** build and save `river-local-oct-18.toe`.
- **B7:** verify with the camera and tune the look.
- **B8:** docs, push, summary.

**Prompt to paste:**
```
You are session B (bitcube · Opus 5.5). Read CLAUDE.md, docs/plan.md, docs/execution-plan.md and the end of docs/a-river-becoming-log.md, then git pull. Goal: steps B1–B8, a CHECKPOINT — a new, self-contained TouchDesigner file C:\Users\user\River\river-bitcube\river-local-oct-18.toe that makes a beautiful, coherent rain/river appear across ALL working hardware (the lit ropes over Art-Net — ropes 9 and 17 may still be dark — and HUB75 quad 1 over HDMI), mapped by where the pixels physically are right now. No Modal, no web, no outside input. Gavin will not move the ropes, HUB75 or gallery camera during this session. Ropes 9 and 17 are dark; ignore them (Gavin deferred the fix). Start in plan mode and show me the plan first. Put the approved plan's step list into docs/sessions/B.md and push before executing.

B1 Structured-light capture with the gallery cam (secrets.local.json 'gallery'; it sees all coils + the HUB75; don't re-aim it). New tools/pixelmap/: a capture script that drives /project1/ropes (add a test source to td/ropes/artnet_out.py if needed) through Gray-code patterns encoding rope index (5 bits) and pixel index (9 bits), each bit plus its inverse, plus black/white references; one camera frame per pattern (keep one ffmpeg RTSP reader open if per-frame connects are too slow). Brightness ≤ the 0.4 cap. People walk through the room: take each pattern twice and reject frames that disagree.
B2 Decoder (Python 3.13 + numpy/pillow in a gitignored venv under river-bitcube), pure functions under TDD with pytest: per camera pixel → (rope, px) with confidence; per (rope, px) → median camera (u,v). Fill pixels hidden inside coils by interpolating along the rope between visible neighbours; ropes with no samples are left out. Write tools/pixelmap/pixelmap-<date>.json (rope, px, u, v, visible) and an annotated overlay in frames/.
B3 Find the HUB75's 4 corners in camera space from the panels test pattern (panels Source='test').
B4 In a new TD network, a rain/river field in camera space — NO custom GLSL (Intel Iris Xe hangs; see CLAUDE.md gotchas). Built-in TOPs only: Noise/Ramp/Feedback/Transform/Level/Composite. It should read as rain (streaks falling) over a slow river flow (horizontal drift, brightness breathing between blue/teal and white highlights), on black, high contrast, calm, with visible drops travelling down through the coil piles.
B5 Sampling: TOP to CHOP with UV input from the pixel map → CHOP to TOP shaped 20×400 (column per rope, row 0 = plug end, as /project1/ropes/rope_tex expects) → the ropes COMP's Canvas parameter (Source='canvas', crops 0..1). For the HUB75, perspective-correct the field's quad-1 region from the B3 corners to 256×128 → panels Quad1 (Source='canvas').
B6 Make river-local-oct-18.toe from a copy of river.toe (keeps the bridge, ropes, panels COMPs); build the new network with an idempotent td/build/build_river_local.py. Save only via tools\td_save.ps1 (add a -Target parameter). Do NOT change the login autostart unless I say so.
B7 Verify with the camera (tools\cam_snap.ps1 gallery and a short ffmpeg clip): coherent motion across piles and the HUB75. Tune the look. Report Art-Net watts (artnet_out status) and fps.
B8 Add a docs/img checkpoint still (no people in it) to docs/index.md and tick plan item L. Ask before anything outside TD and the repo.
Follow the Coordination contract in docs/execution-plan.md throughout: docs/sessions/B.md progress lines and the Status table updated and pushed after EVERY step, the summary at the end.
```
**Done when:** the ropes and HUB75 show one continuous rain/river that moves coherently from the camera's viewpoint, the checkpoint photo is on the status page, and the pixel-map tools plus `pixelmap-<date>.json` are in the repo.

## Session C: housekeeping (bitcube · Sonnet 5)
**Skills:** `mattpocock-skills:tdd`, `code-review`.

**Steps:**
- **C1:** snapshot task.
- **C2:** status page image placeholder until C1 is live.
- **C3:** full black LED-display window.

**Prompt to paste:**
```
You are session C (bitcube · Sonnet 5). Read CLAUDE.md, docs/plan.md and docs/execution-plan.md, git pull. Do:
C1 A scheduled task (every 15 min, 08:00–02:00) that grabs a gallery-cam still (~640 px wide JPEG) and force-pushes it as gallery.jpg to an orphan branch `snapshot` of this repo via the deploy key (one commit, amended each time, no history growth). Test the pure parts with Pester or pytest.
C2 docs/index.md embeds raw.githubusercontent.com/gavaiken/river-bitcube/snapshot/gallery.jpg, which is broken until C1's first push. Make sure the page never shows a broken image (placeholder or latest calibration image until the branch exists), then confirm the live snapshot shows.
C3 In td/build/build_panels.py, make the panels window cover the whole LED display (1920×1080) in black with the panel atlas at its top-left, so nothing else can ever appear on the HUB75. Rebuild and save in BOTH show files: td_save.ps1 saves whichever file is open, so open river-local-oct-18.toe, rebuild, save; then open river.toe, rebuild, save; then reopen whichever file the login autostart uses (see Start-River.cmd). Verify with a gallery-cam frame that only the panel atlas shows on the HUB75.
Tick plan items G and B. Follow the Coordination contract in docs/execution-plan.md throughout (docs/sessions/C.md, Status table, push after every step, summary at the end).
```

## Session D: Dave's visuals on the hardware (bitcube · Opus 5.5 · plan mode)
*Blocked until Dave answers the open questions in `docs/plan.md`.* **Skills:** `mattpocock-skills:diagnosing-bugs`, `code-review`.

**Steps:**
- **D1:** local mirror of Dave's site on port 8770.
- **D2:** Web Render TOP → the same camera-space sampling as B.
- **D3:** switchable source, with fallback to local rain.
- **D4:** verify with a forced scene change, and check performance.

**Prompt to paste:**
```
You are session D (bitcube · Opus 5.5). Read CLAUDE.md, docs/plan.md (item C and Dave's answers), docs/execution-plan.md, and ..\river-agent\CLAUDE.md, docs/gallery-kit.md, gallery/sync.py, tools/site.py, web/canvas.html. git pull both repos (river-agent may need pulling via the Mac mini; bitcube has no credentials for it). Start in plan mode.
D1 Run river-agent's gallery/sync.py + site.py serve on bitcube on port 8770 (8765 is RopeLights) as a login task; venv under river-agent (gitignored); any SITE_TOKEN in river-bitcube\secrets.local.json.
D2 In river.toe: Web Render TOP of http://127.0.0.1:8770/canvas.html?w=..&h=.. (design size suited to the camera-space field), feeding the same pixel-map sampling to ropes and HUB75 as river-local-oct-18 (reuse td/build/build_river_local.py).
D3 Make the source switchable (local rain / Dave's canvas). If the canvas stalls (no new frames for N s), crossfade to local rain; never let the ropes fall back to the hardware's own colour cycle.
D4 Force a scene change (edit the local mirror's state.json) and capture camera clips as evidence. Measure fps/CPU on the Iris Xe; if the Web Render TOP is too heavy, write up Dave's documented fallback (native animations from state.json + reflex.json) as a plan item instead.
Tick plan item C. Follow the Coordination contract in docs/execution-plan.md throughout (docs/sessions/D.md, Status table, push after every step, summary at the end).
```

## Session E: cameras into Dave's agent (bitcube · Opus 5.5)
*Blocked until Dave provides `INGEST_TOKEN` and channel names.*

**Steps:**
- **E1:** token into `secrets.local.json`.
- **E2:** capture task for the gallery cam.
- **E3:** verify on Modal.

**Prompt to paste:**
```
You are session E (bitcube · Opus 5.5). Read CLAUDE.md, docs/plan.md item D, docs/execution-plan.md, ..\river-agent\capture\capture.py and modal_deploy/app.py (/ingest).
E1 Put INGEST_TOKEN in secrets.local.json (never in git).
E2 Run capture.py on bitcube for the gallery cam (location/channel names and cadence from Dave's answers in plan.md) as a resilient scheduled task with logging and backoff. Leave the river cam for when it's at the river (check with Will how its Starlink kit pushes).
E3 Verify on Modal: /data/status.json sensor freshness updates and reflex.json reacts.
Tick plan item D. Follow the Coordination contract in docs/execution-plan.md throughout (docs/sessions/E.md, Status table, push after every step, summary at the end).
```

## Session G: install at Gray Area (bitcube · Opus 5.5 · plan mode)
*From Wed 22 Oct.*

**Steps:**
- **G1:** re-run B1–B5 on the hung ropes and HUB75. This is plan item J, real hang paths.
- **G2:** re-aim the gallery cam to a visitor's eye height.
- **G3:** gallery network: bitcube's dual NIC, and the cameras' network (open questions to Will).

The prompt will be written by session A once the hang is done.

## Verification of the whole path
- **Checkpoint (B):** a camera clip of coherent rain across all piles and the HUB75, and the photo on the status page.
- **End to end (D/E):**
  - A Modal scene change visibly changes the ropes and HUB75 within a tick.
  - Cutting bitcube's internet: the last scene keeps playing, then crossfades to local rain.
  - A reboot brings everything back by itself.
