# Downloads the official Python installer from python.org and runs it for
# the current user, adding Python to PATH. Used by Setup.bat on PCs without
# winget. The installer shows its own progress window; no admin needed.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$version = "3.13.3"
$url = "https://www.python.org/ftp/python/$version/python-$version-amd64.exe"
$installer = Join-Path $env:TEMP "python-$version-amd64.exe"

Write-Output "Downloading Python $version from python.org (about 30 MB)..."
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
Write-Output "Installing (a progress window will appear)..."
$p = Start-Process -FilePath $installer -ArgumentList "/passive", "InstallAllUsers=0", "PrependPath=1", "Include_launcher=1" -Wait -PassThru
Remove-Item $installer -Force -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "The Python installer exited with code $($p.ExitCode)." }
Write-Output "[ok] Python $version installed"
