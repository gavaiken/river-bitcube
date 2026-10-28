---
title: "Fill my cup, configurable (river-filling.toe)"
---

# Fill my cup (configurable)

Also called the filling glass. Its simpler first look is [Fill my cup (simple)](river-fill-simple.html).

**`river-filling.toe`**, a viz show file, made 27 Oct 2026 (Gavin, session A) for the artists' idea: the whole column as one canvas, water filling it like a glass, a river filling a pool, all the way to the top, then leaking out to the floor.

Every rope LED and every screen pixel is painted by where it really is in the room: the calibration's frame (the 27 Oct multi-view map, as the gallery camera sees the piece), the screens at their real size, place and measured tilt (screen 1 +21°, 2 −19°, 3 −20°, 4 +23°, + = counterclockwise as seen). So the water's surface is one line across ropes and screens alike.

**The cycle** (about 84 s): the water rushes in from the coils and fills to the top (38 s), turbulent: a standing slosh across the column plus travelling chop, a white-cyan crest where it crashes, spray flung above it; it holds churning at the top (10 s); drains all the way out (30 s), leaving drips running down the walls; empty (6 s); again. Under the surface: deep blues broken by black pockets that churn upward while filling and downward while draining.

**Dials** (mission control, while this show runs): palette (River blues, Glacier, Midnight, Teal), brightness, intensity (how turbulent: chop, splash, crashing) and speed (25–300 % of the cycle). They reach the show through `River\filling\control.json` (`{palette, brightness, intensity, speed}`, read every second); the show reports `River\filling\status.json` (`{palette, brightness, intensity, speed, level, phase}`) twice a second.

**Detail at the screens' scale:** a screen is only about 30 px wide in the map's frame, so the churn has fine octaves (down to about 2 px), spray droplets are flung from the crashing surface under gravity, foam flecks ride in the body; screens are drawn at half resolution (2 × 2 LEDs per value), the water at 30 Hz (about 7 ms a step).

**Real heights** (27 Oct night): the water fills by height above the floor, which doesn't depend on where you stand (the camera sees the piece from low and to one side, so in its picture a screen and the ropes beside it don't line up as they do for a visitor). Rope LEDs: their heights from the zones file; screens: Gavin's measurements chained from screen 3's calibrated centre (3 → 4 → 2: 1 m apart at 30° from vertical; 1: its bottom 1.5 m above the top of 3), each pixel at its real place and tilt (`td/filling/space.py`). All particles (spray, bubbles, drips) are soft and round, of varying sizes, drawn at full screen resolution.

**Logic:** `td/filling/fill.py` (numpy; `Geometry` from `td/remembered/particles.py`). **Build:** `td/build/build_filling.py` in a copy of the baseline template. **Inputs:** none live (a first sample to judge the look); the calibration only. Ropes at full column about 680 W, under the 1,400 W limit.
