---
title: Session B plan
---

*Approved by Gavin 18 Oct 15:36 (with session A review 15:45: no all-ropes white frame; lit mask from bit/inverse pairs). Progress: [B.md](B.md).*

# Session B plan: local rain checkpoint (`river-local-oct-18.toe`)

## Context
Plan item L. Today TD sends Art-Net to 20 ropes (18 light; ropes 9 and 17, 1-based, are dark) and HDMI to HUB75 quad 1. Rope positions are only known per pile (rope map, 14:11). The goal is a self-contained checkpoint that needs no Modal or web: a camera-space rain/river field, sampled onto every rope pixel at the point where the gallery camera sees it, plus HUB75 quad 1. Seen from the camera, the result should read as one coherent piece.

State found (14:47): TD 2025.33230 is running `river.toe` at 60 fps with the bridge OK. Ropes are `Active`, `Source=black`, 0 W. Panels are `Source=test` with the window open. The gallery cam is H.264 2880×1616 @ 40 fps. The repo is clean at `4a4f464`. The room is sunny and people walk through.

## Step 0: coordination (before B1)
- `git pull`. Create `docs/sessions/B.md` (header `## 2026-10-18 HH:MM start: bitcube · Opus 5.5` plus the step list B1–B8 below). In `docs/execution-plan.md`, split the B row into B1…B8 (➡️). Commit and push.
- After **every** step: a progress line in `B.md` with the commit hash, the Status-table mark, and a push. Decisions go under `### Waiting on Gavin`.
- Add `.venv/` to `.gitignore`. Create `river-bitcube\.venv` (py 3.13) with numpy, pillow and pytest, plus `tools/pixelmap/requirements.txt`.

## B1: structured-light capture
**TD side** (`td/ropes/artnet_out.py`, `td/build/build_ropes.py`):
- Pure `gray_frame(ropes, pixels, bit, invert)`. Bits 0–4 encode Gray(rope index 0–19). Bits 5–13 encode Gray(pixel index 0–399). Lit = white.
- New Sources `gray` (new pars `Graybit` 0–13 and `Grayinvert`) and `white`. Rebuild the menu with `build_ropes.py` (it is idempotent and only appends missing pars).

**`tools/pixelmap/graycode.py`** (pure): `gray(n)` and `ungray(g)`, plus the pattern list: `black`, `white`, then 14 × (bit, inverse) = 30 patterns.

**`tools/pixelmap/capture.py`** (venv Python):
- Keeps **one** ffmpeg RTSP reader open (`-rtsp_transport tcp`, scaled to 1440×808, rawvideo pipe). A thread keeps the latest frame.
- Sets each pattern in a single bridge POST to `127.0.0.1:9980/exec`, so Source, bit and invert change atomically.
- **Latency:** at the start it measures the black→white step delay. Settle time = measured delay + margin, including camera auto-exposure.
- Per pattern it averages 3 frames. It runs pass A over all patterns, then pass B, so a person walking through hits different patterns in each pass. If more than X% of the lit area differs between A and B for a pattern, it retakes that pattern (up to 3 tries).
- Brightness is 0.4, the cap. Half-lit patterns come to about 300 W/box; the white reference reaches the 600 W/box limiter.
- Writes `frames/pixelmap-<stamp>/{A,B}/<pattern>.png` and `meta.json`, and records drift (black at start vs black at end).
- Ends with the ropes on `black` and Brightness restored. Takes about 2–3 minutes.

