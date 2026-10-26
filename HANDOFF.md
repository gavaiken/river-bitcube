# Handoff: where things stand

The baton. **Read this first, every session; rewrite it before you stop** (rules: [`AGENTS.md`](AGENTS.md) "Start here"). Keep it to one screen: the current state, not a history. History goes in `docs/sessions/<name>.md`.

- **Holder:** Gavin (coordinator session on the Mac mini, with two helper agents)
- **Where:** repo + bitcube (a helper is building the baseline template on bitcube)
- **Updated:** 2026-10-26 14:01 PT
- **Next holder:** Will, once the "Ready for Will" list below is all ✅

## The show right now
- At Gray Area. bitcube boots **the river's year** (`river-local-oct-22-seasons.toe`); **the live river** (`river-online-oct-23.toe`) is the other show file mission control offers.
- Mission control v2 is live (round 10 merged; open minor items in [`docs/mission-known-issues.md`](docs/mission-known-issues.md)).
- Checkpoint `checkpoint-2026-10-26` taken (tags in both repos, bitcube and mini archives): [`docs/checkpoints.md`](docs/checkpoints.md).

## In progress (Gavin, 26 Oct): getting ready for Will
| | Piece | Who |
|---|---|---|
| ✅ | Checkpoint | coordinator |
| ✅ | `AGENTS.md` (one rulebook for Claude and Codex), this baton, the old plans marked as history, studio agent follows the baton | coordinator |
| ⏳ | `shows.json` registry (every show file's description, inputs, editors, pinned calibration); `Start-River.cmd`, mission control and the build scripts read it | helper (repo) |
| ⏳ | Calibration pinned per show, never "newest map wins" | helper (repo) |
| ⏳ | `tools/check` + GitHub Actions (tests, registry, metadata freshness) | helper (repo) |
| ⏳ | Mission control: a card describing a show before you switch to it, and "Back to boot file" | helper (repo) |
| ⏳ | Baseline template `river-baseline-template.toe`: river cam (recorded clip as fallback) + gallery cam in, river on the screens and down the ropes | helper (bitcube) |
| ⬜ | Gavin switches to the template on his phone, reads its card, switches back; `tools/check` green → kickoff prompt to Will | Gavin |

## Ready for Will when
All rows above are ✅. Then Will's first session: `git pull`, read `AGENTS.md` and this file, take the baton, make his first viz from the template.

## Open questions
- None blocking.
