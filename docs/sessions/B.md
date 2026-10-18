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
- 15:44 B1 ✅ Capture `frames/pixelmap-20261018-154155` (29 patterns × 2 passes, settle 1.75 s, drift 13.3, no retakes needed, all pairs agree to within 1.6%). **Note:** this run still had the all-ropes white reference (≈1.2 kW, both boxes at the limiter, about 10 s in total) because session A's review arrived after it started. White is now removed from the code; the lit level comes from the bit/inverse pairs. (commit bc4e2f0)
- 15:50 B2 ✅ Decoder (15 pytest tests) → `tools/pixelmap/pixelmap-2026-10-18.json`: 164k camera px decoded; **all 18 working ropes located**, 53–214 of 400 px visible each, the rest interpolated along the rope; ropes 9 and 17 absent. (commit 043a8cf)
- 15:52 B3 ✅ HUB75 quad 1 corners found from the panel test pattern vs black (`frames/hub75-20261018-154718/corners.png`), red at TL as expected, checked by eye. Stored in the pixel map as `hub75_quad1`. The coils hide part of the bottom edge. (commit 1ebe7d9)
