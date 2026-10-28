"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { registerFiles } = require("./cleanup");
const { ApiError } = require("./errors");
const { collectJobFiles, ensureDir, removePartialFiles, snapshotNames } = require("./files");
const { formatFlags, formatOptions, isVideo } = require("./formats");
const { downloadsDir, getSettings } = require("./settings-store");
const { appState } = require("./state");
const { isYouTubeUrl, validateSupportedMediaUrl } = require("./validators");
const { describeSpawnError, runYtDlp } = require("./ytdlp");

function assertDownloadsDirReady(config) {
  let dir;
  try {
    dir = ensureDir(downloadsDir(config));
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new ApiError("Impossible d'écrire dans le dossier de téléchargement. Choisis-en un autre dans le Mode pro.", 400);
  }
  return dir;
}

function buildDownloadFlags(config, settings, format, nameStyle, dir) {
  const flags = {
    ...formatFlags(format, settings),
    newline: true,
    // Files are dated from the download, not from the video's upload day.
    noMtime: true,
    // Names that stay valid once the file is saved on Windows.
    windowsFilenames: true,
    output: path.join(dir, config.nameTemplate(nameStyle)),
  };
  if (config.downloads.max_filesize) {
    flags.maxFilesize = String(config.downloads.max_filesize);
  }
  return flags;
}

async function runDownloadJob(config, url, flags, label, dir) {
  const before = snapshotNames(dir);
  const { code, signal, error } = await runYtDlp(config, url, flags, {
    onStdout: (line) => appState.appendStdout(line),
    onStderr: (line) => appState.appendStderr(line),
    onSpawn: (child) => appState.setChild(child),
  });

  const stdout = appState.snapshot().stdout_lines;
  let files = [];
  try {
    files = collectJobFiles(dir, before, stdout);
    registerFiles(config, dir, files);
    if (code !== 0) {
      removePartialFiles(dir, before);
    }
  } catch (collectError) {
    console.error(`[download] ${collectError.message}`);
  }

  if (error && !signal) {
    appState.finishJob({
      status: "error",
      exitCode: null,
      errorMessage: describeSpawnError(error),
      summary: `${label} : yt-dlp n'a pas pu démarrer.`,
    });
    return;
  }
  if (code === 0) {
    appState.finishJob({ status: "success", exitCode: 0, summary: `${label} : terminé.`, files });
    return;
  }
  const stopped = appState.stopRequested || Boolean(signal);
  appState.finishJob({
    status: stopped ? "stopped" : "error",
    exitCode: code ?? null,
    errorMessage: stopped ? "La tâche a été arrêtée." : "yt-dlp a signalé une erreur.",
    summary: stopped ? "Téléchargement arrêté." : `${label} : échec.`,
    files,
  });
}

function startDownloadJob(config, { jobType, title, url, nameStyle, label, format }) {
  const settings = getSettings(config);
  const resolvedFormat = format || config.downloads.default_format;
  const option = formatOptions(settings).find((item) => item.value === resolvedFormat);
  if (!option) {
    throw new ApiError("Format inconnu.", 422);
  }
  if (isVideo(resolvedFormat) && !isYouTubeUrl(url)) {
    throw new ApiError("La vidéo MP4 n'est disponible que pour les liens YouTube. Choisis un format audio pour SoundCloud.", 422);
  }
  const dir = assertDownloadsDirReady(config);
  const flags = buildDownloadFlags(config, settings, resolvedFormat, nameStyle, dir);
  const fullLabel = `${label} en ${option.label}`;
  const jobId = crypto.randomUUID();

  if (!appState.beginJob({ jobId, jobType, summary: `${fullLabel} : en cours.`, format: resolvedFormat, title })) {
    throw new ApiError("Une tâche est déjà en cours. Attends qu'elle se termine ou arrête-la.", 409);
  }
  runDownloadJob(config, url, flags, fullLabel, dir).catch((error) => {
    appState.finishJob({ status: "error", exitCode: null, errorMessage: String(error.message || error), summary: `${fullLabel} : échec.` });
  });
  return jobId;
}

function startPlaylistDownload(config, playlistId, format) {
  const playlist = getSettings(config).playlists.find((item) => item.id === playlistId);
  if (!playlist) {
    throw new ApiError("Cette playlist n'existe plus. Recharge la page.", 404);
  }
  return startDownloadJob(config, {
    jobType: "playlist_download",
    title: playlist.label,
    url: playlist.url,
    nameStyle: playlist.name_style,
    label: playlist.label,
    format,
  });
}

function startManualDownload(config, rawUrl, format, includeUploader) {
  return startDownloadJob(config, {
    jobType: "manual_download",
    title: "Téléchargement d'un lien",
    url: validateSupportedMediaUrl(rawUrl),
    nameStyle: includeUploader ? "uploader_title" : "title",
    label: "Lien",
    format,
  });
}

module.exports = { startManualDownload, startPlaylistDownload, buildDownloadFlags };
