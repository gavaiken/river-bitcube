# A River Becoming: Claude on bitcube

You're running on **bitcube**, the Windows mini PC that drives the installation (it will also be the gallery machine). This folder, `C:\Users\user\River\river-bitcube`, is the git repo **github.com/gavaiken/river-bitcube**. Next to it, `C:\Users\user\River\river-agent` is Dave's repo **github.com/drocamor/river-agent** (the Modal agent; merges to main deploy to Modal). The parent `C:\Users\user\River` is not a repo; it is shared over SMB as `\\bitcube\River`.

Read first:
- `docs\a-river-becoming-log.md`: running log and handoff (people, architecture, access, what runs on this box, open items, session history). **Append your session's work to its "Session log" section.**
- `docs\a-river-becoming-hardware.md`: verified hardware (LED ropes, PSAC10 Art-Net boxes, rack controller, HUB75 panels).
- `docs\a-river-becoming-notes.md`: design notes from the team meetings.

`docs\` in this repo is the source of truth. Gavin's Mac mini pulls it, and a Claude session there can also SSH in (`ssh bitcube`).

## Current goal
TouchDesigner (TD) drives the 20 ropes over Art-Net **and** the HUB75 panels over HDMI from one canvas, while Claude watches the result through the cameras and iterates. The full plan is in `docs\a-river-becoming-log.md` → open items. Work through it in this order:
1. **Bridge:** in TD's Textport (Alt+T), run `exec(open(r'C:\Users\user\River\river-bitcube\td\bridge\install_bridge.py').read())` once, then save. After that, `tools\td.ps1` runs Python inside TD (`.\tools\td.ps1 "app.build"`, `-File`, `-Errors`, `-Screenshot /path/to/top`). Prefer this over clicking in the GUI.
2. **Ropes over Art-Net** (priority).
3. **Two panel quads over HDMI.**
4. **Cameras** (`tools\cam_snap.ps1 <name>`).
5. **One shared canvas,** saved as `river.toe`.

## Facts you'll need
- **TD 2025.33230:** `C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe`. The login autostart (`Start-River.cmd`, next to this file) opens `river.toe` in this folder.
- **Andi's TD project:** `river_masks\river_masks.toe`. `panel_crop.glsl` samples 4 rotated rects into 4 colour buffers (one quad). Reuse it.
- **Rope mapping** (Will's, provisional; source of truth `C:\Users\user\RopeLights\config.local.json`, read it rather than retyping):
  - 20 ropes × 400 px RGB; 170 px per universe; 4 universes reserved per rope (3 used, 4th cleared).
  - Box 1 = `2.0.0.10`, universes 0–39 (ropes 0–9). Box 2 = `2.0.0.11`, universes 40–79 (ropes 10–19).
  - Source NIC `2.0.0.8/8` ("Ethernet"). Colour order RGB.
  - Rope order, direction and the 170/340 boundaries still need checking with an identify pattern.
- **Will's RopeLights app** (scheduled task `RopeLights`, `Start/Stop-Rope-Lights.cmd`) also sends Art-Net. Stop it (with Gavin's OK) before TD drives the ropes. Never run both at once.
- **Panels:** the single HDMI output (1920×1080) goes to the Colorlight sender, which samples the top-left region. A panel is 128×64; a quad is 256×128.
- **Cameras** (from Will, 2026-10-18): Reolinks behind the GL.iNet router (subnet `192.168.8.0/24`, reached over Will's tailnet). Full URLs including the password are in `secrets.local.json` (untracked; never commit it). Grabbing frames shows you what the ropes and panels are actually doing.
  - Gallery cam (E1 Pro): `192.168.8.103`. River cam (E1 Outdoor Pro): `192.168.8.217`.
  - RTSP: `rtsp://admin:<password>@<ip>:554/Preview_01_main` (`-rtsp_transport tcp`). The password is the same as bitcube's login.
  - Pan/tilt: HTTPS JSON API at `https://<ip>/cgi-bin/api.cgi` (self-signed cert): `Login` → token → `PtzCtrl` (`op` Left/Right/Up/Down/Stop, `speed`) → `Logout`. Always send `Stop`. Will's example: `tools/cameras/test_cam_move.py`.