## B2: decoder and pixel map (TDD, pytest)
`tools/pixelmap/decode.py`: pure functions, each written test-first against synthetic frames in `tools/pixelmap/tests/`.
- `lit_mask(white, black)`: the camera pixels that rope light reaches.
- `decode_bits(pos, neg)`: bit = sign(pos − neg), confidence = |pos − neg| / (white − black).
- `disagreement_mask(A, B)`: drops camera pixels where the two passes differ, such as a person moving.
- `decode(frames)`: per camera pixel → (rope, px, conf). All 5 rope bits must be confident. Pixel bits may let the lowest 1–2 bits run weak; that is recorded in conf.
- `aggregate(...)`: per (rope, px) → confidence-weighted **median** (u, v) and a sample count. Visible means count ≥ N.
- `reject_outliers(...)`: drops points far from the median of their along-rope neighbours, such as floor reflections and stray decodes.
- `fill_along_rope(...)`: linear interpolation between visible neighbours. Ends hold the nearest visible point. Ropes with no samples are left out.
- CLI writes `tools/pixelmap/pixelmap-2026-10-18.json` (meta: camera, resolution, capture stamp, drift, UV convention; points: `rope` 0-based, `px`, `u`, `v` normalised in TD convention with origin bottom-left, `visible`). It also writes `frames/pixelmap-<stamp>/overlay.png`: decoded pixels coloured by rope, with the px gradient as brightness and rope labels.
- Reports per rope: visible count and filled count. Expect ropes 8 and 16 (0-based) to be absent.

## B3: HUB75 corners
`tools/pixelmap/hub75.py` (pure plus TDD; capture reuses the reader in `capture.py`):
- Captures panels `Source=test` vs `black`, twice each, ropes black.
- Takes the largest lit blob in the difference image. Corners are its extreme points (min/max of x+y and x−y). Red (top-left panel with marker) fixes the orientation. The four panel-colour centroids cross-check the corners through a homography.
- Writes the corners (TL, TR, BL, BR, normalised UV) into the pixel-map JSON under `hub75_quad1`, and adds them to the overlay.

## B4: rain/river field (built-in TOPs only, no GLSL)
`/project1/river_local` base COMP, field 1280×720 (camera aspect; the Non-Commercial cap is 1280):
- **River:** Noise TOP (simplex, about 2 octaves, large period stretched horizontally). Its `tx` drifts with `absTime` (slow) and `tz` evolves it. Then a Level TOP for contrast, so about half the area is black. Then a Lookup TOP with a Ramp TOP: black → deep blue → teal → white highlights. **Breathing:** the Level brightness expression is `0.6 + 0.25*sin(2π·absTime/12)`.
- **Rain:** a sparse "drop seeds" Noise TOP (random, thresholded by Level) is composited into a **Feedback** loop: a Transform TOP moves it down a few pixels each frame, a Level TOP fades it (about 0.88), and Composite adds the new seeds. The result is falling streaks with bright heads that travel down through the coil piles. Tinted blue-white.
- Composite (add): rain over a dimmed river, then a final Level (gain and black clamp), then a slight Blur so the point samples don't alias. `null` `field_out`.
- Parameters on the COMP (`Rainspeed`, `Raindensity`, `Flowspeed`, `Breathe`, `Gain`) so B7 can tune them live.

## B5: sampling
- **UVs:** a Table DAT **stored inside the .toe** (not file-synced, so the file is self-contained) with 8,000 rows ordered rope-major (`rope*400+px`) and columns `u` and `v`. Ropes with no mapping get u = v = −1. DAT to CHOP gives channels `u` and `v`.
- **TOP to CHOP** (`field_out`, with the UV CHOP connected to its input; verified that it has one CHOP input, `interp` linear, and extend = `default` with `defcolor` 0, so −1 samples as black) outputs r, g, b × 8,000 samples. Then a Shuffle CHOP splits them into 20 groups of 400. CHOP to TOP (RGB per row) gives 400×20, and a Flip TOP (flop) turns it into **20×400** `rope_canvas` with the top row = px 0 (plug end), which is what `canvas_frame()` expects.
  - *Fallback if the reshape fights back:* a Remap TOP driven by a 20×400 float UV texture built once from the same table. It is built in and has no GLSL.
  - **Check:** a script samples `field_out.numpyArray()` at the table's UVs in numpy and compares the result with `artnet_out.canvas_frame(rope_tex)`. Max error should be ≤ 2/255.
- `/project1/ropes`: `Canvas = /project1/river_local/rope_canvas`, crops 0…1, `Source=canvas`.
- **HUB75:** a Corner Pin TOP (extract mode, using the B3 corners from the table) takes `field_out` to 256×128 as `quad1`. Panels get `Quad1` = that TOP, `Quad2` = a black Constant TOP, `Quad2off` on, and `Source=canvas`.

