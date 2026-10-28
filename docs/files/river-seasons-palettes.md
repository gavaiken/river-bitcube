---
title: "river-seasons-palettes"
---

# river-seasons-palettes

**The river's year with new palettes.** A copy of [river-local-oct-22-seasons](river-local-oct-22-seasons.html) (which stays the default) with new season colours. [All show files](../show-files.html)

## For visitors
The same river and the same turning year, in new colours: an icy winter of whites and greys, a deeper teal spring, a sparse blue-green summer with few glints, and a deep cerulean autumn with pale orange leaves.

## For the team
- **Same as the river's year:** inputs, modes (automatic, dynamic, manual), control page on port 9981, rope map and screens (same pinned calibration: the 27 Oct multi-view map).
- **Different:** the four palettes and tints in `td/build/build_seasons_palettes.py`; summer has fewer glints and a weaker torrent overlay; autumn leaf flecks are pale (1.0, 0.8, 0.55). Tints and glints come from the `season_looks` DAT (`td/seasons/seasons_td.py` falls back to its own tables when the DAT is absent, as in the river's year).
- **Code:** `td/build/build_seasons_palettes.py`. Made by copying `river-local-oct-22-seasons.toe` and running that script.
- **Switching to it:** mission control, Status → What's showing. It doesn't change the default.
