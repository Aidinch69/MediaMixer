# Undoes what Setup.bat and running MediaMixer leave behind. Run via
# Uninstall.bat. Asks before deleting anything, and never touches your media:
# source folders you picked, and media_assets/, Spirals/, overlay_fx/ and
# Audios/ in the project, are always left alone.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root

function Ask($question) {
    while ($true) {
        $a = (Read-Host "$question [y/N]").Trim().ToLower()
        if ($a -eq "" -or $a -eq "n" -or $a -eq "no") { return $false }
        if ($a -eq "y" -or $a -eq "yes") { return $true }
    }
}

Write-Output "==== MediaMixer uninstall ===="
Write-Output ""

# 1. Stop the engine: whatever is listening on its port, plus the
#    Microsoft Store "python" launcher that may have started it.
$port = 5000
try { $port = [int](& python -c "from mediamixer.config import load_config; print(load_config().port)") } catch {}
$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
foreach ($l in $listeners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($l.OwningProcess)"
    if ($proc -and $proc.Name -like "python*") {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)"
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        if ($parent -and $parent.Name -like "python*" -and $parent.CommandLine -like "*Engine.py*") {
            Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Write-Output "[ok] Stopped MediaMixer"
    }
}

# 2. Background prep: stop it and remove its login shortcut.
& "$PSScriptRoot\install_cache_warmer.ps1" -Uninstall
Start-Sleep -Seconds 1

# 3. Generated data (all of it can be rebuilt).
Write-Output ""
$proxyDir = Join-Path $root "media_proxies"
if ((Test-Path $proxyDir) -and (Ask "Delete the proxy cache (media_proxies - rebuilt automatically if you reinstall)?")) {
    Remove-Item $proxyDir -Recurse -Force
    Write-Output "[ok] Proxies deleted"
}

Write-Output ""
Write-Output "Your history: hearts, play counts, Clip DNA, Scenes, chosen source folders,"
Write-Output "engine settings and logs."
if (Ask "Delete your history too (it can't be undone)?") {
    foreach ($f in "system_memory.db", "system_memory.db-wal", "system_memory.db-shm", "config_overrides.json",
                   "engine_stdout.log", "engine_stderr.log", "cache_warmer.log") {
        $p = Join-Path $root $f
        if (Test-Path $p) { Remove-Item $p -Force }
    }
    Write-Output "[ok] History, settings and logs deleted"
}

# 4. Python packages (other programs may use them, so default is keep).
Write-Output ""
if (Ask "Uninstall the Python packages MediaMixer installed (flask, waitress, qrcode)?") {
    & python -m pip uninstall -y flask waitress qrcode
}

Write-Output ""
Write-Output "==== Done ===="
Write-Output " Not touched: your media (any source folders, and media_assets, Spirals,"
Write-Output "   overlay_fx, Audios in this folder) - move out anything you want to keep,"
Write-Output "   then delete this project folder to remove MediaMixer completely."
Write-Output " Per-device settings (XP, trophies, toggles) live in each browser: clear site"
Write-Output "   data for localhost:$port in the browser's settings to remove them."
Write-Output " Python and ffmpeg stay installed (other programs may use them); remove them"
Write-Output "   from Windows Settings > Apps if you don't need them."
