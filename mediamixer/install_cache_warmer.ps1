# Makes background library prep (mediamixer/cache_warmer.py: proxies + Clip
# DNA for new clips) start automatically at every login, with no console
# window, via a shortcut in the current user's Startup folder - Task
# Scheduler registration needs elevated rights some machines don't give,
# the Startup folder just needs normal file access. Setup.bat runs this.
#
# Re-run it any time (e.g. after moving the project folder or reinstalling
# Python) to refresh the shortcut; it restarts the warmer too.
#
#   Check on it:  Get-Content cache_warmer.log -Tail 30   (in the project folder)
#   Remove it:    powershell -ExecutionPolicy Bypass -File mediamixer\install_cache_warmer.ps1 -Uninstall

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "MediaMixer Cache Warmer.lnk"

# Stop any warmer already running, so the new shortcut's code is what runs.
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -like "*mediamixer.cache_warmer*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($Uninstall) {
    if (Test-Path $shortcutPath) { Remove-Item $shortcutPath }
    Write-Output "Background prep removed (no longer starts at login)."
    return
}

# The real interpreter behind `python` (not the Microsoft Store alias), and
# its windowless twin next to it.
$python = (& python -c "import sys; print(sys.executable)").Trim()
$pythonw = Join-Path (Split-Path $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) {
    throw "pythonw.exe not found next to $python - is Python installed from python.org or winget?"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonw
$shortcut.Arguments = "-m mediamixer.cache_warmer"
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7  # minimized, though pythonw never shows a window anyway
$shortcut.Description = "Keeps MediaMixer's proxies and Clip DNA built in the background"
$shortcut.Save()

Start-Process -FilePath $pythonw -ArgumentList "-m", "mediamixer.cache_warmer" -WorkingDirectory $projectRoot
Write-Output "Background prep installed: starts at every login, no window. Running now too."
Write-Output "Progress log: $projectRoot\cache_warmer.log"
