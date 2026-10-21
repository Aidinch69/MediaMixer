@echo off
rem Starts MediaMixer and opens the dashboard. Close this window (or press
rem Ctrl+C in it) to stop the engine. Extra arguments are passed through,
rem e.g.  Run.bat --port 5050
rem       Run.bat --app       opens it in its own app window (the shortcut uses this)
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
  python -m mediamixer.launch %*
  timeout /t 3 >nul
  exit /b 0
)

rem --open (a browser tab) unless --app was asked for
set MM_OPEN=--open
echo.%* | find /i "--app" >nul && set MM_OPEN=
python Engine.py %MM_OPEN% %*
if errorlevel 1 pause
