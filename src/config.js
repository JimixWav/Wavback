"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const FORMATS = ["flac", "wav", "mp3", "m4a", "mp4"];
const IS_WINDOWS = process.platform === "win32";

const DEFAULTS = {
  app: { host: "127.0.0.1", port: 8765, open_browser: true },
  auth: { user: "admin", password: "" },
  downloads: {
    dir: "~/Downloads/Wavback",
    youtube_playlist_url: "",
    soundcloud_playlist_url: "",
    name_template_title: "%(title)s.%(ext)s",
    name_template_uploader_title: "%(uploader)s - %(title)s.%(ext)s",
    default_format: "mp3",
    max_filesize: "",
  },
  cleanup: { max_age_minutes: 0, interval_minutes: 10 },
  executables: { yt_dlp: "bin/yt-dlp", ffmpeg_location: "bin/ffmpeg", js_runtime: "node" },
  update: { enabled: true },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Configuration invalide (${path.basename(file)}) : ${error.message}`);
  }
}

function merge(defaults, raw) {
  const result = {};
  for (const [section, values] of Object.entries(defaults)) {
    result[section] = { ...values, ...((raw && typeof raw[section] === "object" && raw[section]) || {}) };
  }
  return result;
}

function expandHome(target) {
  if (target === "~") {
    return os.homedir();
  }
  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return path.join(os.homedir(), target.slice(2));
  }
  return target;
}

function fromRoot(target) {
  const expanded = expandHome(String(target));
  return path.isAbsolute(expanded) ? expanded : path.join(ROOT_DIR, expanded);
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function withExe(file) {
  return IS_WINDOWS && !file.toLowerCase().endsWith(".exe") ? `${file}.exe` : file;
}

// The installer puts yt-dlp in bin/; without it (yt-dlp installed some other way), the one on the PATH is used.
function resolveYtDlp(configured) {
  if (!configured.includes("/") && !configured.includes("\\")) {
    return { path: configured, bundled: false };
  }
  const absolute = withExe(fromRoot(configured));
  return fs.existsSync(absolute) ? { path: absolute, bundled: true } : { path: "yt-dlp", bundled: false };
}

function resolveFfmpeg(configured) {
  if (!configured) {
    return null;
  }
  const absolute = fromRoot(configured);
  return fs.existsSync(absolute) ? absolute : null;
}

function toolInLocation(ffmpegLocation, tool) {
  if (!ffmpegLocation) {
    return tool;
  }
  const dir = fs.statSync(ffmpegLocation).isDirectory() ? ffmpegLocation : path.dirname(ffmpegLocation);
  return withExe(path.join(dir, tool));
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(host).toLowerCase());
}

function loadConfig() {
  // WAVBACK_CONFIG points to another config file; settings and the cleanup list are then kept next to it.
  const configFile = process.env.WAVBACK_CONFIG ? path.resolve(process.env.WAVBACK_CONFIG) : null;
  const raw = configFile
    ? readJson(configFile)
    : readJson(path.join(ROOT_DIR, "config.json")) || readJson(path.join(ROOT_DIR, "config.example.json"));
  const dataDir = configFile ? path.dirname(configFile) : ROOT_DIR;
  const config = merge(DEFAULTS, raw);

  config.app.port = nonNegativeNumber(process.env.PORT, nonNegativeNumber(config.app.port, 8765)) || 8765;
  config.app.host = process.env.HOST || config.app.host || DEFAULTS.app.host;
  config.auth.user = process.env.APP_USER || config.auth.user;
  config.auth.password = process.env.APP_PASSWORD || config.auth.password;
  if (process.env.NO_BROWSER) {
    config.app.open_browser = false;
  }

  if (!FORMATS.includes(config.downloads.default_format)) {
    config.downloads.default_format = DEFAULTS.downloads.default_format;
  }
  // 0 turns the automatic cleanup off: on a personal computer, downloads are kept.
  config.cleanup.max_age_minutes = nonNegativeNumber(config.cleanup.max_age_minutes, 0);
  config.cleanup.interval_minutes = nonNegativeNumber(config.cleanup.interval_minutes, 10) || 10;

  const ytDlp = resolveYtDlp(String(config.executables.yt_dlp || "yt-dlp"));
  const ffmpegLocation = resolveFfmpeg(config.executables.ffmpeg_location);

  config.paths = {
    root: ROOT_DIR,
    defaultDownloads: fromRoot(config.downloads.dir),
    // PyInstaller builds of yt-dlp unpack themselves in TMPDIR; some systems mount /tmp noexec.
    tmp: path.join(ROOT_DIR, "bin", "tmp"),
    data: dataDir,
    settings: path.join(dataDir, "settings.json"),
    ytDlp: ytDlp.path,
    ytDlpBundled: ytDlp.bundled,
    ffmpegLocation,
    ffmpeg: toolInLocation(ffmpegLocation, "ffmpeg"),
    ffprobe: toolInLocation(ffmpegLocation, "ffprobe"),
  };
  config.listensLocallyOnly = isLoopbackHost(config.app.host);
  config.nameTemplate = (style) =>
    style === "uploader_title" ? config.downloads.name_template_uploader_title : config.downloads.name_template_title;
  return config;
}

module.exports = { loadConfig, expandHome, FORMATS, ROOT_DIR, IS_WINDOWS };
