# Mission control status fixtures

Run the server on them with `MISSION_FIXTURES=$(pwd)/mission/test/fixtures` (see `mission/server.mjs`); `node --test` uses them for the status model.

Hand-written scenarios for mission control's `GET /api/status`, one JSON file per situation, so the new UI can be
designed and screenshotted against every state of the installation, not just the happy one. The server's fixture
mode (`MISSION_FIXTURES=<dir>`) serves `status`, `cameras` and `camera_age_s`; reviewers read `_scenario`.

- `build.mjs` is where the scenarios are written (as data on top of an all-good base); `node build.mjs` rewrites the
  JSON files. Edit the scenario there, not the JSON, or the next build will undo it.
- `node check.mjs [name ...]` validates every file: it parses, has the format, `_scenario.expect` is complete, the
  payload is internally consistent, and the v1 pages read it without throwing (copies of `rows()` from the old
  `status.html`, the `Now` block of the old `mission.html` and `toMap()` from `map-live.js`). Its last column prints what
  the v1 status page would have said; the v2 pages (docs/mission-ui.md) judge every fixture through `public/model.js`
  instead (`test/model.test.mjs`).
- Served by the fixture server, each scenario is its own world: its clock is the scenario's moment moved forward by
  whole days (02:59 Pacific, today; it stands still between polls, so ages read as written), its history (since when,
  what was last done) is in memory per scenario, and so is the scripted calibration run. Lights come from
  `lib/lights.mjs`'s synthetic frames and the newest map and screens file in the clone (`tools/pixelmap/`).
- Base: the real payload recorded at 03:00 on 23 Oct (`_recorded-2026-10-23.json`; the underscore keeps it out of the scenario list). Every
  fixture is "taken" at the same moment, `NOW = 1792749540000` (2026-10-23 02:59:00 PDT), two seconds after it.

## File format

```json
{ "_scenario": { "title": "...", "description": "what is going on in the world, in plain words",
                 "expect": { "headline": "the one-line verdict a correct UI must show",
                             "severity": "ok | warning | down | unknown",
                             "items": { "<equipment or link>": "ok|warning|down|unknown: short reason", "...": "..." },
                             "action": "what the team should do about it" } },
  "status": { "bitcube": {...}, "seasons": {...}, "modal": {...}, "probe": {...} },
  "cameras": { "gallery": true, "river": false },
  "camera_age_s": { "gallery": 25, "river": null } }
```

