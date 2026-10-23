@echo off
rem A River Becoming: login launcher. Started from the Startup folder (Start-River.lnk).
rem Opens the boot show file (below) in this folder with TouchDesigner (2025.33230 installed at the default path); if it doesn't exist yet, opens TouchDesigner empty.
set "TD=C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe"
rem The boot show file: the seasons file once it exists (execution plan D7), else the online file, else its
rem old name. Mission control can choose instead: ..\boot-file.txt names a show file in this folder.
set "TOE=%~dp0river-local-oct-18.toe"
if exist "%~dp0river-online-oct-20.toe" set "TOE=%~dp0river-online-oct-20.toe"
if exist "%~dp0river-local-oct-22-seasons.toe" set "TOE=%~dp0river-local-oct-22-seasons.toe"
if exist "%~dp0..\boot-file.txt" for /f "usebackq delims=" %%f in ("%~dp0..\boot-file.txt") do if exist "%~dp0%%f" set "TOE=%~dp0%%f"

rem Give the network and display a moment after auto-login.
timeout /t 10 /nobreak >nul

if exist "%TOE%" (
    start "" "%TD%" "%TOE%"
) else (
    start "" "%TD%"
)
