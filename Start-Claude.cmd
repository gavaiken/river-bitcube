@echo off
rem A River Becoming: login launcher for Claude Code. Started from the Startup folder (Start-Claude.lnk).
rem Opens a terminal in C:\Users\user\River and starts Claude with a "read everything, then wait" prompt.
set "RIVER=C:\Users\user\River"
set "CLAUDE=C:\Users\user\.local\bin\claude.exe"
set "PROMPT=Read %RIVER%\CLAUDE.md, then river-bitcube\CLAUDE.md, every file in river-bitcube\docs, and river-agent\CLAUDE.md and README.md. Check git status in both repos. Then give me a short summary of where things stand and wait for my next instruction. Do not change anything yet."

rem Let TouchDesigner (Start-River.cmd) and the network come up first.
timeout /t 20 /nobreak >nul

where wt.exe >nul 2>nul
if %errorlevel%==0 (
    start "" wt.exe -d "%RIVER%" powershell.exe -NoExit -Command "& '%CLAUDE%' '%PROMPT%'"
) else (
    start "" /d "%RIVER%" powershell.exe -NoExit -Command "& '%CLAUDE%' '%PROMPT%'"
)
