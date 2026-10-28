# Wavback (ex yt-dlp Web UI) — Guide du projet

**Version 1.0.0** (28 octobre 2026) · © 2026 jimix.wav · [github.com/JimixWav](https://github.com/JimixWav)

Ce document sert à reprendre le projet sur un autre ordinateur, notamment sur Mac. Il explique ce que fait l'application, comment elle est construite, pourquoi certains choix ont été faits, ce qui a été testé et ce qui reste à faire.

> **Version 2 : Wavback (Node.js, publiée sur GitHub)** : le projet s'appelle désormais **Wavback**. L'application a été réécrite en Node.js, sans aucune dépendance npm.
> Les lanceurs (`launch.command`, `launch_windows.bat`, `launch.sh`) installent ce qui manque dans `bin/` :
> Node.js portable si besoin, yt-dlp autonome, FFmpeg statique. Nouveautés : vidéo MP4, liste des fichiers,
> utilisation depuis un autre appareil avec mot de passe, suppression automatique optionnelle.
> **L'installation, l'utilisation et l'architecture actuelles sont décrites dans `README.md`.** La suite de ce document
> décrit la V1 Python et reste utile pour l'historique des choix techniques (§ 7).

---

## 1. En bref

Une petite application web **locale** (elle tourne sur ton ordinateur, rien n'est en ligne) qui pilote [yt-dlp](https://github.com/yt-dlp/yt-dlp) depuis le navigateur pour récupérer **l'audio** de YouTube et SoundCloud, dans le format choisi.

- Serveur : Python + FastAPI, lancé avec Uvicorn sur `http://localhost:8765/`
- Interface : une seule page HTML, du CSS et du JavaScript « à la main » (aucun framework)
- Outils externes : `yt-dlp`, `ffmpeg` et `ffprobe`, appelés en ligne de commande
- Cible : Windows 11 et macOS avec le même code

Pensée au départ pour un DJ (Rekordbox), elle doit devenir une version publique sur GitHub où chacun règle ses propres paramètres.

---

## 2. Fonctionnalités de la V1

**Télécharger**
- Choix du format : **FLAC**, **WAV**, **MP3**, **AAC (.m4a)**. Le dernier choix est mémorisé dans le navigateur.
- Lien YouTube ou SoundCloud collé à la main, avec **aperçu** automatique : titre, chaîne, durée, ou nombre de morceaux si c'est une playlist, et **nom exact du fichier** qui sera créé.
- Nom du fichier au choix : **« Titre »** ou **« Chaîne - Titre »**.
- **Playlists enregistrées** : un bouton par playlist (10 maximum), chacune avec son propre style de nom de fichier.

**Suivre**
- Carte de suivi : titre de la tâche, barre de progression (pourcentage, taille, vitesse, temps restant, « Morceau 3 sur 12 », « Conversion en FLAC… »), liste des fichiers créés, bouton **Arrêter**.
- Console : sortie de yt-dlp et panneau « Erreurs et avertissements ».
- Une seule tâche à la fois.

**Régler** (bouton **Mode pro** dans « Réglages et diagnostic »)
- MP3 : 128, 160, 192, 256, 320 kbps (débit constant) ou V0 (débit variable).
- AAC : 128, 192, 256, 320 kbps.
- FLAC et WAV : 16 ou 24 bits.
- Fréquence : source, 44,1 kHz ou 48 kHz.
- Playlists : nom du bouton, lien, style de nom, ajout et retrait.
- Dossier de téléchargement : box cliquable qui ouvre **l'explorateur du système**, avec saisie manuelle en secours.
- Rien n'est appliqué avant **Enregistrer**. Les boutons **Annuler** et **Valeurs d'origine** sont disponibles, et un indicateur « Modifications non enregistrées » s'affiche.

**Divers**
- Diagnostic : versions de yt-dlp, ffmpeg et ffprobe, état du dossier, bouton **Mettre à jour yt-dlp** (`yt-dlp -U`).
- Bouton **Ouvrir** le dossier de téléchargement.
- Bouton **Quitter** : arrête le téléchargement en cours, éteint le serveur (la fenêtre du lanceur se ferme) et ferme l'onglet quand le navigateur l'autorise.
- Interface entièrement en français, thème sombre, adaptée au mobile.

---

## 3. Démarrer sur Mac

### Prérequis

1. **Python 3.11 ou plus récent**, de préférence depuis [python.org](https://www.python.org/downloads/macos/). Le `python3` fourni avec macOS est trop ancien (3.9), et la version python.org inclut **Tk**, utilisé par la fenêtre « choisir un dossier ».
   - Avec Python Homebrew, Tk s'installe à part : `brew install python-tk@3.13` (adapte le numéro à ta version).
2. **yt-dlp et ffmpeg** (ffprobe est inclus avec ffmpeg) :

   ```bash
   brew install yt-dlp ffmpeg
   ```

3. Recommandé : **Deno**. Depuis fin 2025, yt-dlp a besoin d'un moteur JavaScript pour YouTube. Sans lui, il affiche un avertissement et certains formats peuvent manquer.

   ```bash
   brew install deno
   ```

### Premier lancement

1. Décompresse `yt-dlp-web-ui-v1.0.0.zip`.
2. Double-clique sur `launch.command`. Il :
   - vérifie Python 3.11+ ;
   - crée `.venv` et installe les dépendances (`requirements.txt`) ;
   - copie `config.example.json` en `config.json` ;
   - démarre le serveur, qui ouvre `http://localhost:8765/` dans le navigateur.
3. La première fois, macOS peut bloquer le fichier téléchargé : **clic droit > Ouvrir > Ouvrir**.
4. Si macOS dit que le fichier n'est pas exécutable : `chmod +x launch.command` dans le Terminal, depuis le dossier du projet.

### Mode développement

Pour modifier le code avec rechargement automatique :

```bash
cd ~/chemin/vers/yt-dlp-web-ui
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

Pendant le développement, mets `"auto_open_browser": false` dans `config.json`. Sinon, chaque rechargement ouvre un nouvel onglet (voir § 7).

### Récupérer tes réglages Windows

`config.json` et `settings.json` ne sont **pas** dans le zip, car ce sont des fichiers personnels. Sur le Mac, tu peux :
- refaire tes playlists et ton dossier dans le **Mode pro** ;
- ou copier tes liens de playlists dans `config.json` (`youtube_playlist_url`, `soundcloud_playlist_url`).

---

## 4. Architecture

```text
Navigateur (index.html + app.js)
   │  fetch JSON, interrogation de /api/job toutes les 1 à 3 s
   ▼
FastAPI (routes.py)
   ├── settings_store.py   réglages de l'interface (settings.json)
   ├── services/downloader.py   construit la commande yt-dlp et la lance dans un thread
   │        └── state.py   état de la tâche en mémoire (journaux, statut)
   ├── services/preview.py      aperçu d'un lien (yt-dlp --print, sans téléchargement)
   ├── services/folder_picker.py  fenêtre « choisir un dossier » (Tk dans un sous-processus)
   ├── services/diagnostics.py  versions des outils, état du dossier
   ├── services/updater.py      yt-dlp -U
   └── services/shutdown.py     bouton Quitter
         ▼
   yt-dlp ──► ffmpeg (extraction et conversion audio)
```

### Fichiers

| Fichier | Rôle |
|---|---|
| `app/__init__.py` | Numéro de version (`__version__`), affiché en pied de page (« V1 ») et dans FastAPI |
| `app/main.py` | Création de l'appli, fichiers statiques sans cache, ouverture auto du navigateur |
| `app/config.py` | Lecture de `config.json` (ou `config.example.json`) avec Pydantic |
| `app/models.py` | Tous les modèles de données : enums, requêtes, réponses, réglages, état |
| `app/routes.py` | Toutes les routes HTTP |
| `app/settings_store.py` | Lecture, validation et écriture atomique de `settings.json`, valeurs par défaut |
| `app/state.py` | État de la tâche en cours (verrou, journaux, arrêt demandé) |
| `app/services/downloader.py` | Formats et libellés, options ffmpeg, lancement et suivi de yt-dlp |
| `app/services/preview.py` | Aperçu d'un lien et calcul du nom de fichier exact |
| `app/services/folder_picker.py` | Fenêtre native de choix de dossier |
| `app/services/shutdown.py` | Arrêt propre du serveur, fermeture du Terminal sur Mac |
| `app/services/diagnostics.py` | Diagnostic des outils |
| `app/services/updater.py` | Mise à jour de yt-dlp |
| `app/services/system_tools.py` | Dossier de sortie, version des exécutables, ouverture du dossier |
| `app/services/validators.py` | Liste blanche des liens acceptés (YouTube et SoundCloud) |
| `app/templates/index.html` | La page unique |
| `app/static/js/app.js` | Toute la logique de l'interface |
| `app/static/css/styles.css` | Le style (thème sombre, responsive) |
| `launch.command` | Lanceur macOS |
| `launch_windows.bat` / `.ps1` | Lanceurs Windows |
| `config.example.json` | Configuration neutre, copiée en `config.json` au premier lancement |
| `requirements.txt` | Dépendances Python, versions fixées sur celles testées |

---

## 5. API

Toutes les routes répondent en JSON, sauf `/`. Les erreurs renvoient `{"detail": "message en français"}`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/` | Page de l'interface |
| GET | `/api/health` | Vérifie que le serveur répond |
| GET | `/api/config-summary` | Formats (libellés et aides selon les réglages), playlists, dossier actif, format par défaut |
| GET | `/api/settings` | Réglages enregistrés et valeurs d'origine |
| PUT | `/api/settings` | Valide et enregistre les réglages dans `settings.json` |
| POST | `/api/pick-folder` | Ouvre la fenêtre de choix de dossier, renvoie le chemin ou `null` |
| GET | `/api/diagnostics` | État des outils et du dossier |
| POST | `/api/preview` | Aperçu d'un lien `{url}` |
| POST | `/api/download/manual` | Télécharge un lien `{url, audio_format, include_uploader}` |
| POST | `/api/download/playlist/{id}` | Télécharge une playlist enregistrée `{audio_format}` |
| GET | `/api/job` | État de la tâche en cours (statut, journaux, fichiers…) |
| POST | `/api/job/stop` | Arrête la tâche en cours |
| POST | `/api/update-ytdlp` | Lance la commande de mise à jour |
| POST | `/api/open-download-folder` | Ouvre le dossier dans l'explorateur ou le Finder |
| POST | `/api/shutdown` | Bouton Quitter (corps JSON `{}` obligatoire) |

---

## 6. Configuration

Il y a **deux fichiers**, et la séparation est volontaire.

### `config.json` : réglages « admin »

Modifiable uniquement à la main. L'interface ne peut **jamais** y toucher.

- `app` : `host`, `port`, `auto_open_browser`, `allow_auto_create_output_dir`
- `downloads` :
  - `default_output_dir_mac` / `default_output_dir_windows` (par défaut `~/Downloads/yt-dlp`)
  - `youtube_playlist_url`, `soundcloud_playlist_url` : playlists de départ, vides dans l'exemple
  - `name_template_title` = `%(title)s.%(ext)s`
  - `name_template_uploader_title` = `%(uploader)s - %(title)s.%(ext)s`
  - `default_audio_format` : format choisi à la première visite
- `executables` : commandes `yt-dlp`, `ffmpeg`, `ffprobe` (tableaux d'arguments, jamais une chaîne shell)
- `update` : commande de mise à jour

### `settings.json` : réglages du Mode pro

Créé par le bouton **Enregistrer**. Il contient `output_dir`, `audio` (débits, bits, fréquence) et `playlists` (`id`, `label`, `url`, `name_style`).

- S'il n'existe pas, les valeurs viennent de `config.json`.
- Le supprimer revient aux valeurs de `config.json`.
- S'il est corrompu, l'appli l'ignore et repart des valeurs par défaut au lieu de planter.

### Côté navigateur (localStorage)

`ytdlp-ui.audio-format`, `ytdlp-ui.include-uploader`, `ytdlp-ui.pro-mode`

---

## 7. Choix techniques et pièges déjà résolus

À garder en tête pour ne pas réintroduire ces problèmes.

| Sujet | Ce qui est fait | Pourquoi |
|---|---|---|
| Titres non latins | `--encoding utf-8` passé à yt-dlp, sortie lue en UTF-8 | Sous Windows, un titre cyrillique arrivait sous forme de « ? » dans l'interface |
| FLAC | `--postprocessor-args "ExtractAudio:-sample_fmt s16"` (ou `s32` pour 24 bits) | Sans ça, ffmpeg produit du FLAC 24 bits à partir d'audio compressé, plus lourd que le WAV 16 bits (46,7 Mo contre 40,9 Mo constaté) |
| ALAC | Retiré | Bug de yt-dlp : avec `--audio-format alac`, il n'envoie pas `-acodec alac` à ffmpeg, qui produit de l'AAC |
| MP3 | Débit constant (`320K`…) par défaut, V0 en option | Le MP3 à débit variable peut décaler les cue points sur certaines platines |
| Qualité | Message dans l'interface | YouTube et SoundCloud diffusent en compressé : FLAC ou WAV ne rendent pas la qualité perdue |
| Progression | `--newline` et une seule ligne de progression gardée dans les journaux | Sinon chaque mise à jour ajoutait une ligne dans la console |
| Arrêt sous Windows | Indicateur `stop_was_requested` dans `state.py` | `terminate()` donne le code 1 sous Windows (et non -15) : la tâche apparaissait en « Échec » |
| Heures | Dates en UTC avec fuseau horaire | Sans fuseau, le navigateur décalait les heures |
| Cache du navigateur | `Cache-Control: no-cache` sur `/static` et `?v=<date des fichiers>` dans les liens | Chrome gardait l'ancien `app.js` pendant des semaines, d'où une page cassée qui clignotait |
| Ouverture auto | Ouvre `localhost` (et non l'IP), lanceurs sans `--reload` | Avec `--reload`, chaque modification du code rouvrait un onglet |
| Aperçu et noms | `yt-dlp --flat-playlist --print …` avec la conversion `%(champ)S` | `S` nettoie les noms exactement comme yt-dlp le fait pour les vrais fichiers (`:` et `|` remplacés, etc.) ; l'extension reste un `{ext}` remplacé côté interface |
| Fenêtre de dossier | Tk lancé dans un **sous-processus** Python, verrou contre l'ouverture en double | Tk a besoin du fil principal, que le serveur web n'offre pas |
| Bouton Quitter | `signal.raise_signal(SIGINT)` puis arrêt forcé `os._exit(0)` après 5 s | Même chemin qu'un Ctrl+C : Uvicorn s'arrête proprement avec le code 0, donc le `.bat` se termine et sa fenêtre se ferme |
| Quitter sur Mac | `osascript` ferme la fenêtre du Terminal qui a le même `tty`, lancé dans une session détachée | Sinon Terminal compte `osascript` comme un processus actif et demande confirmation (**non testé sur Mac**) |
| Fermer l'onglet | `window.close()` puis écran « Application fermée » si refusé | Les navigateurs n'autorisent la fermeture que pour un onglet ouvert directement sur l'appli |

### Sécurité

- Aucun `shell=True` : toutes les commandes sont des tableaux d'arguments.
- Liens acceptés : YouTube et SoundCloud uniquement, vérifiés côté serveur, y compris dans les playlists du Mode pro.
- L'interface ne modifie que des réglages structurés (débits, playlists, dossier), jamais des commandes ni des options yt-dlp libres.
- Les routes sensibles exigent un corps JSON, ce qui force une vérification du navigateur (CORS) et empêche un autre site de les déclencher : `shutdown`, `pick-folder`, `settings`, `download/manual`, `preview`.
- **À corriger avant la version publique** (§ 10) : `POST /api/download/playlist/{id}`, `/api/job/stop`, `/api/update-ytdlp` et `/api/open-download-folder` acceptent une requête sans corps. Un site malveillant ouvert dans le même navigateur pourrait donc les déclencher.

---

## 8. Ce qui a été testé

| Test | Windows 11 | Linux (WSL) | Mac |
|---|---|---|---|
| Les 4 formats produisent le bon codec, débit et bits (ffprobe) | Oui | — | **À faire** |
| Réglages pro (MP3 192/V0, AAC 128, FLAC/WAV 24 bits, 44,1 kHz) | Oui | — | **À faire** |
| Téléchargement réel, aperçu, playlists, erreurs | Oui | — | **À faire** |
| Installation de zéro avec le lanceur | — | Oui (`launch.command`) | **À faire** |
| Permission exécutable de `launch.command` dans le zip | Inscrite (0755) | — | **À vérifier** |
| Fenêtre de choix de dossier | Oui (premier plan) | Secours manuel OK sans Tk | **À faire** |
| Quitter : serveur arrêté avec le code 0 | Oui (fenêtre du `.bat` fermée) | Oui | **À faire** |
| Quitter : fermeture de la fenêtre Terminal | — | — | **À faire** |

Versions testées : Python 3.14 (Windows) et 3.12 (Linux), FastAPI 0.136, Uvicorn 0.46, Pydantic 2.13, Starlette 1.0 et 1.10, yt-dlp 2026.10.26.

### Liste de tests à faire sur le Mac

- [ ] Double-clic sur `launch.command` : Gatekeeper, permission exécutable, message si Python est trop vieux.
- [ ] Le navigateur s'ouvre seul sur `http://localhost:8765/`.
- [ ] Diagnostic tout vert (yt-dlp, ffmpeg, ffprobe, dossier).
- [ ] Un morceau dans chaque format, avec un titre accentué et un titre cyrillique.
- [ ] Une playlist, bouton **Arrêter** pendant le téléchargement.
- [ ] Mode pro : la fenêtre de dossier s'ouvre **devant** le navigateur, puis enregistrer et relancer pour vérifier que c'est gardé.
- [ ] Bouton **Ouvrir** : le Finder s'ouvre sur le bon dossier.
- [ ] **Quitter** : l'onglet se ferme, le serveur s'arrête, la fenêtre Terminal se ferme. Note si macOS demande une autorisation.

### Astuces de test

- Vidéo YouTube courte et stable pour les essais : « Me at the zoo », `https://www.youtube.com/watch?v=jNQXAC9IVRw` (19 s).
- Tester sans Internet : générer un fichier avec ffmpeg, puis le passer à yt-dlp avec `--enable-file-urls` :

  ```bash
  ffmpeg -f lavfi -i "sine=frequency=440:duration=3" "Тест é.wav"
  yt-dlp --enable-file-urls -x --audio-format flac "file:///chemin/vers/Тест%20é.wav"
  ```

- Vérifier un fichier produit :

  ```bash
  ffprobe -v error -show_entries stream=codec_name,sample_rate,bits_per_raw_sample,bit_rate -of default=nw=1 fichier.flac
  ```

---

## 9. Faire une release (zip)

Le zip doit :
- garder la permission exécutable de `launch.command` (sinon « permission refusée » sur Mac) ;
- exclure `config.json`, `settings.json`, `.venv`, `__pycache__`, `.git`, les anciens `.zip` et les fichiers parasites `._*` / `.DS_Store` créés par macOS.

**Sur Mac**, `zip` garde déjà les permissions. Depuis le dossier **parent** du projet :

```bash
zip -r yt-dlp-web-ui-v1.0.0.zip yt-dlp-web-ui \
  -x "*/.venv/*" "*/__pycache__/*" "*/.git/*" "*/config.json" "*/settings.json" "*.zip" "*/.DS_Store" "*/._*"
```

**Sur Windows**, l'outil de compression intégré ne garde pas les permissions Unix. Ce script Python, lui, les inscrit dans le zip. Enregistre-le dans un fichier `build_release.py` en dehors du projet, puis lance-le avec le Python du projet en lui donnant le dossier du projet et le fichier de sortie :

```python
import stat, sys, time, zipfile
from pathlib import Path

SRC, DEST, ROOT = Path(sys.argv[1]), Path(sys.argv[2]), "yt-dlp-web-ui"
SKIP_DIRS = {".venv", "__pycache__", ".git"}
SKIP_FILES = {"config.json", "settings.json", "settings.json.tmp", ".DS_Store"}

def keep(p):
    rel = p.relative_to(SRC)
    return not (set(rel.parts) & SKIP_DIRS or p.name in SKIP_FILES or p.name.startswith("._") or p.suffix == ".zip")

with zipfile.ZipFile(DEST, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(x for x in SRC.rglob("*") if x.is_file() and keep(x)):
        info = zipfile.ZipInfo(f"{ROOT}/{p.relative_to(SRC).as_posix()}", time.localtime(p.stat().st_mtime)[:6])
        info.create_system = 3  # Unix : macOS relit les permissions ci-dessous
        info.external_attr = (stat.S_IFREG | (0o755 if p.name == "launch.command" else 0o644)) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, p.read_bytes())
```

```powershell
.venv\Scripts\python.exe ..\build_release.py . ..\yt-dlp-web-ui-v1.0.0.zip
```

Avant chaque release :
1. Mettre à jour `__version__` dans `app/__init__.py`. Le pied de page affiche le chiffre principal (« V1 », « V2 »…).
2. Mettre à jour la version en haut de `README.md` et de ce fichier.
3. Vérifier que `config.example.json` reste neutre : aucune playlist perso, dossier `~/Downloads/yt-dlp`.
4. Vérifier que `launch.command` garde des fins de ligne Unix (LF). Un éditeur Windows qui le passe en CRLF le casse sur Mac (« bad interpreter »).

---

## 10. Suite du projet

### Publication sur GitHub

- `git init`, premier commit « v1.0.0 », tag `v1.0.0`. Le `.gitignore` exclut déjà `config.json`, `settings.json`, `.venv` et `__pycache__`.
- Choisir une licence (MIT, par exemple) et ajouter `LICENSE`.
- Ajouter des captures d'écran au README.
- Rappeler dans le README que l'outil sert à télécharger des contenus qu'on a le droit de télécharger : ses propres morceaux, des téléchargements gratuits autorisés, etc.

### Avant une version publique (prioritaire)

- [ ] **Protéger les routes sans corps** (§ 7, Sécurité). Le plus simple : un middleware qui refuse toute requête non-GET dont l'en-tête `Origin` n'est pas `http://localhost:8765` ou `http://127.0.0.1:8765`.
- [ ] Afficher dans le diagnostic si **Deno** est installé, avec le conseil d'installation.
- [ ] Tests automatisés : `pytest` + `httpx` avec `fastapi.testclient`, sur la validation des réglages, la construction des commandes yt-dlp et l'aperçu.
- [ ] Lanceur Linux (`launch.sh`) si besoin.

### V2 : vidéo

Idée de départ : une section « Vidéo » à côté de l'audio, avec les mêmes principes (réglages structurés dans le Mode pro, aucune option libre).
- Conteneur : MP4 (compatible partout) ou MKV.
- Résolution maximale : 480p, 720p, 1080p, 1440p, 4K, ou meilleure disponible (`-f "bv*[height<=1080]+ba/b[height<=1080]"`).
- Codec préféré : H.264 (compatibilité), VP9 ou AV1 (plus léger). Attention, beaucoup de lecteurs ne lisent pas l'AV1.
- Option sous-titres.
- La barre de progression gère déjà la plupart des sorties de yt-dlp. Il faudra ajouter la phase de fusion (`[Merger]`).

### Autres idées notées en route

- Ajouter les tags (artiste, titre) et la pochette dans les fichiers (`--embed-metadata --embed-thumbnail`), proposé puis mis de côté.
- File d'attente de plusieurs liens.
- Proposer « juste ce morceau » quand un lien YouTube contient `&list=` (aujourd'hui toute la playlist est téléchargée, l'aperçu le signale).
- La clé `auto_run_diagnostics_on_load` de `config.json` n'est pas utilisée : le diagnostic se lance toujours au chargement.

---

## 11. Conventions du code

- Textes de l'interface et messages d'erreur **en français**, code et commentaires **en anglais**.
- Peu de commentaires : seulement pour expliquer un « pourquoi » non évident (voir les exemples dans `downloader.py` et `shutdown.py`).
- Pas de framework JS ni CSS : JavaScript et CSS à la main, couleurs dans les variables `:root`.
- Toute commande externe passe par un tableau d'arguments, jamais `shell=True`.
- Les entrées de l'utilisateur sont validées côté serveur, avec des messages d'erreur en français.
- Les nouveaux réglages vont dans `settings.json` via `UserSettings` (modèle Pydantic). `config.json` reste réservé à l'admin.
