"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { expandHome } = require("./config");
const { ApiError } = require("./errors");
const { VIDEO_HEIGHTS } = require("./formats");
const { validateSupportedMediaUrl } = require("./validators");

const MAX_PLAYLISTS = 10;
const CHOICES = {
  mp3_bitrate: ["128", "160", "192", "256", "320", "v0"],
  aac_bitrate: ["128", "192", "256", "320"],
  flac_bit_depth: [16, 24],
  wav_bit_depth: [16, 24],
  sample_rate: ["source", "44100", "48000"],
};
const NAME_STYLES = ["title", "uploader_title"];
const DEFAULT_AUDIO = { mp3_bitrate: "320", aac_bitrate: "256", flac_bit_depth: 16, wav_bit_depth: 16, sample_rate: "source" };
const DEFAULT_VIDEO = { max_height: "1080" };

let cached = null;

function defaultSettings(config) {
  const { youtube_playlist_url: youtube, soundcloud_playlist_url: soundcloud } = config.downloads;
  const playlists = [
    { id: "youtube", label: "Playlist YouTube", url: youtube, name_style: "title" },
    { id: "soundcloud", label: "Playlist SoundCloud", url: soundcloud, name_style: "uploader_title" },
  ].filter((playlist) => playlist.url);
  return { output_dir: config.paths.defaultDownloads, audio: { ...DEFAULT_AUDIO }, video: { ...DEFAULT_VIDEO }, playlists };
}

function pick(value, allowed, fallback) {
  const match = allowed.find((choice) => String(choice) === String(value));
  return match === undefined ? fallback : match;
}

// Lenient: used for a file on disk, so a hand-edited value falls back instead of breaking the app.
function normalize(raw, config) {
  const defaults = defaultSettings(config);
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const audio = {};
  for (const [key, allowed] of Object.entries(CHOICES)) {
    audio[key] = pick(raw.audio?.[key], allowed, DEFAULT_AUDIO[key]);
  }
  const video = { max_height: pick(raw.video?.max_height, VIDEO_HEIGHTS, DEFAULT_VIDEO.max_height) };
  const playlists = Array.isArray(raw.playlists)
    ? raw.playlists.slice(0, MAX_PLAYLISTS).filter((item) => item && typeof item.url === "string" && typeof item.label === "string")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id.slice(0, 32) : null,
        label: item.label.slice(0, 40),
        url: item.url.slice(0, 2048),
        name_style: pick(item.name_style, NAME_STYLES, "title"),
      }))
    : defaults.playlists;
  const outputDir = typeof raw.output_dir === "string" && raw.output_dir.trim() ? raw.output_dir.trim().slice(0, 400) : defaults.output_dir;
  return { output_dir: outputDir, audio, video, playlists };
}

function getSettings(config) {
  if (!cached) {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(config.paths.settings, "utf8"));
    } catch {
      // Missing or corrupted file: start again from the defaults instead of crashing.
    }
    cached = normalize(raw, config);
  }
  return cached;
}

function downloadsDir(config) {
  return path.resolve(expandHome(getSettings(config).output_dir));
}

function validateOutputDir(raw) {
  const value = String(raw ?? "").trim().slice(0, 400);
  if (!value) {
    throw new ApiError("Indique un dossier de téléchargement.", 422);
  }
  const dir = expandHome(value);
  if (!path.isAbsolute(dir)) {
    throw new ApiError("Le dossier de téléchargement doit être un chemin complet, par exemple /Users/toi/Music ou C:\\Users\\toi\\Music.", 422);
  }
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
    throw new ApiError("Ce chemin désigne un fichier, pas un dossier.", 422);
  }
  return path.resolve(dir);
}

// Strict: used for what the browser sends, so every mistake gets a clear message.
function validate(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError("Réglages manquants.", 422);
  }
  const outputDir = validateOutputDir(payload.output_dir);
  const audio = {};
  for (const [key, allowed] of Object.entries(CHOICES)) {
    const value = pick(payload.audio?.[key], allowed, undefined);
    if (value === undefined) {
      throw new ApiError(`Valeur non autorisée pour ${key}.`, 422);
    }
    audio[key] = value;
  }
  const maxHeight = pick(payload.video?.max_height, VIDEO_HEIGHTS, undefined);
  if (maxHeight === undefined) {
    throw new ApiError("Résolution vidéo non autorisée.", 422);
  }

  const rawPlaylists = Array.isArray(payload.playlists) ? payload.playlists : [];
  if (rawPlaylists.length > MAX_PLAYLISTS) {
    throw new ApiError(`${MAX_PLAYLISTS} playlists au maximum.`, 422);
  }
  const seen = new Set();
  const playlists = rawPlaylists.map((playlist, index) => {
    const label = String(playlist?.label ?? "").trim().slice(0, 40);
    if (!label) {
      throw new ApiError(`La playlist n°${index + 1} n'a pas de nom de bouton.`, 422);
    }
    let url;
    try {
      url = validateSupportedMediaUrl(String(playlist?.url ?? "").slice(0, 2048));
    } catch (error) {
      throw new ApiError(`Playlist « ${label} » : ${error.detail}`, 422);
    }
    const wanted = typeof playlist.id === "string" ? playlist.id.slice(0, 32) : "";
    const id = wanted && !seen.has(wanted) ? wanted : crypto.randomBytes(4).toString("hex");
    seen.add(id);
    return { id, label, url, name_style: pick(playlist.name_style, NAME_STYLES, "title") };
  });
  return { output_dir: outputDir, audio, video: { max_height: maxHeight }, playlists };
}

function saveSettings(config, payload) {
  const cleaned = validate(payload);
  const tempPath = `${config.paths.settings}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(cleaned, null, 2), "utf8");
    fs.renameSync(tempPath, config.paths.settings);
  } catch (error) {
    throw new ApiError(`Impossible d'enregistrer les réglages : ${error.message}`, 500);
  }
  cached = cleaned;
  return cleaned;
}

module.exports = { getSettings, saveSettings, defaultSettings, downloadsDir };
