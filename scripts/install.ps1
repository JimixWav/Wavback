# Wavback : vérifie et installe ce qui manque (Windows 10 et 11).
# Aucun droit administrateur : tout ce qui est téléchargé va dans .\bin.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1          vérifie et installe ce qui manque
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Run     idem, puis lance l'application
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Force   retélécharge tout
#
#   Node.js 22+   celui du système s'il est assez récent, sinon une copie portable dans bin\node
#   yt-dlp        toujours dans bin\yt-dlp.exe
#   FFmpeg        celui du système s'il est installé, sinon une version statique dans bin\ffmpeg

param(
  [switch]$Run,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Invoke-WebRequest is many times slower with the progress bar.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Root = Split-Path -Parent $PSScriptRoot
$Bin = Join-Path $Root "bin"
$Work = Join-Path $Bin ".install"
$NodeMinMajor = 22
$NodeChannel = "latest-v24.x"

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    Attention : $text" -ForegroundColor Yellow }
function Fail($text) { throw $text }

function Download($url, $out) {
  Write-Host "    Téléchargement de $url"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

# The line "<hash>  <name>" of $sums must match the file.
function Verify($file, $name, $sums) {
  $line = Get-Content $sums | Where-Object { $_ -match "[ *]$([regex]::Escape($name))$" } | Select-Object -First 1
  if (-not $line) { Fail "somme de contrôle introuvable pour $name." }
  $expected = ($line -split "\s+")[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
  if ($expected -ne $actual) { Fail "la somme de contrôle de $name ne correspond pas (téléchargement corrompu ?)." }
  Ok "somme de contrôle vérifiée ($name)"
}

function Expand($zip, $dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  # tar.exe (Windows 10 1803+) is much faster than Expand-Archive on large archives.
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    tar.exe -xf $zip -C $dest
    if ($LASTEXITCODE -eq 0) { return }
  }
  Expand-Archive -Path $zip -DestinationPath $dest -Force
}

function Get-SystemNode {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  try {
    $major = [int]((& $cmd.Source -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
    if ($major -ge $NodeMinMajor) { return $cmd.Source }
    Warn "Node.js $(& $cmd.Source -v) est trop ancien (il faut la version $NodeMinMajor ou plus) : installation d'une copie portable."
  } catch {}
  return $null
}

try {
  New-Item -ItemType Directory -Force -Path $Bin, (Join-Path $Bin "tmp") | Out-Null
  if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  $env:TMP = Join-Path $Bin "tmp"
  $env:TEMP = $env:TMP

  # 1. Système ----------------------------------------------------------------
  $Arm = ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") -or ($env:PROCESSOR_ARCHITEW6432 -eq "ARM64")
  $NodePlatform = if ($Arm) { "win-arm64" } else { "win-x64" }
  $YtDlpAsset = if ($Arm) { "yt-dlp_arm64.exe" } else { "yt-dlp.exe" }
  $FfmpegAsset = if ($Arm) { "ffmpeg-master-latest-winarm64-gpl.zip" } else { "ffmpeg-master-latest-win64-gpl.zip" }
  Step "Système : Windows $(if ($Arm) { 'ARM64' } else { 'x64' })"

  # 2. Node.js ----------------------------------------------------------------
  Step "Node.js"
  $PortableNode = Join-Path $Bin "node\node.exe"
  $Node = $null
  if (-not $Force -and (Test-Path $PortableNode)) {
    $Node = $PortableNode
    Ok "Node.js portable $(& $Node -v) (bin\node)"
  } elseif (-not $Force -and ($SystemNode = Get-SystemNode)) {
    $Node = $SystemNode
    Ok "Node.js $(& $Node -v) déjà installé"
  } else {
    $Base = "https://nodejs.org/dist/$NodeChannel"
    $Sums = Join-Path $Work "node-sums.txt"
    Download "$Base/SHASUMS256.txt" $Sums
    $match = Select-String -Path $Sums -Pattern "node-v[0-9.]+-$NodePlatform\.zip" | Select-Object -First 1
    if (-not $match) { Fail "aucune version de Node.js pour $NodePlatform." }
    $NodeFile = $match.Matches[0].Value
    $Zip = Join-Path $Work $NodeFile
    Download "$Base/$NodeFile" $Zip
    Verify $Zip $NodeFile $Sums
    Expand $Zip (Join-Path $Work "node")
    $Extracted = Get-ChildItem (Join-Path $Work "node") -Directory | Select-Object -First 1
    $NodeDir = Join-Path $Bin "node"
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item $Extracted.FullName $NodeDir
    $Node = $PortableNode
    Ok "Node.js portable $(& $Node -v) installé dans bin\node"
  }

  # 3. yt-dlp -----------------------------------------------------------------
  Step "yt-dlp"
  $YtDlp = Join-Path $Bin "yt-dlp.exe"
  if (-not $Force -and (Test-Path $YtDlp)) {
    Ok "déjà installé"
  } else {
    $Release = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
    $Tmp = Join-Path $Work $YtDlpAsset
    $Sums = Join-Path $Work "yt-dlp-sums.txt"
    Download "$Release/$YtDlpAsset" $Tmp
    Download "$Release/SHA2-256SUMS" $Sums
    Verify $Tmp $YtDlpAsset $Sums
    Move-Item -Force $Tmp $YtDlp
  }
  $YtDlpVersion = (& $YtDlp --version) | Select-Object -First 1
  if ($LASTEXITCODE -ne 0) { Fail "bin\yt-dlp.exe ne démarre pas." }
  Ok "yt-dlp $YtDlpVersion (bin\yt-dlp.exe)"

  # 4. FFmpeg -----------------------------------------------------------------
  Step "FFmpeg"
  $FfmpegDir = Join-Path $Bin "ffmpeg"
  $HasBundled = (Test-Path (Join-Path $FfmpegDir "ffmpeg.exe")) -and (Test-Path (Join-Path $FfmpegDir "ffprobe.exe"))
  $HasSystem = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -and (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)
  if (-not $Force -and $HasBundled) {
    Ok "version statique déjà installée (bin\ffmpeg)"
  } elseif (-not $Force -and $HasSystem) {
    Ok "FFmpeg du système : $((Get-Command ffmpeg.exe).Source)"
  } else {
    $Release = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
    $Zip = Join-Path $Work $FfmpegAsset
    $Sums = Join-Path $Work "ffmpeg-sums.txt"
    Download "$Release/$FfmpegAsset" $Zip
    Download "$Release/checksums.sha256" $Sums
    Verify $Zip $FfmpegAsset $Sums
    Expand $Zip (Join-Path $Work "ffmpeg")
    New-Item -ItemType Directory -Force -Path $FfmpegDir | Out-Null
    foreach ($tool in @("ffmpeg.exe", "ffprobe.exe")) {
      $found = Get-ChildItem (Join-Path $Work "ffmpeg") -Recurse -Filter $tool | Select-Object -First 1
      if (-not $found) { Fail "$tool introuvable dans l'archive téléchargée." }
      Copy-Item -Force $found.FullName (Join-Path $FfmpegDir $tool)
    }
    Ok "FFmpeg installé dans bin\ffmpeg"
  }

  Step "Tout est prêt"
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
  if ($Run) {
    Set-Location $Root
    & $Node (Join-Path $Root "server.js")
    exit $LASTEXITCODE
  }
  Write-Host "    Lance l'application avec launch_windows.bat (double-clic)."
} catch {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "Erreur : $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
