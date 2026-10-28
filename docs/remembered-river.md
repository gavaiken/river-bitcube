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

Decisions: bitcube owns the loop clock; a new remembered day takes effect only at the next loop boundary (with the decision wave). The surge lands at Dave's `surge_at` when present, else at the day's heaviest hour of rain moved by the room, clamped to 1.5–3.6 min into the loop. Dave's choice older than 5 min (or absent) → bitcube plays one of the notable days itself, never the same twice in an hour. Remembered days come only from days that have data. The gallery cam stays on the show view (low: people and the base of the piece); it pans and tilts only during a calibration, and always returns home.

## 1. The data: remembered days

Built once on the Mac mini (`tools/remembered/build_days.py`), committed to both repos (`data/remembered/` here; the same files in river-agent).

- **Flow:** Dry Creek near Dobbins, NWM reach **8062207** (Will: pin 39.413113, −121.248323; modelled outlet ~283 m downstream), **NWM v3 retrospective**, hourly, Oct 2002–Jan 2023, from the public zarr on AWS. Modelled reach flow, not a measurement. Missing values stay missing; nothing is interpolated across gaps. Days are fixed PST (UTC−8), as Will's summaries are.
- **Weather:** Open-Meteo historical, hourly, at the same pin: precipitation (mm), temperature (°C), snowfall (cm), is_day.
- **Today:** NWM operational `analysis_assimilation` from `https://api.water.noaa.gov/nwps/v1/reaches/8062207/streamflow?series=analysis_assimilation`, fetched by Dave's agent each tick and archived (rolling window). A different model product: always labelled as such. Gap 2023–2026 is not filled.

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

## 4. Lingerers (people counter)

`presence.json` gains `people: [{x, y, h, still_s}]` (show view, 0–1 from top left, foot point; `h` box height; `still_s` seconds without moving more than a few % of the frame) and `lingerers: [{x, y, still_s, ropes: [i, ...]}]`: people still ≥ 8 s and close (box height ≥ 40% of the frame), with their nearest ropes from the zones file.

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

Mission control controls (all through `probe.ps1`, refused while another show runs): `remembered-zones {pool_height_m?, light: off|pool|eddies}`, `remembered-opening {on}`.
