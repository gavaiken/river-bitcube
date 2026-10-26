# Session: calibration fix + overlays fall down (Gavin, Mac mini, 26 Oct)

SESSION SUMMARY
- **Calibrate died at once** ("stopped without finishing", "its process is gone", empty log): `calibrate.ps1` launched the job with Start-Process inside the SSH session, and Windows OpenSSH kills a session's processes when it closes. The one-off scheduled task (the old `-Task` fallback) is now the default, windowless on `pythonw.exe`; children stay on `python.exe` with CREATE_NO_WINDOW. `-Task` is a no-op, `-Detached` keeps Start-Process. Guard test in `tools/tests/test_mission_guards.py`. Commit 6f9672c, pulled on bitcube; a dry run over SSH reached `done`.
- **Slow video** was manual mode at intensity 0 (stillness), not load: CPU 13%, 9 of 16 GB free, TD at 59.5 fps. Gavin fixed the setting.
- **Overlays rose:** sampling `overlays` and `field_out` every 0.1 s through the bridge showed them moving up the camera image (a Noise TOP's translate y moves its pattern up). Torrent, leaf and rain noise phases negated in `build_seasons_local.py` (a6e099d), applied live and saved into the boot file (cab01cf, from bitcube). Re-measured: down in 37 of 39 sample pairs, none up.

Still to do
- A real Calibrate run from mission control (interrupts the show ~4 min, writes a new dated rope map); the dry run doesn't start capture.py, so the windowless child launch is only proven by that run.
- Not checked: whether `river-online-oct-23.toe`'s overlays rise too.
- bitcube's checkout has uncommitted deletions under `river_masks/` (not from this session; `AGENTS.md` still names `river_masks.toe`).
