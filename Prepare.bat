@echo off
rem Builds proxies and Clip DNA for the whole library in one go, then exits.
rem Works whether or not MediaMixer is running. Safe to close at any time -
rem the next run continues where this one stopped.
rem   Prepare.bat --watch      keep going, picking up new clips every 10 min
rem   Prepare.bat --workers 4  more transcodes at once (faster, busier PC)
cd /d "%~dp0"
title MediaMixer - library prep
python -m mediamixer.prepare %*
echo.
pause
