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

Still to do (needs Gavin's OK: moves the camera, and the full run interrupts the show)
- `git pull` on bitcube; save preset 3 "show" at the current position (`ptz.py gallery save 3 show`; until then `home` moves by position).
- Camera-only check: `ptz.py gallery view up`, a `cam_snap`, `ptz.py gallery home`, `ptz.py gallery pos` = 3241, 0. Confirms Up raises Tpos, the top stop's tilt, that `up` sees the rope tops with overlap, and how exactly home is reached (tol 3 units is a guess).
- A real Calibrate (two views, ~8–9 min), then `screens.py --map <new map>`; pin both in a show of our own and rebuild it.
