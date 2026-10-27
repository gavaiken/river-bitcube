# Handoff: where things stand

- **Holder:** nobody: free for Will
- **Where:** bitcube free; Combined v0 deliberately left showing Channel framing at Will's request
- **Updated:** 2026-10-26 21:21 PT
- **Next holder:** Will (Codex), for visual tuning.

## Running now
- `river-combined-v0.toe`: **Channel: three windows**, live river, fixed summer intensity 0.85, Dave overlay 10%. Will explicitly requested this be left showing.
- Verified after reopening: 60 fps, zero project errors, ropes sending, panels on. The boot default remains `river-local-oct-22-seasons.toe`; no other show, build or calibration pin changed. Dave's repo/deployment untouched.

## Reversible river framing: 12ad39e
- Status in mission control now offers **River framing**: Original (bypass), Channel one/three windows, Pool one/three windows. Choose the matching profile after moving the camera, then **Apply river settings**. This button also applies Dave's overlay slider. Settings persist together in `River/combined-v0.json`; a legacy overlay-only request preserves framing.
- Original takes the exact previous GPU input route (verified max pixel difference 0). Recorded fallback automatically bypasses all framing; live frames restore it when fresh again.
- Profiles enlarge water regions, lift shadows and apply feathered masks generated from Will's two night-camera stills. Three nested windows crossfade every 18 s (54 s cycle). This is a first pass with fixed per-view profiles, **not automatic camera-position recognition or semantic/motion water segmentation**. Changed lighting or imprecise presets may require retuning. Pool detail is limited by exposure. Current camera is on the Channel view; no PTZ commands were sent.
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
- Tune framing/masks, exposure and crop choices with Will; Original available at any point. Daylight/motion-aware masks and automatic profile recognition are future work.
- Gallery influence, audio and further river recordings remain deferred.
