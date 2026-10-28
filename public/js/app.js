const STATUS_LABELS = {
  idle: "En attente",
  running: "En cours",
  success: "Terminé",
  error: "Échec",
  stopped: "Arrêté",
};
const STATUS_TONES = { idle: "neutral", running: "info", success: "success", error: "error", stopped: "warning" };
const JOB_TITLES = {
  playlist_download: "Playlist",
  manual_download: "Téléchargement d'un lien",
  update_ytdlp: "Mise à jour de yt-dlp",
};
const STORAGE_KEYS = {
  format: "wavback.audio-format",
  uploader: "wavback.include-uploader",
  pro: "wavback.pro-mode",
};
const POLL_RUNNING_MS = 1000;
const POLL_IDLE_MS = 3000;
const FILES_REFRESH_MS = 60000;
const PREVIEW_DELAY_MS = 500;
const MAX_PLAYLISTS = 10;
const SUPPORTED_HOST = /(^|\.)(youtube\.com|youtu\.be|soundcloud\.com)$/;
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be)$/;

const PRO_AUDIO_FIELDS = [
  {
    key: "mp3_bitrate",
    label: "MP3 (kbps)",
    choices: [["128", "128"], ["160", "160"], ["192", "192"], ["256", "256"], ["320", "320"], ["v0", "V0"]],
  },
  { key: "aac_bitrate", label: "AAC (kbps)", choices: [["128", "128"], ["192", "192"], ["256", "256"], ["320", "320"]] },
  { key: "flac_bit_depth", label: "FLAC", choices: [[16, "16 bits"], [24, "24 bits"]] },
  { key: "wav_bit_depth", label: "WAV", choices: [[16, "16 bits"], [24, "24 bits"]] },
  {
    key: "sample_rate",
    label: "Fréquence d'échantillonnage",
    choices: [["source", "Source"], ["44100", "44,1 kHz"], ["48000", "48 kHz"]],
  },
];
const PRO_VIDEO_FIELDS = [
  {
    key: "max_height",
    label: "Résolution maximale",
    choices: [["480", "480p"], ["720", "720p"], ["1080", "1080p"], ["1440", "1440p"], ["2160", "4K"]],
  },
];
const PLAYLIST_NAME_STYLES = [["title", "Titre"], ["uploader_title", "Chaîne - Titre"]];

const RE_PERCENT = /^\[download\]\s+([\d.]+)%/;
const RE_SIZE = /\bof\s+~?\s*([\d.]+\s?[KMGT]?i?B)\b/;
const RE_SPEED = /\bat\s+([\d.]+\s?[KMGT]?i?B\/s)/;
const RE_ETA = /\bETA\s+(\d[\d:]*)/;
const RE_ITEM = /^\[download\] Downloading (?:item|video) (\d+) of (\d+)/;
const RE_DESTINATION = /^\[download\] Destination: (.+)$/;
const RE_ALREADY = /^\[download\] (.+) has already been downloaded/;
const RE_EXTRACTED = /^\[ExtractAudio\] Destination: (.+)$/;
const RE_MERGER = /^\[Merger\] Merging formats into "(.+)"$/;
const RE_REMUX = /^\[VideoRemuxer\] Remuxing video from \S+ to \S+; Destination: (.+)$/;
const RE_NOT_CONVERTED = /^\[ExtractAudio\] Not converting audio (.+?); file is already in target format/;
const RE_PP_EXISTS = /Post-process file (.+) exists, skipping/;
const RE_INTERMEDIATE = /\.f\d+\.[a-z0-9]+$/i;

const state = {
  formats: [],
  selectedFormat: null,
  lastJobId: null,
  lastStatus: null,
  running: false,
  local: false,
  quitting: false,
  serverDown: false,
  pollTimer: null,
  myJobIds: new Set(),
  preview: null,
  previewUrl: "",
  previewSeq: 0,
  previewTimer: null,
  previewCache: new Map(),
  pro: { saved: null, defaults: null, draft: null },
};

