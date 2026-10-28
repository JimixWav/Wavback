#!/usr/bin/env bash
# Wavback : vérifie et installe ce qui manque (macOS et Linux, Raspberry Pi compris).
# Aucun droit administrateur : tout ce qui est téléchargé va dans ./bin.
#
#   bash scripts/install.sh          vérifie et installe ce qui manque
#   bash scripts/install.sh --run    idem, puis lance l'application (utilisé par launch.command et launch.sh)
#   bash scripts/install.sh --force  retélécharge yt-dlp, FFmpeg et Node.js portable
#
#   Node.js 22+   celui du système s'il est assez récent, sinon une copie portable dans bin/node
#   yt-dlp        toujours dans bin/ (les versions des gestionnaires de paquets sont souvent trop vieilles)
#   FFmpeg        celui du système s'il est installé, sinon une version statique dans bin/ffmpeg

set -euo pipefail

RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --force) FORCE=1 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/bin"
WORK="$BIN/.install"
NODE_MIN_MAJOR=22
NODE_CHANNEL="latest-v24.x"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '    \033[32mOK\033[0m %s\n' "$*"; }
warn() { printf '    \033[33mAttention :\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 20 --progress-bar -o "$out" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress --tries=3 -O "$out" "$url"
  else
    fail "ni curl ni wget n'est installé."
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# verify FILE NAME SUMS_FILE : the line "<hash>  NAME" of SUMS_FILE must match FILE.
verify() {
  local expected
  expected="$(grep -E "[ *]$2\$" "$3" | head -n 1 | cut -d' ' -f1 || true)"
  [[ -n "$expected" ]] || fail "somme de contrôle introuvable pour $2."
  [[ "$expected" == "$(sha256_of "$1")" ]] || fail "la somme de contrôle de $2 ne correspond pas (téléchargement corrompu ?)."
  ok "somme de contrôle vérifiée ($2)"
}

cleanup_work() { rm -rf "$WORK"; }
trap cleanup_work EXIT

mkdir -p "$BIN" "$BIN/tmp"
rm -rf "$WORK" && mkdir -p "$WORK"
export TMPDIR="$BIN/tmp"

# 1. Système ------------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64) NODE_PLATFORM="darwin-arm64"; YTDLP_ASSET="yt-dlp_macos"; FF="macos/arm64" ;;
  Darwin/x86_64) NODE_PLATFORM="darwin-x64"; YTDLP_ASSET="yt-dlp_macos"; FF="macos/amd64" ;;
  Linux/x86_64) NODE_PLATFORM="linux-x64"; YTDLP_ASSET="yt-dlp_linux"; FF="amd64" ;;
  Linux/aarch64 | Linux/arm64) NODE_PLATFORM="linux-arm64"; YTDLP_ASSET="yt-dlp_linux_aarch64"; FF="arm64" ;;
  # Raspberry Pi OS 32 bits: no standalone yt-dlp exists, the zipapp runs on the system Python.
  Linux/armv7l) NODE_PLATFORM="linux-armv7l"; YTDLP_ASSET="yt-dlp"; FF="armhf" ;;
  *) fail "système non pris en charge : $OS $ARCH. (Raspberry Pi : il faut un Pi 2 ou plus récent.)" ;;
esac
step "Système : $OS $ARCH"

# 2. Node.js ------------------------------------------------------------------
step "Node.js"
NODE=""
if [[ $FORCE -eq 0 && -x "$BIN/node/bin/node" ]]; then
  NODE="$BIN/node/bin/node"
  ok "Node.js portable $("$NODE" -v) (bin/node)"
elif [[ $FORCE -eq 0 ]] && command -v node >/dev/null 2>&1 && node -e "process.exit(+process.versions.node.split('.')[0] >= $NODE_MIN_MAJOR ? 0 : 1)" 2>/dev/null; then
  NODE="$(command -v node)"
  ok "Node.js $(node -v) déjà installé"
else
  if command -v node >/dev/null 2>&1; then
    warn "Node.js $(node -v) est trop ancien (il faut la version $NODE_MIN_MAJOR ou plus) : installation d'une copie portable."
  fi
  BASE="https://nodejs.org/dist/$NODE_CHANNEL"
  download "$BASE/SHASUMS256.txt" "$WORK/node-sums.txt"
  NODE_FILE="$(grep -oE "node-v[0-9.]+-$NODE_PLATFORM\.tar\.gz" "$WORK/node-sums.txt" | head -n 1)"
  [[ -n "$NODE_FILE" ]] || fail "aucune version de Node.js pour $NODE_PLATFORM."
  download "$BASE/$NODE_FILE" "$WORK/$NODE_FILE"
  verify "$WORK/$NODE_FILE" "$NODE_FILE" "$WORK/node-sums.txt"
  rm -rf "$BIN/node" && mkdir -p "$BIN/node"
  tar -xzf "$WORK/$NODE_FILE" -C "$BIN/node" --strip-components=1
  NODE="$BIN/node/bin/node"
  ok "Node.js portable $("$NODE" -v) installé dans bin/node"
fi

