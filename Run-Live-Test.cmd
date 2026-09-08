@echo off
setlocal
cd /d "%~dp0"
set BHOOT_MODE=accounts
set BHOOT_CLAUDE_CAPTURE=
set BHOOT_MOCK=
echo Testing the paired Claude tab and signed-in Codex. Keep the Claude tab open.
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%~dp0dist\live-test.js"
) else (
  node "%~dp0dist\live-test.js"
)
pause
