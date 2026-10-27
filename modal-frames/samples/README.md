# Sample manifests

Illustrative `latest.json` manifests for [`../SPEC.md`](../SPEC.md). They all pass [`../frame.schema.json`](../frame.schema.json). The `sha256` values are placeholders: the mock server (`tools/modal/frames_mock.py`, planned) generates real PNGs and hashes.

| File | Shows |
|---|---|
| `calm-blue.json` | A full frame: all five elements |
| `dusk-ropes-only.json` | A partial frame: ropes only, with a `via` waypoint and a long journey |
| `river-only.json` | No new images: only the river settings change |
| `invalid-layout-mismatch.json` | Schema-valid but **rejected** by bitcube: wrong `layout_version` |