# 3. yt-dlp -------------------------------------------------------------------
step "yt-dlp"
if [[ "$YTDLP_ASSET" == "yt-dlp" ]]; then
  command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
    || fail "sur un système 32 bits, yt-dlp a besoin de Python 3.10 ou plus récent (sudo apt install python3)."
fi
if [[ -x "$BIN/yt-dlp" && $FORCE -eq 0 ]]; then
  ok "déjà installé"
else
  RELEASE="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
  download "$RELEASE/$YTDLP_ASSET" "$WORK/$YTDLP_ASSET"
  download "$RELEASE/SHA2-256SUMS" "$WORK/yt-dlp-sums.txt"
  verify "$WORK/$YTDLP_ASSET" "$YTDLP_ASSET" "$WORK/yt-dlp-sums.txt"
  chmod +x "$WORK/$YTDLP_ASSET"
  mv -f "$WORK/$YTDLP_ASSET" "$BIN/yt-dlp"
fi
YTDLP_VERSION="$("$BIN/yt-dlp" --version 2>&1)" || fail "bin/yt-dlp ne démarre pas :
$YTDLP_VERSION"
ok "yt-dlp $YTDLP_VERSION (bin/yt-dlp)"

# 4. FFmpeg -------------------------------------------------------------------
step "FFmpeg"
FFMPEG_DIR="$BIN/ffmpeg"
if [[ $FORCE -eq 0 && -x "$FFMPEG_DIR/ffmpeg" && -x "$FFMPEG_DIR/ffprobe" ]]; then
  ok "version statique déjà installée (bin/ffmpeg)"
elif [[ $FORCE -eq 0 ]] && command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "FFmpeg du système : $(command -v ffmpeg)"
else
  mkdir -p "$WORK/ffmpeg" "$FFMPEG_DIR"
  if [[ "$OS" == "Darwin" ]]; then
    # Static macOS builds by Martin Riedl (ffmpeg.martin-riedl.de), one zip per tool.
    for tool in ffmpeg ffprobe; do
      URL="https://ffmpeg.martin-riedl.de/redirect/latest/$FF/release/$tool.zip"
      download "$URL" "$WORK/$tool.zip"
      if download "$URL.sha256" "$WORK/$tool.zip.sha256" 2>/dev/null; then
        [[ "$(cut -d' ' -f1 "$WORK/$tool.zip.sha256")" == "$(sha256_of "$WORK/$tool.zip")" ]] || fail "la somme de contrôle de $tool ne correspond pas."
        ok "somme de contrôle vérifiée ($tool.zip)"
      fi
      unzip -o -q "$WORK/$tool.zip" -d "$WORK/ffmpeg"
    done
  else
    command -v xz >/dev/null 2>&1 || fail "il manque xz pour décompresser FFmpeg. Installe FFmpeg avec ton gestionnaire de paquets (Raspberry Pi / Debian / Ubuntu : sudo apt install ffmpeg), puis relance."
    ARCHIVE="$WORK/ffmpeg.tar.xz"
    JVS="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-$FF-static.tar.xz"
    if download "$JVS" "$ARCHIVE"; then
      if download "$JVS.md5" "$WORK/ffmpeg.md5" 2>/dev/null; then
        [[ "$(cut -d' ' -f1 "$WORK/ffmpeg.md5")" == "$(md5sum "$ARCHIVE" | cut -d' ' -f1)" ]] || fail "la somme de contrôle de FFmpeg ne correspond pas."
        ok "somme de contrôle vérifiée (FFmpeg)"
      fi
    else
      [[ "$FF" != "armhf" ]] || fail "téléchargement de FFmpeg impossible. Installe-le avec : sudo apt install ffmpeg"
      warn "johnvansickle.com ne répond pas, essai avec les builds BtbN (GitHub)."
      BTBN_ARCH="linux64"; [[ "$FF" == "arm64" ]] && BTBN_ARCH="linuxarm64"
      download "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-$BTBN_ARCH-gpl.tar.xz" "$ARCHIVE"
    fi
    tar -xJf "$ARCHIVE" -C "$WORK/ffmpeg"
  fi
  for tool in ffmpeg ffprobe; do
    found="$(find "$WORK/ffmpeg" -type f -name "$tool" | head -n 1)"
    [[ -n "$found" ]] || fail "$tool introuvable dans l'archive téléchargée."
    install -m 755 "$found" "$FFMPEG_DIR/$tool"
  done
  "$FFMPEG_DIR/ffmpeg" -version >/dev/null 2>&1 || fail "bin/ffmpeg/ffmpeg ne démarre pas."
  ok "FFmpeg $("$FFMPEG_DIR/ffmpeg" -version | head -n 1 | cut -d' ' -f3) installé dans bin/ffmpeg"
fi

# 5. Lancement ----------------------------------------------------------------
step "Tout est prêt"
if [[ $RUN -eq 1 ]]; then
  cleanup_work
  cd "$ROOT"
  exec "$NODE" "$ROOT/server.js"
fi
echo "    Lance l'application avec : $( [[ "$OS" == "Darwin" ]] && echo "launch.command (double-clic)" || echo "./launch.sh" )"
