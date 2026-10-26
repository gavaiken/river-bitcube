@echo off
rem A River Becoming: login launcher. Started from the Startup folder (Start-River.lnk), and by mission control's switch
rem (tools\mission\probe.ps1 -Action switch) with the show file to open now as its argument.
rem Opens a show file in this folder with TouchDesigner (2025.33230 installed at the default path); if none can be found,
rem opens TouchDesigner empty.
set "TD=C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe"
rem Which file: tools\shows.ps1 reads the show registry (shows.json, docs\shows.md). With an argument (a switch), that file
rem if the registry offers it. Otherwise the boot file: ..\boot-file.txt when it names a listed show that exists (mission
rem control's "Set as default" writes it), else shows.json's boot_default. A switch never changes the boot file.
set "TOE="
set "OPENARG="
if not "%~1"=="" set "OPENARG=-Open %~1"
for /f "usebackq delims=" %%f in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\shows.ps1" %OPENARG%`) do set "TOE=%~dp0%%f"
rem Last resort, if the registry couldn't be read: the file asked for, else the one boot-file.txt names, if it exists.
if not defined TOE if not "%~1"=="" if exist "%~dp0%~1" set "TOE=%~dp0%~1"
if not defined TOE if exist "%~dp0..\boot-file.txt" for /f "usebackq delims=" %%f in ("%~dp0..\boot-file.txt") do if exist "%~dp0%%f" set "TOE=%~dp0%%f"
if not defined TOE for /f "tokens=2 delims=:, " %%f in ('findstr /c:"boot_default" "%~dp0shows.json"') do if exist "%~dp0%%~f" set "TOE=%~dp0%%~f"

rem Give the network and display a moment after auto-login.
timeout /t 10 /nobreak >nul

if defined TOE if exist "%TOE%" (
    start "" "%TD%" "%TOE%"
    goto :eof
)
start "" "%TD%"
