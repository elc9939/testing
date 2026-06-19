@echo off
title Mini Hub Phone Mode
cd /d "%~dp0"
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0scripts\start-phone-mode.ps1"
echo.
echo Mini Hub Phone Mode stopped.
pause
