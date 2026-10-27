---
title: "Modal input selector: interface"
---

# Modal input selector: interface for mission control

The show **Combined with Modal Input Selector** (`river-combined-modal-inputs.toe`, page [`files/river-combined-modal-inputs.md`](files/river-combined-modal-inputs.md)) is Will's Combined v0 plus one control: which of Dave's Modal outputs steers it, and how strongly. This page is the contract between the show (TouchDesigner, `tools/mission/td_mission.py`, `tools/mission/probe.ps1`) and mission control's UI.

## The control
Exactly one **source** at a time and one **strength** 0–1. Changing either fades over about 4 s; TouchDesigner never restarts.

| source | What it does | strength means |
|---|---|---|
| `off` | Combined's summer river alone. | ignored |
| `canvas` | Today's look: Dave's `canvas.html` added over the river (Combined's overlay path). | the overlay amount (0.18 = Combined v0 today) |
| `scene` | Dave's scene (`gallery_state/state.json` + `reflex.json`, gliding over `transition_seconds`): palette recolours the river by brightness, speed/density/brightness/turbulence steer the summer effects. | how far the scene recolours and steers vs plain Combined |
| `frames` | Modal Frames ([`modal-frames/SPEC.md`](https://github.com/gavaiken/river-bitcube/blob/main/modal-frames/SPEC.md) §6): Dave's per-element target pictures, journeyed to in OKLCH and rippled by the live river. Screens and ropes take the pictures directly. | mix of Modal Frames with Combined |

Saved in `C:\Users\user\River\combined-modal-inputs.json` as `{"source": "...", "strength": 0.18}` (default `canvas`, 0.18). Restored when the show opens.

**Stale data:** if the chosen source has nothing current (scene file missing or older than 15 min; frames quiet per SPEC §6.5: 120 s past `ttl_s`, or polls failing, or no frame), the show fades to Combined alone and says so (`effective_source: "off"`, `stale: true`, `stale_reason`). It fades back in by itself when the data returns.

## Status: `probe.ps1` → `td.modal_input`
Present only while this show is open (otherwise absent/`null`). Numbers are what TouchDesigner is using **now** (after gliding and fading).

```json
{"source":"scene","strength":0.6,"effective_source":"scene","fading":false,
 "stale":false,"stale_reason":null,"data_age_s":42,
 "sources":{"canvas":{"ok":true,"age_s":3},
            "scene":{"ok":true,"age_s":42,"set_at":"2026-10-27T16:36:33-07:00","palette_name":"froth-deepening","journal":"one sentence"},
            "frames":{"ok":true,"age_s":95,"frame_id":"2026-10-27T23-52-00Z-5eb8","note":"…"}},
 "params":[{"name":"palette","value":["#dce7f5","#8faac4"],"drives":"river recolour (gradient map by brightness)"},
           {"name":"speed","value":0.19,"effective":0.19,"drives":"summer effect speed ×0.6–1.6"},
           {"name":"density","value":0.41,"drives":"summer effects amount"},
           {"name":"brightness","value":0.56,"drives":"river gain"},
           {"name":"turbulence","value":0.2,"drives":"torrent / roughness"}]}
```

| Field | Meaning |
|---|---|
| `source` | The saved choice: `off`, `canvas`, `scene`, `frames`. |
| `strength` | The saved strength, 0–1. |
| `effective_source` | What is really steering now: `source`, or `off` while that source is stale. |
| `fading` | A fade between sources (or to/from stale, or a strength change) is in progress. |
| `stale`, `stale_reason` | The chosen source's data is stale, and why (one sentence), else `false`/`null`. |
| `data_age_s` | Age in seconds of the chosen source's data (`null` for `off`). |
| `mix` | The applied amount per source now (`{"canvas":0.18,"scene":0,"frames":0}`): fade weight × strength. |
| `sources.canvas` | `ok` (scene present and the canvas renderer has no errors), `age_s` (newest mirrored file). |
| `sources.scene` | `ok` (usable, not placeholder, ≤15 min old), `age_s` (since `set_at`), `set_at`, `palette_name`, `animation`, `journal` (Dave's newest journal sentence, ≤200 chars, if any). |
| `sources.frames` | `ok` (a valid frame is on disk and not past its grace), `age_s` (since arrival), `frame_id`, `note`, `quiet` (bool), `rejected` (last rejected frame and reason, or `null`), `sync` (`{"ok":bool,"age_s":n,"error":...}` from `frames_sync.py`). |
| `params` | What the effective source drives, one entry per thing (below). `[]` for `off`. |

`params` entries are `{"name", "value", "drives"}` plus, where they differ from `value`: `raw` (the value the source asked for, before gliding), `effective` (after the camera reflex offsets), `factor` (the multiplier applied now, after strength and fades).

- **scene:** `palette` (value = the colours now, gliding; `raw` = the scene's colours), `speed`, `density`, `brightness`, `turbulence` (value 0–1 = the gliding scene value, `effective` = with reflex offsets, `factor` = applied multiplier).
- **frames:** one per element, `screen-1` … `screen-4` then `ropes`:
  `{"name":"screen-1","value":{"amount":0.55,"contrast":0.44,"speed":0.66,"journey":0.4},"drives":"screen 1 target picture × river ripple"}`; `journey` is 0–1 (1 = arrived), `ropes` drives "rope target picture × river ripple".
- **canvas:** `[{"name":"canvas","value":"drift / deepening-pool","drives":"additive overlay"}]` (animation / palette).
- **off:** `[]`.

## Action: `probe.ps1 -Action modalinput -Source <off|canvas|scene|frames> -Strength <0..1>`
- Validates (`-Source` one of the four, `-Strength` a number 0–1; PowerShell rejects anything else before TouchDesigner is touched), applies with the 4 s fade, saves the settings file, and answers the usual probe JSON (`ok: true`) with the new `td.modal_input`.
- Refused (`ok: false`, `error`) unless TouchDesigner has `river-combined-modal-inputs.toe` open, while the test pattern is on, or while a calibration runs (like the other light actions).
- Inside TouchDesigner it is `td_mission.py` action `{"action":"modalinput","source":"scene","strength":0.6}`.

## Pieces
- `td/build/build_combined_modal_inputs.py` (the show's build), `td/combined_modal/` (its runtime and selector), reusing `td/combined/*` and `td/modal/modal_scene.py`.
- `tools/modal/frames_sync.py`: the Modal Frames mirror (SPEC §9), started by `tools/modal/modal_link.py`.