- `status` is exactly what `mission/lib/mission.mjs` `snapshot()` returns, minus the `studio` key (the server adds
  it). Each source is `{ at, value | error, age_s }`: `at` in ms epoch, `age_s = round((NOW - at) / 1000)`, and an
  error is the string `mission.mjs` records (`e.message` of the fetch, or the SSH probe's reason). A source that
  hasn't been polled yet is simply absent (`nothing-known-yet`).
- `cameras.<cam>` says whether a still exists for that camera (the fixture server serves a placeholder) and
  `camera_age_s.<cam>` how old it is in seconds (`null` when there is no still). Stills come through bitcube, so
  there are none while bitcube is offline; a still can be old (cached) while the camera has gone quiet.
- `expect.items` uses the same fifteen keys in every file: `mission control`, `bitcube`, `touchdesigner`,
  `seasons`, `ropes`, `rope box 1`, `rope box 2`, `hub75 panels`, `gallery camera`, `river camera`, `router`,
  `internet`, `modal agent`, `modal link`, `recorder`.

## The scenarios

| file | situation | expected verdict |
|---|---|---|
| `all-good` | everything up: seasons file at 60 fps, automatic mode mid-spring, sender open (182 + 191 W of 600), both boxes, LED display, both cameras, Modal ticked a minute ago; people counter not available (normal) | ok |
| `bitcube-offline` | bitcube TCP down; seasons `fetch failed`; probe error `can't reach bitcube over SSH` 400 s old; Modal fine; no stills | down: nothing behind bitcube can be checked |
| `td-frozen` | bitcube up, probe answers, `td = { ok: false, error: 'no answer from the TD bridge' }` (a dialog blocks TD); seasons page times out though its port accepts TCP; devices all fine | down: TD frozen, ropes not driven |
| `td-low-fps` | like all-good with `td.fps` 4.1 of 60 and 3 errors | warning: jerky river |
| `river-cam-stale` | online file running (so no seasons page, expected); river cam's port answers but TD's relay has had no frame for 1800 s, `fresh: false`; last river clip to Dave at 01:58; cached river still 1800 s old | warning: running on the rain fallback |
| `gallery-cam-down` | `devices.gallery_cam` false; last gallery clip at 02:43 (15 min ago), errors since; no gallery still | warning: no picture of the room, show unaffected |
| `modal-scene-old` | Modal reachable, `ok: true`, but the last tick finished 9 h ago and `next_tick_epoch` is in the past; sync log 9 h old | warning: Dave's agent stopped; room unaffected (seasons file) |
| `ropes-dark-on-purpose` | `td.ropes.source 'black'`, active, sender open, 0 + 0 W, boxes reachable | warning: dark by choice, not a fault |
| `just-booted` | uptime 0.1 h; TD on the seasons file with `fps: null` (first probe); year just started (winter, no history); Modal link 0 processes, logs 12 min old | warning: still coming up |
| `nothing-known-yet` | the server just started: `status` holds only `bitcube`; no stills | unknown: checking |
| `lights-not-connected` | the real 03:00 payload nearly verbatim: boxes unreachable, sender `OSError 10049` and retrying, `displays ["\u0000"]`, river cam down, manual summer 0.39, Modal scene from last night, recorder `"Error ope"` | down: lights not connected (expected before the lift) |
| `seasons-not-running` | TD runs `river-online-oct-20.toe`: seasons `fetch failed` (connection refused), `td.seasons` null, live river relay fresh, boot file still the seasons file | warning: the year and its controls unavailable |
| `no-internet` | `devices.internet` false, router true; Modal fine from the mini; uploads failing since 02:38; river cam unreachable | warning: show runs, cameras can't reach Dave |

## How to use `expect`

`expect` is the review contract, not UI copy. For each screenshot of a page on a fixture, a reviewer checks:

1. **Headline:** within five seconds, does the page say what `expect.headline` says, in substance? Same verdict,
   same main cause. Wording may differ; the verdict and the cause may not.
2. **Severity:** does the page's overall state match `expect.severity`? `ok` = nothing to do; `warning` = the
   show is running but something needs attention or is deliberately unusual (dark ropes, a camera, Dave's
   agent); `down` = the piece isn't running as it should, or can't be checked; `unknown` = not enough data yet.
   A page that shows `ok` for a `warning`/`down` fixture, or that shows stale data as fresh, fails the review.
3. **Items:** for each key in `expect.items`, is that piece of equipment shown in the right state, with roughly
   that reason? `unknown` items must look unknown (never green, never red); `ok` items should not alarm.
4. **Action:** can a reader tell what to do next, and is it `expect.action` in substance? If the action is
   "nothing", the page must not nag.

The `description` is the ground truth of the world, for the reviewer only; the UI never sees it.

## What the real producers do (the fixtures follow this, even where the brief guessed differently)

Read before changing a scenario. Sources: `mission/lib/mission.mjs`, `tools/mission/probe.ps1`,
`tools/mission/td_mission.py`, `td/ropes/artnet_out.py`, `td/cameras/river_cam.py`, `td/seasons/seasons_td.py`,
`td/seasons/seasons.py`, `td/build/build_seasons_local.py`, `tools/modal/modal_link.py`, Dave's
`capture/capture.py` and `gallery/sync.py` (river-agent), `tools/cameras/record.py`.

- **`td.river_cam` is `null` whenever the seasons file runs.** `build_seasons_local.py` destroys
  `/project1/river_local` (the relay lives there) and `td_mission.py` returns `None` without it; the recorded
  payload confirms it. So `all-good` has `river_cam: null` (the brief asked for a fresh relay), and
  `river-cam-stale` runs the **online file** (the only file that watches the river camera), which is why that
  fixture also has the seasons page absent. The real `status()` keys are `relay, frames, last_frame_age_s, fresh,
  error, colourfulness, night, nightness` (there is no `fps`); `fresh` is `last_frame_age_s < 10`.
- **`river_cam.error` is never a stream error.** It is only set when the relay *process* can't be started; a dead
  stream shows as `last_frame_age_s` growing and `fresh: false` with `error: null`. The brief's "a timeout as the
  last error" can't occur.
- **`modal_link.<name>.last` is the last `INFO` line of the last 200 lines; `log_age_s` is the file's mtime.**
  capture.py logs failures at `ERROR` (and sync.py at `WARNING`), which touch the file but never become `last`.
  So a camera that is down shows a *small* `log_age_s` (errors keep landing, ~every 20-70 s) and a `last` line whose
  `HH:MM:SS` is old (the last good clip); after a long outage `last` becomes `null` (no INFO line left in the last
  200, as the real river log shows). `gallery-cam-down`, `river-cam-stale` and `no-internet` are modelled that
  way; the brief's `log_age_s` 900/3600 would only happen if the capture child were hung. `sync` only logs on
  changes, so a *stalled* Modal (`modal-scene-old`) does make its log old. Improvement for the probe: report the
  age of the last INFO line.
- **The probe is one SSH call; its `time` is bitcube's clock when it started**, about 8 s before the mini got the
  answer (`at`), longer when the TD bridge times out (`td-frozen`: 24 s). Log ages and device checks are measured
  at that start.
- **Error sources are re-stamped on every failed poll**, so in practice an error's `age_s` stays under the poll
  interval (60 s for the probe). `bitcube-offline` keeps the brief's 400 s (stale *and* failed): treat it as the
  poller itself having stalled.
- **Fetch errors from the seasons page** (`mission.mjs` records `e.message`): a closed port (TD not running, or the
  online file) and an unreachable host both give `fetch failed` (Node 26's undici hides ECONNREFUSED); a frozen TD
  gives `The operation was aborted due to timeout` (4 s). The UI can't distinguish "refused" from "unreachable"
  from the string alone; use `bitcube.online`, `devices.seasons_page` and `td.file`.
- **`devices.seasons_page` is a bare TCP connect**, which a frozen TD still passes (the socket is the kernel's), so
  it can be `true` while the page times out (`td-frozen`). The same goes for `devices.river_cam` with a wedged
  camera (`river-cam-stale`).
- **`td.seasons` is `Year.state()` only** (`mode, effective_mode, phase, season, weights, intensity, target,
  manual, presence`); the page's `/state` adds `counter_available, rules, history, file`. Both come from the same
  object, so they agree.
- **Sender counters live in `comp.storage`, which is saved in the `.toe`:** `sent`, `packets`, `seq` and `watts`
  survive restarts and keep their last value while `open` is false. The real `watts [106, 120]` with the boxes
  unplugged are stale; `just-booted` keeps the recorded `sent`. Only `open`, `error` and `retrying` are live.
- **`displays`:** `["\u0000"]` is what WMI gives with no monitor at all (a null name, cast to one NUL character);
  with the Colorlight sender attached it reads `LED 1920X1080`. The M14 monitor isn't at Gray Area.
- **Recorder `last` is the raw last line of `record.log`, cut to 120 characters**, and record.py writes ffmpeg's
  multi-line stderr (cut to 200 chars) into the log, so the file's last line can be a fragment such as
  `"Error ope"` (kept verbatim in `lights-not-connected`). A finished run ends with `... done`.
- **Dave's agent ticks every 5 min from 09:00 to 01:55 Central (07:00-23:55 PDT) and rests overnight.**
  `next_tick_epoch` is computed from the cron, so during the rest it points to the last slot, i.e. the past: at
  03:00 the real payload's "scene from 23:53" is the agent resting, not broken (`lights-not-connected` says so).
  `modal-scene-old` is the real fault: a 17:58 scene that missed six hours of daytime ticks. `all-good` follows the
  brief (a tick a minute ago) although at 02:59 the agent would really be resting. `set_at` is in `-07:00`,
  `finished_at` in `+00:00`: Dave's files mix zones.
- **`modal_link.processes` is 8 when healthy** (supervisor + 3 children, each seen twice through the venv
  launcher), 0 when not running.
- **The people counter doesn't exist yet:** `presence.available` and `counter_available` are false everywhere,
  `usual` sits on its 0.75 floor, dynamic mode can't be chosen. That is normal, not a fault.
- **Weights, season names and intensities** follow `seasons.py` (`weights()` cosine blend; `season` is the
  rounded phase; automatic intensity is the blend of 0.05/0.45/0.85/0.35), so the numbers are what the page
  would really serve.

## What today's status page says (from `check.mjs`)

`all-good`, `modal-scene-old`, `ropes-dark-on-purpose` and `td-low-fps` all read "everything is up"; `just-booted`
flags only the Modal link; `nothing-known-yet` shows **bitcube red** (its row is `online && probeAnswered`, so a
reachable bitcube is "down" until the first probe); `lights-not-connected` lists four red rows but not the sender
error; `river-cam-stale` and `seasons-not-running` both say "Seasons control page" without saying why. These are
the gaps the redesign exists to close.
