---
title: "Combined with Modal Input Selector"
---

# Combined with Modal Input Selector

Will's [Combined v0](river-combined-v0.html), cloned, with one new control: **which of Dave's Modal outputs steers it, and how strongly**. Made by Gavin, 27 Oct, for the opening. [All show files](../show-files.html)

## What it does
- **Same Combined look:** live river (recorded fallback), Gavin's fixed summer treatment, Auto/manual river framing and the four-screen look cycle, all exactly as Combined v0 builds them (its own `td/combined/*.py`, reused). Framing, screen looks and their timing follow Combined v0's saved settings (`River/combined-v0.json`, read only), so this show changes with Will's choices; it never writes them.
- **Modal input** (mission control, while this show runs): exactly one source and one strength 0–1. Switching or changing strength fades over about 4 seconds; TouchDesigner never restarts.
  - **Off:** Combined's summer river alone.
  - **Canvas:** today's look, Dave's `canvas.html` added over the river. Strength = overlay amount (0.18 = Combined v0 today).
  - **Scene:** Dave's agent's scene (`gallery_state/state.json`, gliding over its `transition_seconds`, plus the camera reflexes in `reflex.json`): its palette (2–6 colours) becomes a gradient map that recolours the river by brightness; *speed* sets the summer effects' speed (×0.6–1.6; live video stays at camera speed), *density* the summer effects amount, *brightness* the river gain (≤1.25×), *turbulence* the torrent streaks. Strength = how far the scene recolours and steers vs plain Combined.
  - **Frames:** [Modal Frames](https://github.com/gavaiken/river-bitcube/blob/main/modal-frames/SPEC.md): Dave's own picture for each screen (128×256, upright) and for the ropes (20×400, top row = top of every rope). Each element journeys from what it shows now to Dave's picture in OKLCH (easing, `via` colours, `duration_ms`), and the live river ripples it (its `river_region`, amount × contrast; speed below 1 slows the ripples). The rope picture goes straight to the ropes, bypassing the camera map; the screen pictures go into the four upright screen inputs. Same brightness caps as Combined. Strength = mix with Combined.
- **Stale data:** if the chosen source has nothing current (scene missing or older than 15 minutes; Modal Frames quiet for 120 s past the frame's `ttl_s`, or polls failing, or no frame yet), it fades back to Combined alone and mission control says why. It comes back by itself.
- **Settings:** `C:\Users\user\River\combined-modal-inputs.json` `{source, strength}`; default **canvas, 0.18**. Restored when the show opens.
- **Inputs:** river camera (recorded clip fallback), the local Modal mirror (`gallery_state`, served on 8770, from `tools/modal/modal_link.py`), Modal Frames mirrored by `tools/modal/frames_sync.py` (started by `modal_link.py`).
- **Outputs:** Combined v0's 20 ropes and four screens, pinned 27 Oct multi-view calibration (floor to rig), ropes capped at 0.4 brightness and 600 W per box.

## Controls
Mission control Status, while this show runs. Script form: `probe.ps1 -Action modalinput -Source <off|canvas|scene|frames> -Strength <0..1>`; status `td.modal_input`. Full contract: [Modal input selector interface](../modal-inputs.html).

## How it's built
`td/build/build_combined_modal_inputs.py` is a copy of Combined v0's build script (its own name and registry entry), which runs Combined v0's `td/combined/build_viz.py` with this show's runtime (`td/combined_modal/runtime.py`: its own show name, Combined v0's settings read only, the selector's canvas mix and speed), then `td/combined_modal/build_modal_inputs.py`:

- `viz/modal_inputs_mod` (`td/combined_modal/modal_inputs.py`): settings, fades, staleness, status; Modal Frames journeys in one worker thread (`frames_journey.py`, numpy); the pure parts are `selector.py` and `frames_journey.py` (tests: `tools/tests/test_combined_modal_inputs.py`).
- Scene: `viz/scene_keys` → `scene_ramp` → `scene_palette` (lookup of `river_mono`) → `scene_look` (cross into `summer_mix`); the torrent, glints, summer gain and streak expressions take the selector's factors (1 when the scene isn't steering).
- Frames: per element `viz/fr_<e>_target` (Script TOP) × ripple (`fr_<e>_region` → fit → mono → `luma` with feedback smoothing → `mean`) in `fr_<e>_out` (GLSL, `td/combined_modal/frames_ripple.glsl`); `outputs/screen<k>_modal` feeds `screen<k>_src`, `outputs/rope_modal` is the ropes' canvas (and the preview's rope column).

Never edit Combined v0's file, build script or settings for this show. Rebuild through `tools/td.ps1`, save with `tools/td_save.ps1`. A rebuild creates any new GLSL TOP bypassed: save, then un-bypass `viz/fr_*_out` and save again.

## Verified on bitcube (27 Oct)
Built from a Save As of Combined v0 (whose file and settings stayed byte-identical). All four sources switched through `probe.ps1 -Action modalinput`, each fading in about 4 s with no TouchDesigner restart (same process throughout), 60 fps, zero errors. Modal Frames from Dave's live app: screens and ropes match his pictures top-up (rope picture row 0 = the top of every rope, as sent to Art-Net); rope draw about 110/90 W per box at full frames strength; a 20 s journey with a `via` colour checked mid-way; an empty frames folder faded back to Combined with "no Modal frame has arrived yet", and recovered by itself. Saved .toe expanded: 855 parts, no secret values. The scene recolours the ropes and the screens' Current look; Will's screen cycle still shows his Gavin-style looks on their turns.

## Reverting
Choose **Off** (Combined alone) or **Canvas 0.18** (Combined v0's look) in mission control; or switch back to Combined v0.
