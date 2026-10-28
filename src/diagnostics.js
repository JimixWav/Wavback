"use strict";

const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const readline = require("node:readline");

const { ApiError } = require("./errors");
const { ensureDir, listFiles } = require("./files");
const { downloadsDir } = require("./settings-store");
const { appState } = require("./state");
const { processEnv } = require("./ytdlp");

function probe(config, command, args) {
  return new Promise((resolve) => {
    // A PyInstaller build of yt-dlp can take a few seconds to start the first time.
    execFile(command, args, { timeout: 20_000, env: processEnv(config), windowsHide: true }, (error, stdout, stderr) => {
      const first = String(stdout || stderr || "").trim().split(/\r?\n/)[0] || null;
      resolve({ found: !error, version: error ? null : first });
    });
  });
}

function downloadsStatus(config) {
  const dir = downloadsDir(config);
  let exists = false;
  let writable = false;
  try {
    ensureDir(dir);
    exists = true;
    fs.accessSync(dir, fs.constants.W_OK);
    writable = true;
  } catch {
    // Reported as is.
  }
  const listing = exists ? listFiles(dir) : { total_count: 0, total_bytes: 0 };
  return { path: dir, exists, writable, file_count: listing.total_count, total_bytes: listing.total_bytes };
}

async function buildDiagnostics(config) {
  const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
    probe(config, config.paths.ytDlp, ["--version"]),
    probe(config, config.paths.ffmpeg, ["-version"]),
    probe(config, config.paths.ffprobe, ["-version"]),
  ]);
  const downloads = downloadsStatus(config);
  return {
    yt_dlp: { ...ytDlp, bundled: config.paths.ytDlpBundled },
    ffmpeg: { ...ffmpeg, bundled: Boolean(config.paths.ffmpegLocation) },
    ffprobe,
    js_runtime: config.executables.js_runtime === "node" ? `Node.js ${process.versions.node}` : config.executables.js_runtime || null,
    downloads,
    update_enabled: Boolean(config.update.enabled),
    ready: ytDlp.found && ffmpeg.found && ffprobe.found && downloads.writable,
    checked_at: new Date().toISOString(),
  };
}

function startUpdateJob(config) {
  if (!config.update.enabled) {
    throw new ApiError("La mise à jour de yt-dlp est désactivée dans config.json.", 400);
  }
  const jobId = crypto.randomUUID();
  if (!appState.beginJob({ jobId, jobType: "update_ytdlp", summary: "Mise à jour de yt-dlp : en cours.", title: "Mise à jour de yt-dlp" })) {
    throw new ApiError("Une tâche est déjà en cours. Attends qu'elle se termine ou arrête-la.", 409);
  }

  let finished = false;
  const finish = (fields) => {
    if (!finished) {
      finished = true;
      appState.finishJob(fields);
    }
  };
  const child = spawn(config.paths.ytDlp, ["--update"], { env: processEnv(config), detached: process.platform !== "win32" });
  appState.setChild(child);
  readline.createInterface({ input: child.stdout }).on("line", (line) => appState.appendStdout(line));
  readline.createInterface({ input: child.stderr }).on("line", (line) => appState.appendStderr(line));
  child.on("error", (error) =>
    finish({ status: "error", exitCode: null, errorMessage: `Impossible de lancer la mise à jour : ${error.message}`, summary: "La mise à jour de yt-dlp n'a pas pu démarrer." })
  );
  child.on("close", (code, signal) => {
    if (code === 0) {
      finish({ status: "success", exitCode: 0, summary: "Mise à jour de yt-dlp terminée." });
      return;
    }
    const stopped = appState.stopRequested || Boolean(signal);
    finish({
      status: stopped ? "stopped" : "error",
      exitCode: code,
      errorMessage: stopped ? "La mise à jour a été arrêtée." : "La mise à jour a échoué.",
      summary: stopped ? "Mise à jour arrêtée." : "Mise à jour de yt-dlp échouée.",
    });
  });
  return jobId;
}

module.exports = { buildDiagnostics, startUpdateJob };
