@echo off
rem A River Becoming: login launcher for the link to Dave's Modal agent. Started from the Startup folder (Start-Modal.lnk).
rem Runs tools\modal\modal_link.py windowless: camera clips up to /ingest, the scene mirrored down to ..\gallery_state.
rem A second copy exits at once, so running this by hand is safe.  Status:  .venv\Scripts\python.exe tools\modal\modal_link.py status
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0tools\modal\modal_link.py"