## B6: show file and build script
- `tools/td_save.ps1`: add `-Target <name.toe>`. **The default becomes the currently open project file** (not hard-coded `river.toe`), so a plain save in the local file can never overwrite `river.toe`. Keep the `general.inc` check, the timestamp check and the stray-`<base>.N.toe` cleanup per target.
- Sequence:
  1. Confirm `river.toe` is clean in git.
  2. Run `td_save.ps1 -Target river-local-oct-18.toe`. This is a Save As of the running river.toe, which is unchanged except for live state, and TD now runs the copy.
  3. Run `td.ps1 -File td/build/build_ropes.py`, then the new **`td/build/build_river_local.py`**. It is idempotent: it creates or updates `/project1/river_local`, loads the pixel-map JSON into the Table DAT, deactivates Andi's `Mask_Panels/webrender1` (no web) and wires ropes and panels.
  4. Save via `td_save.ps1`.
- `river.toe` on disk stays untouched, and the login autostart is **not** changed. After a reboot, river.toe opens with ropes black and the panels' test pattern. Commit `river-local-oct-18.toe` (the gitignore's `*.[0-9]*.toe` doesn't match it).
- Save **before** first cooking the new network, in line with the TDR lesson, even though it has no GLSL.

## B7: verify and tune
- `tools\cam_snap.ps1 gallery` stills, plus a 10 s ffmpeg clip into `frames/`. Look for drops travelling down every pile and across the HUB75 in step, the river drift reading left to right, a black background and no flicker.
- Tune live with the COMP parameters: rope `Brightness` (≤ 0.4) and panels `Brightness` to balance the HUB75 against the ropes.
- Report `artnet_out.status()` watts per box, `project.cookRate` and the actual fps over 10 s, and dropped frames. Save the tuned values into the build script's defaults and the .toe.

## B8: docs and wrap-up
- Pick a frame with **no people** in it (checked by eye), resize it to about 1280 px JPEG, and save it as `docs/img/rain-checkpoint-2026-10-18.jpg`. Optionally add an overlay image if it is people-free.
- Update `docs/index.md` (still image, "Status as of" line, Next list), tick **L** in `docs/plan.md`, add a log entry (including the new td_save default and the gray/white sources), and refresh the CLAUDE.md facts if useful.
- Run `/code-review` on the session's diff and fix findings. Add the SESSION SUMMARY to `B.md`, push, and print it.
- **End state:** TD runs `river-local-oct-18.toe` with the rain on the ropes and quad 1. Autostart still points at river.toe.

## Files
- New: `tools/pixelmap/{graycode,capture,decode,hub75}.py`, `tools/pixelmap/tests/test_*.py`, `tools/pixelmap/requirements.txt`, `tools/pixelmap/pixelmap-2026-10-18.json`, `td/build/build_river_local.py`, `river-local-oct-18.toe`, `docs/sessions/B.md`, `docs/img/rain-checkpoint-2026-10-18.jpg`.
- Edited: `td/ropes/artnet_out.py` (gray/white sources), `td/build/build_ropes.py` (menu and pars), `tools/td_save.ps1` (`-Target`), `.gitignore` (`.venv/`), docs (`plan.md`, `index.md`, `execution-plan.md`, log).
- Reused: `tools/td.ps1`, `cam_snap.ps1`, `artnet_out.canvas_frame/status`, `build_panels.py` Source/Quad pars, and the median/drift ideas from `rope_identify.py`.

## Verification
- `.venv\Scripts\python -m pytest tools/pixelmap -q`: all green before running on real data.
- Pixel-map sanity: the overlay matches the rope map piles (right pile 1/4/8/10, and so on); per-rope visible counts; drift below about 15.
- Numeric sampling check (B5): field vs `rope_tex` within 2/255.
- Camera evidence (B7): stills plus a clip showing coherent falling drops across all piles and the HUB75. Watts and fps reported.

## Risks I'll handle as they come
- Camera auto-exposure shifts between patterns. Decoding uses the sign of bit vs inverse, and the settle time covers AE. Camera settings won't be changed without asking.
- Sun and floor reflections give a second cluster per pixel. The median plus the neighbour outlier filter handle it.
- Pixels deep inside coils are hidden; interpolation along the rope fills them.
