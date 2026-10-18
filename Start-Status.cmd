@echo off
rem A River Becoming: login launcher for the status page. Started from the Startup folder (Start-Status.lnk).
rem Opens https://gavaiken.github.io/river-bitcube/ in Chrome on the primary monitor, after TouchDesigner (10 s)
rem and the Claude terminal (20 s), so it ends up in front. Falls back to the local docs\index.md when offline.
timeout /t 40 /nobreak >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tools\status_page.ps1"
