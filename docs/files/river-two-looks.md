---
title: "The river, two looks (river-two-looks.toe)"
---

# The river (two looks)

**`river-two-looks.toe`** (28 Oct 2026, Gavin, session A): a frozen copy of [The river (all looks)](river-looks.html) (`river-looks.toe`) as it ran on the morning of 28 Oct. It is the rollback point while [the all-looks playlist file](river-all-looks.html) grows. [All show files](../show-files.html)

**Status (28 Oct):** registered in `shows.json`, not offered yet (`offered: false`) until the copy is saved on bitcube.

## What it does
- **Looks:** [the remembered river](river-remembered.html) and [Fill my cup](river-fill-simple.html), with the GPU silk ribbons on the screens. Moved between by fading to black (2 s) and back in (2 s).
- **Auto** (the default): four loops of the remembered river (about 20 min), then one full cycle of Fill my cup (simple) (about 84 s), again. **A flood day** brings the fill right after its loop instead of waiting for the fourth.
- **Manual:** fade to the chosen look and stay on it.

It has no playlist: the order is fixed. Its control is the old one, `River\looks\control.json` `{mode: auto | manual, look}`, and its status `River\looks\status.json`.

## Why it's frozen
Nothing changes in this file. If the all-looks file misbehaves, switch to this one (or set it as the default) in mission control and the piece is back where it was on 28 Oct. The repo as it was before the all-looks work is tagged **`before-all-looks`**; check that tag out on bitcube if the shared code (`td/looks/mixer.py`, the remembered river's modules) has to go back too.

**Build:** `td/build/build_two_looks.py` (runs `build_remembered.py` with the looks driver); only to remake the copy, never to try an idea. **Inputs:** as the remembered river, plus `River\looks\control.json` and the fill dials.
