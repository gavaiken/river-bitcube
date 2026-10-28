---
title: "river-baseline-template"
---

# river-baseline-template

**The starting point for a new visualization.** Not a show: the river, untouched, on every screen and rope. Built 26 Oct for the handover to Will. [All show files](../show-files.html)

## What it does
- **Reads:** the live **river cam** (640×360, ~10 fps, through `td/cameras/river_cam.py`'s relay). When no river frame has arrived for 10 s (the live river's own staleness rule, `river_cam.fresh()`), it switches to the recorded clip `River\recordings\river\seasons\river-normal.mp4` (looping), and back as soon as frames return. The live **gallery cam** runs too, as a second input.
- **Does:** nothing. `viz` passes the river straight through. That's the part you replace.
- **Outputs:** the 20 ropes (each LED samples the picture where it hangs on the sculpture, through the pinned LED map) and the four HUB75 screens (the shared screens module, `td/build/screens.py`), with the show files' brightness cap (ropes `Brightness` = `Maxbrightness` 0.4, 600 W per box).
- **Code:** `td/build/build_baseline.py` (refuses to run unless `river-baseline-template.toe` is open).

## The network
```
/project1
  README     this, in short
  inputs/    river    = river cam, or the recorded clip when the cam is stale
             gallery  = gallery cam
             (Forceclip: use the clip even with the cam live, to test the fallback; Gallerycam: run the gallery cam)
  viz/       YOUR VISUAL: river_in, gallery_in  ->  ...  ->  viz_out
  outputs/   don't touch: viz_out -> field_out (1280x720) -> rope_canvas (20x400) + screen1..4_out
             screens_preview = what TD sends (ropes + 4 screens upright)
  ropes      don't touch: the Art-Net sender (mission control finds it here)
  panels     don't touch: the HDMI window for the HUB75 screens
```
Each COMP has a `NOTE` Text DAT saying the same.

**What `viz_out` means.** Any size; it is stretched to the 1280×720 field, which is laid over the **whole sculpture** as the pinned map sees it: since 27 Oct the map stitches three tilted views of the gallery cam, so the bottom of the frame is the floor coils and the top is the rig. A pixel of `viz_out` lands on whichever rope LED or screen hangs there. Paint the top of the frame and the tops of the ropes light up. This is *not* the gallery cam's own picture (`inputs/gallery` sees only the lower part from its show position); the map gives each LED's place in that picture too (`hu`, `hv`). The stitched view with the map drawn on it: `frames/pixelmap-20261027-201707/panorama.png` on bitcube.

## Calibration
Pinned, never "the newest map wins": `tools/pixelmap/pixelmap-2026-10-27.json` (ropes) and `tools/pixelmap/screens-2026-10-27.json` (screens), the 27 Oct multi-view map every show uses. The build takes the pin from `shows.json` through `td/build/registry.py` `calibration_for()` when that exists, else from the two constants at the top of `build_baseline.py`; its output line says which. A re-map makes a new dated file; your show only moves to it when you change its pin.

## Start a new viz
1. Open the template on bitcube (mission control, or restart TD on it), then copy it: `.\tools\td_save.ps1 -Target river-<name>.toe`. TD now runs your file. File names never change after this.
2. Add `river-<name>.toe` to `shows.json` (`kind: "viz"`, who made it, a description of at most 100 words, its pinned calibration). See `docs/shows.md`.
3. Write `td/build/build_<name>.py`: it refuses to run unless `river-<name>.toe` is open, and builds only inside `/project1/viz` (keep `river_in`, `gallery_in` and `viz_out`). Run it with `.\tools\td.ps1 -File .\td\build\build_<name>.py`, look with `.\tools\td.ps1 -Screenshot /project1/outputs/screens_preview`, save with `.\tools\td_save.ps1` (never `project.save`).
4. Add a page `docs/files/river-<name>.md` like this one.

Rules that bite (AGENTS.md has the full list): cameras only through `river_cam.py` (never a Video Stream In TOP); save before cooking a new GLSL shader and index its inputs with constants; never light all ropes white; the boot file stays the boot file until Gavin says otherwise.

## Rebuilding the template itself
Open `river-baseline-template.toe`, run `.\tools\td.ps1 -File .\td\build\build_baseline.py -Timeout 120`, save with `.\tools\td_save.ps1`. The build is idempotent; it removes anything in `/project1` that isn't `inputs`, `viz`, `outputs`, `ropes`, `panels` or `README` (the file was first made as a Save As of the river's year), and rewires `viz` only if `viz_out` is missing.
