---
title: "The river, all looks with a playlist (river-all-looks.toe)"
---

# The river (all looks, playlist)

**`river-all-looks.toe`** (28 Oct 2026, Gavin, session A): every look in one show file, played in an order you set. Between looks it fades to black (2 s) and back in (2 s), never restarting TouchDesigner. It grew out of [The river (all looks)](river-looks.html), which had three looks and a fixed order. [All show files](../show-files.html)

**Status (28 Oct):** built, checked and offered; the boot default since 11:20. The remembered river, both fills and the river's year are available inside it. Combined with Modal is still pending its fold script and cannot yet be added to the running playlist.

## Its looks

| Look (name in the playlist) | What it is | A step counts |
|---|---|---|
| [The remembered river](river-remembered.html) (`remembered`) | One remembered day of Dry Creek every five minutes, with its surge | loops (5 min each) |
| [Fill my cup (simple)](river-fill-simple.html) (`fill-simple`) | The first filling cup, the look the artists liked best | cycles (about 84 s each) |
| [Fill my cup (configurable)](river-filling.html) (`fill-configurable`) | The filling cup with dials | cycles |
| [The river's year](river-local-oct-22-seasons.html) (`seasons`) | The recorded river through four seasons | minutes |
| [Combined with Modal Input Selector](river-combined-modal-inputs.html) (`modal`, pending) | Will's live river with one Modal input steering it; not yet folded into this file | minutes |

Each look keeps its own settings (the remembered river's page, the fill dials, the year's rules, the Modal input and strength), the same as in its own file. Its description in mission control is the one it had as its own file: `shows.json` keeps a copy under this entry's `looks` ([format](../shows.html#looks)). Only the look on the lights runs; the remembered river's clock keeps the wall time while it's hidden, so it comes back partway through a loop.

## The playlist

**Control:** `River\looks\control.json`:

```json
{"mode": "auto", "playlist": [{"look": "remembered", "for": {"loops": 4}}, {"look": "fill-simple", "for": {"cycles": 1}}]}
```

- **Auto** plays the playlist in order and starts again at the top. Each step is one look `for` so many `loops`, `cycles` or `minutes`.
- **Manual** pins one look (`{"mode": "manual", "look": "seasons"}`): it fades there and stays, looping.
- **The default playlist:** the remembered river ×4 loops (about 20 min), then Fill my cup (simple) ×1 cycle (about 84 s), again. This is what `river-looks.toe` did.
- **A flood day:** when the remembered day that just played was a flood (its flow in the top 10 % of the record), the fill comes on right after that loop instead of waiting for the count. `River\looks\status.json` (twice a second) says so in `auto.flood` / `auto.why`.

**Where it's edited:** mission control's **Looks** tab: the playlist, auto or manual, and each look's settings with its description beside them. Its **live inputs** card shows the inputs of the look on the lights (Dave's agent, the river camera or its recorded fallback, the people counter, the Modal mirror). From a terminal: `node mission/bin/mc.mjs looks '{"mode":"auto","playlist":[...]}'`.

## Rolling back

[`river-two-looks.toe`](river-two-looks.html) is a frozen copy of `river-looks.toe` as it ran on the morning of 28 Oct (the remembered river and Fill my cup alternating). If the all-looks file misbehaves, switch to it (or set it as the default) in mission control. The repo as it was before this file is tagged **`before-all-looks`**.

**Logic:** `td/looks/mixer.py` (the playlist mixer). **Build:** `td/build/build_all_looks.py`, which runs `build_remembered.py` with the looks driver. **Inputs:** every look's inputs, plus `River\looks\control.json`.

## Softer ribbon folds (28 Oct, Will)

Will approved the local shader study for the remembered-river look inside this file. Its screen shader now uses a finite projected width at edge-on twists, removes the unstable lifted-sheet inverse, feathers the silhouette and softens the rim boost. Its 3×3 Gaussian glow clamps to each screen’s own strip. The original shaders remain available; standalone and frozen shows keep them. CPU fallback remains the existing numpy ribbon renderer.

Apply only the screen changes without resetting the look or playlist: `td.ps1 -File td\build\update_all_looks_ribbons.py` (save first with `td_save.ps1`, then verify and save again). A full `build_all_looks.py` also selects these shaders. Neither path changes playlist configuration, mapping, river grade or rope logic.

Rollback: set `SOFT_RIBBONS=False` in the update script’s execution globals; it reconnects the original Blur TOP and restores the original DRAW shader without resetting the clock. Saved pre-deployment show and controls: `River\checkpoints\before-soft-ribbons-20261028-will\` (`disk-before.toe`, `live-before.toe`). The frozen two-looks show remains available in mission control.
