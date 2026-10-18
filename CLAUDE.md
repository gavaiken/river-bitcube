# A River Becoming: Claude on bitcube

You're running on **bitcube**, the Windows mini PC that drives the installation (it will also be the gallery machine). This folder, `C:\Users\user\River`, is the git repo **github.com/gavaiken/river-bitcube** and is shared over SMB as `\\bitcube\River`.

Read first:
- `docs\a-river-becoming-log.md`: running log and handoff (people, architecture, access, what runs on this box, open items, session history). **Append your session's work to its "Session log" section.**
- `docs\a-river-becoming-hardware.md`: verified hardware (LED ropes, PSAC10 Art-Net boxes, rack controller, HUB75 panels).
- `docs\a-river-becoming-notes.md`: design notes from the team meetings.

`docs\` in this repo is the source of truth. Gavin's Mac mini pulls it, and a Claude session there can also SSH in (`ssh bitcube`).

## Current goal
TouchDesigner (TD) drives the 20 ropes over Art-Net **and** the HUB75 panels over HDMI from one canvas, while Claude watches the result through the cameras and iterates. The full plan is in `docs\a-river-becoming-log.md` → open items. Work through it in this order:
1. **Bridge:** in TD's Textport (Alt+T), run `exec(open(r'C:\Users\user\River\td\bridge\install_bridge.py').read())` once, then save. After that, `tools\td.ps1` runs Python inside TD (`.\tools\td.ps1 "app.build"`, `-File`, `-Errors`, `-Screenshot /path/to/top`). Prefer this over clicking in the GUI.
2. **Ropes over Art-Net** (priority).
3. **Two panel quads over HDMI.**
4. **Cameras** (`tools\cam_snap.ps1 <name>`).
5. **One shared canvas,** saved as `river.toe`.

## Facts you'll need
- **TD 2025.33230:** `C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe`. The login autostart (`Start-River.cmd`) opens `River\river.toe`, which doesn't exist yet.
- **Andi's TD project:** `river_masks\river_masks.toe`. `panel_crop.glsl` samples 4 rotated rects into 4 colour buffers (one quad). Reuse it.
- **Rope mapping** (Will's, provisional; source of truth `C:\Users\user\RopeLights\config.local.json`, read it rather than retyping):
  - 20 ropes × 400 px RGB; 170 px per universe; 4 universes reserved per rope (3 used, 4th cleared).
  - Box 1 = `2.0.0.10`, universes 0–39 (ropes 0–9). Box 2 = `2.0.0.11`, universes 40–79 (ropes 10–19).
  - Source NIC `2.0.0.8/8` ("Ethernet"). Colour order RGB.
  - Rope order, direction and the 170/340 boundaries still need checking with an identify pattern.
- **Will's RopeLights app** (scheduled task `RopeLights`, `Start/Stop-Rope-Lights.cmd`) also sends Art-Net. Stop it (with Gavin's OK) before TD drives the ropes. Never run both at once.
- **Panels:** the single HDMI output (1920×1080) goes to the Colorlight sender, which samples the top-left region. A panel is 128×64; a quad is 256×128.
- **Cameras:** Reolinks with RTSP + pan/tilt on Will's tailnet, behind the GL.iNet router. Put URLs in `secrets.local.json` (untracked; see the example file). Grabbing frames shows you what the ropes and panels are actually doing.
- **Dave's visuals:** web canvas `https://to-be-a-river--river.modal.run/canvas.html` (Web Render TOP).
- **Remote viewing:** VNC (TightVNC :5900) shows the real console/HDMI; RDP blanks the panels.
- **Power:** a full-white box is ≈1.5 kW. Cap brightness in TD.

## Rules
- It's a shared show machine. Ask Gavin before uninstalling anything, changing network/firewall/Tailscale settings, or touching Will's RopeLights setup.
- Never write passwords, tokens or camera logins into tracked files.
- Commit and push in small logical steps to `main`.