- **Dave's visuals:** web canvas `https://to-be-a-river--river.modal.run/canvas.html` (Web Render TOP).
- **Remote viewing:** VNC (TightVNC :5900) shows the real console/HDMI; RDP blanks the panels.
- **Power:** a full-white box is ≈1.5 kW. Cap brightness in TD.

## TouchDesigner gotchas (learned the hard way)
- **Anything modal in TD freezes the bridge.** A dialog blocks TD's main thread, so `td.ps1` calls hang. `td.ps1` times out after 20 s and names the blocking dialog. Someone then has to answer it on the console (VNC), or Claude clicks it after taking a screenshot.
- **Save only with `.\tools\td_save.ps1`.** Never call `project.save(...)` directly. TD's incremental save (pref `general.inc`, default 2) made a named save collide with an existing `river.N.toe` and prompt "already exists. Replace?". On bitcube `general.inc` is now 0. `td_save.ps1` re-checks it, refuses to save if it's back on, verifies `river.toe`'s timestamp, and deletes stray `river.N.toe`.
- **Never put unpicklable objects (sockets, files) in `comp.storage`.** TD pickles storage into the `.toe` on save, and a socket triggers a modal "saved with errors". Keep live objects in a holder module in `sys.modules`, as `td/ropes/artnet_out.py` does.
- **Save before cooking a new GLSL shader.** A shader that sampled an unwired input hung the Iris Xe driver (TDR) and killed TD. Index `sTD2DInputs[]` with literal constants only, guarded by `TD_NUM_2D_INPUTS`. In multi-input TOPs a new input connector only appears on the next frame (see `wire()` in `td/build/build_panels.py`).
- **Changes live in the repo, not only in the `.toe`.** The rope/panel logic and shaders are files synced into DATs. `td/build/*.py` rebuild the COMPs idempotently: `.\tools\td.ps1 -File .\td\build\build_ropes.py`. From Git Bash, run PowerShell scripts with `powershell -ExecutionPolicy Bypass -File ...`.
- **Dark ropes = keep sending black.** When Art-Net stops, the lighting hardware plays its own colour-cycling program (rack SD card or PSAC10 PLAY mode). To keep the ropes dark, use `Source='black'` with `Active` on, never `Active` off.
- **Displays (2026-10-18):** Windows extends the desktop across two displays. `M14` (USB-C, Lenovo, 1366×768, **primary**, at 0,767) and `LED 1920X108…` (the Colorlight sender for the HUB75, `DISPLAY2`, 1920×1080 at 1366,767). TD's `monitors` lists both. The panels window used to anchor to the primary display, so it landed on the M14: find the LED monitor by name instead (plan item B). Keep the M14 as primary so the desktop and taskbar stay off the panels.
- **Booting (fixed and verified by a restart, 2026-10-18 12:27):** the UEFI boot order now puts Windows Boot Manager ahead of Ubuntu/GRUB (`bcdedit /set {fwbootmgr} displayorder {bootmgr} /addfirst`). Ubuntu is still installed and can be picked from the firmware boot menu. Auto-login uses Sysinternals Autologon: the password is stored as an LSA secret, not plain text in the registry, and Windows' Hello-only sign-in (`DevicePasswordLessBuildVersion`) is off. Tailscale runs unattended (connects before login), and sleep and hibernate on AC are both off. A restart takes about a minute end to end.

## Rules
- **This repo is public** (status page: https://gavaiken.github.io/river-bitcube/). Never commit passwords, tokens, camera logins, private keys, personal emails or phone numbers. Secrets live only in untracked `secrets.local.json`.
- **Coordination:** `docs/plan.md` is the shared checklist. `git pull` before starting. Only one Claude (this one or the Mac mini one) works at a time. When you finish an item, tick it in `docs/plan.md`, update `docs/index.md` (the public status page: keep it to one screen, refresh the "Status as of" line) and add a log entry, all in the same commit as the work.
- It's a shared show machine. Ask Gavin before uninstalling anything, changing network/firewall/Tailscale settings, or touching Will's RopeLights setup.
- Never write passwords, tokens or camera logins into tracked files.
- Commit and push in small logical steps to `main`.
