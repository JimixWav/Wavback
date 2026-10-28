"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { appState } = require("./state");

/*
 * Optional automatic cleanup (cleanup.max_age_minutes > 0), meant for a shared machine such as a Raspberry Pi.
 * Only files created by this app are tracked and deleted, never anything else the download folder may contain.
 * The list lives in cleanup-registry.json so it survives restarts.
 */

let registry = null;

function registryPath(config) {
  return path.join(config.paths.data, "cleanup-registry.json");
}

function load(config) {
  if (!registry) {
    try {
      registry = JSON.parse(fs.readFileSync(registryPath(config), "utf8"));
    } catch {
      registry = {};
    }
  }
  return registry;
}

function save(config) {
  try {
    fs.writeFileSync(registryPath(config), JSON.stringify(registry, null, 2), "utf8");
  } catch (error) {
    console.error(`[cleanup] Impossible d'enregistrer la liste des fichiers : ${error.message}`);
  }
}

function isEnabled(config) {
  return config.cleanup.max_age_minutes > 0;
}

/** Records (or refreshes) files produced by a job. */
function registerFiles(config, dir, names) {
  if (!isEnabled(config) || !names.length) {
    return;
  }
  const entries = load(config);
  const now = Date.now();
  for (const name of names) {
    entries[path.join(dir, name)] = now;
  }
  save(config);
}

function expiryFor(config, fullPath) {
  if (!isEnabled(config)) {
    return null;
  }
  const created = load(config)[fullPath];
  return created ? new Date(created + config.cleanup.max_age_minutes * 60_000).toISOString() : null;
}

function forget(config, fullPath) {
  const entries = load(config);
  if (fullPath in entries) {
    delete entries[fullPath];
    save(config);
  }
}

/** Deletes tracked files older than the limit. Returns { deleted, freedBytes }. */
function sweepRegistered(config, now = Date.now()) {
  const entries = load(config);
  const maxAgeMs = config.cleanup.max_age_minutes * 60_000;
  const result = { deleted: 0, freedBytes: 0 };
  let changed = false;
  for (const [file, created] of Object.entries(entries)) {
    if (now - created <= maxAgeMs) {
      continue;
    }
    try {
      const stat = fs.statSync(file);
      fs.rmSync(file, { force: true });
      result.deleted += 1;
      result.freedBytes += stat.size;
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(`[cleanup] ${file} : ${error.message}`);
        continue;
      }
    }
    delete entries[file];
    changed = true;
  }
  if (changed) {
    save(config);
  }
  return result;
}

/** Deletes everything older than maxAgeMs in a folder owned by the app (bin/tmp). */
function sweepOwnedDir(dir, maxAgeMs, now = Date.now()) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      const stat = fs.lstatSync(full);
      if (now - Math.max(stat.mtimeMs, stat.ctimeMs) > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // In use or already gone.
    }
  }
}

function formatBytes(bytes) {
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function runCleanup(config) {
  // Wait for the next round rather than racing a running download.
  if (appState.isRunning()) {
    return null;
  }
  sweepOwnedDir(config.paths.tmp, 24 * 60 * 60_000);
  if (!isEnabled(config)) {
    return null;
  }
  const result = sweepRegistered(config);
  if (result.deleted) {
    console.log(`[cleanup] ${result.deleted} fichier(s) supprimé(s), ${formatBytes(result.freedBytes)} libérés.`);
  }
  return result;
}

function startCleanup(config) {
  runCleanup(config);
  const timer = setInterval(() => runCleanup(config), config.cleanup.interval_minutes * 60_000);
  timer.unref();
  if (isEnabled(config)) {
    console.log(
      `[cleanup] Fichiers téléchargés supprimés après ${config.cleanup.max_age_minutes} min (vérification toutes les ${config.cleanup.interval_minutes} min).`
    );
  }
  return timer;
}

module.exports = { startCleanup, runCleanup, registerFiles, expiryFor, forget, sweepRegistered, sweepOwnedDir, isEnabled };