const $ = (id) => document.getElementById(id);
const el = {
  page: $("page"),
  closedScreen: $("closed-screen"),
  btnQuit: $("btn-quit"),
  proTip: $("pro-tip"),
  btnProTip: $("btn-pro-tip"),
  btnOpenFolder: $("btn-open-folder"),
  serverFilesNote: $("server-files-note"),
  proOutputDir: $("pro-output-dir"),
  btnPickFolder: $("btn-pick-folder"),
  appError: $("app-error"),
  appSuccess: $("app-success"),
  chipPro: $("chip-pro"),
  chipYtdlp: $("chip-ytdlp"),
  chipFfmpeg: $("chip-ffmpeg"),
  chipFolder: $("chip-folder"),
  formatOptions: $("format-options"),
  formatHint: $("format-hint"),
  form: $("manual-form"),
  manualUrl: $("manual-url"),
  nameStyleInputs: Array.from(document.querySelectorAll('input[name="name-style"]')),
  linkPreview: $("link-preview"),
  nameExample: $("name-example"),
  playlistsBlock: $("playlists-block"),
  playlistButtons: $("playlist-buttons"),
  serverFilesList: $("server-files-list"),
  serverFilesCount: $("server-files-count"),
  serverFilesEmpty: $("server-files-empty"),
  btnRefreshFiles: $("btn-refresh-files"),
  btnStop: $("btn-stop"),
  btnUpdate: $("btn-update"),
  btnDiagnostics: $("btn-diagnostics"),
  jobTitle: $("job-title"),
  jobSubtitle: $("job-subtitle"),
  jobStatusBadge: $("job-status-badge"),
  jobProgress: $("job-progress"),
  progressTrack: $("progress-track"),
  progressCount: $("progress-count"),
  progressBar: $("progress-bar"),
  progressFill: $("progress-fill"),
  progressPercent: $("progress-percent"),
  progressSpeed: $("progress-speed"),
  jobOutcome: $("job-outcome"),
  filesBlock: $("files-block"),
  filesCount: $("files-count"),
  filesList: $("files-list"),
  jobStartedAt: $("job-started-at"),
  jobFinishedAt: $("job-finished-at"),
  jobExitCode: $("job-exit-code"),
  autoscroll: $("autoscroll"),
  stdoutLogs: $("stdout-logs"),
  stderrLogs: $("stderr-logs"),
  stderrCount: $("stderr-count"),
  proCard: $("pro-card"),
  proLoading: $("pro-loading"),
  proForm: $("pro-form"),
  proAudio: $("pro-audio"),
  proVideo: $("pro-video"),
  proPlaylists: $("pro-playlists"),
  proError: $("pro-error"),
  proDirty: $("pro-dirty"),
  btnPro: $("btn-pro"),
  btnProClose: $("btn-pro-close"),
  btnAddPlaylist: $("btn-add-playlist"),
  btnProDefaults: $("btn-pro-defaults"),
  btnProCancel: $("btn-pro-cancel"),
  btnProSave: $("btn-pro-save"),
  settings: $("settings"),
  healthLink: $("health-link"),
  diagReady: $("diag-ready-badge"),
  diagYtdlp: $("diag-ytdlp"),
  diagFfmpeg: $("diag-ffmpeg"),
  diagFfprobe: $("diag-ffprobe"),
  diagJs: $("diag-js"),
  diagOutput: $("diag-output"),
  diagCheckedAt: $("diagnostics-checked-at"),
  configDefaultFormat: $("config-default-format"),
  configPlaylists: $("config-playlists"),
  configRetention: $("config-retention"),
  configMaxSize: $("config-max-size"),
};

/* Helpers */

function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private window); the choice just won't be remembered.
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function textElement(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) {
    node.className = className;
  }
  return node;
}

function showError(message) {
  el.appError.textContent = message;
  el.appError.hidden = false;
}

function clearError() {
  el.appError.hidden = true;
  el.appError.textContent = "";
}

function showSuccess(message) {
  el.appSuccess.textContent = message;
  el.appSuccess.hidden = false;
  window.clearTimeout(showSuccess.timeoutId);
  showSuccess.timeoutId = window.setTimeout(() => {
    el.appSuccess.hidden = true;
  }, 3500);
}

function describeApiError(detail) {
  if (typeof detail === "string") {
    return detail;
  }
  return "Une erreur est survenue.";
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(describeApiError(data.detail));
  }
  return data;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

