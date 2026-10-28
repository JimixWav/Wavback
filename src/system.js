"use strict";

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ApiError } = require("./errors");

const PICKER_TITLE = "Choisis le dossier de téléchargement";
const PICKER_TIMEOUT_MS = 10 * 60_000;

// macOS: native dialog through AppleScript, no extra software needed.
const MACOS_PICKER = `
on run argv
    activate
    set chosen to choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv))
    return POSIX path of chosen
end run
`;
const MACOS_USER_CANCELED = "-128";

// Windows: the standard folder dialog through PowerShell; paths travel through environment variables to avoid quoting issues.
const WINDOWS_PICKER = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:PICKER_TITLE
$dialog.SelectedPath = $env:PICKER_START
$dialog.ShowNewFolderButton = $true
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.Write($dialog.SelectedPath)
}
`;

let pickerOpen = false;

function detached(command, args) {
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function openUrl(url) {
  if (process.platform === "darwin") {
    return detached("open", [url]);
  }
  if (process.platform === "win32") {
    return detached("rundll32", ["url.dll,FileProtocolHandler", url]);
  }
  return process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? detached("xdg-open", [url]) : false;
}

function openFolder(dir) {
  if (!fs.existsSync(dir)) {
    throw new ApiError("Le dossier de téléchargement n'existe pas.", 400);
  }
  const ok = process.platform === "darwin"
    ? detached("open", [dir])
    : process.platform === "win32"
      ? detached("explorer.exe", [dir])
      : (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && detached("xdg-open", [dir]);
  if (!ok) {
    throw new ApiError("Impossible d'ouvrir le dossier sur cet ordinateur.", 501);
  }
}

function closestExistingDir(raw) {
  let start = raw ? path.resolve(raw) : os.homedir();
  while (!fs.existsSync(start) && path.dirname(start) !== start) {
    start = path.dirname(start);
  }
  return fs.existsSync(start) ? start : os.homedir();
}

function pickerCommand(startDir) {
  if (process.platform === "darwin") {
    return { command: "osascript", args: ["-e", MACOS_PICKER, startDir, PICKER_TITLE], env: process.env };
  }
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_PICKER],
      env: { ...process.env, PICKER_TITLE, PICKER_START: startDir },
    };
  }
  return {
    command: "zenity",
    args: ["--file-selection", "--directory", `--title=${PICKER_TITLE}`, `--filename=${startDir}/`],
    env: process.env,
  };
}

function pickFolder(initialDir) {
  if (pickerOpen) {
    return Promise.reject(new ApiError("La fenêtre de sélection du dossier est déjà ouverte.", 409));
  }
  const { command, args, env } = pickerCommand(closestExistingDir(initialDir));
  pickerOpen = true;
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: PICKER_TIMEOUT_MS, windowsHide: false, encoding: "utf8" }, (error, stdout, stderr) => {
      pickerOpen = false;
      const chosen = String(stdout || "").trim();
      if (error) {
        // Cancel: AppleScript error -128, zenity exit code 1.
        if (String(stderr).includes(MACOS_USER_CANCELED) || (process.platform === "linux" && error.code === 1)) {
          resolve(null);
          return;
        }
        reject(new ApiError("Impossible d'ouvrir la fenêtre de sélection. Saisis le chemin à la main.", 501));
        return;
      }
      resolve(chosen ? path.resolve(chosen) : null);
    });
  });
}

// yt-dlp runs in its own process group (POSIX) so ffmpeg, its child, is stopped along with it.
function killTree(child, signal = "SIGTERM") {
  if (!child?.pid) {
    return;
  }
  if (process.platform === "win32") {
    detached("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // Not a group leader or already gone: fall back to the process itself.
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
}

module.exports = { openUrl, openFolder, pickFolder, killTree };
