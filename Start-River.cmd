@echo off
rem A River Becoming: login launcher. Started from the Startup folder (Start-River.lnk).
rem Opens river.toe in this folder with TouchDesigner (2025.33230 installed at the default path); if it doesn't exist yet, opens TouchDesigner empty.
set "TD=C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe"
set "TOE=%~dp0river.toe"

rem Give the network and display a moment after auto-login.
timeout /t 10 /nobreak >nul

if exist "%TOE%" (
    start "" "%TD%" "%TOE%"
) else (
    start "" "%TD%"
)
