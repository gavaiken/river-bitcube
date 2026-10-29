---
title: "The remembered river v2: plan"
---

# The remembered river v2

A living plan. Agreed with Gavin on 29 Oct 2026, 00:10 PT (the grilling in the Mac mini session). Updated and committed after every step. Window: **12 hours** (until ~12:00 PT, 29 Oct); rebuilds on bitcube are allowed at any time in that window. Gavin is not on site: every people effect must be testable with an override.

## Why

Gavin audited the remembered river on 28 Oct (the look in `river-all-looks.toe`). What's agreed and built is in [remembered-river.md](remembered-river.md); what's missing on the piece:

- **People don't visibly change anything.** The headcount only moves calm brightness ±20 % relative to "usual", the surge ±30 s, and mini-surges fire in an empty room too. A lingerer brightens 11–18 of the 20 ropes (falloff radius 0.08 over feet that span 0.16 of the frame), which reads as nothing. The people counter crashed 39 times on 28 Oct (`PermissionError` swapping `presence.json`), resetting every stillness clock. The driftwood eddies were never built (0 in the zones file).
- **Dave's signal is nearly constant.** The remembered day changes every tick (good). The four knobs sit in a narrow dim band (speed 0.04–0.14, turbulence 0.08–0.14), changing ~every 25 min; the reflex offsets are ±0.01; `heard` is dead while the river cam's RTSP is down; ticks up to 18 min apart drop the show to its own day. The remembered day's own hourly profile (already in `state.json`) is unused for the knobs.
- **Bugs.** The first control write from mission control turns opening night off; a `zones.py light --write` leaves a nested block that overrides the UI forever; "Light the pool" survives a reboot; intensity 0 % reads as 82 %; Apply snaps all three sliders to 5 %. Dave sending a non-numeric knob aborts a tick every 2 s.
- **No rollback.** Every `.toe` imports `td/remembered/*.py` live from the checkout, so the "frozen" copies change with every pull.
- **No way to see or steer the inputs.** No master rope brightness, no manual override of any input, no history. Dead code (`panels.py`, `particles.py`, `flow.py`), duplicate motion passes, a 1 MB library parse on the frame thread.

## Decisions (29 Oct, Gavin)

1. Bug fixes land in **v1** (`td/remembered/`, `river-all-looks.toe`), verified, then v1 is **frozen**: vendored `td/remembered_v1/` + `td/looks_v1/`, `river-all-looks.toe` rebuilt to import them, tag `all-looks-v1-frozen`. That file is the rollback; mission control's "What's showing" switches back to it.
2. v2 = `river-all-looks-v2.toe` built from `td/remembered/` (live code).
3. **People effects, obvious:** a lingerer → sparks and splashes running up and down their 2–4 nearest ropes, light and the pool gathering there; headcount → Fantasia-style turbulence at head height and below (LEDs ≤ 1.8 m), mounting and subsiding over ~60 s; an empty room → slow ocean waves over the pool, settling to a still pond, main surge still plays softer, no random mini-surges while busy; anyone entering wakes it in seconds.
4. Knobs: the remembered day's hourly flow/rain/temp drives speed, density, turbulence through the loop; Dave's narrow band is remapped to a useful range (his voice stays as a slow mood layer).
5. Inputs logger (`River\logs\inputs.jsonl`); `status.json` extended with every derived parameter and its source.
6. Overrides in `control.json`: per parameter **auto / fix / adjust**, master rope brightness, calm baseline min/max, screen sliders; sticky until cleared, "clear all". **Simulated people (headcount, a lingerer at rope N) clear after 2 min** and show a red SIMULATING banner.
7. One control schema shared by TD, `probe.ps1`, `mission.mjs`, the page.
8. v2 page in mission control: inputs → parameters → outputs with sources, ages, sparklines, explainers (tooltips, ? buttons), clear override UX; one route that detects which file runs and serves the right page.
9. Dave's repo (`river-agent`): branch + PR, pushed (no Signal message); additive only: raw gallery/river `signals` in `reflex.json`, tick-gap tolerance. We don't depend on it.
10. Delete what is certainly unused; keep anything still selectable from mission control.
11. Agents: Opus (code items, with tests) and Fable (plan, integration, bitcube). No Sonnet.

