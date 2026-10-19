# A River Becoming: Claude on bitcube

You're running on **bitcube**, the Windows mini PC that drives the installation (it will also be the gallery machine). This folder, `C:\Users\user\River\river-bitcube`, is the git repo **github.com/gavaiken/river-bitcube**. Next to it, `C:\Users\user\River\river-agent` is Dave's repo **github.com/drocamor/river-agent** (the Modal agent; merges to main deploy to Modal). The parent `C:\Users\user\River` is not a repo; it is shared over SMB as `\\bitcube\River`.

Read first:
- `docs\a-river-becoming-log.md`: running log and handoff (people, architecture, access, what runs on this box, open items, session history). **Append your session's work to its "Session log" section.**
- `docs\a-river-becoming-hardware.md`: verified hardware (LED ropes, PSAC10 Art-Net boxes, rack controller, HUB75 panels).
- `docs\a-river-becoming-notes.md`: design notes from the team meetings.
- `docs\system\system.json`: every machine, IP, port, account and connection ([interactive map](https://gavaiken.github.io/river-bitcube/system/)). When you change any of them, update it, run `python tools\system_docs.py` and the tests in `tools\tests`.

`docs\` in this repo is the source of truth. Gavin's Mac mini pulls it, and a Claude session there can also SSH in (`ssh bitcube`).

## Current goal
TouchDesigner (TD) drives the 20 ropes over Art-Net **and** the HUB75 panels over HDMI from one canvas, while Claude watches the result through the cameras and iterates. The full plan is in `docs\a-river-becoming-log.md` → open items. Work through it in this order:
1. **Bridge:** in TD's Textport (Alt+T), run `exec(open(r'C:\Users\user\River\river-bitcube\td\bridge\install_bridge.py').read())` once, then save. After that, `tools\td.ps1` runs Python inside TD (`.\tools\td.ps1 "app.build"`, `-File`, `-Errors`, `-Screenshot /path/to/top`). Prefer this over clicking in the GUI.
2. **Ropes over Art-Net** (priority).
3. **Two panel quads over HDMI.**
4. **Cameras** (`tools\cam_snap.ps1 <name>`).
5. **One shared canvas,** saved as `river.toe`.

## Facts you'll need
- **TD 2025.33230:** `C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe`. The login autostart (`Start-River.cmd`, next to this file) opens **`river-local-oct-18.toe`** (the local rain checkpoint) since 18 Oct; `river.toe` is the general show file for Dave's visuals (session D).
- **Andi's TD project:** `river_masks\river_masks.toe`. `panel_crop.glsl` samples 4 rotated rects into 4 colour buffers (one quad). Reuse it.
- **Rope mapping** (Will's, provisional; source of truth `C:\Users\user\RopeLights\config.local.json`, read it rather than retyping):
  - 20 ropes × 400 px RGB; 170 px per universe; 4 universes reserved per rope (3 used, 4th cleared).
  - Box 1 = `2.0.0.10`, universes 0–39 (ropes 0–9). Box 2 = `2.0.0.11`, universes 40–79 (ropes 10–19).
  - Source NIC `2.0.0.8/8` ("Ethernet"). Colour order RGB.
  - Rope order, direction and the 170/340 boundaries still need checking with an identify pattern.
- **Will's RopeLights app** (scheduled task `RopeLights`, `Start/Stop-Rope-Lights.cmd`) also sends Art-Net. Stop it (with Gavin's OK) before TD drives the ropes. Never run both at once.
- **Panels:** the single HDMI output (1920×1080) goes to the Colorlight sender, which samples the top-left region. A panel is 128×64; a quad is 256×128.
- **Cameras** (from Will, 2026-10-18): Reolinks behind the GL.iNet router (subnet `192.168.8.0/24`, reached over Will's tailnet). Full URLs including the password are in `secrets.local.json` (untracked; never commit it). Grabbing frames shows you what the ropes and panels are actually doing.
  - Gallery cam (E1 Pro): on **Agape WiFi at `10.0.7.76`** since 18 Oct 14:09 (it was on the GL.iNet router at `.103`, then `.189`). bitcube reaches it directly over the house network, and since 18 Oct 17:55 advertises it on Will's tailnet as `10.0.7.76/32`, so devices on that tailnet reach it through bitcube. At Gray Area, advertise its new address the same way. River cam (E1 Outdoor Pro): `192.168.8.217` on the GL.iNet router; both went to the river on the evening of 18 Oct. Never advertise a site's own LAN as a Tailscale subnet from another device: the GL.iNet's `10.0.7.0/24` route took bitcube's house traffic with it when the router left.
  - Aim with `python tools/cameras/ptz.py <cam> Left|Right|Up|Down <seconds>`. Roughly 2,600 px/s of pan at 2880 px width, so nudge 0.1–0.4 s at a time and check with `cam_snap.ps1`. The gallery cam is aimed (18 Oct 13:59) at all the coil piles plus the HUB75 and PSAC10s.
  - RTSP: `rtsp://admin:<password>@<ip>:554/Preview_01_main` (`-rtsp_transport tcp`). The password is only in `secrets.local.json`.
  - Pan/tilt: HTTPS JSON API at `https://<ip>/cgi-bin/api.cgi` (self-signed cert): `Login` → token → `PtzCtrl` (`op` Left/Right/Up/Down/Stop, `speed`) → `Logout`. Always send `Stop`. Will's example: `tools/cameras/test_cam_move.py`.
- **Dave's visuals:** web canvas `https://to-be-a-river--river.modal.run/canvas.html` (Web Render TOP).
- **Remote viewing:** VNC (TightVNC :5900) shows the real console/HDMI; RDP blanks the panels.
- **Power:** a full-white box is ≈1.5 kW. Cap brightness in TD.

## TouchDesigner gotchas (learned the hard way)
- **Anything modal in TD freezes the bridge.** A dialog blocks TD's main thread, so `td.ps1` calls hang. `td.ps1` times out after 20 s and names the blocking dialog. Someone then has to answer it on the console (VNC), or Claude clicks it after taking a screenshot.
- **Two show files:** `river.toe` (the general show file, for Dave's visuals) and the local rain checkpoint `river-local-oct-18.toe` (opened at login since 18 Oct 16:54; pixel-mapped rain on the ropes and HUB75; `td/build/build_river_local.py`, map from `tools/pixelmap/`). `td_save.ps1` saves whichever file is open; `-Target x.toe` does a Save As.
- **Never light all ropes white at once:** both boxes hit the 600 W limiter (about 1.2 kW) and could trip a shared house circuit. Plain Gray-code patterns are *not* balanced (rope bit 4's inverse lights every rope of box 1), so `tools/pixelmap/capture.py` dims each pattern pair until no box draws more than half its power at the cap (`graycode.pattern_brightness`, at most 300 W/box).
- **Save only with `.\tools\td_save.ps1`.** Never call `project.save(...)` directly. TD's incremental save (pref `general.inc`, default 2) made a named save collide with an existing `river.N.toe` and prompt "already exists. Replace?". On bitcube `general.inc` is now 0. `td_save.ps1` re-checks it, refuses to save if it's back on, verifies `river.toe`'s timestamp, and deletes stray `river.N.toe`.
- **Never put unpicklable objects (sockets, files) in `comp.storage`.** TD pickles storage into the `.toe` on save, and a socket triggers a modal "saved with errors". Keep live objects in a holder module in `sys.modules`, as `td/ropes/artnet_out.py` does.
- **Save before cooking a new GLSL shader.** A shader that sampled an unwired input hung the Iris Xe driver (TDR) and killed TD. Index `sTD2DInputs[]` with literal constants only, guarded by `TD_NUM_2D_INPUTS`. In multi-input TOPs a new input connector only appears on the next frame (see `wire()` in `td/build/build_panels.py`).
- **Changes live in the repo, not only in the `.toe`.** The rope/panel logic and shaders are files synced into DATs. `td/build/*.py` rebuild the COMPs idempotently: `.\tools\td.ps1 -File .\td\build\build_ropes.py`. From Git Bash, run PowerShell scripts with `powershell -ExecutionPolicy Bypass -File ...`.
- **`absTime` restarts at 0 when a project loads, but `comp.storage` is saved in the `.toe`.** Never compare `absTime` with a time kept in storage without handling the clock going backwards. The rope sender stalled after a reload this way (fixed 18 Oct in `artnet_out.tick`).
- **Non-Commercial key: TOPs max 1280×1280.** The full-screen black for the LED display comes from a Container COMP (`panels/screen`), not a TOP. Panel `y` counts up from the bottom.
- **Dark ropes = keep sending black.** When Art-Net stops, the lighting hardware plays its own colour-cycling program (rack SD card or PSAC10 PLAY mode). To keep the ropes dark, use `Source='black'` with `Active` on, never `Active` off.
- **Displays (2026-10-18):** Windows extends the desktop across two displays. `M14` (USB-C, Lenovo, 1366×768, **primary**, at 0,767) and `LED 1920X108…` (the Colorlight sender for the HUB75, `DISPLAY2`, 1920×1080 at 1366,767). TD's `monitors` lists both. The panels window used to anchor to the primary display, so it landed on the M14: find the LED monitor by name instead (plan item B). Keep the M14 as primary so the desktop and taskbar stay off the panels.
- **Booting (fixed and verified by a restart, 2026-10-18 12:27):** the UEFI boot order now puts Windows Boot Manager ahead of Ubuntu/GRUB (`bcdedit /set {fwbootmgr} displayorder {bootmgr} /addfirst`). Ubuntu is still installed and can be picked from the firmware boot menu. Auto-login uses Sysinternals Autologon: the password is stored as an LSA secret, not plain text in the registry, and Windows' Hello-only sign-in (`DevicePasswordLessBuildVersion`) is off. Tailscale runs unattended (connects before login), and sleep and hibernate on AC are both off. A restart takes about a minute end to end.

## Rules
- **This repo is public** (status page: https://gavaiken.github.io/river-bitcube/). Never commit passwords, tokens, camera logins, private keys or phone numbers. Names, hostnames, IPs, ports, device usernames and account emails may be published (Gavin, 18 Oct; see `docs/system/`). Secrets live only in untracked `secrets.local.json`.
- **Sessions:** you are one lettered session in `docs/execution-plan.md` (the prompt says which). Follow its **Coordination contract**: progress lines in `docs/sessions/<letter>.md` and the Status table updated and **pushed after every step**, decisions you need under `### Waiting on Gavin`, a SESSION SUMMARY at the end. Session A (Gavin's Mac mini) coordinates by pulling the repo.
- **Coordination:** `docs/plan.md` is the shared checklist. `git pull` before starting. Only one Claude (this one or the Mac mini one) works at a time. When you finish an item, tick it in `docs/plan.md`, update `docs/index.md` (the public status page: keep it to one screen, refresh the "Status as of" line) and add a log entry, all in the same commit as the work.
- It's a shared show machine. Ask Gavin before uninstalling anything, changing network/firewall/Tailscale settings, or touching Will's RopeLights setup.
- Never write passwords, tokens or camera logins into tracked files.
- Commit and push in small logical steps to `main`.
