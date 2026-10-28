#!/usr/bin/env bash
# macOS : double-clic pour lancer Wavback.
# La première fois, il installe ce qui manque dans le dossier bin/ (quelques minutes).
cd "$(dirname "$0")" || exit 1
bash scripts/install.sh --run
status=$?
if [ "$status" -ne 0 ]; then
  echo
  read -r -p "Appuie sur Entrée pour fermer cette fenêtre…" _
fi
exit "$status"
