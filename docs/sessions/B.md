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
- 15:56 B4 ✅ Rain/river field `/project1/river_local` (1280×720, camera space, built-in TOPs only):
  - River: simplex noise stretched along the flow, drifting slowly, breathing (14 s) through a black → deep blue → teal → white ramp, more than half black.
  - Rain: thin streak noise scrolling down (0.22 heights/s), thresholded sparse, with feedback trails. The first version (per-frame random seeds) gave stationary dots, so it was replaced.
  - Look parameters live on the COMP (`Gain`, `Riverlevel`, `Flowspeed`, `Breathe*`, `Rain*`, `Blur`, `Uvtest`). (commit 2310582)
- 15:56 B5 ✅ Sampling: UV table (8,000 rows, stored in the .toe) → TOP to CHOP → CHOP to TOP `rowswrapped` 400×20 → Flip (flop bottomleft + flipx) → 20×400 `rope_canvas` → ropes `Canvas`.
  - Checked with the UV test field: max error 0.0006, and unmapped ropes are exactly black.
  - HUB75: Corner Pin (perspective) from the B3 corners → 256×128 → panels `Quad1`; all four corners match. (commit 2310582)
- 15:56 B6 ✅ `river-local-oct-18.toe` saved via `td_save.ps1` and committed. Idempotent `td/build/build_river_local.py`, check script `td/scripts/check_river_local.py`, Web Render switched off in this file. Autostart unchanged (still `river.toe`). (commit 2310582)
- 15:57 B7 ✅ Camera verification (clips in `frames/`, not committed: people):
  - The river washes drift across the left piles, and the rain shows as columns of white dashes falling through successive rings of the centre and right piles.
  - The HUB75 shows the same streaks descending in step with the piles beside it.
  - Tuning: rain density 0.06 and wider streaks (sx 4.5); river inlow 0.5; ropes Brightness 0.4 (cap); panels Brightness 0.5 (0.8 overexposed next to the ropes).
  - **Art-Net 68–196 W total** (10 samples, both boxes), no dropped frames, about 35 of 40 frames/s sent. **TD 60 fps** (measured over 10 s).
  - (B5 line fixed: an earlier push had control characters where backticks were.)
- 15:58 B8 ✅ Checkpoint still `docs/img/rain-checkpoint-2026-10-18.jpg` (cropped, no people) on the status page; plan item **L** ticked; log entry; CLAUDE.md now lists both show files. (commit 4c3e7c8)
- 16:05 Code review ✅ 10 findings, all fixed. **The important one:** plain Gray codes are unbalanced, so the 15:42 capture lit `b04n` (ropes 0–15 fully, about 960 W) and `b13n` (64% of every rope) at 0.4, twice each. My CLAUDE.md line "patterns light at most half the pixels" was wrong. `capture.py` now dims each bit/inverse pair so no box draws more than half its power at the cap (at most 300 W/box). Also fixed: Graybit clamp, build guard against `river.toe`, settings restored after a capture (checked on the hardware), newest-pixel-map rule, `td_save` with an incremental file open, clear errors, and a TD↔decoder sync test (26 tests). (commit 4c3e7c8)

### SESSION B SUMMARY — Sun 18 Oct 2026, 16:06
Done:
- B1 Gray-code structured-light capture of all ropes with the gallery cam (`tools/pixelmap/capture.py`, rope Source `gray`).
- B2 Decoder (TDD, 26 tests) and `tools/pixelmap/pixelmap-2026-10-18.json`: all 18 working ropes located, hidden pixels filled along the rope, islands and jumps rejected.
- B3 HUB75 quad 1 corners in camera space (`hub75.py`), red at TL, checked by eye.
- B4 Rain/river field `/project1/river_local`, built-in TOPs only: drifting, breathing blue/teal/white river plus falling streak rain, on black.
- B5 Sampling: TOP to CHOP at 8,000 UVs → 20×400 → ropes; Corner Pin → 256×128 → panels quad 1. Both checked numerically (error < 0.001).
- B6 `river-local-oct-18.toe` (Save As of river.toe; river.toe untouched); idempotent `td/build/build_river_local.py`; `td_save.ps1 -Target`.
- B7 Camera check: drops fall through every pile as columns of lit rings and the same streaks cross the HUB75 in step; river washes drift across the piles. 68–196 W total, TD 60 fps, Art-Net about 35 fps sent, no drops.
- B8 Still on the status page, plan item L ticked, log and CLAUDE.md updated, code review done and fixed.
Not done / blocked: none. Ropes 9 and 17 still dark (P1 deferred).
Evidence: commits d4edc83 (plan), bc4e2f0, 043a8cf, 5cd1ac6, 1ebe7d9, 2310582, 4c3e7c8, 4c3e7c8. `docs/img/rain-checkpoint-2026-10-18.jpg`, `tools/pixelmap/pixelmap-2026-10-18.json`. Overlay, corners and clips in `frames/` (local only; people in them).
Hardware state now: TD runs `river-local-oct-18.toe`. Ropes `Source=canvas`, Brightness 0.4 (cap), showing the rain. Panels `Source=canvas`, Brightness 0.5, quad 1 rain, quad 2 blanked. RopeLights stopped. **The login autostart still opens `river.toe`** (ropes black, panel test pattern), so a reboot leaves the checkpoint.
Decisions or answers needed from Gavin/team:
- Should the login autostart open `river-local-oct-18.toe` until Dave's visuals are in? Not changed; your call.
- Awareness: the 15:42 capture briefly lit near the limiters (all-white reference, then `b04n`/`b13n`, about 1 kW for a few seconds each). It is fixed in code now.
Suggested next step: C1–C3 (session C). C3 must save each show file while it is open (`td_save.ps1` saves the open file). Then D, which reuses `build_river_local.py`'s sampling for Dave's canvas.

