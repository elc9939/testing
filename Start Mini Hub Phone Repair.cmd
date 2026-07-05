@echo off
title Mini Hub Phone Repair
cd /d "%~dp0"
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Opening Windows administrator approval for Mini Hub Phone Repair...
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  echo.
  echo Approve the Windows prompt. A repair window will finish the setup.
  pause
  exit /b
)
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0scripts\mini-hub-remote-repair.ps1" repair -NoPause
echo.
echo Mini Hub Phone Repair finished. Re-open Settings and run Check Services.
pause
