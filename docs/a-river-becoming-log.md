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
- bitcube pushes to GitHub with a **repo-only deploy key** (`C:\Users\user\.ssh\river_bitcube_deploy`, read-write on gavaiken/river-bitcube only; set via `core.sshCommand` in this repo). No personal GitHub login on bitcube. Revoke it under the repo Settings, Deploy keys.

### 2026-10-18 ~01:00–01:25 (Claude Code on bitcube, solo after handoff)
- **Bridge:** works (`.\tools\td.ps1 "app.build"`). `td.ps1` now prints plain text (stdout, then result). The `/screenshot` endpoint was fixed: TD passes query params in `request['pars']`. From Git Bash use `powershell -ExecutionPolicy Bypass -File tools/td.ps1 ...`, because the system policy blocks scripts.
- **Licence:** TD is **Non-Commercial** (TOPs capped at 1280×1280). That's fine for our sizes, but Gavin should decide whether a gallery show needs a Commercial key.
- **Show file:** `River\river.toe` now exists and is in git. It is Andi's `river_masks` network + `/claude_bridge` + `/project1/ropes` + `/project1/panels`, so the login launcher opens it with the bridge already live. Andi's shader DATs now point to `river_masks/*.glsl`. Andi's original `river_masks.toe` is untouched. TD saves incrementally (`river.N.toe`, gitignored) and also writes `river.toe`.
- **Ropes over Art-Net (working, pending eyes on the ropes):** `/project1/ropes` = canvas (`/project1/null5`, Dave's Web Render 500×800) → crop → fit 20×400 (column = rope, top row = pixel 0) → `artnet_out` (Python, synced from `td/ropes/artnet_out.py`, sent from an Execute DAT at 40 fps).
  - It reads Will's `config.local.json`. Its packets are **byte-identical to RopeLights'**, checked against Will's own `packets()` for all 80 universes.
  - Custom params: `Active`, `Source` (canvas / identify / order / black), `Identify`, `Brightness` 0.15, `Maxbrightness` cap 0.4, `Boxwatts` limiter 600 W/box, `Fps` 40, crop. Status: `op('/project1/ropes/artnet_out').module.status(op('/project1/ropes'))`.
  - It binds `2.0.0.8:6454` exclusively, like RopeLights, so the two can't both send: if RopeLights is running, TD's output fails and turns itself off. Turning `Active` off sends a blackout.
  - Andi's old `dmxout1` (Art-Net broadcast, empty routing table) is now deactivated.
- **RopeLights stopped** (Gavin OK'd). `stop.ps1` refused because a non-elevated shell can't read the S4U task process path, so Claude created `stop.request` itself. That is the same graceful path: the app blacked out and exited in 0.5 s. Task state: Ready. Restart it with `Start-Rope-Lights.cmd` only after setting TD `Active` off.
- Ethernet up, and both PSAC10s answer ping: `2.0.0.10` and `2.0.0.11`.
- **Panels over HDMI (working on screen, pending eyes on the panels):** `/project1/panels` puts quad 1 (Andi's rect 0) at HDMI (0,0) and quad 2 (rect 1) at (256,0) via `td/panels/panel_layout.glsl`. Its window is 512×128, borderless, always on top, DPI-native, and reopens at load.
  - `Source` test/canvas/black, `Brightness` 0.8, `Quad1pos`/`Quad2pos`.
  - Test pattern per quad: panels red/green/blue/yellow with white borders, quad number as white squares, and a sweep bar. Confirmed in a desktop screenshot at exactly (0,0)–(511,127).
  - Andi's `window1` (one quad) stays closed.
- **TD crash, 01:13:** GPU driver TDR (`LiveKernelEvent 141`, "igfxn stopped responding"). It happened when the first `panel_layout.glsl` sampled `sTD2DInputs[2/3]` before those inputs were wired. The shader now uses only literal indices behind `#if TD_NUM_2D_INPUTS`.
  - The bridge had never been saved, so Claude relaunched TD, reopened the Textport via the Dialogs menu (Alt+T via SendKeys doesn't register) and typed the install line.
  - Lesson: **save before cooking a new shader.** In multi-input TOPs, only the next connector appears, one per frame, so `build_panels.py` wires inputs on successive frames.
- Rebuild scripts: `td/build/build_ropes.py` and `td/build/build_panels.py` are idempotent (`.\tools\td.ps1 -File ...`).
- **State at end of session:** ropes `Active`, `Source=order` at 15% (~35 W box 1, ~97 W box 2); panels `Source=test`, window open; TD at 60 fps.
- **Needs a human (Gavin):**
  - Look at the ropes. Rope *r* should be lit from its input end for (r+1)×15 px; box 1 cyan, box 2 magenta, ropes 4/9/14/19 white. Report any rope out of order or reversed, and the colours (RGB vs GRB).
  - Look at the panels. Each quad should show red/green/blue/yellow panels and 1 or 2 white squares, and should match the LEDVision receive config (quad 2 at x=256).
- Next: calibration from that feedback (`reverse_ropes`/`color_order` in Will's config, or a TD-side remap), then switch both `Source`s to canvas, a local fallback visual for when Modal is down, and cameras once Will sends the URLs.

### 2026-10-18 ~01:30–01:40 (Claude Code on bitcube): hardware feedback, rope tests, save fix
- **Gavin's photos:** Art-Net reaches both boxes. Only one panel quad is connected; its left column is right, and its right column looked "split by an extra vertical line". That line was almost certainly the test pattern's **sweep bar**: in Claude's desktop screenshot at the same time it sat at x≈228, inside the right-hand panels, splitting green and yellow at the same x.
  - The sweep is now off by default (`Sweep` toggle), and `Quad2off` blanks quad 2. The screen corner now shows a static quad 1 with no extra lines. **Recheck the panels.**
- **Display:** Windows is *not* mirroring. bitcube has exactly one monitor, `LED 1920X1080` on HDMI (the Colorlight sender), so `DisplaySwitch /extend` has nothing to extend to and wasn't run. Options to keep the desktop off the panels:
  - (a) Keep the borderless always-on-top TD window at (0,0). That's the current setup; only other always-on-top windows or toasts can cover it.
  - (b) Add a second display: an HDMI dummy plug, or a virtual display driver (needs Gavin's OK to install). Then make the virtual display primary and give the LED display to TD.
  - (c) Make TD fullscreen on the LED display (console unusable, VNC only).
- **Rope tests** (`tools/rope_tests.ps1 colour|order|direction|all`, new sources `box1_red`, `box2_green`, `rope`, `heads`). The run at 01:35:42–01:37:22:
  - Colour: box 1 red / box 2 green, 5 s each, twice, at the 0.4 cap. Pure hue, value 102.
  - Order: ropes 1→20, 4 s each, full length, 15%. Printed log: rope *n* = box ⌈n/10⌉ OUT((n−1) mod 10 + 1), universes 4(n−1)…4(n−1)+2. Rope 1 started at 01:36:02 and rope 20 at 01:37:18.
  - Direction: first 20 px white on all ropes. **Left on.**
  - `color_order` unchanged pending Gavin's report.
- **Save hang, fixed:** `project.save(path)` with TD's incremental save on (`general.inc` = 2) tried to write `river.1.toe`, found it existed and opened a modal "Replace?" that froze the bridge. Fixes:
  - `general.inc` set to 0 and saved to TD prefs.
  - New `tools/td_save.ps1`: checks the pref, saves, verifies the `river.toe` timestamp and deletes stray `river.N.toe`.
  - `td.ps1`: 20 s timeout. On timeout it lists TD's windows and names any dialog (exit 3); it now shows TD tracebacks plainly and always sets its exit code.
- **A second modal, fixed:** "river.toe saved with errors: cannot pickle 'socket'". The rope sender kept its UDP socket in `comp.storage`, which TD pickles on save. Socket and config now live in a `sys.modules` holder, migrated live without dropping output.
- Both gotchas, plus the GLSL/TDR one, are now in CLAUDE.md under "TouchDesigner gotchas".
- Side note: TD's pref `general.startupfilename` still points to `Desktop\Bitcube4\Bitcube4.toe` (startupfilemode 2). It's harmless while the launcher passes `river.toe`.
- **Sign-off, 01:45:**
  - Ropes blacked out (TD `Active` off; port 6454 released). Panels `Source=black`, window still open.
  - `river.toe` saved in this dark state, so a reboot comes up dark. RopeLights stopped (task Ready, no trigger).
  - The 01:35 rope test run was **not watched** (no photos), so colour, order and direction are all still unverified. Re-run tomorrow with someone watching, ropes uncoiled ~1 m at the plug end.
  - Team handoff summary published as a private page: https://claude.ai/artifact/SZwraPQpZLgTdyAEM9MnKA
- **Correction, 01:47:** with TD's output off, the ropes did **not** stay dark. Gavin saw them cycling colours.
  - Nothing on bitcube was sending (port 6454 free, RopeLights Ready, `dmxout1` off). So when Art-Net stops, the hardware falls back to its own program: either the rack controller's SD card (program 2) or the PSAC10s' PLAY mode. That answers hardware open question 3: live Art-Net overrides it, and silence hands control back.
  - Overnight fix: TD `Active` on with `Source=black` (continuous zeros at 40 fps, 0 W), saved into `river.toe`.
  - If bitcube or TD goes down, the colour cycle comes back. Switching off the PSAC10s is the only sure off.
  - **"Blackout" must mean sending black, never stopping output.**
- 01:50: Gavin confirmed the ropes went dark once TD sent continuous black. Overnight state verified.

### 2026-10-18 midday (Gavin + Claude on the mini)
- **bitcube boot:** Gavin power-cycled bitcube. A cold boot stops at a GRUB menu (dual boot with Ubuntu, so Windows has to be picked by hand) and then at the Windows password screen, so auto-login didn't happen. **Don't power it off;** any reboot needs someone at the box until the boot order/GRUB default and auto-login are fixed. Afterwards the lighting NIC (`Ethernet`) showed **Disconnected** again. bitcube's Tailscale was offline from about 02:45 until the reboot, and the mini's own Tailscale had stopped (restarted with Gavin's OK, same settings).
- **Second display:** a USB-C monitor (`M14`) is now plugged in as well as the Colorlight sender (`LED 1920X1080`).
- **Folder layout:** `C:\Users\user\River` is now a plain folder (not a repo, still the SMB share) holding two checkouts:
  - `river-bitcube\`: this repo, moved from the River root. Copied with robocopy, then old root copies deleted.
  - `river-agent\`: Dave's repo, copied from the mini's clone. bitcube has no GitHub credentials for it.
  - Also a short root `CLAUDE.md` describing the layout.
  - Repointed TD's 5 file DATs/shaders to the new path and saved `river.toe` there (`td_save.ps1`). TD now runs from `river-bitcube\river.toe` with no errors. Startup shortcut now targets `river-bitcube\Start-River.cmd`.
  - Hard-coded paths updated in `td/build/*.py`, the bridge installer, `CLAUDE.md` and the README.
  - Added `safe.directory` for river-agent in bitcube's global git config and `core.filemode=false` in that repo, since an exec-bit difference had shown as a change.
- **Cameras** (Will, Signal DM 2026-10-18): gallery E1 Pro `192.168.8.103`, river E1 Outdoor Pro `192.168.8.217`, RTSP `/Preview_01_main` on 554, user `admin`. The password is in the untracked `secrets.local.json` only. bitcube reaches both over Will's tailnet, and `tools\cam_snap.ps1 gallery|river` works (12:10).
  - The **river cam** sees the rope coils on the floor. The **gallery cam** is pressed against a ribbon cable and needs re-aiming. Frames show housemates; they stay in `frames\` (git-ignored).
  - Will's PTZ example is in `tools/cameras/test_cam_move.py`, and the details are in the hardware doc.
- **Dave:** added gavaiken as a collaborator on `drocamor/river-agent` (push access) and posted an SSH public key for bitcube (`dave@rocamr.com river`, SHA256:aXW4LMdJXbPfPv8mRImLDWTjkVZ3f6Y818HEqin+/No). The key is **not yet added**: the mini session's attempt was blocked pending Gavin's confirmation.
