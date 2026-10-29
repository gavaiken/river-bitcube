---
title: "A River Becoming: the remembered river (design and contracts)"
---

# The remembered river

The final visualization, agreed with Gavin, Will and Justine on 27 Oct (the grilling in session A). The artists' spec is their doc "What is it like to be a river? — Rules for the light"; this page is how we build it and the contracts between the parts. Terms: [GLOSSARY.md](../GLOSSARY.md) (remembered day, loop, phase, surge, decision wave, the pool, day's season, lingerer).

## Who does what

| Part | Owns | Where |
|---|---|---|
| Dave's agent (Modal) | Which remembered day, why, and when the surge lands; palette and the four knobs; `heard` | `drocamor/river-agent` |
| bitcube (TouchDesigner) | The loop clock, playback of the day, the surge choreography, the decision wave, the panels, the pool and eddies, the lingerer reflex, the fallback when Dave is late | `river-remembered.toe`, `td/build/build_remembered.py`, `td/remembered/` |
| People counter (bitcube) | Presence, and each person's place and stillness in the show view | `tools/presence/counter.py` |
| Calibration | Each LED's height above the floor, the pool line, the driftwood eddies, each rope's foot in the show view, the screens' heights | `tools/remembered/zones.py` → `tools/pixelmap/zones-<date>.json` |
| Mission control | The **Remembered river** debug page (inputs, decision, outputs, why), the pool/eddy adjusters, the opening-night switch | `mission/public/remembered.*` |

Decisions: bitcube owns the loop clock; a new remembered day takes effect only at the next loop boundary (with the decision wave). The surge lands at Dave's `surge_at` when present, else at the day's heaviest hour of rain moved by the room, clamped to 1.5–3.6 min into the loop. Each of Dave's choices plays once, if it is under 15 min old (v2: until his `valid_until`, at most an hour; see [v2](#v2-29-oct-2026)); between his choices (his ticks run about 5–15 min apart) and when he is absent, bitcube plays one of the notable days itself, never the same twice in an hour. Remembered days come only from days that have data. The gallery cam stays on the show view (low: people and the base of the piece); it pans and tilts only during a calibration, and always returns home.

## 1. The data: remembered days

Built once on the Mac mini by a script in river-agent (private: it holds the reach and the point), committed to both repos (`data/remembered/` here; the same files in river-agent).

