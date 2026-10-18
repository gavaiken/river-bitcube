---
title: Session B progress
---

# Session B: local rain checkpoint

## 2026-10-18 15:36 start: bitcube · Opus 5.5
Full plan: [B-plan.md](B-plan.md).

Steps:
- **B1** Structured-light capture: Gray-code `gray`/`white` sources in `artnet_out.py`; `tools/pixelmap/capture.py` (one ffmpeg reader, two passes, retakes on disagreement, brightness 0.4).
- **B2** Decoder (TDD, pytest, `.venv`): camera pixel → (rope, px, conf); per (rope, px) median (u, v); outlier filter; fill along the rope; `tools/pixelmap/pixelmap-2026-10-18.json` and overlay.
- **B3** HUB75 quad 1 corners in camera space from the panels test pattern.
- **B4** Rain/river field (built-in TOPs only, 1280×720): noise river with drift and breathing, plus feedback rain streaks.
- **B5** Sampling: UV table → TOP to CHOP → 20×400 `rope_canvas` → ropes `Canvas`; Corner Pin from the B3 corners → panels `Quad1`.
- **B6** `river-local-oct-18.toe` (Save As of river.toe), `td/build/build_river_local.py`, `td_save.ps1 -Target` (default = the open file). Autostart unchanged.
- **B7** Verify by camera (stills and a clip), tune, report watts and fps.
- **B8** Checkpoint still on the status page, tick L, log, code review, summary.

Progress:
- 15:38 B6 (early) TD saved as `river-local-oct-18.toe` via the new `td_save.ps1 -Target` before any building, so `river.toe` stays untouched. TD now runs the checkpoint file.
- 15:46 B1 ✅ Capture `frames/pixelmap-20261018-154155` (29 patterns × 2 passes, settle 1.75 s, drift 13.3, no retakes needed, all pairs agree to within 1.6%). **Note:** this run still had the all-ropes white reference (≈1.2 kW, both boxes at the limiter, about 10 s in total) because session A's review arrived after it started. White is now removed from the code; the lit level comes from the bit/inverse pairs. (commit bc4e2f0)
- 15:46 B2 ✅ Decoder (15 pytest tests) → `tools/pixelmap/pixelmap-2026-10-18.json`: 164k camera px decoded; **all 18 working ropes located**, 53–214 of 400 px visible each, the rest interpolated along the rope; ropes 9 and 17 absent. (commit 043a8cf)
- 15:48 B3 ✅ HUB75 quad 1 corners found from the panel test pattern vs black (`frames/hub75-20261018-154718/corners.png`), red at TL as expected, checked by eye. Stored in the pixel map as `hub75_quad1`. The coils hide part of the bottom edge. (commit 1ebe7d9)
- 15:51 B2 (revised, per session A) Tighter `reject_outliers`: drops points with no near neighbour along the rope and islands shorter than 8 px between jumps of more than 0.08. `fill_along_rope` no longer draws chords across a jump between piles; each half of a hidden stretch holds its nearer visible point. The jump to the camera's status light is gone. 22 tests. Pixel map regenerated from the same capture, with no re-capture and no white frame. (commit 5cd1ac6)
- 15:56 B4 ✅ Rain/river field /project1/river_local (1280×720, camera space, built-in TOPs only). River: simplex noise stretched along the flow, drifting slowly, breathing (14 s) through a black → deep blue → teal → white ramp, more than half black. Rain: thin streak noise scrolling down (0.22 heights/s), thresholded sparse, feedback trails. The first version (per-frame random seeds) gave stationary dots, so it was replaced. Look parameters live on the COMP (Gain, Riverlevel, Flowspeed, Breathe*, Rain*, Blur, Uvtest). (commit 2310582)
- 15:56 B5 ✅ Sampling: UV table (8,000 rows, stored in the .toe) → TOP to CHOP → CHOP to TOP 
owswrapped 400×20 → Flip (flop bottomleft + flipx) → 20×400 
ope_canvas → ropes Canvas. Checked with the UV test field: max error 0.0006, unmapped ropes exactly black. HUB75: Corner Pin (perspective) from the B3 corners → 256×128 → panels Quad1, all four corners match. (commit 2310582)
- 15:56 B6 ✅ 
iver-local-oct-18.toe saved via 	d_save.ps1 and committed. Idempotent 	d/build/build_river_local.py, check script 	d/scripts/check_river_local.py, Web Render switched off in this file. Autostart unchanged (still 
iver.toe). (commit 2310582)
