# Handoff: where things stand

- **Holder:** nobody: free for Will
- **Where:** bitcube free; Combined v0 left on Auto framing with the screens-only look cycle
- **Updated:** 2026-10-26 22:04 PT
- **Next holder:** Will (Codex), for visual tuning.

## Running now
- `river-combined-v0.toe`: **Auto**, currently detecting Channel and using **Channel: three windows**, live river, fixed summer intensity 0.85, Dave overlay 18%. Four screens cycle between Current and Gavin style with 30-second holds and 8-second fades. Will requested this be left showing.
- Verified after reopening: 60 fps, zero project errors, ropes sending, panels on. The boot default remains `river-local-oct-22-seasons.toe`; no other show, build or calibration pin changed. Dave's repo/deployment untouched.

## Screens-only look fade: 06978a6
- Will chose screens only, Gavin's existing appearance versus current Combined appearance, ~30 seconds on each with slow fades. **Enabled: Automatic cycle, hold 30 s, fade 8 s** (76-second full cycle). The ropes keep the Combined output. Current overlay 18% and Auto framing preserved.
- Mission control Status: **Screen look** = Current look / Gavin style / Manual blend / Automatic cycle; blend slider 0% Current → 100% Gavin; cycle hold 15/30/60/120 s. Apply river settings persists all settings together. Changing modes or applying a blend fades over 8 s. Unchanged screen settings do not restart the cycle when overlay/framing changes.
- **Gavin style is applied to live river video**, retaining the recorded fallback and camera speed. Reuses his grade/effects section verbatim at build time, plus a scoped copy of his year glue and the original year engine. Independent live state, no server, no writes to seasonal rules. It retains Gavin's existing presence-driven seasonal behavior: currently winter because presence is zero. No new gallery-video steering or audio. Original Gavin show/build/glue, shared screens builder and calibration pins unchanged.
- Own graph: `viz/gavin_screens` (640×360 seasonal branch) → `viz/gavin_screen_in`; `viz/screen_mix` crossfades this against `combined_clamp`. `outputs/screen_field` selects that for the four existing screen samplers. `viz_out`, `outputs/field_out` and the rope sampler stay on Combined. All panel orientation, screen sampling coordinates, HDMI routing and rope power caps retained.
- Verified: full rebuild repeatable; screen routing separated from rope routing; an actual cycle midpoint reported ~0.579 both in runtime and the Cross TOP; current/Gavin output previews; saved/reopened with Auto, 18% overlay, cycle/30 s settings intact, no project errors. Runtime verified 60 fps before and after reload. Midpoint pixel equality was not used as proof (live sources changed between reads).
- Validation: **314 Python passed, 3 skipped; 418 mission tests passed**. Saved .toe expanded fresh: **519 parts, zero UTF-8/UTF-16/URL-encoded secret hits**. GitHub check and Pages green for 06978a6. Browser fixture tested cycle, 60/30 s timing, manual 40% blend and readback. Test tab/server closed.
- Mission control deployed **06978a6adbb44384f6abc8973edff061570956b4** at 22:04 PT, verified `/version`. Reload Status to get the screen controls.
- Revert the screens: **Screen look → Current look → Apply river settings** (8-second fade). Framing Original is separate and does not stop the screen cycle. Full pre-feature .toe/settings backup: `C:\Users\user\River\checkpoints\combined-v0-before-screen-fade-20261026\`; source `191e70d`. Staging recovery stash `combined-v0 screen fades verified staging 2026-10-26` is already deployed; do not apply over main.

## Automatic camera-view selection: c9bcc88
- Will asked for the framing to follow his camera-position changes. **Auto: recognize camera view** is now enabled and persisted, preserving the overlay at 10%. Manual Channel/Pool choices and Original bypass still work.
- Recognizes two known views from 32×18 exposure-normalized reference thumbnails, checked twice per second. Similarity ≥0.90 and a ≥0.10 lead over the other view required; one second of stable matching before selecting its three-window profile. Changed image structure resets settling. Uncertain/ambiguous/blank frames, a detector older than 2 s, or recorded fallback use Original.
- This selects existing masks/crops; it does not segment moving water or invent crops for arbitrary angles. Daylight/lighting changes may cause Auto to abstain. No camera API/preset-control changes and no PTZ commands sent.
- Current live Pool matched at ~0.9997 similarity and ~0.247 margin. Both prior view references, exposure/water perturbations, ambiguous/blank/noise frames, both transition directions and stale detector data tested offline. Recorded fallback bypass and automatic Pool recovery tested on TD. Auto/10% setting restored across reopening with no project errors; live processing verified at 60 fps; final runtime check repeated after reopening. The physical camera was not moved for a second live transition test.
- Validation: **301 Python passed, 3 skipped; 417 mission tests passed**. Saved .toe fresh expansion: **387 parts, zero UTF-8/UTF-16/URL-encoded secret hits**. GitHub check/Pages green. Local browser fixture tested Auto apply and detected-Pool readback; fixture tab/server closed.
- Mission control `/version`: **c9bcc880d636378027ae468cf9144dad5c4c3a99**, started 21:34 PT. Reload for Auto selector.
- Pre-Auto backup: `C:\Users\user\River\checkpoints\combined-v0-before-auto-20261026\`; source `d0e041a`. Selecting a manual profile disables Auto immediately. New verified staging recovery stash: `combined-v0 auto verified staging 2026-10-26` (already deployed; do not apply over main).

## Reversible river framing: 12ad39e (prior pass)
- Status in mission control now offers **River framing**: Original (bypass), Channel one/three windows, Pool one/three windows. Choose the matching profile after moving the camera, then **Apply river settings**. This button also applies Dave's overlay slider. Settings persist together in `River/combined-v0.json`; a legacy overlay-only request preserves framing.
- Original takes the exact previous GPU input route (verified max pixel difference 0). Recorded fallback automatically bypasses all framing; live frames restore it when fresh again.
- Profiles enlarge water regions, lift shadows and apply feathered masks generated from Will's two night-camera stills. Three nested windows crossfade every 18 s (54 s cycle). Fixed per-view masks and crops, now selected automatically by the matcher above or manually. Changed lighting or imprecise presets may require retuning. Pool detail is limited by exposure.
- TD implementation: `td/combined/framing.py`, numpy Script TOP at up to 10 Hz, 640x360, alongside the unchanged summer/Modal treatment and calibrated outputs. No new shader, port or service. Original saved in the .toe; first-frame runtime loads the persisted choice.
- All five profiles exercised on TD; Channel visually inspected against live footage and Pool against its prior reference preview. Recorded fallback bypass, Original, persistence across restart, and web selector draft/apply/readback verified. Overlay temporarily suppresses itself during missing/placeholder Modal scenes, as before.
- Validation: **295 Python passed, 3 skipped; 416 mission tests passed**. Fresh saved-show expansion: **384 parts, zero secret hits** in UTF-8/UTF-16/URL-encoded scans. GitHub check and Pages green for 12ad39e.
- Mission control `/version` verified **12ad39e3ed01cd95712368dc390b99ec47bc2e81**, started 21:14 PT. Reload the page for the framing selector. Production team login was not accessed; browser interaction tested in an isolated synthetic local fixture. Test tab and server closed.

## Reverting
- Immediate comparison: **Original (bypass)** → **Apply river settings**. Keeps Dave's overlay strength.
- Full pre-framing show/settings backup on bitcube: `C:\Users\user\River\checkpoints\combined-v0-before-framing-20261026\`. Original .toe SHA256 `326b869717a6eace7095917d429fe7aea50f1cb85b9a30586c4e30429cb8106a`; overlay 10%. Prior source commit `4933054` (initial feature `3bbd35f`). Never roll unrelated shows back.
- Usual show: mission control **Back to default**. **Set as default** only if Will requests it.

## Preserve / access
- Pre-existing bitcube changes remain: moved `river_masks/` files and untracked `tools/pixelmap/pixelmap-2026-10-26.json` (reported unreadable by probe). Do not repair or re-pin without a separate task. All shows retain their own 23 Oct pins.
- Recovery stashes: `combined-v0 verified staging before deployment 2026-10-26` and `combined-v0 framing verified staging 2026-10-26`. Deployed contents are committed; do not apply these over the finished feature.
- SSH from Will's Mac: macOS `/usr/bin/ssh -o UseKeychain=yes -o BatchMode=yes -o HostKeyAlias=bitcube.tail03bc1a.ts.net user@100.73.68.60`. No auth/server changes needed. Never use RDP (blanks panels).
- Tests need modern Node (CI 24, mission control 26.10), not this Mac's default Node 20. Session's temporary Node: `/tmp/river-npm-cache/_npx/fd0ad82db56a14ec/node_modules/node/bin`.

## Next
- Tune screen looks/cycle timing, framing/masks, exposure and Auto recognition under daylight with Will; Original available at any point. Motion-aware masks and new arbitrary-angle crops remain future work.
- Gallery influence, audio and further river recordings remain deferred.
