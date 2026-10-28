"use strict";

const { ApiError } = require("./errors");

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);

function parse(rawUrl) {
  const url = String(rawUrl ?? "").trim();
  if (!url) {
    throw new ApiError("Colle un lien avant de lancer le téléchargement.", 422);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError("Ce lien n'est pas valide.", 422);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError("Seuls les liens http et https sont acceptés.", 422);
  }
  return { url, host: parsed.hostname.toLowerCase() };
}

function validateSupportedMediaUrl(rawUrl) {
  const { url, host } = parse(rawUrl);
  if (!YOUTUBE_HOSTS.has(host) && !SOUNDCLOUD_HOSTS.has(host)) {
    throw new ApiError("Seuls les liens YouTube et SoundCloud sont acceptés.", 422);
  }
  return url;
}

function isYouTubeUrl(url) {
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

module.exports = { validateSupportedMediaUrl, isYouTubeUrl };
