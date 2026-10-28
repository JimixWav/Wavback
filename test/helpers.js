"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** A temporary folder with a config.json, so tests never read or write the real settings. */
function tempConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavback-test-"));
  const downloads = path.join(dir, "downloads");
  const config = {
    app: { host: "127.0.0.1", port: 8765, open_browser: false },
    downloads: { dir: downloads },
    executables: { yt_dlp: path.join(__dirname, "fixtures", "fake-yt-dlp.js"), ffmpeg_location: "" },
    ...overrides,
  };
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(config));
  return { dir, downloads, file };
}

module.exports = { tempConfig };
