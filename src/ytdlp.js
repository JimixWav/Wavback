"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const readline = require("node:readline");

const { killTree } = require("./system");

function kebab(key) {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Turns { extractAudio: true, audioFormat: "mp3", print: ["a", "b"] }
 * into ["--extract-audio", "--audio-format", "mp3", "--print", "a", "--print", "b"].
 * Every value is its own argument and no shell is involved, so titles and paths never need escaping.
 */
function toArgs(flags) {
  const args = [];
  for (const [key, value] of Object.entries(flags)) {
    const flag = `--${kebab(key)}`;
    if (value === true) {
      args.push(flag);
    } else if (value === false) {
      args.push(`--no-${kebab(key)}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        args.push(flag, String(item));
      }
    } else if (value !== undefined && value !== null && value !== "") {
      args.push(flag, String(value));
    }
  }
  return args;
}

function processEnv(config) {
  fs.mkdirSync(config.paths.tmp, { recursive: true });
  return { ...process.env, TMPDIR: config.paths.tmp, TEMP: config.paths.tmp, TMP: config.paths.tmp, PYTHONIOENCODING: "utf-8" };
}

function baseFlags(config) {
  const flags = { ignoreConfig: true, encoding: "utf-8" };
  if (config.paths.ffmpegLocation) {
    flags.ffmpegLocation = config.paths.ffmpegLocation;
  }
  // YouTube needs a JavaScript runtime since late 2025. Node 22+ is supported, and it is already running this app.
  if (config.executables.js_runtime === "node") {
    flags.jsRuntimes = `node:${process.execPath}`;
  } else if (config.executables.js_runtime) {
    flags.jsRuntimes = config.executables.js_runtime;
  }
  return flags;
}

function eachLine(stream, onLine) {
  if (stream) {
    readline.createInterface({ input: stream, crlfDelay: Infinity }).on("line", onLine);
  }
}

/**
 * Runs yt-dlp and streams its output line by line.
 * Resolves once the process has exited: { code, signal, error }.
 */
function runYtDlp(config, url, flags, { onStdout, onStderr, onSpawn, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    let child;
    try {
      child = spawn(config.paths.ytDlp, [...toArgs({ ...baseFlags(config), ...flags }), "--", url], {
        env: processEnv(config),
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      finish({ code: null, signal: null, error });
      return;
    }

    eachLine(child.stdout, (line) => onStdout?.(line));
    eachLine(child.stderr, (line) => onStderr?.(line));
    child.on("error", (error) => finish({ code: null, signal: null, error }));
    child.on("close", (code, signal) => finish({ code, signal, error: null }));
    onSpawn?.(child);

    if (timeoutMs) {
      timer = setTimeout(() => {
        killTree(child, "SIGKILL");
        finish({ code: null, signal: "SIGKILL", error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
      }, timeoutMs);
    }
  });
}

function describeSpawnError(error) {
  if (error?.code === "ENOENT") {
    return "yt-dlp est introuvable. Relance l'application avec son lanceur : il installe ce qui manque.";
  }
  if (error?.code === "EACCES") {
    return "yt-dlp n'est pas exécutable. Relance l'application avec son lanceur.";
  }
  return `Impossible de lancer yt-dlp : ${error?.message || error}`;
}

module.exports = { runYtDlp, processEnv, describeSpawnError, toArgs };
