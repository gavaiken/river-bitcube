@echo off
rem A River Becoming: login launcher for the people counter (S10, docs/presence-plan.md). Started from the Startup folder (Start-Presence.lnk).
rem Runs tools\presence\counter.py windowless: the gallery cam's sub stream -> a person count every 0.5 s in ..\presence.json, which turns on the
rem seasons file's dynamic mode. A second copy exits at once, so running this by hand is safe.  Status:  .venv\Scripts\python.exe tools\presence\counter.py status
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0tools\presence\counter.py"
