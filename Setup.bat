@echo off
rem One-time setup on a new PC: Python packages, ffmpeg, and (optionally)
rem background library prep at login. Safe to run again any time.
setlocal
cd /d "%~dp0"
title MediaMixer setup
echo ==== MediaMixer setup ====
echo.

rem -- 1. Python 3.10+ --
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if errorlevel 1 (
  echo Python 3.10 or newer is needed and wasn't found.
  choice /m "Download and install Python from python.org now"
  if errorlevel 2 (
    echo Get it from https://www.python.org/downloads/ - tick "Add python.exe to PATH" -
    echo then run Setup.bat again.
    pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mediamixer\get_python.ps1"
  if errorlevel 1 (
    echo [!] That didn't work. Install it from https://www.python.org/downloads/ instead
    echo     ^(tick "Add python.exe to PATH"^), then run Setup.bat again.
    pause
    exit /b 1
  )
  echo.
  echo Close this window and run Setup.bat again so Windows picks up Python.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('python --version') do echo [ok] %%v

rem -- 2. Python packages --
echo.
echo Installing Python packages...
python -m pip install --disable-pip-version-check --no-warn-script-location -q -r requirements.txt
if errorlevel 1 (
  echo [!] pip couldn't install the packages - see the message above.
  pause
  exit /b 1
)
echo [ok] Packages installed

rem -- 3. ffmpeg (proxies + Clip DNA) --
echo.
python -c "import sys; from mediamixer.proxy import _find_ffmpeg; sys.exit(_find_ffmpeg() is None)"
if errorlevel 1 (
  echo ffmpeg wasn't found. MediaMixer still plays without it, but without
  echo proxies ^(smooth multi-tile playback^) or Clip DNA ^(smart picking^).
  choice /m "Download ffmpeg into this folder now"
  if errorlevel 2 (
    echo Skipped. You can run Setup.bat again any time, or unzip an ffmpeg build
    echo into a folder named "ffmpeg" here.
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mediamixer\get_ffmpeg.ps1"
    if errorlevel 1 (
      echo [!] The download didn't work. You can unzip an ffmpeg build from
      echo     https://ffmpeg.org/download.html into a folder named "ffmpeg" here.
    )
  )
) else (
  echo [ok] ffmpeg found
)

rem -- 4. Background prep at login --
echo.
echo Background prep keeps proxies and Clip DNA built for new clips, starting
echo at login with no window. Without it, run Prepare.bat after adding clips
echo ^(MediaMixer also catches up on its own while it's running^).
choice /m "Turn on background prep"
if not errorlevel 2 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mediamixer\install_cache_warmer.ps1"
)

echo.
echo ==== Setup done ====
echo  Start:    Run.bat
echo  Folders:  in the dashboard menu, More ^> Sources
echo  Prep now: Prepare.bat  ^(optional - builds proxies + DNA for everything^)
echo.
pause
