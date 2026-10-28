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

Decisions: bitcube owns the loop clock; a new remembered day takes effect only at the next loop boundary (with the decision wave). The surge lands at Dave's `surge_at` when present, else at the day's heaviest hour of rain moved by the room, clamped to 1.5–3.6 min into the loop. Each of Dave's choices plays once, if it is under 15 min old; between his choices (his ticks run about 5–15 min apart) and when he is absent, bitcube plays one of the notable days itself, never the same twice in an hour. Remembered days come only from days that have data. The gallery cam stays on the show view (low: people and the base of the piece); it pans and tilts only during a calibration, and always returns home.

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
- **Lighting checks:** `light` prints the LED ranges and with `--write` writes `River\remembered\control.json`: `{"t": unix, "zones": {"file": "zones-….json", "light": "pool|eddies|leds|off", "leds": [{"rope", "from", "to"}], "pool_height_m"?}}` for the remembered show to light (mission control's `remembered-zones` sends the same shape).

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
 "knobs": {"speed": 0.5, "density": 0.6, "brightness": 0.7, "turbulence": 0.4, "reflex": {"speed": 0.05}},
 "palette": ["#0b3d5c", "#1f8fb3", "#bfefff"],
 "ropes_follow": "sound", "heard": 0.62, "river_motion": 0.41, "river_source": "live",
 "room": {"presence": 3.2, "usual": 2.1, "relative": 1.5, "lingerers": [{"x": 0.4, "y": 0.8, "still_s": 12, "ropes": [7, 8]}]},
 "panels": {"lit_pct": [12, 8, 22, 4], "cap": 0.55},
 "ropes": {"watts": 410},
 "opening_night": false,
 "zones": {"file": "zones-2026-10-27.json", "pool_height_m": 0.6, "light": "off"}}
```

Mission control controls (all through `probe.ps1`, refused while another show runs): `remembered-zones {pool_height_m?, light: off|pool|eddies}`, `remembered-opening {on}`. Both end up in `River\remembered\control.json` (also written by `zones.py light … --write`, with `light: leds` for individual LEDs).

Optional, additive: `day.profile` (`{flow, rain, temp, snow, is_day}`, 24 values each, as in `profiles.json.gz`) when bitcube plays a day that isn't Dave's (a notable day): the debug page then draws that day's hours; without it, it draws Dave's `memory.profile` only when the day playing is his.

**The control request file** `River\remembered\control.json` (written by mission control through `probe.ps1`, read by TouchDesigner; built by whoever builds the TD side):

```json
{"pool_height_m": 0.6, "light": "pool", "opening_night": false, "at": "2026-10-28T04:12:09Z"}
```

- `pool_height_m`: the pool line in metres above the floor (0–1.5; `null` until someone sets it: keep the zones file's own). `light`: `off` (the show), `pool` (light the LEDs at or below the pool line, to check it) or `eddies` (light the eddy LEDs). `opening_night`: the opening-night switch. `at`: when it was written (UTC). TouchDesigner reports what it took in its status (`zones`, `opening_night`).
- Each control changes only its own fields; the others keep what the file held. The file is written whole to `control.json.tmp` and swapped in (`[IO.File]::Replace`), so a reader never sees half of it: read it when its write time changes.
- `probe.ps1 -Action remembered-zones -Light off|pool|eddies [-PoolHeight 0.60]` and `-Action remembered-opening [-On]` write it, only while `status.json` is under 10 s old and names `river-remembered.toe` (else `{ok: false, error: "the remembered river isn't running (…)", refused}`); mission control also refuses them (409) while the full check sees another show, and `remembered-zones` during a calibration or the test pattern. `probe.ps1 -Action remembered` reads `status.json`, Dave's `gallery_state\state.json` (only `memory`, `surge_at`, `scene`, `set_at`) and `reflex.json`, `presence.json` and `control.json`, each as `{age_s, json}`, `{missing}` or `{error}`, for `GET /api/remembered` (`mission/lib/remembered.mjs`; the page: `docs/mission-ui.md` "Remembered river page").

## Round 2: the artists on site (27 Oct, night)

Agreed with Gavin, Will and Justine after seeing it on the piece. Built in this order; each step rebuilt on bitcube and shown before the next.

1. **Screens like the HUB75 simulator** (Q5–Q7). The look and settings the artists chose in `/hub75` (look Water, four fixed windows, intensity 0.82, zoom 2.5, threshold 0.35, softness 0.35, black floor 0.12, contrast 1.4, colour 0.85, trail 0.5), without the per-panel edge fades a later simulator update added (they drew horizontal bands). Each window drifts gently around its home position (a few % of the frame, minutes per cycle), so the view varies without wandering. No 30 % coverage or 55 % brightness cap. Footage: the live river cam while it is live and light enough, else the two clips the artists approved (the 22 s cascade, 27 Oct 14:51; and 27 Oct 18:13, 3.8 min), same framing, so the windows line up. Brightness follows the loop: about 40 % of the chosen intensity in calm, the full intensity at the surge, eased. Threshold and Intensity sliders on the debug page.
2. **The pool** (Q1): the waterline rises and falls with the flow and sloshes as a slow wave across the ropes in their real order; drops and the surge front landing in it send ripples to neighbouring ropes; bubbling at the bottom; a soft 10–20 LED band instead of a hard edge.
3. **More dynamic** (Q2): intensity is a continuous curve (the remembered day's hours, the room, slow drift) instead of slow / surge / slow; the day's main surge stays; random smaller surges when the room is empty (every 1–4 min); a busy room or a lingerer can bring one on (at most one a minute). This replaces the doc's "the room can move the surge but never add one".
4. **Surge easing** (Q3): every surge eases into the torrent and out again over anywhere from 1 s to 1 min (chosen per surge), on an ease-in/out curve; the speed at full flow stays.
5. **Black dots** (Q4): dark gaps moving with the flow in the surge body, as dense as the white foam.
6. **The filling pool** (Q8), a second animation: ropes and screens as one canvas by height (the calibration); water fills from the floor like a torrent into a pool, sloshes violently and splashes to the top. It is the surge on flood days (flow in the record's top 10 %) and every fourth loop.
