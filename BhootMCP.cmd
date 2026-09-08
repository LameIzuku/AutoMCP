@echo off
setlocal
set "BHOOT_GROK=%USERPROFILE%\.grok\bin\grok.exe"
if defined BHOOT_GROK_BIN set "BHOOT_GROK=%BHOOT_GROK_BIN%"
if not exist "%BHOOT_GROK%" (
  echo Grok CLI was not found. Set BHOOT_GROK_BIN to its executable path.
  pause
  exit /b 1
)
pushd "%~dp0"
:menu
echo.
echo BhootMCP - MCP control
echo 1. Enable in Grok
echo 2. Disable in Grok
echo 3. Show MCP status
echo 4. Start local bridge / copy pairing code
echo 5. Exit
choice /c 12345 /n /m "Choose: "
if errorlevel 5 goto done
if errorlevel 4 goto bridge
if errorlevel 3 goto status
if errorlevel 2 goto disable
"%BHOOT_GROK%" mcp enable bhoot
echo Restart Grok to load the change. Keep the paired Claude tab open.
echo Tell Grok to use BhootMCP for technical clarifications.
goto menu
:disable
"%BHOOT_GROK%" mcp disable bhoot
echo Restart Grok to load the change. Running requests are not cancelled.
goto menu
:status
"%BHOOT_GROK%" mcp list
goto menu
:bridge
call "%~dp0Start-BhootMCP.cmd"
goto menu
:done
popd
