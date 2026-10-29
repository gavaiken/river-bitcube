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
| 3a | People effects: `room.py` (the people model) + `ropes.py` (sparks/splashes, gathering, crowd turbulence ≤ 1.8 m, ocean → pond); tests, offline preview | Opus | ✅ `04e43e1` |
| 3b | Knobs from the day's profile + Dave remap (`knobs.py`, `clock.py` valid_until + signals); tests | Opus | ✅ `4562c73` |
| 3c | Overrides in `parse_control` + schema; simulated people with 2-min expiry; master brightness; calm range; applied in `show.py`; reported in `status.json` with sources; inputs logger | Opus | ✅ `66825e4` (modules), `6268ce2` (`show.py` wired) |
| 3d | Build `river-all-looks-v2.toe` (`build_all_looks_v2.py`), `shows.json` entry, rebuild, verify with simulated people, tag | Fable | ✅ `4107199` registered, `5186f33` rebuilt from live code, TD on it 01:35; verified 01:36 with a simulated lingerer (rope 7) + 6 people: sparks 25–40, crowd 0→0.68 in 42 s, 300–960 W, 57–64 fps, the column visibly lit on the cam. **Boot default still `river-all-looks.toe` (v1)** until Gavin says. |
| 4 | v2 page: `mission/public/remembered-v2.*`, `/api/remembered` extended, overrides API in `mission.mjs` + `probe.ps1`, route detection, explainers; tests; `docs/mission-ui.md` | Opus | ✅ `03c28cf` + `e97c8fb` (the writers swap with Move-Item: IO.File::Replace failed on bitcube); all six probe actions exercised on bitcube 01:51 |
| 5 | Perf + dead code: `panels.py` → `motion.py`; drop `particles.py`/`flow.py` if unreachable; one motion pass; `lit_pct` cheaper; library load off-thread; mtime-gated reads; constants in one place | Opus | ✅ `e1cf141`: 3.5 → 2.2 ms a tick offline; on bitcube Python 11–15 → 3 ms, 60 fps; v2 now plays the approved 30 fps clips (it matched only the v1 name) |
| 6 | `river-agent` PR: `signals` block in `reflex.json`; `memory.valid_until` | Opus | ✅ [PR #14](https://github.com/drocamor/river-agent/pull/14), awaiting Dave; the show reads both in 3b/3c |
| 7 | Docs: `remembered-river.md` v2 section, explainer page, GLOSSARY, index; HANDOFF + session summary | Opus (docs), Fable (handoff) | ✅ `d77c76e`, `docs/sessions/V2.md` |

✅ done · ➡️ in progress · ❌ not started

## Log

- 29 Oct 16:12 **opening-day audit** (Gavin: /remembered full of "not known", is v2 too bright?): (1) mission control couldn't parse the probe since v2's status gained `knobs.why` with a middle dot (PowerShell re-emits it as an invalid byte): status.json is ASCII-only now (`cf859da`), hot-reloaded on bitcube, probe parses; (2) brightness by the numbers: calm 140–350 W, building ~300 W, the surge ~990 W (the design's full white; under the 1,250 W budget); the camera's auto-exposure saturates on it; master brightness and the calm range are on /remembered-v2 if the artists want it softer; (3) people: 769 log lines with visitors near the piece today, **0 lingerers**: thresholds lowered to 5 s still at 25 % of the frame (`aed0e75`), counter restarted 16:10.

- 29 Oct 07:51 **the v1-era runtime tools, done** (was open: they named only the v1 file). `tools/remembered/runtime_guard.py`: `direct_video.py`, `video_trial.py` and `profile_capture.py` (start) refuse when `remembered.show` loads from `river-bitcube-v1` (the frozen file: never patch it) or the open file isn't `river-all-looks-v2.toe`, and print what replaced them. On v2: `direct_video.py` only writes `control.json` `screens.motion_mask` (atomic; the show reads it, the readback skip is built in); `video_trial.py` keeps/rolls back/reports v2's own `video-library.json` entry (rolling back a trial v2 only inherits pins it to the originals), changing only the running clip list, no module patching; `profile_capture.py` times `river_luma`, `Motion.feed_luma`, `Water.feed_luma` (no `Water.feed`, no panels). `update_all_looks_ribbons.py` accepts both all-looks names, so `build_all_looks_v2.py` no longer string-patches it (shows.json entries updated; nothing rebuilt). Tests: `test_runtime_guard.py`, `test_direct_video.py`, `test_video_trial.py`, `test_profile_capture.py`.

- 29 Oct 02:15 **all steps done.** v2 rebuilt after step 5 and running on bitcube (`abab5ab`), 60 fps, Python ~3 ms. Open: v2 as the boot default (Gavin); Dave's PR #14.

- 29 Oct 01:52 v2 page live in mission control (self-updates within ~5 min); probe actions proven on bitcube; perf agent (5) and docs agent (7) running.

- 29 Oct 01:35 v2 file built from the live code and running on bitcube (`5186f33`); step 4 (page) and 5 (perf) agents running; simulated-people test next. Found: `probe.ps1`'s looks / remembered-* guards only accept `river-all-looks.toe`, so they refuse while v2 runs (fix in step 4).

- 29 Oct 01:00 steps 1 and 2 done; the rollback is in place. 3a/3b/3c started in parallel, each owning its own files (`ropes.py`+`room.py`; `clock.py`+`knobs.py`; `control_schema.py`+`status.py`+`overrides.py`+`inputs_log.py`); `show.py` is wired afterwards by Fable.

- 29 Oct 00:55 1a deployed (counter restarted on bitcube, streaming); river-agent PR #14 open. Step 2 design: the frozen file builds from a pinned second checkout `C:\Users\user\River\river-bitcube-v1` (git worktree at the tag) via `REPO_OVERRIDE` in the build scripts, instead of vendored copies: no import rewrites, and the live repo's code can't reach it.
- 29 Oct 00:10 plan written; baton taken on bitcube (HANDOFF). Step 1a and 1b started in parallel (different files).
