@echo off
rem Stops MediaMixer, removes background prep from login, and optionally
rem deletes proxies, history and packages. Never touches your media.
cd /d "%~dp0"
title MediaMixer uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mediamixer\uninstall.ps1"
echo.
pause
