# Handoff: where things stand

- **Holder:** nobody: free for Will
- **Where:** repo only (bitcube is free; the default show is running)
- **Updated:** 2026-10-26 20:12 PT
- **Next holder:** Will (Codex), for visual tuning.

## Running now
- **The river's year** (`river-local-oct-22-seasons.toe`) restored after testing; default unchanged. Ropes sending, panels on, no project errors.
- Original year/live/template `.toe` hashes and all their calibration pins are unchanged.

## Combined v0 ready
- Feature commit **3bbd35f**: `river-combined-v0.toe` is offered in `shows.json`, built from the baseline. Live river (10 s stale -> recorded fallback), fixed summer at 0.85 intensity, Gavin's palette/torrent/glints, additive Dave canvas via the existing local mirror. Camera clock/label cropped. No audio or gallery influence yet; no Dave-repo or deployment changes.
- Mission control Status shows the overlay slider only while Combined v0 runs. Move it, then **Set overlay**. Starts at 25%; saves to `River/combined-v0.json`, restored on reopening without a rebuild. Missing/placeholder Modal scene suppresses the overlay while the base continues.
- Verified on bitcube: ~60 fps, no project errors; live input and forced recorded fallback; 0/25/100% overlay; persisted 60% across default -> combined switch, then reset to 25%. Wrong-show overlay request refused. Returned to default.
- Final saved `.toe` unpacked into a fresh temporary directory: **370 parts, zero secret-value hits**. `tools/check`: **292 Python passed, 3 skipped; 415 mission tests passed**. GitHub check and Pages deployment green for 3bbd35f. Browser slider tested against an isolated local fixture server.
- bitcube pulled the feature. Mission control `/version` verified **3bbd35f** (running since 20:09 PT). Reload the page to receive the new selector entry and slider.

## Next
- Reload mission control, Change -> Combined v0 -> Switch. Adjust overlay; Back to default when finished. Use Set as default only if Will asks.
- Tune the visual with Will. Gallery influence and further river recording are deferred. Live footage stays at camera speed; no seasonal speed synthesis yet.

## Preserve / access
- bitcube still has its pre-existing moved `river_masks/` files and untracked `tools/pixelmap/pixelmap-2026-10-26.json` (the status probe calls it unreadable). We did not change these or re-pin any show. Combined v0 uses the template's 23 Oct pins.
- A recovery stash on bitcube is named `combined-v0 verified staging before deployment 2026-10-26`; the deployed files are committed, so do not apply it over the finished feature.
- On Will's Mac use macOS `/usr/bin/ssh -o UseKeychain=yes -o BatchMode=yes -o HostKeyAlias=bitcube.tail03bc1a.ts.net user@100.73.68.60`. His key was already accepted; Homebrew SSH could not unlock it. No server auth changes needed. Local tests need modern Node (CI uses 24; mission control uses 26.10), not this Mac's default 20/older 22.
