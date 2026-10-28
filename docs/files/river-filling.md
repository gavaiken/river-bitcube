---
title: "The filling glass (river-filling.toe)"
---

# The filling glass

**`river-filling.toe`**, a viz show file, made 27 Oct 2026 (Gavin, session A) for the artists' idea: the whole column as one canvas, water filling it like a glass, a river filling a pool, all the way to the top, then leaking out to the floor.

Every rope LED and every screen pixel is painted by where it really is in the room: the calibration's frame (the 27 Oct multi-view map, as the gallery camera sees the piece), the screens at their real size, place and measured tilt (screen 1 +21°, 2 −19°, 3 −20°, 4 +23°, + = counterclockwise as seen). So the water's surface is one line across ropes and screens alike.

**The cycle** (about 84 s): the water rushes in from the coils and fills to the top (38 s), turbulent: a standing slosh across the column plus travelling chop, a white-cyan crest where it crashes, spray flung above it; it holds churning at the top (10 s); drains all the way out (30 s), leaving drips running down the walls; empty (6 s); again. Under the surface: deep blues broken by black pockets that churn upward while filling and downward while draining.

**Logic:** `td/filling/fill.py` (numpy; `Geometry` from `td/remembered/particles.py`). **Build:** `td/build/build_filling.py` in a copy of the baseline template. **Inputs:** none live (a first sample to judge the look); the calibration only. Ropes at full column about 680 W, under the 1,400 W limit.
