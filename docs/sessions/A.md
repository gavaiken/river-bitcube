---
title: Session A (coordinator) notes
---

# Session A: coordinator notes (Mac mini · Opus 5.5)
Notes kept here while another session is editing the shared docs; folded into the log afterwards.

## 2026-10-18 17:50
- **The GL.iNet router (`GL-AXT1800`) left with Colin for the river,** along with the river cam. On Will's tailnet it had been advertising **`10.0.7.0/24` (the Agape house LAN)** as well as `192.168.8.0/24`. bitcube accepts routes (`RouteAll: true`), so all its house traffic went into Tailscale. With the router offline, bitcube couldn't reach the gallery cam (`10.0.7.76`) or even the eero (`10.0.7.1`), though Tailscale itself still worked.
- **Fix (Gavin, admin console):** un-approved `10.0.7.0/24` on GL-AXT1800 and kept `192.168.8.0/24` (the river cam's network, which bitcube will need for session E). Verified 17:47: bitcube routes `10.0.7.76` via Wi-Fi again, the eero answers, gallery-cam RTSP is reachable, and a camera frame shows the rain on the ropes.
- **Rule:** never advertise the venue's own LAN as a Tailscale subnet from another device. It hijacks bitcube's local traffic. (For session I's system docs and for the Gray Area setup.)
- Lighting path unaffected by removing the "switch": Ethernet up at 100 Mbps, both PSAC10s (`2.0.0.10`/`.11`) reachable, TD 60 fps.
- HUB75 rain is very dim: `panel_out` peaks at about 0.17 (panels Brightness 0.5, and the HUB75's camera-space region is mostly dark). Tuning item, not a fault.
- Proposed next (awaiting Gavin): bitcube advertises only `10.0.7.76/32` (gallery cam) on Will's tailnet, approved in the console, so teammates reach the camera through bitcube.

## 2026-10-18 17:55
- **Gallery cam shared over Tailscale through bitcube:** `tailscale set --advertise-routes=10.0.7.76/32` on bitcube, approved by Gavin in Will's console (bitcube's `PrimaryRoutes` = `10.0.7.76/32`). Devices **on Will's tailnet** can now reach the cam at `10.0.7.76` (RTSP 554, PTZ HTTPS) via bitcube. Node *sharing* doesn't carry routes, so on Gavin's own tailnet it isn't visible; use the account switcher to Will's tailnet. At Gray Area, advertise the gallery cam's new address the same way (and remove this one).
- **HUB75 brightened:** new `quad1_gain` Level TOP in `/project1/river_local` (`Panelgain` 3.0, `Panelgamma` 0.7 on the COMP's River page), panels `Brightness` 1.0, in `td/build/build_river_local.py` (19d8919); rebuilt and saved `river-local-oct-18.toe` (f5e7cee). Panel output went from a peak of 0.17 to 1.0 (mean 4–14%); the camera shows a bright blue-white wash crossing the HUB75 in step with the coils. Turn `Panelgain` down to about 2 if it's too strong in person.

## 2026-10-18 18:05
- **Rope sender now survives the lights being switched off** (Gavin turned the ropes off for the noise; bitcube and the HUB75 stay on). Before, any send error set `Active = False`, so after power-on the ropes would have played the hardware's colour cycle until someone re-enabled TD. Now network `OSError`s close the socket and retry every 2 s (`retry_at` in storage, clock-safe after a reload); a successful send clears the error. Non-network errors still stop the sender. Test first: `tools/tests/test_artnet_retry.py` (3 tests: recover after an outage, stale `retry_at` after reload, a real bug still stops).

## 2026-10-19 17:50
- **Live river cam on the HUB75 (plan item N).** Will (Signal 16:34): the river cam is at the river at `192.168.8.217`, reachable over Tailscale. bitcube reaches it via the GL-AXT1800's `192.168.8.0/24` route (DERP relay `sfo`, i.e. Starlink); the sub-stream is H.264 640×360 @ 10 fps (the main stream is HEVC 4K @ 20). Built into `river-local-oct-18.toe` via `td/build/build_river_local.py`: `river_cam` Script TOP ← `td/cameras/river_cam.py` → fit 256×128 → `river_cam_level` (`Camgain`) → `panel_mix` (Cross: rain ↔ cam, `Panelcam` × fresh) → `quad1_out`. Ropes unchanged (rain).
- **Two TD freezes on the way** (each recovered by killing TD and relaunching `Start-River.cmd` in the console session; no data lost): (1) creating a Video Stream In TOP through the bridge; (2) `copyNumpyArray` with an `np.flipud` view. A reader thread inside TD managed only ~2 fps, so the reader is now a separate relay process writing named shared memory, measured at 10.0 fps in the console session.
- **Secrets:** verified with `toeexpand` that the saved `.toe` (289 parts, 4 mention the cam module) contains no password and no `rtsp://`. `.gitignore` now covers `CrashAutoSave.*`.
- **Room state at 17:46:** the ropes are off (Gavin, for the noise). The HUB75 looks dark on the gallery cam although TD is sending the river picture (panel output mean 0.21, peak 1.0), so it's probably powered off too. The USB-C M14 is unplugged, so the LED display is now Windows' only (primary) display; the full-screen black window still covers it.

## 2026-10-19 18:05
- **The river cam now feeds the ropes as well as the HUB75** (Gavin, to try out at home). New `river_cam_field` (fit, fill 1280×720) → `river_cam_field_level` (`Camgain`) → `field_cam_mix` (Cross between the rain `field_gain` and the cam, `Fieldcam` × fresh) → `field_blur` → `field_out`. The ropes and the HUB75 corner-pin both sample `field_out`, so the river image spans both. `Panelcam` now means "whole river frame on the HUB75" (set to 0 = the HUB75 shows its patch of the field). The HUB75 rain boost (`Panelgain`/`Panelgamma`) fades out in proportion to the cam mix, to avoid washing out the daylight video.
- Measured at 18:00: rope canvas mean about 0.49, HUB75 mean about 0.42, **about 300 W per box at the 0.4 cap** (the ropes are off at the switch right now), TD 60 fps.
- **Outage test:** killed the relay at 18:03:02; TD restarted it and frames flowed again within about 7 s, under the 10 s staleness limit, so the outputs never left the river. Saved and committed the `.toe` (b9a32ee); `toeexpand` scan: 295 parts, no password, no `rtsp://`.
- Expect: once it's dark at the river, the cam goes to IR (greyscale, dim), so the ropes will dim. Drop `Fieldcam` to about 0.5 to blend in the rain, or raise `Camgain`.

## 2026-10-19 18:26
- **Everything powered on.** Ropes show the river cam: link up, both boxes receiving, about 270 W/box with the raw video, TD 60 fps, river frames 0.1 s old. In raw video the coils looked flat pale white-blue, so the cam now goes through the river palette (`river_cam_field_level` with `Camcontrast` 1.8 → `river_cam_mono` → `river_cam_palette`, a Lookup on `ramp_river`, channel luminance → `river_cam_look`, crossed by `Campalette`). Now: deep blue/teal coils with white foam highlights and dark gaps, about 200 W/box. Saved + committed (4d34f46); `toeexpand` scan: 300 parts, no password, no `rtsp://`.
- **HUB75 still dark although bitcube outputs correctly:** a DPI-aware capture of the LED display (now the only, primary display, 1920×1080 at 0,0) shows the river patch at x 0–255, y 0–127 and black elsewhere. So it's on the hardware side: the Colorlight sender, the receive card, the panels' power or the ribbons. Asked Gavin to check the power and the receive card's LED, and to re-seat the HDMI at the sender (the M14 was unplugged since it last worked).

## 2026-10-19 18:37
- **HUB75 dark: a loose connection, fixed on site.** Remote checks first ruled out the software: the desktop capture showed the right image on the LED output, the mode was unchanged (1920×1080 @ 60 Hz, 59.999 in TD), a forced `ChangeDisplaySettingsEx` CDS_RESET made no difference, and the panels stayed black even on the test pattern. bitcube has no USB link to the Colorlight sender, and HDMI EDID shows even with the sender unpowered. Someone at the house handled the panels at 18:35 (seen on the gallery cam), and at 18:36 the test pattern lit. Panels are back on `Source=canvas`, saved and committed. A gallery-cam watcher (`scratchpad/watchhub.sh`: colourfulness in the HUB75 crop) flagged the change. A person's arms caused one false positive, so always check the flagged frame by eye.
- **Now:** the live river cam spans the ropes and the HUB75 in the river palette (camera-verified 18:36).

## 2026-10-19 18:49
- **"The river's memory"** (Gavin: "have some fun with it"). On the ropes: a vertical time-slice of the live river cam. `cam_small` (320×180) → `cam_t3d` (Texture 3D TOP, 2D array, 200 frames) + `cam_timemap` (vertical ramp, bottom = past, top = now) → `cam_memory` (Time Machine, black offset = −`Memory`×60 frames, so up to 3.3 s). Plus sparkle: `cam_cache` + `cam_prev` (Cache Select −6 frames, about one camera frame) → `cam_motion` (difference) → `cam_sparkle` (Level, `Sparkle`×4), added on. `cam_fx` crosses live ↔ memory (`Camfx`). The result goes through the existing palette into the field, so the ropes and the HUB75's patch both get it. HUB75: `Panelcam` = 1 shows the whole live waterfall in natural colour.
- Verified: top rows of `cam_memory` = live (diff 0.0), bottom rows older (0.016); 60 fps; no errors. Camera: teal coils with white sparkle points drifting down the piles, and the waterfall on the HUB75. Saved, secrets-checked (`toeexpand`: 325 parts, no password/rtsp), committed 1376061.
- Fixed on the way: bitcube's 56c099c had never been pushed (rejected after a concurrent mini push, error swallowed); rebased and pushed as 8cc64d9. CLAUDE.md now says to pull --rebase first and check the push exit code.

- 19 Oct 22:20: added `tools/screenshot.ps1` (bitcube desktop screenshot, works over SSH via a one-off interactive task); documented in CLAUDE.md. Closed the TD panels window so Gavin could use the desktop; TD now sees a single 1920×1080 display (the M14 is unplugged or mirrored). Right Shift reads as held down in the desktop session (physical?).

- 20 Oct 10:15: Dave answered (ingest token, names; no SITE_TOKEN). Modal link live: both cams posting clips, mirror running, Startup entry added. TD: `modal_scene.py` drives the look (plan O), show file saved (2627211, 0 secret hits after toeexpand). Fixed the river cam relay hanging on a dead link (11 h stale).

- 20 Oct 10:40: auto day/night (plan P) and Dave's canvas layer (`modal_canvas`, Canvasmix 0.4; ~1.5% GPU, 60 fps) live; show file a7bbf28.
