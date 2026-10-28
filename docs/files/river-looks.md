---
title: "The river, all looks (river-looks.toe)"
---

# The river (all looks)

**`river-looks.toe`** (M8, 27 Oct 2026, Gavin, session A): several looks in one show file, moved between by fading to black (2 s) and back in (2 s), never by restarting TouchDesigner.

- **Looks:** [the remembered river](river-remembered.html), [Fill my cup (simple)](river-fill-simple.html), [Fill my cup (configurable)](river-filling.html).
- **Auto** (the default): four loops of the remembered river (about 20 min), then one full cycle of Fill my cup (simple) from an empty cup (about 84 s), again.
- **Manual:** fade to the chosen look and stay on it, looping.
- **Settings:** each look keeps its own: the remembered river's page (pool line, opening night, the river video under the particles, M9), the fill dials.

Only the look on the lights runs. The remembered river's clock keeps the wall time while it's hidden, so it comes back partway through a loop; the count of four starts when it comes back.

**Control:** `River\looks\control.json` `{mode: auto | manual, look: remembered | fill-simple | fill-configurable}`; **status** `River\looks\status.json` twice a second. **Logic:** `td/looks/mixer.py`; the network is the remembered river's (`build_remembered.py`, driven through `td/build/build_looks.py`).
