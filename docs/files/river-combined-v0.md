---
title: "Combined v0"
---

# Combined v0

Will's first visualization: the live river in Gavin's summer colours, with Dave's animation added over it. [All show files](../show-files.html)

## What it does
- **Reads:** live river video through the established camera relay. If no frame arrives for 10 seconds, uses `River/recordings/river/seasons/river-normal.mp4`, and returns to live video when frames resume. The live camera clock and label are cropped like the recorded library. Gallery video is available as `viz/gallery_in` but has no influence yet.
- **Base:** holds summer at intensity 0.85, using Gavin's summer palette, natural tint, downward torrent streaks and sun glints. Live video runs at camera speed; this version does not synthesize faster playback of the live river.
- **Overlay:** Dave's canvas from the existing local Modal mirror (`http://127.0.0.1:8770/canvas.html?w=640&h=360`). His scene drives his animation; it does not change the summer base in v0. Bright canvas forms are added over the river, then clamped. Missing scene or renderer errors leave the base running alone. A network outage keeps the last mirrored scene.
- **Controls:** Status in mission control, while Combined v0 runs: move **Dave's overlay strength**, then press **Apply river settings**. 0% is the summer river alone; 100% adds the full canvas. Starts at 25%; changes persist in `River/combined-v0.json`, independently of other shows. No audio, people-count steering, new recordings or Modal deployment changes.
- **River framing:** Status offers **Original (bypass)**, **Channel**, or **Pool**, each profile with one window or three slowly crossfading windows. Profiles lift shadows and use feathered foreground masks derived from Will’s two night-camera stills. Select the matching profile after moving the camera; camera position is not detected automatically. The three crops preserve 16:9, cover successively wider water regions and crossfade every 18 seconds (54-second cycle). Original takes the unchanged input route. Recorded fallback always bypasses framing. Profile and overlay strength share the persisted settings file; changing one preserves the other.
- **Outputs:** the baseline's 20 ropes and four screens, capped at brightness 0.4 and 600 W per rope box. Uses the baseline's pinned 23 Oct rope and screen maps.
- **Code:** `td/build/build_combined_v0.py`, `td/combined/build_viz.py`, `td/combined/runtime.py`, `td/combined/framing.py` and its two mask assets.

## Structure and iteration
`inputs -> viz -> outputs`, with `ropes` and `panels` at `/project1`. Keep `viz/river_in`, `viz/gallery_in` and `viz/viz_out`. Change this show's code, rebuild through `tools/td.ps1`, inspect a preview and gallery still, and save only with `tools/td_save.ps1`. Update this page and its registry metadata with every change.

Calibration is read through `registry.calibration_for(project.name)`; no newest-map selection. To compare in the gallery: Change -> Combined v0 -> Switch. Back to default returns to the existing default; switching does not change it.

## Reverting the experiment
Choose **Original (bypass)** under River framing and press **Apply river settings**. This restores the pre-framing river path while retaining the overlay strength. It does not require a show restart. The .toe is saved with Original selected; the persisted choice is restored on load.

For a complete file rollback, the pre-framing show and 10% overlay settings are backed up on bitcube at `C:\Users\user\River\checkpoints\combined-v0-before-framing-20261026\`. The source before this experiment is commit `4933054` (feature `3bbd35f`); restore only this show's files and related controls, never roll other shows back.

These are fixed profiles selected from a still-image heuristic, not moving-water segmentation. Daylight, changed lighting, a different camera angle or an imprecise preset can make the masks unsuitable; use Original until retuned. Pool detail remains limited by the camera's exposure.