function formatDuration(seconds) {
  if (typeof seconds !== "number") {
    return null;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

function formatBytes(bytes) {
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

function formatRemaining(expiresAt) {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000));
  if (minutes < 1) {
    return "supprimé sous peu";
  }
  if (minutes < 60) {
    return `supprimé dans ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `supprimé dans ${hours} h ${String(rest).padStart(2, "0")}`;
}

function renderFilesNote() {
  if (state.retentionMinutes) {
    el.serverFilesNote.textContent = `Supprimés automatiquement ${formatRetention(state.retentionMinutes)} après leur création.`;
    return;
  }
  const path = textElement("span", state.outputDir || "…", "server-files-note-path");
  el.serverFilesNote.replaceChildren("Enregistrés dans ", path);
}

function formatRetention(minutes) {
  if (minutes % 60 === 0) {
    return `${minutes / 60} h`;
  }
  return `${minutes} min`;
}

function setBadge(element, label, tone) {
  element.textContent = label;
  element.className = `badge badge-${tone}`;
}

function setChip(element, ok, label) {
  element.textContent = label;
  element.className = `chip ${ok ? "chip-ok" : "chip-bad"}`;
}

function basename(path) {
  return path.split(/[\\/]/).pop();
}

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, "");
}

function downloadUrl(name) {
  return `/download/${encodeURIComponent(name)}`;
}

function downloadLink(name, text, className) {
  const link = textElement("a", text, className);
  link.href = downloadUrl(name);
  link.setAttribute("download", name);
  return link;
}

function buildSegmented(name, choices, current, onChange, extraClass) {
  const group = document.createElement("div");
  group.className = `segmented ${extraClass || ""}`.trim();
  group.setAttribute("role", "radiogroup");
  choices.forEach(([value, text]) => {
    const label = document.createElement("label");
    label.className = "segment";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = String(value);
    input.checked = String(current) === String(value);
    input.addEventListener("change", () => onChange(value));
    label.append(input, textElement("span", text));
    group.append(label);
  });
  return group;
}

/* Formats and file names */

function formatOption(value) {
  return state.formats.find((format) => format.value === value);
}

function formatLabel(value) {
  const option = formatOption(value);
  return option ? option.label : (value || "").toUpperCase();
}

function isVideoFormat(value) {
  const option = formatOption(value);
  return Boolean(option && option.kind === "video");
}

function selectedNameStyle() {
  const checked = el.nameStyleInputs.find((input) => input.checked);
  return checked ? checked.value : "title";
}

function renderNameExample() {
  const withUploader = selectedNameStyle() === "uploader";
  const ext = state.selectedFormat || "mp3";
  const preview = state.preview;
  const realName = preview && preview.kind === "video" ? (withUploader ? preview.name_with_uploader : preview.name_title_only) : null;
  const prefix = preview && preview.kind === "playlist" ? "Chaque fichier : " : "Fichier : ";
  const example = document.createElement("code");
  example.textContent = realName ? realName.replace("{ext}", ext) : `${withUploader ? "Chaîne - Titre" : "Titre"}.${ext}`;
  el.nameExample.replaceChildren(prefix, example);
}

function selectFormat(value, persist) {
  state.selectedFormat = value;
  const option = formatOption(value);
  el.formatHint.textContent = option ? option.hint : "";
  renderNameExample();
  if (persist) {
    store(STORAGE_KEYS.format, value);
  }
}

function renderFormats(formats, defaultFormat) {
  state.formats = formats;
  const stored = state.selectedFormat || readStored(STORAGE_KEYS.format);
  const initial = formats.some((format) => format.value === stored) ? stored : defaultFormat;
  const choices = formats.map((format) => [format.value, format.label]);
  const group = buildSegmented("media-format", choices, initial, (value) => selectFormat(value, true));
  el.formatOptions.replaceChildren(...group.childNodes);
  selectFormat(initial, false);
}

/* Playlists */

function renderPlaylists(playlists) {
  el.playlistsBlock.hidden = playlists.length === 0;
  el.playlistButtons.replaceChildren(
    ...playlists.map((playlist) => {
      const button = textElement("button", playlist.label, "btn btn-secondary");
      button.type = "button";
      button.title = playlist.url;
      button.dataset.busyDisable = "";
      button.disabled = state.running;
      button.addEventListener("click", () => {
        runAction(button, `/api/download/playlist/${encodeURIComponent(playlist.id)}`, { format: state.selectedFormat }, rememberJob);
      });
      return button;
    })
  );
}

/* Config and diagnostics */

function renderConfig(data) {
  renderFormats(data.formats, data.default_format);
  renderPlaylists(data.playlists);
  el.configDefaultFormat.textContent = formatLabel(data.default_format);
  el.configPlaylists.textContent = data.playlists.length ? data.playlists.map((playlist) => playlist.label).join(", ") : "Aucune";
  state.local = data.local;
  state.retentionMinutes = data.retention_minutes;
  state.outputDir = data.output_dir;
  el.configRetention.textContent = data.retention_minutes ? `Après ${formatRetention(data.retention_minutes)}` : "Désactivée";
  el.btnQuit.hidden = !data.local;
  el.btnOpenFolder.hidden = !data.local;
  el.btnPickFolder.hidden = !data.local;
  renderFilesNote();
  el.configMaxSize.textContent = data.max_filesize ? String(data.max_filesize).replace(/\s*([KMGT])$/i, (_, unit) => ` ${unit.toUpperCase()}o`) : "Illimitée";
  el.btnUpdate.hidden = !data.update_enabled;
}

async function loadConfig() {
  renderConfig(await apiRequest("/api/config-summary"));
}

function shortVersion(tool) {
  if (!tool.found) {
    return "Introuvable";
  }
  const match = /version\s+(\S+)/i.exec(tool.version || "");
  return match ? match[1] : tool.version || "Trouvé";
}

function renderDiagnostics(data) {
  const ffmpegOk = data.ffmpeg.found && data.ffprobe.found;
  const storageOk = data.downloads.exists && data.downloads.writable;
  setChip(el.chipYtdlp, data.yt_dlp.found, data.yt_dlp.found ? `yt-dlp ${shortVersion(data.yt_dlp)}` : "yt-dlp manquant");
  setChip(el.chipFfmpeg, ffmpegOk, ffmpegOk ? "ffmpeg" : "ffmpeg manquant");
  setChip(el.chipFolder, storageOk, storageOk ? "Dossier OK" : "Dossier inaccessible");
  setBadge(el.diagReady, data.ready ? "Tout est prêt" : "Problème détecté", data.ready ? "success" : "error");

  el.diagYtdlp.textContent = `${shortVersion(data.yt_dlp)}${data.yt_dlp.found && !data.yt_dlp.bundled ? " (système)" : ""}`;
  el.diagFfmpeg.textContent = `${shortVersion(data.ffmpeg)}${data.ffmpeg.found && !data.ffmpeg.bundled ? " (système)" : ""}`;
  el.diagFfprobe.textContent = shortVersion(data.ffprobe);
  el.diagJs.textContent = data.js_runtime || "Aucun";
  el.diagOutput.textContent = !data.downloads.exists
    ? "Introuvable"
    : data.downloads.writable
      ? `${data.downloads.file_count} fichier${data.downloads.file_count > 1 ? "s" : ""}, ${formatBytes(data.downloads.total_bytes)}`
      : "Lecture seule";
  el.diagCheckedAt.textContent = formatDate(data.checked_at);

  if (!data.ready) {
    el.settings.open = true;
  }
}

async function loadDiagnostics() {
  try {
    renderDiagnostics(await apiRequest("/api/diagnostics"));
    return true;
  } catch (error) {
    showError(error.message);
    return false;
  }
}

/* Files on the server */

function serverFileRow(file) {
  const item = document.createElement("li");
  item.className = "server-file";

  const info = document.createElement("div");
  info.className = "server-file-info";
  // On this computer the file is already in the folder; from another device it has to be downloaded.
  const name = state.local ? textElement("span", file.name, "server-file-name plain") : downloadLink(file.name, file.name, "server-file-name");
  name.title = file.name;
  const meta = [formatBytes(file.size), file.expires_at ? formatRemaining(file.expires_at) : formatDate(file.created_at)];
  info.append(name, textElement("small", meta.join(" · ")));

  const actions = document.createElement("div");
  actions.className = "server-file-actions";
  if (!state.local) {
    actions.append(downloadLink(file.name, "Télécharger", "btn btn-secondary btn-small"));
  }
  const remove = textElement("button", "Supprimer", "btn btn-ghost btn-small");
  remove.type = "button";
  remove.setAttribute("aria-label", `Supprimer ${file.name}`);
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Supprimer définitivement « ${file.name} » ?`)) {
      return;
    }
    remove.disabled = true;
    try {
      await apiRequest(`/api/files/${encodeURIComponent(file.name)}`, { method: "DELETE", body: "{}" });
      await loadFiles();
      loadDiagnostics();
    } catch (error) {
      showError(error.message);
      remove.disabled = false;
    }
  });
  actions.append(remove);

  item.append(info, actions);
  return item;
}

