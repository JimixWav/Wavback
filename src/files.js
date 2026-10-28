"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ApiError } = require("./errors");

const PARTIAL_FILE = /\.(part|ytdl|temp|tmp)$|\.part-Frag\d+$|\.f\d+\.[a-z0-9]+$/i;
const CONTENT_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".opus": "audio/ogg",
};
// Lines in which yt-dlp names a file it created, kept or skipped.
const OUTPUT_PATTERNS = [
  /^\[download\] Destination: (.+)$/,
  /^\[download\] (.+) has already been downloaded/,
  /^\[ExtractAudio\] Destination: (.+)$/,
  /^\[ExtractAudio\] Not converting audio (.+?); file is already in target format/,
  /^\[Merger\] Merging formats into "(.+)"$/,
  /^\[VideoRemuxer\] Remuxing video from \S+ to \S+; Destination: (.+)$/,
  /Post-process file (.+) exists, skipping/,
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isPartial(name) {
  return PARTIAL_FILE.test(name) || name.startsWith(".");
}

// ctime cannot be set back by yt-dlp or ffmpeg (unlike mtime), so the newest of the two is a safe "last written" date.
function lastWritten(stat) {
  return Math.max(stat.mtimeMs, stat.ctimeMs);
}

const MAX_LISTED = 100;

/** Files in the download folder, newest first. `expiry(fullPath)` gives the planned deletion date, or null. */
function listFiles(dir, expiry = () => null) {
  ensureDir(dir);
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || isPartial(entry.name)) {
      continue;
    }
    try {
      const full = path.join(dir, entry.name);
      const stat = fs.statSync(full);
      const written = lastWritten(stat);
      files.push({
        name: entry.name,
        size: stat.size,
        created_at: new Date(written).toISOString(),
        expires_at: expiry(full),
      });
    } catch {
      // Deleted in between by the cleanup.
    }
  }
  files.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { files: files.slice(0, MAX_LISTED), total_count: files.length, total_bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

function snapshotNames(dir) {
  try {
    return new Set(fs.readdirSync(ensureDir(dir)));
  } catch {
    return new Set();
  }
}

/**
 * Files of a finished job: new files in the folder, plus files yt-dlp skipped because they were already there.
 * Skipped files are touched so the cleanup gives them a fresh two hours.
 */
function collectJobFiles(dir, before, stdoutLines) {
  const names = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (!before.has(name)) {
      names.add(name);
    }
  }
  for (const line of stdoutLines) {
    for (const pattern of OUTPUT_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        names.add(path.basename(match[1]));
        break;
      }
    }
  }
  const now = new Date();
  const files = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if (isPartial(name) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      continue;
    }
    if (before.has(name)) {
      try {
        fs.utimesSync(full, now, now);
      } catch {
        // Not critical: the file just keeps its original expiry.
      }
    }
    files.push(name);
  }
  return files.sort((a, b) => a.localeCompare(b, "fr"));
}

function removePartialFiles(dir, before) {
  for (const name of fs.readdirSync(dir)) {
    if (!before.has(name) && isPartial(name)) {
      fs.rmSync(path.join(dir, name), { force: true, recursive: true });
    }
  }
}

function resolveDownload(dir, rawName) {
  const name = String(rawName || "");
  if (!name || name !== path.basename(name) || name.startsWith(".") || isPartial(name)) {
    throw new ApiError("Fichier introuvable.", 404);
  }
  const full = path.join(dir, name);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new ApiError("Ce fichier n'existe plus dans le dossier de téléchargement.", 404);
  }
  if (!stat.isFile()) {
    throw new ApiError("Fichier introuvable.", 404);
  }
  return { name, full, stat };
}

function contentDisposition(name) {
  const fallback = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sendFile(res, dir, rawName, method = "GET") {
  const { name, full, stat } = resolveDownload(dir, rawName);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
    "Content-Disposition": contentDisposition(name),
    "Cache-Control": "private, no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(full);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function deleteFile(dir, rawName) {
  const { full } = resolveDownload(dir, rawName);
  fs.rmSync(full, { force: true });
  return full;
}

module.exports = {
  ensureDir,
  listFiles,
  snapshotNames,
  collectJobFiles,
  removePartialFiles,
  sendFile,
  deleteFile,
  lastWritten,
};
