---
title: "Fill my cup, simple (river-fill-simple.toe)"
---

# Fill my cup (simple)

**`river-fill-simple.toe`**, a viz show file (27 Oct 2026, Gavin, session A): the filling glass as the artists first saw it, the look they liked best, kept as its own show beside [Fill my cup (configurable)](river-filling.html).

Every rope and screen is one canvas, by each LED's real height above the floor (`td/filling/space.py`: the zones file for the ropes, the measured chain for the screens). Smooth churning blue and black water rises from the floor to the top with a standing slosh and a white crest, holds, then drains all the way out, and fills again (about 84 s a cycle). Its spray and drips are soft round particles of varying sizes.

**Logic:** `td/filling/simple.py` (the colours of commit `b2a7064`) on `td/filling/fill.py`'s cycle and particles. **Build:** `td/build/build_fill_simple.py` (shares `build_filling.py`) in a copy of the baseline template. **Inputs:** the calibration only.
