@echo off
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%~dp0dist\launcher.js" %*
) else (
  node "%~dp0dist\launcher.js" %*
)
if errorlevel 1 pause
