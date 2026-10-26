# river-bitcube

Show machine for **A River Becoming** (Gray Area, Oct 2026). Lives at `C:\Users\user\River\river-bitcube` on bitcube (next to `River\river-agent`, Dave's repo), the Windows mini PC that drives 20 LED ropes over Art-Net and HUB75 panels over HDMI.

| Path | What |
|---|---|
| `AGENTS.md` | Start here (humans and agents, Claude and Codex): the rules, the baton, key facts. `CLAUDE.md` just points to it |
| `HANDOFF.md` | Where things stand now and who worked last (the baton) |
| `shows.json` | Every show file mission control offers: what it does, its inputs, who edited it, its calibration |
| `tools/check` | Run before every push (tests, registry, calibration); also runs on GitHub |
| `docs/` | Hardware reference, design notes, show-file pages, [checkpoints](docs/checkpoints.md); the old plans and log are history |
| `docs/system/` | **System map:** `system.json` (every device, IP, port and connection; source of truth), the interactive page ([live](https://gavaiken.github.io/river-bitcube/system/)) and generated `system.md`. `docs/llms.txt` indexes the docs for agents |
| `tools/system_docs.py`, `tools/system_check.py` | Generate `system.md`; validate `system.json` and scan for secrets (`.venv/bin/pytest tools/tests`) |
| `river_masks/` | Andi's TouchDesigner project (web view → panel crops → HDMI) |
| `td/bridge/` | Claude ↔ TouchDesigner bridge (WebServer DAT on localhost:9980) |
| `tools/td.ps1` | Run Python inside the open TD project via the bridge |
| `tools/cam_snap.ps1` | Grab a camera frame (URLs in untracked `secrets.local.json`) |
| `Start-River.cmd` | Login autostart: opens the boot show file in TouchDesigner |
| `Start-Status.cmd` | Login autostart (40 s): Chrome on the main monitor with the public status page (`tools/status_page.ps1`; local `docs/index.md` if offline) |
| `Start-Claude.cmd` | Login autostart: terminal in `C:\Users\user\River` running Claude, told to read all docs and wait |

## Login launcher

Set up 2026-10-17. This box auto-logs in as `user`, and the shortcut
`C:\Users\user\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Start-River.lnk`
runs `C:\Users\user\River\river-bitcube\Start-River.cmd` at every login.

`Start-River.cmd` waits 10 s, then opens the boot show file in TouchDesigner
(`C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe`, build 2025.33230): the file named in `C:\Users\user\River\boot-file.txt` (set by mission control), else `river-local-oct-22-seasons.toe` (the river's year), else `river-online-oct-23.toe`. If none exists, it opens TouchDesigner with no file. Retired show files start with `old-` and are never opened.

- To change what runs at boot, use mission control's Boot file (Status → Installer), or edit the `TOE` lines in the script.
- To stop autostart, delete or move `Start-River.lnk` out of the Startup folder.
- The parent folder `C:\Users\user\River` is shared over SMB as `\\bitcube\River` (user `user`).
- TouchDesigner 2022.33910 is no longer installed. The 2025 installer ignored `/DIR` and replaced it in place (2026-10-17). 2025 opens the old BitCube files.
- The previous (2023 BitCube) autostart is archived, with restore steps, in `C:\Users\user\Archive\2023-bitcube-startup\README.md`.

Not managed here: Will's rope-light app runs as the scheduled task `RopeLights` (`C:\Users\user\RopeLights`). It has no trigger, so it does not start at boot. Don't run it while TouchDesigner is also sending Art-Net to the ropes.
