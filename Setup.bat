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
  choice /m "Install Python 3.12 now with winget"
  if errorlevel 2 (
    echo Get it from https://www.python.org/downloads/ - tick "Add python.exe to PATH" -
    echo then run Setup.bat again.
    pause
    exit /b 1
  )
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  echo.
  echo Python installed. Close this window and run Setup.bat again so Windows picks it up.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('python --version') do echo [ok] %%v

rem -- 2. Python packages --
echo.
echo Installing Python packages...
python -m pip install --disable-pip-version-check -q -r requirements.txt
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
  choice /m "Install ffmpeg now with winget"
  if not errorlevel 2 (
    winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  ) else (
    echo You can also unzip an ffmpeg build into a folder named "ffmpeg" here.
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
