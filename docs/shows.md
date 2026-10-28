---
title: "A River Becoming: the show registry"
---

# The show registry: `shows.json`

`shows.json` at the repo root is the one list of show files (the TouchDesigner files that run the whole piece). Everything that used to keep its own list reads it instead:

| Reader | What it takes from it |
|---|---|
| `Start-River.cmd` (through `tools/shows.ps1`) | which file opens at boot, and which file a switch opens now |
| `tools/mission/probe.ps1` (through `tools/shows.ps1`) | what mission control may switch to or set as default (`show_files`), the boot file, what a rebuild may bake |
| `mission/public/model.js` (mission control, server and pages; pages fetch `GET /shows.json`) | labels, the switch list, the boot-file choices, the preview card, Back to boot file |
| `mission/lib/mission.mjs` | the control whitelist: a switch, or Set as default, only to an offered show |
| `td/build/registry.py` (every `td/build/build_*.py`, `td/build/screens.py`) | which file a build script may build, and the calibration it pins |
| `tools/check` (`tools/shows_check.py`) | the schema, the files, and that metadata is kept up to date |

Mission control restarts itself when `shows.json` changes on `main` (as it does for new `mission/` code). bitcube reads its own checkout: **`git pull` on bitcube** before a new show can be switched to there.

## Format

```json
{
  "boot_default": "river-local-oct-22-seasons.toe",
  "shows": [
    {
      "file": "river-local-oct-22-seasons.toe",
      "title": "The river's year",
      "label": "the river's year",
      "role": "year",
      "kind": "show",
      "offered": true,
      "build": "td/build/build_seasons_local.py",
      "calibration": {
        "pixelmap": "tools/pixelmap/pixelmap-2026-10-23.json",
        "screens": "tools/pixelmap/screens-2026-10-23.json"
      },
      "description": "At most 100 words: what it does, for someone about to switch to it.",
      "inputs": ["river library", "people counter"],
      "created_by": "gavin", "created": "2026-10-22",
      "updated_by": "gavin", "updated": "2026-10-26",
      "last_change": "One line: what changed last."
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `boot_default` | yes | The file Start-River.cmd opens when `River\boot-file.txt` names no listed show (mission control's **Set as default** writes that file; this is the fallback under it). Must be an offered entry. **Protected:** changing it is Gavin's call. |
| `file` | yes | The `.toe` in the repo root. Never renamed after creation. Retired files (`old-…`) aren't listed. |
| `title` | yes | Its name on the preview card. |
| `label` | no | Its words mid-sentence ("Switch to *the river's year*"). Default: `title`. |
| `role` | no | Only for the two original shows: `year` (serves the year page on 9981; the one a rebuild may bake) or `live` (live river cam and Dave's agent). Mission control's verdicts depend on it. Leave it out for a new viz. |
| `kind` | yes | `show` (made for visitors), `template` (a starting point), `viz` (a new visualization). |
| `offered` | yes | Mission control may switch to it. `false` hides it (and skips the file-exists check, for an entry registered before its file lands). |
| `build` | yes | The repo-relative build script (`td/build/build_<name>.py`). The script refuses to run in any other file. |
| `calibration.pixelmap` | yes | The rope LED map this show pins (`tools/pixelmap/pixelmap-<date>.json`). |
| `calibration.screens` | no | Where the HUB75 screens hang in the camera's view (`tools/pixelmap/screens-<date>.json`); `null` = the fallback windows. |
| `calibration.zones` | no | The remembered river's zones (`tools/pixelmap/zones-<date>.json`: LED heights, pool, eddies, rope feet, screen heights and tilts; `tools/remembered/zones.py`); `null` or absent = the show's built-in defaults. Read with `registry.zones_for()`; the people counter also reads it. |
| `description` | yes | At most 100 words: what it does, what someone sees after switching. |
| `inputs` | yes | What it reads: cameras, files, services (a list of short phrases). |
| `created_by`, `created` | yes | Who made it, `YYYY-MM-DD`. |
| `updated_by`, `updated`, `last_change` | yes | Who changed it last, when, and one line on what. **Update them with every change to the `.toe` or its build script** (`tools/check` refuses otherwise). |

## Calibration is pinned

Each show uses exactly the calibration its entry pins, never "the newest dated file". In a build script:

```python
import sys; sys.path.insert(0, REPO + '/td/build')
import importlib, registry; importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_<name>.py')   # RegistryError unless shows.json says this script builds it
cal = registry.calibration_for(project.name)   # {'pixelmap': '<abs path>', 'screens': '<abs path>' or None}
```

`calibration_for` raises `RegistryError` with a plain message when the entry, its pin or a pinned file is missing. Pass `PINNED_SCREENS=cal['screens']` into `td/build/screens.py`'s globals (without it, screens.py looks up the open file's pin itself). Other helpers: `registry.load()`, `registry.entry(name)`, `registry.offered()`.

**A new calibration** (Lights → Calibrate, `tools/mission/calibrate.py`) writes a new dated `pixelmap-<date>.json` (and `screens.py` a `screens-<date>.json`) and changes no pins. To use it in a show: change that show's `calibration` in `shows.json` (and its `updated`/`last_change`), push, pull on bitcube, then rebuild that show (Lights → Rebuild for the river's year, or its build script through `tools\td.ps1`). Never re-pin someone else's show.

## Boot file and switching

In mission control the boot file is called **the default**: what opens when bitcube restarts.

- **Switch** (Status → What's showing → Change, or the TouchDesigner row): restarts TouchDesigner on any offered show (`Start-River.cmd <file>`). **The default doesn't change.** A preview card (title, kind, description, inputs, who made it, who edited it last and when, last change, whether it is the default) comes up before anything is sent.
- **Back to default**: one button whenever something other than the default is showing.
- **Set as default** (on the preview card, and Installer → Default): any offered show, its own confirmed action ("<title> will open when bitcube restarts. What's showing now doesn't change."). It writes `River\boot-file.txt`; `boot_default` in `shows.json` is the fallback. The show list marks the current default.

## Adding a show

1. Copy the template: `tools\td_save.ps1 -Target river-<name>.toe` (with `river-baseline-template.toe` open).
2. Copy `td/build/build_baseline.py` to `td/build/build_<name>.py`; change its `TOE` and `require_build` names.
3. Add an entry: `kind: "viz"`, `offered: true`, your `build`, the calibration you want pinned, a description (≤100 words), `inputs`, `created_by`/`created`, `updated_by`/`updated`/`last_change`.
4. Run `tools/check`, commit, push. Pull on bitcube; it then shows up in mission control's switch list.

## `tools/check`

Run `tools/check` before every push (Mac, Linux, or Git Bash on bitcube). It runs:

- **the registry check** (`tools/shows_check.py`): the schema above; every offered `.toe`, every build script and every pinned calibration file exists; descriptions are at most 100 words; `boot_default` is an offered show; and **metadata freshness**: if the changes since `origin/main` (plus your working tree) touch an entry's `.toe` or its build script, that entry's `last_change` must change and `updated` must not go backwards (a new entry passes);
- the Python tests (`tools/tests`, `tools/pixelmap/tests`; a `.venv` is made on first run if pytest is missing);
- mission control's tests (`cd mission && npm test`; `npm ci` first if `node_modules` is missing).

GitHub Actions (`.github/workflows/check.yml`) runs the same on every push and pull request, comparing with the push's previous tip. Nothing in it needs bitcube or secrets.
