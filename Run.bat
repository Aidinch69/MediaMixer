@echo off
rem Starts MediaMixer and opens the dashboard. Close this window (or press
rem Ctrl+C in it) to stop the engine. Extra arguments are passed through,
rem e.g.  Run.bat --port 5050
cd /d "%~dp0"
title MediaMixer

python -c "import flask, waitress, qrcode" >nul 2>&1
if errorlevel 1 (
  echo MediaMixer isn't set up on this PC yet - running Setup.bat first.
  echo.
  call "%~dp0Setup.bat"
  python -c "import flask, waitress, qrcode" >nul 2>&1
  if errorlevel 1 exit /b 1
)

for /f %%p in ('python -c "from mediamixer.config import load_config; print(load_config().port)"') do set MM_PORT=%%p
python -c "import socket, sys; sys.exit(socket.socket().connect_ex(('127.0.0.1', %MM_PORT%)) != 0)"
if not errorlevel 1 (
  echo MediaMixer is already running - opening the dashboard.
  start "" http://localhost:%MM_PORT%
  timeout /t 3 >nul
  exit /b 0
)

python Engine.py --open %*
if errorlevel 1 pause