async function loadFiles() {
  try {
    const data = await apiRequest("/api/files");
    el.serverFilesList.replaceChildren(...data.files.map(serverFileRow));
    el.serverFilesEmpty.hidden = data.files.length > 0;
    el.serverFilesCount.textContent = data.total_count ? String(data.total_count) : "";
  } catch (error) {
    showError(error.message);
  }
}

function startDownload(name) {
  const link = downloadLink(name, "");
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

/* Link preview */

function renderPreview(status, data) {
  const box = el.linkPreview;
  if (status === "hidden") {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.className = `link-preview link-preview-${status}`;
  if (status === "loading") {
    box.replaceChildren(textElement("span", "", "spinner"), "Recherche du titre…");
  } else if (status === "error") {
    box.replaceChildren(data);
  } else if (data.kind === "playlist") {
    const count = data.count || 0;
    const detail = count === 0
      ? "Playlist vide : rien à télécharger."
      : `Playlist · ${count === 1 ? "1 élément sera téléchargé" : `${count} éléments seront téléchargés`}`;
    box.replaceChildren(textElement("strong", data.title || "Playlist sans titre"), textElement("small", detail));
  } else {
    const meta = [data.uploader, formatDuration(data.duration)].filter(Boolean).join(" · ");
    box.replaceChildren(textElement("strong", data.title || "Sans titre"), textElement("small", meta));
  }
}

function showPreview(data) {
  state.preview = data;
  renderPreview("ready", data);
  renderNameExample();
}

function parseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function isSupportedUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && SUPPORTED_HOST.test(url.hostname));
}

async function loadPreview(url, seq) {
  try {
    const data = await apiRequest("/api/preview", { method: "POST", body: JSON.stringify({ url }) });
    state.previewCache.set(url, data);
    if (seq === state.previewSeq) {
      showPreview(data);
    }
  } catch (error) {
    if (seq === state.previewSeq) {
      renderPreview("error", error.message);
    }
  }
}