## Status

| Step | What | Agent | Status |
|---|---|---|---|
| 1a | People counter: retry the `presence.json` swap instead of crashing; keep stillness clocks across a restart | Opus | ✅ `450ba77`, deployed on bitcube 00:38 |
| 1b | Control schema (`td/remembered/control_schema.py` → generated JSON for probe/mission/page); fix opening-night seed, nested-zones precedence, light reset at boot, intensity 0, slider snap; tolerant `Knobs.set_scene` | Opus | ✅ `53b3c68` |
| 1c | Rebuild `river-all-looks.toe`, verify on the piece, tag `all-looks-v1-bugs` | Fable | ✅ `84fde12`, tag `all-looks-v1-bugs`; opening night restored to ON (bug 1 had written it off at 16:15 on 28 Oct) |
| 2 | Freeze v1: `river-all-looks.toe` built from the pinned worktree `River\river-bitcube-v1` (`REPO_OVERRIDE`); TD restarted on it; tag `all-looks-v1-frozen`; `shows.json`, `docs/checkpoints.md` | Fable | ✅ `092fdfc`, verified 01:00 (modules load from `river-bitcube-v1`, no errors) |
| 3a | People effects in `ropes.py` + `show.py` (lingerer sparks/splashes + gathering; crowd turbulence ≤ 1.8 m; empty-room ocean → pond; mini-surge rules); tests | Opus | ➡️ |
| 3b | Knobs from the day's profile + Dave remap (`clock.py`, `show.py` Knobs); tests | Opus | ➡️ |
| 3c | Overrides in `parse_control` + schema; simulated people with 2-min expiry; master brightness; calm range; applied in `show.py`; reported in `status.json` with sources; inputs logger | Opus | ➡️ |
| 3d | Build `river-all-looks-v2.toe` (`build_all_looks_v2.py`), `shows.json` entry, rebuild, verify with simulated people, tag | Fable | ❌ |
| 4 | v2 page: `mission/public/remembered-v2.*`, `/api/remembered` extended, overrides API in `mission.mjs` + `probe.ps1`, route detection, explainers; tests; `docs/mission-ui.md` | Opus | ❌ |
| 5 | Perf + dead code: `panels.py` → `motion.py`; drop `particles.py`/`flow.py` if unreachable; one motion pass; `lit_pct` cheaper; library load off-thread; mtime-gated reads; constants in one place | Opus | ❌ |
| 6 | `river-agent` PR: `signals` block in `reflex.json`; `memory.valid_until` | Opus | ✅ [PR #14](https://github.com/drocamor/river-agent/pull/14), awaiting Dave; the show reads both in 3b/3c |
| 7 | Docs: `remembered-river.md` v2 section, explainer page, GLOSSARY, HANDOFF | Fable | ❌ |

✅ done · ➡️ in progress · ❌ not started

## Log

- 29 Oct 01:00 steps 1 and 2 done; the rollback is in place. 3a/3b/3c started in parallel, each owning its own files (`ropes.py`+`room.py`; `clock.py`+`knobs.py`; `control_schema.py`+`status.py`+`overrides.py`+`inputs_log.py`); `show.py` is wired afterwards by Fable.

- 29 Oct 00:55 1a deployed (counter restarted on bitcube, streaming); river-agent PR #14 open. Step 2 design: the frozen file builds from a pinned second checkout `C:\Users\user\River\river-bitcube-v1` (git worktree at the tag) via `REPO_OVERRIDE` in the build scripts, instead of vendored copies: no import rewrites, and the live repo's code can't reach it.
- 29 Oct 00:10 plan written; baton taken on bitcube (HANDOFF). Step 1a and 1b started in parallel (different files).
