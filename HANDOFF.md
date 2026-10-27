# Handoff: where things stand

The baton. **Read this first, every session; rewrite it before you stop** (rules: [`AGENTS.md`](AGENTS.md) "Start here"). Keep it to one screen: the current state, not a history. History goes in `docs/sessions/<name>.md`.

- **Holder:** Will (Codex)
- **Where:** bitcube (combined-v0 build and mission-control overlay slider)
- **Updated:** 2026-10-26 19:49 PT
- **Next holder:** Will (Codex). **Ready for Will.**

## The show right now
- At Gray Area. bitcube boots **the river's year** (`river-local-oct-22-seasons.toe`); **the live river** (`river-online-oct-23.toe`) is the other show file mission control offers.
- 26 Oct (Gavin, calibration session; [`docs/sessions/calibrate.md`](docs/sessions/calibrate.md)): Calibrate now launches its job through a scheduled task (every run had died with the SSH session; dry run verified, a real run still to do). In the boot file, torrent streaks, leaves and rain now fall down the room (they rose).
- Mission control v2 is live (round 10 merged; open minor items in [`docs/mission-known-issues.md`](docs/mission-known-issues.md)).
- Checkpoint `checkpoint-2026-10-26` taken (tags in both repos, bitcube and mini archives): [`docs/checkpoints.md`](docs/checkpoints.md).

## Done (Gavin, 26 Oct): ready for Will
| | Piece | Who |
|---|---|---|
| ✅ | Checkpoint | coordinator |
| ✅ | `AGENTS.md` (one rulebook for Claude and Codex), this baton, the old plans marked as history, studio agent follows the baton | coordinator |
| ✅ | `shows.json` registry (every show file's description, inputs, editors, pinned calibration); `Start-River.cmd`, mission control and the build scripts read it | helper (repo) |
| ✅ | Calibration pinned per show, never "newest map wins" | helper (repo) |
| ✅ | `tools/check` + GitHub Actions (tests, registry, metadata freshness) | helper (repo) |
| ✅ | Mission control: "What's showing" card (Change → preview card → Switch; Back to default; Set as default, any show); seasons panel only while the river's year runs | helper (repo) |
| ✅ | Baseline template `river-baseline-template.toe`: river cam (recorded clip as fallback) + gallery cam in, river on the screens and down the ropes. Verified on the lights 14:05–14:07; [page](docs/files/river-baseline-template.md). Offered in mission control | helper (bitcube) |
| ✅ | Verified 14:37–14:40: bitcube pulled; `shows.ps1`/`probe.ps1` list the three offered shows; switch to the template and back via `probe.ps1`, default unchanged; `tools/check` green, CI green, mission control on 7886e79 | coordinator |
| ⬜ | Gavin's phone test (optional): Change → Baseline → read card → Switch → Back to default | Gavin |

## Will's session in progress
- Building `river-combined-v0.toe` from the baseline: live river with recorded fallback, fixed summer treatment, Dave's locally mirrored canvas as an additive overlay.
- Mission control gets an overlay-strength slider for this show only. Gallery influence, audio and additional recording are deferred.
- SSH verified using macOS `/usr/bin/ssh -o UseKeychain=yes`; default show running, cameras reachable, Modal clips uploading.
- bitcube has pre-existing moved `river_masks/` files and untracked `pixelmap-2026-10-26.json`; preserve them. New show keeps the baseline's 23 Oct calibration pins.
- Return to the existing default after verification; do not change the default or Dave's deployment.

## Open questions
- Running **the live river** still shows as a warning on Status ("not the river's year"); a viz running shows OK. Gavin to decide if the live river should be OK too.
- A switch restarts TouchDesigner, so the river's year comes back with its own saved state (after the 14:40 test it was in winter; it had been set by hand to summer at 14:12).