function schedulePreview() {
  const url = el.manualUrl.value.trim();
  if (url === state.previewUrl) {
    return;
  }
  window.clearTimeout(state.previewTimer);
  state.previewUrl = url;
  state.previewSeq += 1;
  state.preview = null;
  renderNameExample();

  if (!isSupportedUrl(url)) {
    renderPreview("hidden");
  } else if (state.previewCache.has(url)) {
    showPreview(state.previewCache.get(url));
  } else {
    renderPreview("loading");
    const seq = state.previewSeq;
    state.previewTimer = window.setTimeout(() => loadPreview(url, seq), PREVIEW_DELAY_MS);
  }
}

/* Job tracking */

function parseOutput(lines) {
  const result = { percent: null, size: null, speed: null, eta: null, item: null, total: null, track: null, phase: "prepare", files: [] };
  const files = new Set();

  for (const line of lines) {
    let match;
    if ((match = RE_ITEM.exec(line))) {
      result.item = Number(match[1]);
      result.total = Number(match[2]);
      result.percent = null;
      result.phase = "prepare";
    } else if ((match = RE_DESTINATION.exec(line)) || (match = RE_ALREADY.exec(line))) {
      const name = basename(match[1]);
      result.track = stripExtension(name.replace(RE_INTERMEDIATE, ".x"));
      result.phase = "download";
      if (/\.mp4$/i.test(name) && !RE_INTERMEDIATE.test(name)) {
        files.add(name);
      }
    } else if ((match = RE_PERCENT.exec(line))) {
      result.percent = Number(match[1]);
      result.size = (RE_SIZE.exec(line) || [])[1] || null;
      result.speed = (RE_SPEED.exec(line) || [])[1] || null;
      result.eta = (RE_ETA.exec(line) || [])[1] || null;
      result.phase = "download";
    } else if ((match = RE_EXTRACTED.exec(line))) {
      files.add(basename(match[1]));
      result.track = stripExtension(basename(match[1]));
      result.phase = "convert";
    } else if ((match = RE_MERGER.exec(line)) || (match = RE_REMUX.exec(line))) {
      files.add(basename(match[1]));
      result.track = stripExtension(basename(match[1]));
      result.phase = "merge";
    } else if ((match = RE_NOT_CONVERTED.exec(line)) || (match = RE_PP_EXISTS.exec(line))) {
      files.add(basename(match[1]));
    }
  }
  result.files = Array.from(files);
  return result;
}

function renderProgress(parsed, format) {
  el.progressTrack.textContent = parsed.track || "Préparation…";
  el.progressCount.textContent = parsed.total ? `Élément ${parsed.item} sur ${parsed.total}` : "";

  let percent = 0;
  let indeterminate = false;
  if (parsed.phase === "convert" || parsed.phase === "merge") {
    percent = 100;
    el.progressPercent.textContent = parsed.phase === "merge" ? "Assemblage de l'image et du son en MP4…" : `Conversion en ${formatLabel(format)}…`;
    el.progressSpeed.textContent = "";
  } else if (parsed.phase === "download" && parsed.percent !== null) {
    percent = parsed.percent;
    const size = parsed.size ? ` de ${parsed.size}` : "";
    el.progressPercent.textContent = `${parsed.percent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %${size}`;
    el.progressSpeed.textContent = [parsed.speed, parsed.eta ? `reste ${parsed.eta}` : null].filter(Boolean).join(" · ");
  } else {
    indeterminate = true;
    el.progressPercent.textContent = "Récupération des informations…";
    el.progressSpeed.textContent = "";
  }

  el.progressFill.classList.toggle("indeterminate", indeterminate);
  el.progressFill.style.width = indeterminate ? "" : `${percent}%`;
  el.progressBar.setAttribute("aria-valuenow", String(Math.round(percent)));
}

// While running, names come from yt-dlp's output; once done, the server's list is authoritative and downloadable.
function renderFiles(names, downloadable) {
  el.filesBlock.hidden = names.length === 0;
  el.filesCount.textContent = names.length ? String(names.length) : "";
  el.filesList.replaceChildren(
    ...names.map((name) => {
      const item = document.createElement("li");
      if (downloadable && !state.local) {
        const link = downloadLink(name, name);
        link.title = `Télécharger ${name}`;
        item.append(link);
      } else {
        item.textContent = name;
        item.title = name;
      }
      return item;
    })
  );
}

function lastErrorLine(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith("ERROR:")) {
      return lines[index].replace(/^ERROR:\s*/, "");
    }
  }
  return null;
}

function setOutcome(message, tone) {
  el.jobOutcome.textContent = message;
  el.jobOutcome.className = `outcome-banner outcome-${tone}`;
}