- **Flow:** Dry Creek near Dobbins, the National Water Model reach at the river site (its ID and Will's pin are in river-agent's private config, never here), **NWM v3 retrospective**, hourly, Oct 2002–Jan 2023, from the public zarr on AWS. Modelled reach flow, not a measurement. Missing values stay missing; nothing is interpolated across gaps. Days are fixed PST (UTC−8), as Will's summaries are.
- **Weather:** Open-Meteo historical, hourly, at the same point: precipitation (mm), temperature (°C), snowfall (cm), is_day.
- **Today:** NWM operational `analysis_assimilation` for the same reach (NOAA's NWPS reach streamflow API), fetched by Dave's agent each tick and archived (rolling window). A different model product: always labelled as such. Gap 2023–2026 is not filled.

Files (`data/remembered/`):
- `days.csv`: one row per day with data: `date, flow_mean_cfs, flow_max_cfs, flow_pct` (percentile of the day's mean flow in the record), `rain_mm, rain_max_mm_h, heaviest_hour, tmin_c, tmax_c, snow_cm, season, dry, cold, hours_flow` (hours with flow values).
- `profiles.json.gz`: `{date: {flow: [24], rain: [24], temp: [24], snow: [24], is_day: [24]}}` (null for missing hours).
- `notable.json`: the 30 most extreme days: `[{date, kind: flood|drought|first_rain|cold|storm, line}]`, `line` built from numbers only ("8 Jan 2017: highest modelled flow in the record, 412 cfs; 81 mm of rain").

## 2. The scene contract (Dave → bitcube)

Additive fields in `state.json` (mirrored to `River\gallery_state\state.json` by `sync.py`):

```json
"memory": {
  "date": "2017-02-07",
  "reason": "Cold steady rain at the creek today, like 7 Feb 2017.",
  "chosen_by": "resemblance",
  "chosen_at": "2026-10-28T04:10:00Z",
  "product": "NWM v3 retrospective (modelled reach flow) + Open-Meteo",
  "stats": {"flow_mean_cfs": 41.2, "flow_pct": 96, "rain_mm": 38.5, "heaviest_hour": 14, "season": "winter", "dry": false, "cold": true},
  "profile": {"flow": [24], "rain": [24], "temp": [24], "snow": [24], "is_day": [24]}
},
"surge_at": 13.5
```

- `surge_at`: the remembered hour (0–24) the surge lands on; `null` on a dry day (no surge).
- `reflex.json` gains `heard` (0–1: how loud the river sounds in the latest clip; `null` when unknown). The ropes follow `heard` when present, the picture (river cam motion) otherwise; the panels always follow the picture.

## 3. Calibration zones (`tools/pixelmap/zones-<date>.json`)

From a multi-view pixel map (`sphere.py`: every LED a 3D direction from the camera) plus a show-view still.

- **Height:** a rope hangs vertically, so along one rope the direction's elevation fixes height up to the rope's distance; the rope's lowest decoded LED (on the floor coil) fixes that distance given the camera height `cam_height_m` (measured or estimated; adjustable). Every LED gets `height_m`; consistent across ropes, not exact.
- **Pool:** LEDs with `height_m <= pool_height_m` (adjustable live; default 0.25 m above the coil tops).
- **Eddies:** where a rope crosses a log: `[{rope, from, to}]` (LED indices), found from log outlines on a still and checked by lighting the LEDs (individual LEDs on/off where the map is thin).
- **Rope feet in the show view:** `[{rope, x, y}]` (0–1, top-left), for mapping lingerers to ropes.
- **Screens:** each screen's centre height (for the order the surge front lights them) and tilt (degrees, to cancel).

**As built** (`tools/remembered/zones.py`, tests `tools/tests/test_zones.py`; pure repo work, nothing touches the camera or the lights):

```
python tools/remembered/zones.py build --map tools/pixelmap/pixelmap-<date>.json [--screens tools/pixelmap/screens-<date>.json]
       [--logs tools/remembered/logs-<date>.json] [--cam-height-m 2.0] [--pool-above-coil-m 0.25 | --pool-height-m X]
       [--led-pitch-m X] [--rope-distance-m X] [--pitch-deg X] [--out tools/pixelmap/zones-<date>.json]
python tools/remembered/zones.py still --map M --zones Z --logs L --image <show-view still> --out marked.png
python tools/remembered/zones.py light pool|eddies|off|leds [ROPE:FROM-TO ...] [--zones Z] [--pool-height-m X] [--write]
```

File (`zones-<date>.json`; rope numbers 0-based as in the pixel map, LED 0 = the plug end):

```json
{"meta": {"map": "pixelmap-2026-10-28.json", "screens": "...", "logs": "...", "cam_height_m": 2.0, "coil_top_m": 0.28,
          "pool_above_coil_m": 0.25, "pool_height_m": 0.53, "led_pitch_m": 0.0167, "down": [-0.026, 0.978, 0.208],
          "camera_pitch_deg": 12.1, "camera_roll_deg": 1.4, "down_from": "...", "lens": "...", ...},
 "pool_height_m": 0.53,
 "ropes":   [{"rope": 0, "method": "floor", "distance_m": 3.6, "decoded": 204, "heights": [400 × metres, cm],
              "extrapolated": [[0, 40], [390, 399]], "pool_from": 229, "coil_from": 254, "coil_top_m": 0.27}],
 "feet":    [{"rope": 0, "x": 0.31, "y": 0.93}],
 "eddies":  [{"rope": 4, "from": 250, "to": 266, "log": "big log", "decoded": 9}],
 "screens": [{"screen": 2, "height_m": 3.1, "tilt_deg": -4.5, "distance_m": 3.4, "size_m": [0.5, 1.0], "estimated": true}]}
```

- **Down** (which way is vertical, in the map's camera coordinates): every rope is straight with evenly spaced LEDs, so its 3D direction follows from how the spacing shrinks with distance (perspective); down is the robust mean over the ropes. No camera pitch is needed (`--pitch-deg` overrides). The ropes' shared plane line would also give it, but they span too narrow a fan of directions (10° off on the 23 Oct map).
- **Distance per rope** (`method`): `floor` = its lowest decoded LED is the floor (at least 8° below the horizon and not at the picture's bottom edge); `pitch` = from the LED pitch (median over the floor ropes, or `--led-pitch-m`) and how fast its elevation changes, used when the floor disagrees by > 25 % (the lowest LED was hidden); `given` = `--rope-distance-m`; `neighbours` = median of its two nearest ropes by direction; `borrowed` = the map missed it: its nearest rope's heights and foot (x shifted 0.02), as `fill_unmapped` does for positions.
- **Heights:** `cam_height_m + D tan(elevation)` at decoded LEDs (median-smoothed), interpolated along the LED index, continued past the ends along the rope's own slope (up towards the rig; down to the floor, held once in the coil, never below 0) and listed in `extrapolated`. Synthetic room: every LED within 0.35 m, decoded ones within ~8 %. Everything scales with `cam_height_m`: measure it.
- **Pool:** `coil_top_m` is where a rope leaves its straight drop for its coil (median over ropes where it is seen; 0 when none); `pool_height_m = coil_top_m + pool_above_coil_m`. `pool_from` = the first LED from the plug end at or below the pool line (400 = none); TD can recompute it live from `heights` when the line is moved.
- **Feet:** the floor point under each rope, projected into the show view (the gallery cam's home view, as the people counter sees it).
- **Screens** (screens file in the same frame as the map: pin them together): each hangs at the distance of the two ropes nearest it (or `--screen-distance-m`); `height_m` of its centre as for an LED; `tilt_deg` = how far its top leans from vertical as seen from the camera, + = to the right (rotate by −tilt to cancel); `size_m` is a sanity check.
- **Logs** (`tools/remembered/logs-<date>.json`, made by marking `zones.py still`'s picture, which has a 0.1 grid, every LED, rope numbers at the feet and a tick where each pool begins): `[{"name": "big log", "polygon": [[x, y], ...]}]` in the show view (0–1, top left), or `{"frame": "map", "logs": [...]}` for the map's own frame. Eddies = runs of a rope's LEDs inside an outline (gaps ≤ 2 bridged, runs < 3 dropped).
- **Old single-view maps** work too (each pixel through an 87° pinhole guess), but the 23 Oct map's view never reaches the floor, so it needs `--rope-distance-m` or `--led-pitch-m`.
- **Lighting checks:** `light` prints the LED ranges and with `--write` writes `River\remembered\control.json`: `{"t": unix, "zones": {"file": "zones-….json", "light": "pool|eddies|leds|off", "leds": [{"rope", "from", "to"}], "pool_height_m"?}}` for the remembered show to light (the whole file: it drops the other controls). TouchDesigner reads that nested block only where the canonical flat key is absent, and mission control's next write folds it into flat keys (section 5, the control request file).

## 4. Lingerers (people counter)

`presence.json` gains `people: [{x, y, h, still_s}]` (show view, 0–1 from top left, foot point; `h` box height; `still_s` seconds without moving more than a few % of the frame) and `lingerers: [{x, y, still_s, ropes: [i, ...]}]`: people still ≥ 8 s and close (box height ≥ 40% of the frame), with their nearest ropes from the zones file.

**As built** (`tools/presence/counter.py`, tests in `tools/tests/test_presence.py`): `{"t", "count", "people", "lingerers"}`; `t` and `count` unchanged, so the river's year reads it as before.
- **Foot point** = the box's bottom centre / frame size; `h` = box height / frame height; rounded to 3 decimals, `still_s` to 0.1 s.
- **Tracking** (2 fps): a box joins the person whose last box it overlaps (IoU ≥ 0.3), else the one whose foot is within 0.12 frame heights; best matches first. A person unseen for 1 s leaves `people`; for 2 s they're forgotten (a missed detection or two doesn't reset their clock).
- **Still:** the clock restarts when the foot moves more than 0.04 frame heights from where it last started (box jitter doesn't reset it).
- **Lingerer:** `still_s ≥ 8` and `h ≥ 0.40`; `ropes` = up to 2 ropes (0-based) whose feet are within 0.35 frame heights (x scaled by the frame's aspect), nearest first; `[]` when none is near or no zones file is found.
- **Zones file:** `counter.py run --zones=<path>`, else the one a show pins as `calibration.zones` in `shows.json`, else the newest `tools/pixelmap/zones-<date>.json`; re-read when it changes. With the motion fallback (no detector), `people` and `lingerers` are `[]`.
- All thresholds are constants at the top of `counter.py` (`LINGER_STILL_S`, `LINGER_MIN_H`, `STILL_MOVE`, `TRACK_*`, `ROPE_RADIUS`, `NEAREST_ROPES`).

## 5. TouchDesigner status (bitcube → mission control)

TD writes `River\remembered\status.json` twice a second (read by the full check and by mission control's debug page):

```json
{"t": 1793160000.0, "show": "river-remembered.toe", "fps": 60,
 "loop": {"index": 12, "t_s": 141.2, "length_s": 300, "hour": 11.3},
 "phase": "building",
 "day": {"date": "2017-02-07", "reason": "...", "chosen_by": "resemblance", "source": "dave", "age_s": 220, "next": null},
 "surge": {"hour": 13.5, "t_s": 162.0, "why": "Dave: hour 13.5", "room_shift_s": 0},
 "knobs": {"speed": 0.5, "density": 0.6, "brightness": 0.7, "turbulence": 0.4, "reflex": {"speed": 0.05},
           "why": {"speed": "Dave 0.42 · day 0.61 · reflex +0.05 → 0.57", "density": "Dave 0.55 · day 0.65 → 0.60",
                   "brightness": "Dave 0.70 · day 0.70 → 0.70", "turbulence": "Dave 0.35 · day 0.45 → 0.40"}},
 "palette": ["#0b3d5c", "#1f8fb3", "#bfefff"],
 "ropes_follow": "sound", "heard": 0.62, "river_motion": 0.41, "river_source": "live",
 "room": {"presence": 3.2, "usual": 2.1, "relative": 1.5, "lingerers": [{"x": 0.4, "y": 0.8, "still_s": 12, "ropes": [7, 8]}]},
 "panels": {"lit_pct": [12, 8, 22, 4], "cap": 0.55, "field": "ribbons"},
 "screens": {"mode": "particles", "field": "ribbons", "video": 0.15, "intensity": 0.82, "threshold": 0.35},
 "ropes": {"watts": 410},
 "opening_night": false,
 "zones": {"file": "zones-2026-10-27.json", "pool_height_m": 0.6, "light": "off"},
 "inputs": {
   "day": {"value": "2017-02-07", "source": "dave", "age_s": 220.0, "fresh": true},
   "scene": {"value": [0.6, 0.4, 0.7, 0.3], "source": "dave", "age_s": 220.0, "fresh": true},
   "reflex": {"value": [0.05, 0.0, 0.0, 0.0], "source": "dave", "age_s": 4.0, "fresh": true},
   "heard": {"value": 0.62, "source": "sound", "age_s": 4.0, "fresh": true},
   "river_motion": {"value": 0.41, "source": "cam", "age_s": 0.1, "fresh": true},
   "headcount": {"value": 3.2, "source": "counter", "age_s": 0.5, "fresh": true},
   "lingerers": {"value": [7, 8], "source": "counter", "age_s": 0.5, "fresh": true},
   "control": {"value": null, "source": "control", "age_s": 812.0, "fresh": true}},
 "params": {
   "day": {"mode": "auto", "auto": "2017-02-07", "value": "2017-02-07", "source": "auto", "expires_in_s": null},
   "surge_hour": {"mode": "auto", "auto": 13.5, "value": 13.5, "source": "auto", "expires_in_s": null},
   "knob.speed": {"mode": "adjust", "auto": 0.5, "value": 0.7, "source": "adjusted", "expires_in_s": null},
   "knob.density": {"mode": "auto", "auto": 0.6, "value": 0.6, "source": "auto", "expires_in_s": null},
   "knob.brightness": {"mode": "auto", "auto": 0.7, "value": 0.7, "source": "auto", "expires_in_s": null},
   "knob.turbulence": {"mode": "auto", "auto": 0.4, "value": 0.4, "source": "auto", "expires_in_s": null},
   "palette": {"mode": "auto", "auto": ["#0b3d5c", "#1f8fb3", "#bfefff"], "value": ["#0b3d5c", "#1f8fb3", "#bfefff"], "source": "auto", "expires_in_s": null},
   "flow_level": {"mode": "auto", "auto": 0.62, "value": 0.62, "source": "auto", "expires_in_s": null},
   "headcount": {"mode": "fix", "auto": 3.2, "value": 8, "source": "fixed", "expires_in_s": 74},
   "lingerer_rope": {"mode": "auto", "auto": 7, "value": 7, "source": "auto", "expires_in_s": null},
   "calm_min": {"mode": "auto", "auto": 0.18, "value": 0.18, "source": "auto", "expires_in_s": null},
   "calm_max": {"mode": "auto", "auto": 0.6, "value": 0.6, "source": "auto", "expires_in_s": null},
   "master_brightness": {"mode": "auto", "auto": 1.0, "value": 1.0, "source": "auto", "expires_in_s": null}},
 "effects": {},
 "overrides": {},
 "simulating": true,
 "people": {"available": true, "headcount": 8, "crowd": 0.62, "empty": 0.0, "wake": 0.0, "linger_strength": 0.8,
            "linger_ropes": [6, 7, 8], "lingerers": 1, "nobody_s": 0.0},
 "signals": {"gallery": {}, "river": {}}}
```

**v2 additions** (plan decisions 5, 6, 8; `status.py` `build(sources=, params=, effects=, overrides=, people=, knobs_why=, signals=)`, all filled by `show.py`), so mission control can show inputs → parameters → outputs and who is steering:

- `inputs`: always every name in `status.INPUTS` (`day`, `scene`, `reflex`, `heard`, `river_motion`, `headcount`, `lingerers`, `control`), each `{value, source, age_s, fresh}` (`value` a number, string, list or null, never an object: `scene` and `reflex` give their knobs as `[speed, density, brightness, turbulence]`); `source` is one of `dave`, `notable`, `preset`, `cam`, `clip`, `sound`, `counter`, `simulated`, `control` (null: no such input now, `fresh` false). A simulated headcount or lingerer reports `source: "simulated"`.
- `params`: always every overridable parameter (`control_schema.PARAMS`), each `{mode: auto|fix|adjust, auto, value, source: auto|fixed|adjusted, expires_in_s}`: what the show computed, what it used, and how long an override has left (null: sticky until cleared).
- `effects`: what the people effects in the ropes are doing (from `ropes.py`, passed through as it gives them; `{}` while they report nothing). Its keys are the ropes' own.
- `overrides`: the overrides in force, keyed by parameter, each the cleaned `control.json` entry plus `expires_in_s` and `simulated`, e.g. `{"headcount": {"mode": "fix", "value": 8.0, "at": "2026-10-29T04:12:09Z", "expires_at": "2026-10-29T04:14:09Z", "expires_in_s": 74, "simulated": true}, "knob.speed": {"mode": "adjust", "offset": 0.1, "gain": 1.2, "at": "2026-10-29T04:00:00Z", "expires_at": null, "expires_in_s": null, "simulated": false}}`.
- `simulating`: true while a simulated headcount or lingerer is in force (the page's red SIMULATING banner).
- `knobs.why`: each knob's parts in words (`knobs.describe`): Dave's remapped voice, the remembered day's hour, the reflex when it moves the knob, and the knob before any override (`params.knob.*` has the override).
- `people`: the room as the ropes feel it (`room.RoomState.status()`, from the counter's newest count, or the simulated people): `headcount`, `crowd` (0–1, mounts and subsides over ~60 s), `empty` (0–1), `wake` (someone just came into an emptying room), `linger_strength` and `linger_ropes` (the ropes gathering light), `lingerers`, `nobody_s`.
- `signals`: Dave's raw signals from `reflex.json` (drocamor/river-agent#14; `clock.read_signals`), `{group: {name: {value, slow, age_s, stale}}}`, with `gallery` and `river` always present (empty until his agent sends them).

**The inputs log** `River\logs\inputs.jsonl` (`td/remembered/inputs_log.py`): one line `{"t", "inputs": {name: {"v", "s"}}, "params": {name: {"v", "s"}}}` every 5 s, or sooner (at most once a second) when an input's or parameter's source changes or its value moves by more than 2 % (of a 0–1 range; 2 % of the value above 1). At 20 MB it moves to `inputs.jsonl.1` (one old file kept). `inputs_log.recent(path, seconds=86400, fields=['inputs.heard', 'params.knob.speed'])` returns `{field: [[t, value], ...]}`, at most 300 points per field (numbers averaged per time bucket), for the page's sparklines.

Mission control controls (all through `probe.ps1`, refused while another show runs): `remembered-zones {pool_height_m?, light: off|pool|eddies}`, `remembered-opening {on}`, `remembered-screens {video?, intensity?, threshold?}`. All end up in `River\remembered\control.json` (also written by `zones.py light … --write`, with `light: leds` for individual LEDs).

Optional, additive: `day.profile` (`{flow, rain, temp, snow, is_day}`, 24 values each, as in `profiles.json.gz`) when bitcube plays a day that isn't Dave's (a notable day): the debug page then draws that day's hours; without it, it draws Dave's `memory.profile` only when the day playing is his.

**The control request file** `River\remembered\control.json` (written by mission control through `probe.ps1`, read by TouchDesigner). **One schema**, `td/remembered/control_schema.py` (each field's type, range, default and meaning); mission control and its page read a generated copy, `mission/public/remembered-schema.js` (regenerate with `python td/remembered/control_schema.py`; `tools/tests/test_control_schema.py` fails while it is stale). The canonical shape, flat keys and the screens in one block:

```json
{"pool_height_m": 0.6, "light": "pool", "light_at": "2026-10-29T04:12:09Z", "opening_night": true,
 "screens": {"intensity": 0.82, "threshold": 0.35, "video": 0.7}, "at": "2026-10-29T04:12:09Z"}
```

| Field | Range | Default (absent) | Meaning |
|---|---|---|---|
| `pool_height_m` | 0–1.5 m | `null`: the zones file's own | the pool line above the floor |
| `light` | `off` `pool` `eddies` `leds` | `off` (the show) | light the LEDs at or below the pool line, the eddy LEDs, or `leds` (zones.py only) to check them |
| `light_at` | UTC time | the file's `at`, else its write time | when `light` was last set (probe.ps1 stamps it with every `remembered-zones`) |
| `leds` | `[{rope, from, to}]` | `[]` | `light: leds` only |
| `opening_night` | true/false | **true** | the opening-night switch: on unless the file says `false` |
| `screens.intensity` | 0–1 | 0.82 | how bright the screens are (0: dark, not "unset") |
| `screens.threshold` | 0–1 | 0.35 | how much the river has to move to show in its video |
| `screens.video` | 0–1 | 0.7 | how strongly the river video shows under the particle windows (M9) |
| `screens.mode` / `.field` / `.gpu` / `.motion_mask` | `particles`·`water` / `ribbons`·`fine`·`streaks` / bool / bool | `particles` / `ribbons` / true / true | the screens' engine (set by hand or by tools, not by the page) |
| `at` | UTC time | | when the file was last written |

- **Precedence:** a flat key wins. The older spellings count only when the flat key is absent: `zones.{pool_height_m, light, leds}` (and its `t` as `light_at`; what `zones.py light --write` writes), `opening.on`, `screen_<name>`. An invalid value is dropped (its default stands), it never lets an older spelling back in. probe.ps1 folds the nested `zones` block (and `t`, `opening`) into flat keys on every write and drops it, so after one mission control write the file is canonical again.
- **Light checks never stick:** TouchDesigner ignores a `light` other than `off` that was set before the show started (a restart of bitcube or TouchDesigner, or a rebuild: it never comes up in calibration white) or more than 10 minutes ago (`control_schema.LIGHT_MAX_S`): it goes back to the show by itself and prints why once. TouchDesigner only reads the file (no second writer); since `light_at` moves only when someone picks a light, a later slider write doesn't bring an old light back. Its status reports the light it actually uses (`zones.light`).
- **Nothing is seeded:** a write changes only its own fields; the others keep what the file held, and a field nobody set stays absent (TouchDesigner uses its default). In particular `opening_night` is written only by `remembered-opening`. The screens' Apply sends only the sliders moved, in 1 % steps. The file is written whole to `control.json.tmp` and swapped in (`[IO.File]::Replace`), so a reader never sees half of it.
- TouchDesigner reports what it took in its status (`zones`, `opening_night`, `screens`, `params`, `overrides`).
- **Overrides** (v2, plan decision 6): `"overrides": {<param>: {"mode": "auto"|"fix"|"adjust", "value", "offset", "gain", "at", "expires_at"}}`, one entry per parameter in `control_schema.PARAMS` (the generated module carries them as `params`, with range, default, unit, group, the modes each allows and its doc). **fix** uses `value` instead of the show's own; **adjust** (numbers only) uses `auto × gain + offset` (gain 0–4, default 1; offset within ± the range, default 0), clamped to the parameter's range; **auto** or no entry: the show's own value. Sticky until cleared (the entry removed or set to auto) or `expires_at` (UTC; null: no expiry). **Simulated people** (`headcount` 0–20, `lingerer_rope` 0–19, fix only) need an `at` and never last past `at` + 2 minutes (`SIMULATED_MAX_S`), whatever `expires_at` says; one stamped over a minute in the future is ignored. Invalid entries, unknown parameters and expired entries are dropped when read (`validate_overrides(raw, now)`); `td/remembered/overrides.py` applies them (`apply(name, auto, overrides, now) -> (value, how)`, `simulated_people`).

| Parameter | Range | Modes | What |
|---|---|---|---|
| `day` | a date in `data/remembered/days.csv` | fix | the remembered day playing |
| `surge_hour` | 0–24 h | fix, adjust | the remembered hour the main surge lands on |
| `knob.speed` `.density` `.brightness` `.turbulence` | 0–1 | fix, adjust | the four knobs (Dave's scene + reflex, the day's hours) |
| `palette` | 3 × `#rrggbb` | fix | deep / mid / light |
| `flow_level` | 0–1 | fix, adjust | how hard the ropes flow (heard, else the river cam's motion) |
| `headcount` | 0–20 | fix (simulated, ≤ 2 min) | people in the room |
| `lingerer_rope` | 0–19 | fix (simulated, ≤ 2 min) | someone standing still by this rope |
| `calm_min` / `calm_max` | 0–1 (0.18 / 0.6) | fix, adjust | the floor and ceiling of the calm brightness curve |
| `master_brightness` | 0–1.5 (1.0) | fix, adjust | every rope's brightness times this (the power limit still applies) |

The screens' intensity, threshold and river video stay the plain `screens.*` fields above, not overrides.
- `probe.ps1 -Action remembered-zones -Light off|pool|eddies [-PoolHeight 0.60]` and `-Action remembered-opening [-On]` (and `-Action remembered-screens [-Video] [-Intensity] [-Threshold] <0..1>`) write it, only while `status.json` is under 10 s old and names `river-remembered.toe`, or `River\looks\status.json` is under 10 s old and says `river-looks.toe` shows the remembered look (else `{ok: false, error: "the remembered river isn't running (…)", refused}`); mission control also refuses them (409) while the full check sees another show, and `remembered-zones` during a calibration or the test pattern. `probe.ps1 -Action remembered` reads `status.json`, Dave's `gallery_state\state.json` (only `memory`, `surge_at`, `scene`, `set_at`) and `reflex.json`, `presence.json` and `control.json`, each as `{age_s, json}`, `{missing}` or `{error}`, for `GET /api/remembered` (`mission/lib/remembered.mjs`; the page: `docs/mission-ui.md` "Remembered river page").

## Round 2: the artists on site (27 Oct, night)

Agreed with Gavin, Will and Justine after seeing it on the piece. Built in this order; each step rebuilt on bitcube and shown before the next.

1. **Screens like the HUB75 simulator** (Q5–Q7). The look and settings the artists chose in `/hub75` (look Water, four fixed windows, intensity 0.82, zoom 2.5, threshold 0.35, softness 0.35, black floor 0.12, contrast 1.4, colour 0.85, trail 0.5), without the per-panel edge fades a later simulator update added (they drew horizontal bands). Each window drifts gently around its home position (a few % of the frame, minutes per cycle), so the view varies without wandering. No 30 % coverage or 55 % brightness cap. Footage: the live river cam while it is live and light enough, else the two clips the artists approved (the 22 s cascade, 27 Oct 14:51; and 27 Oct 18:13, 3.8 min), same framing, so the windows line up. Brightness follows the loop: about 40 % of the chosen intensity in calm, the full intensity at the surge, eased. Threshold and Intensity sliders on the debug page.
2. **The pool** (Q1): the waterline rises and falls with the flow and sloshes as a slow wave across the ropes in their real order; drops and the surge front landing in it send ripples to neighbouring ropes; bubbling at the bottom; a soft 10–20 LED band instead of a hard edge.
3. **More dynamic** (Q2): intensity is a continuous curve (the remembered day's hours, the room, slow drift) instead of slow / surge / slow; the day's main surge stays; random smaller surges when the room is empty (every 1–4 min); a busy room or a lingerer can bring one on (at most one a minute). This replaces the doc's "the room can move the surge but never add one".
4. **Surge easing** (Q3): every surge eases into the torrent and out again over anywhere from 1 s to 1 min (chosen per surge), on an ease-in/out curve; the speed at full flow stays.
5. **Black dots** (Q4): dark gaps moving with the flow in the surge body, as dense as the white foam.
6. **The filling pool** (Q8), a second animation: ropes and screens as one canvas by height (the calibration); water fills from the floor like a torrent into a pool, sloshes violently and splashes to the top. It is the surge on flood days (flow in the record's top 10 %) and every fourth loop.

### Round 2 milestones, as revised (27 Oct, 22:20, after the artists saw the particle windows)

Done: **1** (screens like the simulator, kept as `screens.mode: water`) and **2b** (the screens as windows into one particle field in the room, measured tilts; checkpoint `remembered-particles-v1`).

Next, in order:
- **M1 The filling glass (now):** a separate show file, `river-filling.toe`. All ropes and all screens are one canvas, painted by where every LED really is (the calibration's frame, as the gallery camera sees the piece, screens at their measured tilts): water rises from the floor to the top like a glass filling, turbulent, sloshing and crashing, blues and blacks, a river filling a pool; then it drains all the way out to the floor, and again. A first sample that hits those notes, to judge on the piece.
- **M2 Finer particles:** the particle field finer-grained and more fluid: closer to smoke or sloshing water than rope-sized drops, swirling, falling in from the top of each screen (their measured tilts) and sloshing between the screens and across the ropes, reacting at the screen edges. **Done 28 Oct:** `flow.py` (smoky streaks through a divergence-free swirl, ledges at each screen's tilted lower edge that collect and spill), then, on Gavin's reference ("too sparse and dark"), `ribbons.py`: silk ribbons of glitter, the default (`screens.field`, docs/files/river-remembered.md).
- **M3** the pool (ripples, sloshing waterline, soft edge), **M4** dynamics (continuous intensity, random and room-triggered surges), **M5** surge easing 1 s–1 min and black dots, **M6** the filling glass as the remembered river's surge on flood days and every fourth loop, **M7** debug page sliders, the simulator restored, the frame rate back to 60. **M7 status 28 Oct:** sliders done (Remembered river page: Screens intensity, threshold, river video), /hub75 restored (first version, artists' settings, Drift). Frame rate: bitcube is vsync-bound on the 60 Hz panels window, so a frame lands at 33 ms or 50 ms; ~26 -> ~29 fps after the ribbons' one-pass render, colour lookup and splitting the screens' work across alternate frames (Python ~15 ms a tick on bitcube, plus ~6 ms of Art-Net in ropes/exec). 45-60 fps needs the screens drawn on the GPU (the ribbons are procedural: a GLSL TOP could draw them) rather than numpy on this CPU: follow-up, not done.


### Planned (27 Oct, 23:00, Gavin; not started)

- **M8 One show file, many looks (the "jumbo" file).** Switching show files restarts TouchDesigner (about a minute dark). Instead, one show file holds several looks and moves between them smoothly: fade to black (about 2 s), then fade the next look in, with no restart.
  - **Looks at first:** the remembered river and Fill my cup (simple); then Fill my cup (configurable). Older show files (the river's year, Combined) are whole TouchDesigner networks, so add them only if wanted: much more to merge.
  - **Auto** (the default): four loops of the remembered river, then one full cycle of Fill my cup (simple), then again.
  - **Manual:** pick a target look; it fades over and then stays, looping that look. The chosen look's settings show with it (the fill's dials; the remembered river's pool line and opening night).
  - **Mission control:** "What's showing" keeps working: picking a look inside the jumbo file is a quick fade, not a restart; picking another show file still switches files. Auto / Manual and the look's settings sit on that card.
  - **How:** each look renders into the same rope canvas and screen image; a selector crossfades them. Only the visible look runs (both only during a fade), so it costs no more than one show. The remembered river's loop clock pauses while it's hidden and picks up where it left off (or starts a fresh loop: decide). Ropes keep their power limit and safety ramps through the fades.
- **Mission control's side of M8 and M9 (28 Oct):** the Looks card on Status, `POST /api/control/looks`, `probe.ps1 -Action looks`, the looks' `control.json` / `status.json` contract, the remembered river's controls while its look shows, and the River video slider on the Remembered river page (`remembered-screens`, `control.json` `screens.video`): docs/mission-ui.md "Looks" and "Remembered river page". The show file itself (`river-looks.toe`) is separate work.
- **M9 A subtle river under the remembered river's screens:** the artists' simulator look (round 2 step 1: the moving water through four drifting windows) as a faint layer under the particle windows, with its own strength setting.

## v2 (29 Oct 2026)

Agreed with Gavin on 29 Oct after his audit of the night before: people didn't visibly change anything, and Dave's knobs barely moved. Plan, decisions and log: [remembered-v2-plan.md](remembered-v2-plan.md). The running file is **`river-all-looks-v2.toe`** ([its page](files/river-all-looks-v2.md)), built from the live `td/remembered/`. Numbers below are the constants in the code (`room.py`, `ropes.py`, `knobs.py`, `clock.py`, `show.py`, `control_schema.py`, `inputs_log.py`); change them there and here together.

### People change the light

`room.py` turns the people counter into three smoothed signals for the ropes: **linger** (per rope), **crowd** and **empty**. It reads the counter's newest raw count (not the 30 s median: waking has to be fast) and its lingerers. Without the counter (missing or stale) all three relax to neutral: no crowd, not empty, no lingerers.

- **A lingerer** (still ≥ 8 s, close: box ≥ 40 % of the frame, as before) lights their **2–4 nearest ropes**: the counter's two nearest, widened by the ropes' feet within 0.012 of the show view (the old 0.08 lit 11–18 of the 20), weighted 1, 1, 0.85, 0.7, never fewer than two. It builds over 3 s and fades over 5 s after they go. On those ropes: **sparks and splashes** (short streaks of 5–20 px, about 7 a second on a fully lingered rope; 60 % thrown up from the waterline at 90–170 px/s, the rest falling from 1.6–2.6 m, all pulled down into the pool where they splash, 2.2 s each), **the light gathers** (up to ×1.9 with a standing glow, every other rope down by up to 25 %), the water slows by up to 60 %, and **the pool's waterline rises** 0.4 m. Strongest between 0.5 and 1.8 m.
- **A crowd:** 4 people or more is the full crowd, 1 person a hint. Crowd **mounts over ~60 s** as people are counted and **subsides over ~60 s** when they go. It brings Fantasia-style turbulence **at head height and below (LEDs ≤ 1.8 m)**: swirling eddies, a slosh across the ropes, bursts (up to 3 a second at a full crowd, × crowd²); it adds up to 0.4 to the turbulence knob, lifts the calm toward 0.6 and wakes more ropes.
- **An empty room:** after 5 s with nobody seen, empty ramps up over 60 s. The calm becomes **slow ocean waves** over the pool and across the ropes (periods 13–19 s, lifting the waterline up to 0.14 m), then settles to a **still pond** breathing at about 0.15; fewer ropes carry drips. The day's main **surge still plays, at 60 %**. Anyone entering drops empty to 0 within 1.5 s and sends a wake (a ripple across the pool, fading over 4 s).
- **Small surges:** random ones (every 1–4 min) only when the room is empty or the counter is out, and **never while the room is busy** (crowd over 0.3, or anyone lingering). A busy room (relative presence over 1.5) or a lingerer can still bring one on, at most once a minute, never within 45 s of the main surge. The room still moves the main surge 30 s sooner or later (unchanged).

### The knobs follow the remembered day as well as Dave

Each knob is `0.5 × Dave (remapped) + 0.5 × the day + the reflex` (reflex gain 1), clamped 0–1; until the show has a day, Dave and the reflex alone.

- **The day, hour by hour through the loop:** its **flow** drives speed (0.15–0.90) and density (0.25–0.85), half from the day's flow percentile in the record and half from the hour's flow within the day (damped on a day that barely varies); its **rain** drives turbulence (0.15–0.90): the hour's rain over the day's wettest hour, times how wet the day got (a wettest hour of 3 mm/h counts as full), plus a little flow; its **temperature** and **daylight** tilt brightness around 0.55 (±0.08 each). The day part eases over ~2 s, so a new day at the loop boundary doesn't jump. A flood day and a dry day now give visibly different curves.
- **Dave's voice, remapped:** his agent keeps the knobs in a narrow band (50 ticks audited on 28 Oct). `knobs.REMAP` stretches that band onto a useful range, linear between the points, clamped at the ends:

| Knob | Dave's band (audit) | becomes | Dave 0 → | Dave 1 → |
|---|---|---|---|---|
| speed | 0.04–0.14 | 0.25–0.75 | 0.20 | 0.90 |
| density | 0.25–0.58 | 0.30–0.75 | 0.25 | 0.85 |
| brightness | 0.47–0.65 | 0.45–0.75 | 0.35 | 0.85 |
| turbulence | 0.075–0.14 | 0.25–0.70 | 0.20 | 0.85 |

- Status shows the parts per knob: "Dave 0.42 · day 0.61 → 0.52" (the reflex only when it moves the knob).

### Dave's `valid_until` and signals (river-agent PR #14)

[drocamor/river-agent#14](https://github.com/drocamor/river-agent/pull/14) (additive, awaiting Dave; the show reads both with defaults and doesn't depend on it):
- `memory.valid_until`: his choice counts until then (he sends `chosen_at` + 20 min), capped at `chosen_at` + 1 h against a bad clock. Without it, 15 min from `chosen_at` as before; either way only while the mirror is fresh (rewritten within 15 min). With it, Dave's ticks up to 18 min apart no longer drop the show to its own day.
- `reflex.json` `signals`: raw `{gallery, river}: {name: {value, slow, age_s}}`; a signal older than 10 min reads as none. Reported in status and on the v2 page; they don't drive the light.

### Overrides and simulated people

The control file's `overrides` block (contract and parameter table in section 5): every parameter the show drives is **auto** (the show's own), **fix** (a value) or **adjust** (auto × gain + offset, clamped), sticky until cleared or "clear all". Two of them steer the whole column: **master brightness** (0–1.5, default 1.0; the 1,400 W limit still applies) and the **calm range** (`calm_min` / `calm_max`, defaults 0.18 / 0.6: the floor and ceiling of the calm brightness curve). **Simulated people** (a headcount 0–20, a lingerer by rope 0–19) stand in for the counter and clear themselves after **2 minutes** at most, with a red SIMULATING banner on the page: every people effect can be tested with nobody in the room. `status.json` reports each parameter as `{mode, auto, value, source, expires_in_s}`.

### The inputs log

`River\logs\inputs.jsonl`: every input and parameter with its value and source, one line every 5 s, or sooner (at most every 1 s) when a source changes or a value moves more than 2 %. At 20 MB it moves to `inputs.jsonl.1` (one old file kept). The page reads it back for its 24 h sparklines (at most 300 points each). Writing never stops the show.

### The frozen v1 and the rollback

The bug fixes (opening-night seed, nested zones block, light reset at boot, intensity 0, slider snap, a non-numeric knob) landed in v1 first (tag `all-looks-v1-bugs`). Then **`river-all-looks.toe` was frozen**: it imports its code from a second checkout pinned at that tag, `River\river-bitcube-v1`, so a pull can't change it (tag `all-looks-v1-frozen`; [checkpoints](checkpoints.md)). **Rolling back** is mission control's What's showing → `river-all-looks.toe`. The boot default stays the frozen v1 until Gavin says otherwise.

### The v2 page

Mission control's **Remembered river v2** page (`/remembered-v2`; [mission-ui.md](mission-ui.md) "Remembered river v2 page"): inputs → parameters → outputs, each with its source, age and sparkline; the overrides, master brightness, calm range and Simulate people; a ? on everything. `/remembered` stays the v1 page; each says so when the other file is running, and the menu links to the one that matches.
