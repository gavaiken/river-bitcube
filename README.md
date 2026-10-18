# river-bitcube

Show machine for **A River Becoming** (Gray Area, Oct 2026). Lives at `C:\Users\user\River` on bitcube, the Windows mini PC that drives 20 LED ropes over Art-Net and HUB75 panels over HDMI.

| Path | What |
|---|---|
| `CLAUDE.md` | Start here (humans and agents): current goal, key facts, rules |
| `docs/` | Running log, hardware reference, design notes |
| `river_masks/` | Andi's TouchDesigner project (web view → panel crops → HDMI) |
| `td/bridge/` | Claude ↔ TouchDesigner bridge (WebServer DAT on localhost:9980) |
| `tools/td.ps1` | Run Python inside the open TD project via the bridge |
| `tools/cam_snap.ps1` | Grab a camera frame (URLs in untracked `secrets.local.json`) |
| `Start-River.cmd` | Login autostart: opens `river.toe` in TouchDesigner |