function renderOutcome(data, count) {
  const isUpdate = data.job_type === "update_ytdlp";
  switch (data.status) {
    case "running":
      setOutcome(isUpdate ? "Mise à jour en cours…" : "Téléchargement en cours…", "info");
      break;
    case "success":
      if (isUpdate) {
        setOutcome("Mise à jour terminée.", "success");
      } else if (count) {
        const where = state.local ? "dans le dossier de téléchargement" : ": clique sur un nom pour le télécharger";
        setOutcome(`${count} fichier${count > 1 ? "s" : ""} prêt${count > 1 ? "s" : ""} ${where}.`, "success");
      } else {
        setOutcome("Terminé, mais aucun fichier créé : il dépassait peut-être la taille maximale.", "success");
      }
      break;
    case "error": {
      const detail = lastErrorLine(data.stderr_lines || []);
      setOutcome(detail ? `Échec : ${detail}` : data.error_message || "La tâche a échoué. Regarde les erreurs dans la console.", "error");
      break;
    }
    case "stopped":
      setOutcome("Tâche arrêtée avant la fin.", "warning");
      break;
    default:
      setOutcome("Aucune tâche en cours.", "neutral");
  }
}

function renderLogs(element, lines, emptyText, scrollToEnd) {
  element.textContent = lines.length ? lines.join("\n") : emptyText;
  if (scrollToEnd) {
    element.scrollTop = element.scrollHeight;
  }
}

function onJobFinished(data) {
  if (data.job_type === "update_ytdlp") {
    loadDiagnostics();
    return;
  }
  loadFiles();
  loadDiagnostics();
  // Saves a click for a single file this tab asked for; playlists stay in the list to avoid a burst of downloads.
  if (!state.local && data.status === "success" && state.myJobIds.has(data.job_id) && data.files.length === 1) {
    startDownload(data.files[0]);
  }
}

function renderJob(data) {
  const status = data.status || "idle";
  const running = status === "running";
  const isNewJob = Boolean(data.job_id) && data.job_id !== state.lastJobId;
  const justFinished = state.lastStatus === "running" && !running;
  state.running = running;
  state.lastJobId = data.job_id || state.lastJobId;
  state.lastStatus = status;

  setBadge(el.jobStatusBadge, STATUS_LABELS[status] || status, STATUS_TONES[status] || "neutral");
  el.jobTitle.textContent = data.job_type ? data.title || JOB_TITLES[data.job_type] || data.job_type : "Aucune tâche";
  el.jobSubtitle.textContent = data.job_type ? data.summary || "" : "Lance un téléchargement pour suivre sa progression ici.";

  const stdout = data.stdout_lines || [];
  const stderr = data.stderr_lines || [];
  const parsed = parseOutput(stdout);

  el.jobProgress.hidden = !running || data.job_type === "update_ytdlp";
  if (running) {
    renderProgress(parsed, data.format);
  }
  const files = running ? parsed.files : data.files || [];
  renderOutcome(data, files.length);
  renderFiles(files, !running);

  el.jobStartedAt.textContent = formatDate(data.started_at);
  el.jobFinishedAt.textContent = formatDate(data.finished_at);
  el.jobExitCode.textContent = data.exit_code === null || data.exit_code === undefined ? "—" : String(data.exit_code);
  el.btnStop.hidden = !running;
  document.querySelectorAll("[data-busy-disable]").forEach((button) => {
    button.disabled = running;
  });

  const scrollToEnd = el.autoscroll.checked || isNewJob;
  renderLogs(el.stdoutLogs, stdout, "Aucun journal pour l'instant.", scrollToEnd);
  renderLogs(el.stderrLogs, stderr, "Rien à signaler.", scrollToEnd);
  el.stderrCount.textContent = stderr.length ? String(stderr.length) : "";

  if (justFinished) {
    onJobFinished(data);
  }
}

function setServerDown(down) {
  if (down && !state.serverDown) {
    showError("L'application ne répond plus. Relance-la avec son lanceur (launch.command, launch_windows.bat ou launch.sh), puis recharge la page.");
  } else if (!down && state.serverDown) {
    clearError();
  }
  state.serverDown = down;
}

