# Adds a "MediaMixer" shortcut to the Desktop and the Start menu. It runs
# Run.bat --app: the engine starts in a minimized window (close that window
# to stop MediaMixer) and the dashboard opens in its own app window - Chrome
# or Edge with no tabs or address bar. Setup.bat runs this.
#
#   Remove: powershell -ExecutionPolicy Bypass -File mediamixer\install_shortcuts.ps1 -Uninstall

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$paths = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "MediaMixer.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "MediaMixer.lnk")
)

if ($Uninstall) {
    foreach ($p in $paths) { if (Test-Path $p) { Remove-Item $p } }
    Write-Output "MediaMixer shortcuts removed."
    return
}

$shell = New-Object -ComObject WScript.Shell
foreach ($p in $paths) {
    $s = $shell.CreateShortcut($p)
    $s.TargetPath = Join-Path $root "Run.bat"
    $s.Arguments = "--app"
    $s.WorkingDirectory = $root
    $s.WindowStyle = 7  # the engine's console starts minimized
    $s.IconLocation = (Join-Path $root "mediamixer\web\static\icons\mediamixer.ico") + ",0"
    $s.Description = "Start MediaMixer in its own window"
    $s.Save()
}
Write-Output "[ok] MediaMixer shortcut added to the Desktop and Start menu."
