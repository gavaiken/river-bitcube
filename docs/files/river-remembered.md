---
title: "river-remembered"
---

# river-remembered: the remembered river

**Dry Creek relives one remembered day from its past every five minutes.** The final visualization (design and contracts: [the remembered river](../remembered-river.html); terms in the glossary: remembered day, loop, phase, surge, decision wave, the pool, day's season, lingerer). [All show files](../show-files.html)

**Status (27 Oct): not yet built on bitcube.** The logic and the build script are in the repo and tested offline; the `.toe` is made on bitcube from the baseline template (below), then `offered` goes to `true` in `shows.json`.

## For visitors
The column remembers a real day of the creek: its hours, its rain, how high the river ran, its night and day, its season. Most of the time the light is calm: single slow drips down a few ropes, a pool breathing on the floor. As the remembered storm builds, the drips join into flow; then, for a few seconds, everything holds its breath, and a white front falls down every rope into the pool, which churns white. The water runs bright for half a minute, swells once, then drains of colour, slows and goes dark rope by rope, the pool last. The screens show the real river's moving water through four slowly drifting windows, everything else dark, brighter as the surge comes. Stand still near the column and the light slows and gathers toward you.

## For the team

**Inputs** (on bitcube, under `River\`): `gallery_state\state.json` + `reflex.json` (Dave's mirror: `memory`, `surge_at`, scene colours and knobs, reflexes, `heard`), `presence.json` (people and lingerers), `remembered\control.json` (pool line, light checks, opening night), `data\remembered\` in the repo (the fallback days), the river cam (recorded clip as fallback). **Output:** the ropes, the four screens, and `River\remembered\status.json` twice a second (contract §5).

**The loop** (`td/remembered/clock.py`): 300 s = the remembered day's 24 h (12.5 s an hour). One day per loop; a new day applies at the next boundary with the **decision wave** (one ~8 s wave of light down every rope, a line wiping down each screen in step).
- **Which day:** each of Dave's `memory` choices plays once while its `chosen_at` is under 15 min old and the mirror (`state.json`) was rewritten in the last 15 min; else bitcube picks one of `notable.json`'s days (with its `profiles.json.gz` hours and `days.csv` stats), never the same date twice within an hour; with no data at all, the preset calm loop at 30 %.
- **The surge:** at Dave's `surge_at`; else at the heaviest rain hour − 0.5 (rain is stamped at the hour's end), or the highest-flow hour on a wet day without rain, 30 s sooner for a busier-than-usual room (relative presence > 1.3) or a lingerer, 30 s later for an empty room (nobody for 60 s); always clamped to 90–216 s. The plan is fixed once the loop starts building. A dry day (`stats.dry`, or `surge_at` null) has no surge, unless opening night.
- **Opening night is on by default** (Gavin and the artists, 27 Oct: visually appealing first): unless `control.json` says `"opening_night": false`, calm runs at 45 % and every loop has a surge; a dry day's lands at 150 s (still moved by the room, within 90-216 s), a little smaller (body at 80 %, 40 % of the foam), and `surge.why` says "Opening night: a surge every loop (the day was dry)".
- **Phases:** building starts 30–75 s before the surge (longer when it rained for longer before it); draw-back the last 8 s; surge 40 s (front 0–4 s, body 4–40 s); settling 45–75 s (longer for a higher flow percentile), cut at the loop's end; calm the rest.

**The ropes** (`td/remembered/ropes.py`, 20 × 400, LED 0 at the ceiling, drawn rope by rope, not through the pixel map): calm 35 % (45 % on opening night, 30 % for the preset), low saturation, about a quarter of the ropes dripping; building wakes the rest and joins drips into flow. Surge: the front (2.5 px edge, 20 px white, 60 px tail; 0.4 × top speed at the top accelerating to it by mid-height; top speed 1.5–3 m/s by `flow_pct`, so the floor in ~3.5 s; per-rope offsets 0–600 ms × turbulence), the body (teal-cyan at 70–85 % by Dave's brightness, speed ±30 % on 2–5 s noise, foam sparkles by rain and density, bubbles, eddies where the zones file says), the swell at 60 % (+15 %, 2 s), the pool (LEDs at or below the pool line: 0.3 × flow, dark in the draw-back, churning white, fading last). Settling drains colour (15 s), then speed, thins the foam and darkens the ropes top-down in random order. Night at the remembered hour → 35 % darker and greyer; season → palette (`td/remembered/palette.py`: always cool, saturated; Dave's colours crossed in when he sends them; cold or snow → whiter, finer sparkles; a dry day → calm with few drips; its opening-night surge smaller). The flow level follows `heard` while the reflex is fresh (`updated_epoch` + `ttl_seconds`, or the file under 90 s old without them), else the river cam's motion. Lingerers' ropes (and those whose feet are near) get 80 % brighter and 60 % slower, the rest 30 % dimmer, easing over ~4 s.
- **Safety:** the whole column's mean brightness changes at most 0.5 per second (every change ramps; no whole-column flashing) and the frame stays under 1,250 W of `artnet_out`'s power model, so its 1,400 W limit never cuts in.
- **Light checks:** `control.json` `light: pool | eddies | leds` lights only those LEDs, white at 25 % (the screens go black).

**The screens, particles** (round 2b, 27 Oct night, the default: `td/remembered/particles.py`): one field of falling water-like particles in the room's own space (the calibration's frame: every rope LED and every screen where it really is), which the four screens look into like windows, each at its real size and rotation (rotations measured on site with an iPhone: screen 1 21° counterclockwise, 2 19° clockwise, 3 20° clockwise, 4 23° counterclockwise; the camera misjudges them), so water falls toward the room's floor through every window and a particle crossing a rope and then a screen is the same one. The same particles add light to the rope LEDs they pass (through the ropes' safety ramp and power limit). They fall at the ropes' speed with a slow sideways swirl (more with Dave's turbulence), about 2 cm across, and come in numbers and brightness that follow how lit the ropes are (a torrent in the surge). `control.json` `screens: {mode: particles | water, intensity}`.

**The screens, water** (round 2, 27 Oct, `screens.mode: water`: `td/remembered/water.py`, the artists' look from mission control's HUB75 simulator): only the moving water of the river footage (a slow running average of frame-to-frame change, blurred, scaled to its 90th percentile, soft threshold), seen through four windows, one per 128 × 256 screen, each drifting ±3.5 % around the home the artists chose (periods 1.5–2.5 min, size ±6 %). Black floor 0.12, contrast 1.4, colour 0.85, intensity 0.82 in linear light, everything that doesn't move off. Brightness follows the loop: 40 % of the intensity in calm, eased to 100 % from building to the surge and back while settling. Footage: the live river cam while it is live and not dark (`cam_probe`), else the approved clips in `River\recordings\river\remembered\` (a loop each). `control.json` `screens: {intensity, threshold}` overrides the two from mission control. No coverage cap; no tilt correction (the artists' simulator has none). `panels.py` (the first version's foam) is kept but no longer drawn.

**Calibration:** pins the 27 Oct multi-view map and screens (`pixelmap-2026-10-27.json`, `screens-2026-10-27.json`: each screen's orientation, as in every show) and `zones-2026-10-27.json` (LED heights, the pool line; no eddies until the logs are marked).

**Code:** `td/remembered/` (clock, palette, zones, ropes, panels, status, show: plain Python + numpy, tested in `tools/tests/test_remembered_*.py`), `td/build/build_remembered.py`. Preview offline: `python tools/remembered/preview.py` (loop strip, surge close-up, screens at each phase, a GIF).

## Building it on bitcube
1. `git pull` on bitcube. Open `river-baseline-template.toe` (switch to it), then `.\tools\td_save.ps1 -Target river-remembered.toe`.
2. `.\tools\td.ps1 -File .\td\build\build_remembered.py -Timeout 120`; look with `.\tools\td.ps1 -Screenshot /project1/outputs/screens_preview` and at `River\remembered\status.json`.
3. Save with `.\tools\td_save.ps1`. Set `offered: true` (and `updated`/`last_change`) in `shows.json`, push.

## The network
```
/project1
  inputs/      the template's river cam / recorded clip (and gallery cam)
  remembered/  river_small -> (show.frame) ; rope_render -> rope_canvas ; panel_render -> screen1..4_crop ; remembered_exec
  outputs/     screens.py: screen<k>_src <- remembered/screen<k>_crop -> orientation -> panels ; screens_preview
  ropes        Art-Net (Canvas = remembered/rope_canvas)
  panels       the HDMI window
```