async function poll() {
  window.clearTimeout(state.pollTimer);
  if (state.quitting) {
    return;
  }
  try {
    renderJob(await apiRequest("/api/job"));
    setServerDown(false);
  } catch {
    setServerDown(true);
  } finally {
    if (!state.quitting) {
      state.pollTimer = window.setTimeout(poll, state.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    }
  }
}

async function quitApp() {
  const losses = [];
  if (state.running) {
    losses.push("le téléchargement en cours sera arrêté");
  }
  if (isProDirty()) {
    losses.push("les réglages non enregistrés seront perdus");
  }
  if (losses.length && !window.confirm(`Fermer l'application ? Attention : ${losses.join(" et ")}.`)) {
    return;
  }
  state.quitting = true;
  window.clearTimeout(state.pollTimer);
  el.btnQuit.disabled = true;
  try {
    await apiRequest("/api/shutdown", { method: "POST", body: "{}" });
  } catch (error) {
    state.quitting = false;
    el.btnQuit.disabled = false;
    showError(`Impossible de fermer l'application : ${error.message}`);
    poll();
    return;
  }
  el.page.hidden = true;
  el.closedScreen.hidden = false;
  document.title = "Wavback (fermée)";
  // Browsers only allow this for tabs opened by the app itself; otherwise the closed screen stays.
  window.close();
}

function rememberJob(data) {
  if (data && data.job_id) {
    state.myJobIds.add(data.job_id);
  }
}

async function runAction(button, url, body, onSuccess) {
  clearError();
  button.disabled = true;
  try {
    const data = await apiRequest(url, { method: "POST", body: JSON.stringify(body || {}) });
    showSuccess(data.message);
    if (onSuccess) {
      onSuccess(data);
    }
    await poll();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = state.running && button.hasAttribute("data-busy-disable");
  }
}

/* Pro mode */

function isProDirty() {
  return Boolean(state.pro.draft) && JSON.stringify(state.pro.draft) !== JSON.stringify(state.pro.saved);
}

function updateProDirty() {
  const dirty = isProDirty();
  el.proDirty.hidden = !dirty;
  el.btnProSave.disabled = !dirty;
  el.btnProCancel.disabled = !dirty;
}

function renderProFields(container, fields, values) {
  container.replaceChildren(
    ...fields.map((field) => {
      const wrapper = document.createElement("div");
      wrapper.className = "pro-field";
      const labelId = `pro-label-${field.key}`;
      const label = textElement("span", field.label, "field-label");
      label.id = labelId;
      const group = buildSegmented(`pro-${field.key}`, field.choices, values[field.key], (value) => {
        values[field.key] = value;
        updateProDirty();
      }, "segmented-auto segmented-compact");
      group.setAttribute("aria-labelledby", labelId);
      wrapper.append(label, group);
      return wrapper;
    })
  );
}

function playlistRow(playlist, index, playlists) {
  const row = document.createElement("div");
  row.className = "pro-playlist";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "pl-name";
  name.maxLength = 40;
  name.placeholder = "Nom du bouton";
  name.value = playlist.label;
  name.setAttribute("aria-label", `Nom du bouton de la playlist ${index + 1}`);
  name.addEventListener("input", () => {
    playlist.label = name.value;
    updateProDirty();
  });

  const url = document.createElement("input");
  url.type = "url";
  url.className = "pl-url";
  url.placeholder = "https://soundcloud.com/… ou https://www.youtube.com/playlist?list=…";
  url.value = playlist.url;
  url.setAttribute("aria-label", `Lien de la playlist ${index + 1}`);
  url.addEventListener("input", () => {
    playlist.url = url.value;
    updateProDirty();
  });

  const style = document.createElement("select");
  style.className = "pl-style";
  style.setAttribute("aria-label", `Nom des fichiers de la playlist ${index + 1}`);
  PLAYLIST_NAME_STYLES.forEach(([value, text]) => {
    const option = textElement("option", text);
    option.value = value;
    style.append(option);
  });
  style.value = playlist.name_style;
  style.addEventListener("change", () => {
    playlist.name_style = style.value;
    updateProDirty();
  });

  const remove = textElement("button", "Retirer", "btn btn-ghost btn-small pl-remove");
  remove.type = "button";
  remove.setAttribute("aria-label", `Retirer la playlist ${playlist.label || index + 1}`);
  remove.addEventListener("click", () => {
    playlists.splice(index, 1);
    renderProPlaylists();
    updateProDirty();
  });

  row.append(name, url, style, remove);
  return row;
}

function renderProPlaylists() {
  const playlists = state.pro.draft.playlists;
  if (playlists.length) {
    el.proPlaylists.replaceChildren(...playlists.map((playlist, index) => playlistRow(playlist, index, playlists)));
  } else {
    el.proPlaylists.replaceChildren(textElement("p", "Aucune playlist enregistrée.", "pro-help"));
  }
  el.btnAddPlaylist.disabled = playlists.length >= MAX_PLAYLISTS;
}

function renderProForm() {
  el.proLoading.hidden = true;
  el.proForm.hidden = false;
  el.proError.hidden = true;
  renderProFields(el.proAudio, PRO_AUDIO_FIELDS, state.pro.draft.audio);
  renderProFields(el.proVideo, PRO_VIDEO_FIELDS, state.pro.draft.video);
  el.proOutputDir.value = state.pro.draft.output_dir;
  renderProPlaylists();
  updateProDirty();
}

function applySettingsResponse(data) {
  state.pro.saved = data.settings;
  state.pro.defaults = data.defaults;
  state.pro.draft = clone(data.settings);
}

async function setProMode(on, scroll) {
  el.proCard.hidden = !on;
  el.chipPro.hidden = !on;
  el.proTip.hidden = on;
  el.btnPro.setAttribute("aria-pressed", String(on));
  el.btnPro.textContent = on ? "Quitter le mode pro" : "Mode pro";
  store(STORAGE_KEYS.pro, String(on));
  if (!on) {
    return;
  }
  if (scroll) {
    el.proCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (!state.pro.draft) {
    try {
      applySettingsResponse(await apiRequest("/api/settings"));
      renderProForm();
    } catch (error) {
      el.proLoading.textContent = `Impossible de charger les réglages : ${error.message}`;
    }
  }
}

async function pickOutputFolder() {
  el.proError.hidden = true;
  el.btnPickFolder.disabled = true;
  try {
    const data = await apiRequest("/api/pick-folder", { method: "POST", body: JSON.stringify({ initial_dir: state.pro.draft.output_dir }) });
    if (data.path) {
      state.pro.draft.output_dir = data.path;
      el.proOutputDir.value = data.path;
      updateProDirty();
    }
  } catch (error) {
    el.proError.textContent = error.message;
    el.proError.hidden = false;
    el.proOutputDir.focus();
  } finally {
    el.btnPickFolder.disabled = false;
  }
}

async function saveProSettings() {
  el.proError.hidden = true;
  el.btnProSave.disabled = true;
  try {
    const data = await apiRequest("/api/settings", { method: "PUT", body: JSON.stringify(state.pro.draft) });
    applySettingsResponse(data);
    renderProForm();
    await loadConfig();
    loadFiles();
    loadDiagnostics();
    showSuccess("Réglages enregistrés.");
  } catch (error) {
    el.proError.textContent = error.message;
    el.proError.hidden = false;
    updateProDirty();
  }
}

/* Events */

el.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const submit = el.form.querySelector("button[type=submit]");
  const url = parseUrl(el.manualUrl.value.trim());
  if (isVideoFormat(state.selectedFormat) && url && !YOUTUBE_HOST.test(url.hostname)) {
    showError("La vidéo MP4 n'est disponible que pour les liens YouTube. Choisis un format audio pour SoundCloud.");
    return;
  }
  const payload = {
    url: el.manualUrl.value,
    format: state.selectedFormat,
    include_uploader: selectedNameStyle() === "uploader",
  };
  runAction(submit, "/api/download/manual", payload, (data) => {
    rememberJob(data);
    el.manualUrl.value = "";
    schedulePreview();
  });
});

