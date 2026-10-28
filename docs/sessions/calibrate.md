# Session: calibration fix + overlays fall down (Gavin, Mac mini, 26 Oct)

SESSION SUMMARY
- **Calibrate died at once** ("stopped without finishing", "its process is gone", empty log): `calibrate.ps1` launched the job with Start-Process inside the SSH session, and Windows OpenSSH kills a session's processes when it closes. The one-off scheduled task (the old `-Task` fallback) is now the default, windowless on `pythonw.exe`; children stay on `python.exe` with CREATE_NO_WINDOW. `-Task` is a no-op, `-Detached` keeps Start-Process. Guard test in `tools/tests/test_mission_guards.py`. Commit 6f9672c, pulled on bitcube; a dry run over SSH reached `done`.
- **Slow video** was manual mode at intensity 0 (stillness), not load: CPU 13%, 9 of 16 GB free, TD at 59.5 fps. Gavin fixed the setting.
- **Overlays rose:** sampling `overlays` and `field_out` every 0.1 s through the bridge showed them moving up the camera image (a Noise TOP's translate y moves its pattern up). Torrent, leaf and rain noise phases negated in `build_seasons_local.py` (a6e099d), applied live and saved into the boot file (cab01cf, from bitcube). Re-measured: down in 37 of 39 sample pairs, none up.

Still to do
- A real Calibrate run from mission control (interrupts the show ~4 min, writes a new dated rope map); the dry run doesn't start capture.py, so the windowless child launch is only proven by that run.
- Not checked: whether `river-online-oct-23.toe`'s overlays rise too.
- bitcube's checkout has uncommitted deletions under `river_masks/` (not from this session; `AGENTS.md` still names `river_masks.toe`).

# Session: calibration through camera views (Gavin, Mac mini, 27 Oct)

SESSION SUMMARY
- **Why:** the gallery cam's new show position (Will's; pan 3241, tilt 0 = the bottom stop, read with GetPtzCurPos) is aimed low at people and the sculpture's base and can't see the tops of the hanging ropes.
- **What:** a calibration now turns the cam through `tools/cameras/views.json` (`home`, then `up` = tilted to the top stop), runs the rope and panel captures in every view, and always sends the cam back to `home` (after the panels; also on failure, cancel, and in `calibrate.ps1` after a forced kill). `decode.py` stitches the views from the LEDs two views share (`tools/pixelmap/sphere.py`: lens f + k1 and each view's rotation by least squares; no PTZ units or lens specs needed). Each LED gets `d` (3D direction from the camera, home coordinates), `u`/`v` in one virtual frame holding every light (16:9, so the shows sample it as they did the camera frame), and `hu`/`hv` (where it is in the show position's own view). `hub75.py` and `screens.py --map` place the panels in the same frame. Mission control shows "Camera view 1 of 2" and scales the progress bar. Single-view maps (and `calibrate.py --no-views`) are unchanged.
- **ptz.py:** `pos`, `moveto <pan> <tilt|max|min>`, `view <name>`, `home` (preset, then a closed loop on the read-back position; directions and speeds learnt from the first nudge).
- Tests: synthetic two-view stitching recovers a 35° tilt to <0.2° and the lens to 1 %; calibrate's camera tour, home on failure/cancel, dry run never moves. `tools/check` green (411 Python, 457 mission).

Live (Gavin's OK, 20:05–20:45)
- Preset 3 "show" saved at pan 3241, tilt 0; `home` returns there exactly (image shift 0 px). Tilt runs 0 to 1240 (top stop, sees the rope tops at the rig). A middle view (620) added so neighbours overlap.
- Run 1 stopped after the home view: "drift 37". The camera had not moved (phase correlation: 0 px); the room's light changed. Drift is now the measured picture shift (`capture.camera_shift`), limit 8 px.
- Run 2 (20:17–20:29): ok. Views home / mid (27.7° up) / up (56.5° up), stitch error 1.8–1.9 px over 1,542 and 827 shared LEDs, all 20 ropes (rope 5 weakest: 21 LEDs seen), 8,000 points; camera home at 3241, 0. The one-term lens model couldn't reach the picture's corners (k1 -0.45): switched to the division model and re-decoded the same captures (f 1088 px, k1 -0.555). Panorama: `frames/pixelmap-20261027-201707/panorama.png` on bitcube.
- Screens (`screens.py --map`): tilt doesn't repeat (the mid view landed 61 px, 24 px and 121 px from the calibration's picture in three runs, at the same read-back tilt), so each revisited view is corrected by the picture's shift against the calibration's frame. **Gavin spotted the screens ~50 px low on the panorama:** the camera's overlay text (clock, name) never moves and pulled the phase correlation to 0; it now leaves those bands out (`capture.OSD_BAND`). Re-worked from the saved frames (`screens.py --frames`): 2 and 4 agree within 2 px over three runs, 3 over two (home view); 1 hangs nearly edge-on and was never detected, so it is placed by hand from Gavin's marks (flagged `estimated`). The old neighbour rule (1 above 2, 3 below 4) is wrong for this hang. The calibration's own captures re-measured with the fix: 0 px drift.
- Committed: `tools/pixelmap/pixelmap-2026-10-27.json` and `screens-2026-10-27.json`. (the untracked single-view 19:38 map is backed up in `River\checkpoints\pixelmap-before-multiview-20261027\`). **No show pins them yet.**

Still to do
- Pin the pair in a show of our own and rebuild it (the multi-view frame lays the river over the whole sculpture, floor to rig, so the look moves).
- `NEIGHBOUR` in screens.py still encodes the old hang; screen 1 needs a hand place (or a darker room and a lower threshold) whenever screens are re-located.
