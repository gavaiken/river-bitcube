# A River Becoming: running log and handoff for LLMs

Running record of what Gavin and Claude have done on this project, plus how to pick up from here. **Append new sessions at the bottom (newest last). Never put passwords or tokens in this file.**

Related files (all on Gavin's Mac mini, `gav-m1-mini`):
- `~/claude/docs/a-river-becoming-hardware.md`: verified hardware reference (ropes, PSAC10 boxes, rack controller, universes, panels, open hardware questions).
- `~/claude/docs/a-river-becoming-notes.md`: design notes digested from the meetings (TouchDesigner's job, the open question about what Modal outputs, panel mapping modes, sensing ideas).
- `~/claude/local/signal-export/out/Ariverbecoming/chat.md`: full export of the team's Signal group (Oct 6–17), with media in `media/`. To refresh it: `cd ~/claude/local/signal-export && .venv/bin/sigexport out --chats "A river becoming" --no-stickers`. The first run needs someone to click Allow on a macOS Keychain prompt on the mini's screen.

---

## 1. Project in one paragraph
LED + AI art installation for **Gray Area** (SF) that should read as a river. 20 LED ropes (8,000 px) are the rain/flow, ~30 HUB75 panels are "pools" in the flow, plus driftwood and river rocks. An AI "river" agent (Dave's, on Modal) gets input from Reolink cameras at the gallery and at a real river (Starlink + solar). Prototyping happens at **Agape** (Gavin's house). Install at Gray Area **Oct 22–27, 2026**. Gavin joined Oct 6 to handle pixel mapping and the CPU→LED path.

## 2. People
| Who | Role |
|---|---|
| Casper | Lead / organiser, ordering |
| Justine Sun Dela Cruz | Meeting notes, visual references, coordination |
| Will Gardiner | Networking, cameras, Tailscale (tailnet owner), Windows box, rope-light app |
| Dave (drocamor) | Agent + generated visuals on Modal; owns the `river-agent` repo |
| Andi | HUB75 panels, Colorlight config (from their own Windows PC), TouchDesigner |
| Lilian (Lily) | Rigging; Gray Area liaison with Seabrook |
| Colin | Mentioned in meetings (connected Lily to Seabrook; "panels as high-res windows" idea) |
| Gavin | Pixel mapping, TouchDesigner harness; built the Chromatik model + TD patch on Oct 7 |

## 3. System architecture (current understanding)
```
Dave's visuals (Modal / web canvas)
        │
TouchDesigner on bitcube  ── "glue"
   ├─ crop 20×400 region ─► Art-Net (2.x.x.x /8) ─► AoShow rack controller ─► PSAC10 ×2 ─► 20 ropes
   └─ crop/rotate panel regions ─► 1080p frame ─► HDMI ─► Colorlight sender ─► 5A-75B ─► HUB75 panels
Cameras (Reolink, RTSP + pan/tilt) ─► GL.iNet router running Tailscale ─► Modal agent ("brain")
```
- The Colorlight sender always looks like a 1920×1080 display and samples the top-left region, so TD just needs a fullscreen borderless window.
- A panel is 128×64; a 2×2 quad is 256×128.
- Agreed principle: animations run **locally on bitcube** so the show survives network drops. Modal pushes updates/code/parameters.
- Open: whether Modal outputs a display stream or config/code; how Modal joins the tailnet (bridge service); how the gallery camera gets onto Tailscale.

## 4. Access
### GitHub
- Repo: **`drocamor/river-agent`** (Dave's, private). Merged PRs to `main` auto-deploy to Modal. Will added a `rope-lights` PR.
- As of 2026-10-17, `gavaiken` had **no access**. Ask Dave to add him. Clone to `~/claude/Source/river-agent` once access is granted.
- Decision: contribute to river-agent rather than starting a new repo.

### Tailscale
- Will's tailnet: account `itsriverbox@outlook.com` (tailnet `tail03bc1a`), max 6 users (free plan). Gavin accepted an **Admin** invite on 2026-10-17.
- Gavin's own tailnet (`tailddc624`) holds the mini (`gav-m1-mini`, 100.126.113.14) and his MacBook Air. **Don't move the mini to Will's tailnet**: a device is on one tailnet at a time, and the mini is Gavin's remote-access path.
- **bitcube is shared into Gavin's tailnet** (node share, accepted 2026-10-17) → 100.73.68.60 from the mini/Air. If accepting a share fails with "Failed to accept invite", the console was set to the sharer's tailnet; switch to your own first.
- Cameras sit behind the GL.iNet router's subnet route, which node sharing doesn't carry. To reach them, a device has to actually join Will's tailnet (account switcher on the Air/phone).

### bitcube (the Windows mini PC; will be the gallery machine)
- Windows 11 Pro, user `user` (Administrator), auto-logs in at boot. Password: ask Will (not stored here).
- **SSH from the mini:** `ssh bitcube` (alias in `~/.ssh/config` → 100.73.68.60, key `~/.ssh/id_ed25519`, key in `C:\ProgramData\ssh\administrators_authorized_keys`). SSH sessions run with full admin rights (High integrity), and no UAC prompts appear.
- **Remote desktop:** Windows App (installed on the Air via `dots cask windows-app`) → PC `100.73.68.60`, user `user`. Caveat: RDP takes over the console session, so the HDMI/panel output goes away while connected and the screen is left locked on disconnect. Hand it back with `tscon <session id> /dest:console` (run over SSH as admin).
- **File sharing:** Finder → bitcube (shows under Network on the LAN), or ⌘K `smb://100.73.68.60/River` / `smb://bitcube.local/River`. Share `River` = `C:\Users\user\River`, full access for `user`.
- **Network:** Wi-Fi "Agape WiFi" 10.0.7.79 (`bitcube.local`), profile set to **Private** on 2026-10-17. Ethernet has 2.0.0.8/8 (Art-Net to the LED controller) + 192.168.1.99/24. Tailscale 100.73.68.60. Single HDMI display, 1920×1080, Intel Iris Xe.
- **Quirk:** Claude's shell on the mini can't reach bitcube's LAN IP directly ("No route to host"), even though Tailscale's direct path goes over the LAN. It's probably macOS Local Network privacy on the launchd-spawned process. Use the Tailscale IP.
- **Running PowerShell over SSH:** quoting is painful. Encode the script instead: `ssh bitcube "powershell -NoProfile -EncodedCommand $(printf '%s' "$PS" | iconv -t UTF-16LE | base64)"`, and filter `CLIXML` noise from the output. Processes started with `Start-Process` die when the SSH session ends, so run long jobs in the foreground (e.g. a backgrounded ssh on the mini).
- **Cancelling a tool call does not stop a command already running on bitcube.** After any interrupted remote command, audit what actually ran.

### What runs on bitcube
- **Login autostart:** `Startup\Start-River.lnk` → `C:\Users\user\River\Start-River.cmd`. It waits 10 s, then opens `River\river.toe` in TouchDesigner, or TD empty if that file doesn't exist. README at `C:\Users\user\River\README.md`.
- **TouchDesigner 2025.33230** at `C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe`. The licence/first-launch step was **still pending** at the end of the session and needs RDP.
- **RopeLights (Will's):** scheduled task `RopeLights`, which runs `C:\Users\user\RopeLights\runtime\python.exe app.py --config config.local.json` (its own Python, plus a small web app with rope patterns). It has **no trigger**, so it won't start after a reboot. Don't run it while TD also sends Art-Net.
- Other autostart, left alone (probably BitCube leftovers): loopMIDI, Ableton Push control panel, TeamViewer service (a second remote-access path; worth reviewing), Java updater, OneDrive, Edge.
- **Archived 2023 BitCube autostart:** `C:\Users\user\Archive\2023-bitcube-startup\` (README + restore steps, the original startup shortcut, `startup-inventory-2026-10-17.txt`). The project files stay in `Desktop\Bitcube4`, and its old Chromatik setup is in `~\Chromatik`.

## 5. Gavin's own assets
- Oct 7 work (done with Claude on Gavin's Mac):
  - Chromatik 3D model: 20 × 10 m strips, 400 px each, weaving down a column and across the floor, plus 30 panels grouped as 8 "pools".
  - Pixel map: every LED/panel in one shared "river" texture space.
  - TouchDesigner patch: river texture → per-LED sampling → Art-Net, and per-pool crops → atlas → HDMI, at 60 fps.
  - Files on the Mac (probably the Air): `~/Chromatik/Models/Rain.lxm`, `River.lxm`, `~/Chromatik/Models/River-pixelmap/` (map + builder script). **Not yet copied** to the mini or bitcube.
  - Chromatik free tier caps output at 1k px.
- `river_masks.zip`: Gavin was dragging it to `\\bitcube\River` at the end of the session (not yet confirmed or unzipped).

## 6. Open items / next steps
1. Accept the TouchDesigner 2025 licence on bitcube via RDP, then hand the session back to the console.
2. Get Dave to add `gavaiken` to `river-agent`; clone it.
3. Copy the Chromatik model, pixel map and TD patch to bitcube (`River\`), port them to TD 2025, and save as `River\river.toe` so the launcher picks it up.
4. Tonight's goal from the Oct 17 meeting: TD on bitcube driving the ropes (Art-Net) **and** one HUB75 quad (HDMI).
5. Hardware unknowns (see the hardware doc): PSAC10 port ↔ universe mapping, box IPs, rope colour order, whether the boxes auto-switch from PLAY to Art-Net.
6. Before the gallery (Will's call): give `RopeLights` a trigger, or retire it once TD drives the ropes; review TeamViewer; plan bitcube's dual-NIC gallery network and how the gallery camera reaches Tailscale.
7. Optional: an ongoing Signal link via `signal-cli` as a linked device (offered, not done). For now Gavin sends Signal messages himself.

---

## Session log

### 2026-10-17 (evening, Gavin + Claude on the mini via remote-control)
- Installed signal-export in `~/claude/local/signal-export` (venv). Exported the "A river becoming" group to markdown. Signal Desktop was installed from the web, not via `dots`.
- Digested the Signal thread and two in-person meeting transcripts into the notes doc. Saved Gavin's hardware rundown as the hardware doc.
- Found Dave's repo `drocamor/river-agent` (no access yet).
- Tailscale: Will invited Gavin as Admin on his tailnet; Gavin accepted and shared bitcube into his own tailnet. Verified a 13 ms direct path, SSH key auth (Will had already added the mini's key) and RDP port open. Added the `bitcube` SSH alias on the mini.
- Audited bitcube autostart: an old 2023 BitCube script launched `Bitcube5.toe` in TD 2022 and a Chromatik alpha at every login. Archived it with a README and restore steps.
- Upgraded TouchDesigner 2022.33910 → 2025.33230 (installer downloaded on bitcube and checked for size and Derivative signature). The side-by-side install was intended, but **the installer ignored `/DIR`**: it uninstalled 2022 and installed at the default path. The `.toe` file association was removed. Gavin cancelled the tool call, but the install had already started and finished anyway.
- Created the River launcher (`River\Start-River.cmd` + Startup shortcut) and `River\README.md`.
- Network: switched bitcube's Wi-Fi to Private, enabled network discovery services, and added Private to the File and Printer Sharing firewall rules (this command also ran despite being cancelled; kept, as Gavin had said "let her rip"). Created the `River` SMB share. Gavin can now see bitcube in Finder on his MacBook.
- Later that evening (done by Gavin/Andi, not Claude): installed **TightVNC Server** on bitcube (service `tvnserver`, automatic). Its firewall rule allows **all profiles**, i.e. the whole house Wi-Fi as well, which the team chose. Connect with macOS Screen Sharing: `vnc://100.73.68.60`. VNC shows the real console/HDMI output; RDP doesn't (it uses its own session and blanks the panels).
- Andi built a TD project: `C:\Users\user\River\river_masks\river_masks.toe` (+ `panel_crop.glsl`, `panel_preview.glsl`, Backup\). It takes a web view in and crops boxes out: the panel crops go to HDMI (works), and a prototype Art-Net output for the ropes is **not yet validated**. The launcher looks for `River\river.toe`, so this project does **not** autostart yet.
- `River\LEDSetting_2.2.6_3180(2).zip` appeared in the share (probably a Colorlight/LED config tool; unverified).
- Plan for 2026-10-18 (late morning/early afternoon): (1) TD driving the ropes over Art-Net (priority), (2) a second HUB75 panel over HDMI.
- Drafted a Signal update for the group (Gavin to send).
- Installed Windows App on the Air (`dots cask windows-app`). The Brewfile sync hit a yadm rebase conflict on the Air; Claude gave resolution steps (keep both sides, `yadm add`, `GIT_EDITOR=true yadm rebase --continue`, `yadm push`). Not confirmed resolved.

### 2026-10-18 (Gavin + Claude on the mini, then handoff to Claude on bitcube)
- Gavin installed Git (winget) and Claude Code (native installer) on bitcube; Claude added `C:\Users\user\.local\bin` to the user PATH. Claude Code is running locally on bitcube, which is now the main agent for device work.
- Found Will's provisional rope mapping in `C:\Users\user\RopeLights\config.local.json`: box 1 `2.0.0.10` = universes 0–39 (ropes 0–9), box 2 `2.0.0.11` = 40–79 (ropes 10–19), 4 universes reserved per rope (3 used), RGB, source `2.0.0.8`. This answers hardware open question 1, pending visual calibration.
- The Ethernet (lighting) NIC on bitcube was **down** at check time, so the LED controller cable is probably unplugged. No USB camera on bitcube; the cameras are the Reolinks on Will's tailnet (URLs and logins needed from Will).
- Plan agreed (Claude on bitcube executes): repo → TD bridge → ropes via TD Art-Net → 2 panel quads → camera snapshots as Claude's "eyes" → one shared canvas saved as `river.toe`.
- Created private repo **github.com/gavaiken/river-bitcube**. `C:\Users\user\River` is the working copy, and `docs\` there is now the source of truth. Installed on bitcube via winget: ffmpeg, GitHub CLI, Python 3.13. Added `td/bridge/` (WebServer DAT bridge on localhost:9980, installed once from the TD Textport), `tools/td.ps1`, `tools/cam_snap.ps1`, and `secrets.local.example.json`.
