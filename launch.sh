#!/usr/bin/env bash
# Linux et Raspberry Pi : ./launch.sh pour lancer Wavback.
# La première fois, il installe ce qui manque dans le dossier bin/ (quelques minutes).
cd "$(dirname "$0")" || exit 1
exec bash scripts/install.sh --run "$@"
