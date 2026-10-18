# river-bitcube

Show machine for **A River Becoming** (Gray Area, Oct 2026). Lives at `C:\Users\user\River\river-bitcube` on bitcube (next to `River\river-agent`, Dave's repo), the Windows mini PC that drives 20 LED ropes over Art-Net and HUB75 panels over HDMI.

| Path | What |
|---|---|
| `CLAUDE.md` | Start here (humans and agents): current goal, key facts, rules |
| `docs/` | Running log, hardware reference, design notes |
| `river_masks/` | Andi's TouchDesigner project (web view → panel crops → HDMI) |
| `td/bridge/` | Claude ↔ TouchDesigner bridge (WebServer DAT on localhost:9980) |
| `tools/td.ps1` | Run Python inside the open TD project via the bridge |
| `tools/cam_snap.ps1` | Grab a camera frame (URLs in untracked `secrets.local.json`) |
| `Start-River.cmd` | Login autostart: opens `river.toe` in TouchDesigner |
| `Start-Claude.cmd` | Login autostart: terminal in `C:\Users\user\River` running Claude, told to read all docs and wait |

## Login launcher

Set up 2026-10-17. This box auto-logs in as `user`, and the shortcut
`C:\Users\user\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Start-River.lnk`
runs `C:\Users\user\River\river-bitcube\Start-River.cmd` at every login.

`Start-River.cmd` waits 10 s, then opens `C:\Users\user\River\river-bitcube\river.toe` in TouchDesigner
(`C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe`, build 2025.33230). If `river.toe` doesn't exist yet, it opens TouchDesigner with no file.

- To change what runs at boot, put the show file at `river-bitcube\river.toe`, or edit the `TOE` line in the script.
- To stop autostart, delete or move `Start-River.lnk` out of the Startup folder.
- The parent folder `C:\Users\user\River` is shared over SMB as `\\bitcube\River` (user `user`).
- TouchDesigner 2022.33910 is no longer installed. The 2025 installer ignored `/DIR` and replaced it in place (2026-10-17). 2025 opens the old BitCube files.
- The previous (2023 BitCube) autostart is archived, with restore steps, in `C:\Users\user\Archive\2023-bitcube-startup\README.md`.

Not managed here: Will's rope-light app runs as the scheduled task `RopeLights` (`C:\Users\user\RopeLights`). It has no trigger, so it does not start at boot. Don't run it while TouchDesigner is also sending Art-Net to the ropes.
