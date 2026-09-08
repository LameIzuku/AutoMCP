@echo off
setlocal
set BHOOT_MODE=accounts
set BHOOT_CLAUDE_CAPTURE=
set BHOOT_MOCK=
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%~dp0dist\grok-launch.js" %*
) else (
  node "%~dp0dist\grok-launch.js" %*
)
if errorlevel 1 pause