el.manualUrl.addEventListener("input", schedulePreview);

el.nameStyleInputs.forEach((input) => {
  input.addEventListener("change", () => {
    store(STORAGE_KEYS.uploader, String(selectedNameStyle() === "uploader"));
    renderNameExample();
  });
});

el.btnStop.addEventListener("click", () => runAction(el.btnStop, "/api/job/stop"));
el.btnQuit.addEventListener("click", quitApp);
el.btnOpenFolder.addEventListener("click", () => runAction(el.btnOpenFolder, "/api/open-download-folder"));
el.btnPickFolder.addEventListener("click", pickOutputFolder);
el.proOutputDir.addEventListener("input", () => {
  state.pro.draft.output_dir = el.proOutputDir.value;
  updateProDirty();
});
el.btnUpdate.addEventListener("click", () => runAction(el.btnUpdate, "/api/update-ytdlp"));
el.btnRefreshFiles.addEventListener("click", loadFiles);

el.btnDiagnostics.addEventListener("click", async () => {
  clearError();
  el.btnDiagnostics.disabled = true;
  if (await loadDiagnostics()) {
    showSuccess("Diagnostic à jour.");
  }
  el.btnDiagnostics.disabled = false;
});

el.healthLink.addEventListener("click", () => {
  el.settings.open = true;
});

el.btnPro.addEventListener("click", () => setProMode(el.proCard.hidden, true));
el.btnProClose.addEventListener("click", () => setProMode(false));
el.btnProTip.addEventListener("click", () => setProMode(true, true));

el.btnAddPlaylist.addEventListener("click", () => {
  state.pro.draft.playlists.push({ id: null, label: "", url: "", name_style: "title" });
  renderProPlaylists();
  updateProDirty();
  const inputs = el.proPlaylists.querySelectorAll("input[type=text]");
  inputs[inputs.length - 1].focus();
});

el.btnProDefaults.addEventListener("click", () => {
  if (!state.pro.defaults) {
    return;
  }
  state.pro.draft = clone(state.pro.defaults);
  renderProForm();
});

el.btnProCancel.addEventListener("click", () => {
  if (!state.pro.saved) {
    return;
  }
  state.pro.draft = clone(state.pro.saved);
  renderProForm();
});

el.btnProSave.addEventListener("click", saveProSettings);

window.addEventListener("beforeunload", (event) => {
  if (isProDirty()) {
    event.preventDefault();
  }
});

async function initialize() {
  updateProDirty();
  const storedStyle = readStored(STORAGE_KEYS.uploader) === "true" ? "uploader" : "title";
  el.nameStyleInputs.forEach((input) => {
    input.checked = input.value === storedStyle;
  });
  renderNameExample();
  try {
    await loadConfig();
  } catch (error) {
    showError(error.message);
  }
  loadDiagnostics();
  loadFiles();
  window.setInterval(loadFiles, FILES_REFRESH_MS);
  poll();
  if (readStored(STORAGE_KEYS.pro) === "true") {
    setProMode(true, false);
  }
}

initialize();
