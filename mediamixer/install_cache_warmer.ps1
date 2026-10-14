# Makes the cache warmer (mediamixer/cache_warmer.py) start automatically
# at every login, with zero console window, via a shortcut in the
# current user's Startup folder - Task Scheduler registration isn't
# available in every environment (needs elevated rights this one
# doesn't have), but the Startup folder just needs normal file access.
# Re-run this script any time (e.g. after moving the project folder)
# to refresh the shortcut.
#
# To check on it:      Get-Content "$PSScriptRoot\..\cache_warmer.log" -Tail 30
# To stop it for good: delete the shortcut this prints the path to,
#                      and End Task any running pythonw.exe for it.

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$pythonw = "C:\Users\Aiden\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe"

if (-not (Test-Path $pythonw)) {
    throw "pythonw.exe not found at $pythonw - update this path if Python was reinstalled elsewhere."
}

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "MediaMixer Cache Warmer.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonw
$shortcut.Arguments = "-m mediamixer.cache_warmer"
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7  # minimized, though pythonw never shows a window anyway
$shortcut.Description = "Keeps MediaMixer's proxy cache filled in the background"
$shortcut.Save()

Write-Output "Shortcut installed: $shortcutPath"
Write-Output "Starting it now for this session too..."
Start-Process -FilePath $pythonw -ArgumentList "-m", "mediamixer.cache_warmer" -WorkingDirectory $projectRoot
Write-Output "Done - it'll auto-start at every login from now on, no window, no action needed."
