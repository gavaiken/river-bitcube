---
title: "The river, all looks v2 (river-all-looks-v2.toe)"
---

# The river (all looks) v2

**`river-all-looks-v2.toe`** (29 Oct 2026, Gavin): [The river (all looks, playlist)](river-all-looks.html) with **the remembered river v2**. The same playlist, fades and fills; the remembered river look is new. Plan and status: [the v2 plan](../remembered-v2-plan.html). [All show files](../show-files.html)

**Rollback:** `river-all-looks.toe` is frozen (it runs code pinned in a second checkout, `River\river-bitcube-v1`; [checkpoints](../checkpoints.html)). Switching back is mission control's What's showing.

## What's new in the remembered river

- **People change the light, visibly.** Someone standing still near the piece: sparks and splashes run up and down their two to four ropes, the light and the pool's waterline gather there, the rest dims a little. A crowd: turbulence below head height, swirls and bursts mounting over a minute as people are counted and subsiding when they go; calm brightens with it. An empty room: slow ocean waves over the pool settling to a still pond; the day's surge still plays, softer; anyone entering wakes it within seconds.
- **The remembered day's own hours drive the knobs.** Its flow sets speed and density, its rain the turbulence, its temperature and daylight the brightness, hour by hour through the loop, blended half and half with Dave's agent's knobs (his narrow band remapped to a useful range). A flood day and a dry day now look different.
- **Every input can be steered** from mission control's **Remembered river v2** page: each parameter is auto, fixed, or adjusted (auto × gain + offset); master rope brightness and the calm range; a simulated headcount or lingerer for testing (expires after two minutes, with a red banner). The page shows every input, its source and age, a day of history, which parameters it feeds, and the outputs.
- **Inputs log:** `River\logs\inputs.jsonl`, every input and parameter, for the page's sparklines.

## Build

`td/build/build_all_looks_v2.py` (the all-looks build with this file's name), from the **live** checkout: `.\tools\td.ps1 -File .\td\build\build_all_looks_v2.py -Timeout 120`, then `tools\td_save.ps1`. Logic: `td/remembered/` (`room.py` the people model, `knobs.py` the knobs, `overrides.py`, `inputs_log.py`), `td/looks/mixer.py`.
