---
title: "The river, all looks (river-looks.toe)"
---

# The river (all looks)

**`river-looks.toe`** (M8, 27 Oct 2026, Gavin, session A): several looks in one show file, moved between by fading to black (2 s) and back in (2 s), never by restarting TouchDesigner.

**Superseded** by [the all-looks playlist file](river-all-looks.html) once that is the default; [`river-two-looks.toe`](river-two-looks.html) is this file's frozen copy (28 Oct morning).

- **Looks:** [the remembered river](river-remembered.html), [Fill my cup (simple)](river-fill-simple.html), [Fill my cup (configurable)](river-filling.html).
- **Auto** (the default): four loops of the remembered river (about 20 min), then one full cycle of Fill my cup (simple) from an empty cup (about 84 s), again.
- **A flood day** (M6, 28 Oct): when the remembered day that just played was a flood (its flow in the top 10 % of the record), the fill comes on right after that loop instead of waiting for the fourth. `status.json` `auto.flood` / `auto.why` say so.
- **Manual:** fade to the chosen look and stay on it, looping.
- **Settings:** each look keeps its own: the remembered river's page (pool line, opening night, the river video under the particles, M9), the fill dials.

Only the look on the lights runs. The remembered river's clock keeps the wall time while it's hidden, so it comes back partway through a loop; the count of four starts when it comes back.

**Control:** `River\looks\control.json` `{mode: auto | manual, look: remembered | fill-simple | fill-configurable}`; **status** `River\looks\status.json` twice a second. **Logic:** `td/looks/mixer.py`; the network is the remembered river's (`build_remembered.py`, driven through `td/build/build_looks.py`).
