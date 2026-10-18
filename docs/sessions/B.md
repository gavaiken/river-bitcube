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
