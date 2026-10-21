# Downloads ffmpeg + ffprobe into <project>\ffmpeg\bin, where MediaMixer
# looks first (mediamixer/proxy.py). Used by Setup.bat - needs no winget and
# no admin rights, and deleting the project folder removes it again.

param([string]$Dest = "")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # the progress bar makes Invoke-WebRequest very slow
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if (-not $Dest) { $Dest = Join-Path (Resolve-Path "$PSScriptRoot\..").Path "ffmpeg" }
$sources = @(
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
)

$tmp = Join-Path $env:TEMP ("mediamixer-ffmpeg-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zip = Join-Path $tmp "ffmpeg.zip"
    $ok = $false
    foreach ($url in $sources) {
        Write-Output "Downloading ffmpeg from $(([Uri]$url).Host) (about 100-200 MB)..."
        try {
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
            $ok = $true
            break
        } catch {
            Write-Output "  that didn't work: $($_.Exception.Message)"
        }
    }
    if (-not $ok) { throw "Couldn't download ffmpeg from any source - check the internet connection." }

    Write-Output "Unpacking..."
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "x")
    $exe = Get-ChildItem (Join-Path $tmp "x") -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    if (-not $exe -or -not (Test-Path (Join-Path $exe.DirectoryName "ffprobe.exe"))) {
        throw "The download didn't contain ffmpeg.exe and ffprobe.exe."
    }

    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $Dest "bin") | Out-Null
    foreach ($name in "ffmpeg.exe", "ffprobe.exe") {  # ffplay etc. aren't needed
        Copy-Item (Join-Path $exe.DirectoryName $name) (Join-Path $Dest "bin")
    }
    $version = (& (Join-Path $Dest "bin\ffmpeg.exe") -hide_banner -version | Select-Object -First 1)
    Write-Output "[ok] $version"
    Write-Output "     installed in $Dest"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
