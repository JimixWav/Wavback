"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { version } = require("./package.json");
const { expiryFor, forget, isEnabled: cleanupEnabled, startCleanup } = require("./src/cleanup");
const { loadConfig } = require("./src/config");
const { buildDiagnostics, startUpdateJob } = require("./src/diagnostics");
const { startManualDownload, startPlaylistDownload } = require("./src/downloader");
const { ApiError } = require("./src/errors");
const { deleteFile, ensureDir, listFiles, sendFile } = require("./src/files");
const { formatOptions } = require("./src/formats");
const { fetchLinkPreview } = require("./src/preview");
const { defaultSettings, downloadsDir, getSettings, saveSettings } = require("./src/settings-store");
const { appState } = require("./src/state");
const { openFolder, openUrl, pickFolder } = require("./src/system");

const config = loadConfig();
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 64 * 1024;
const STATIC_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip", "cf-ray"];

/* HTTP helpers */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError("Requête trop volumineuse.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new ApiError("Corps JSON invalide.", 400));
      }
    });
    req.on("error", reject);
  });
}

/* Access control */

function hostnameOf(hostHeader) {
  const host = String(hostHeader || "").toLowerCase();
  if (host.startsWith("[")) {
    return host.slice(0, host.indexOf("]") + 1);
  }
  return host.split(":")[0];
}

/**
 * A request typed on this computer: loopback socket, a localhost name in the Host header
 * (blocks DNS rebinding) and no proxy header (blocks a tunnel or reverse proxy running on this machine).
 */
function isLocalRequest(req) {
  return (
    LOOPBACK_ADDRESSES.has(req.socket.remoteAddress) &&
    LOCAL_HOSTNAMES.has(hostnameOf(req.headers.host)) &&
    !PROXY_HEADERS.some((header) => header in req.headers)
  );
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

// On this computer, no password. From another device (a Raspberry Pi used over the network), a password is required.
function checkAccess(req, res) {
  if (isLocalRequest(req)) {
    return true;
  }
  if (!config.auth.password) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Wavback n'accepte que les connexions depuis cet ordinateur.\n" +
        'Pour l\'utiliser depuis un autre appareil, définis "auth.password" dans config.json, puis redémarre l\'application.'
    );
    return false;
  }
  const header = req.headers.authorization || "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator > 0 && safeEqual(decoded.slice(0, separator), config.auth.user) && safeEqual(decoded.slice(separator + 1), config.auth.password)) {
      return true;
    }
  }
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Wavback", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
  res.end("Identifiant ou mot de passe requis.");
  return false;
}

// Another website open in the same browser must not be able to start downloads or stop the app.
// JSON forces a CORS preflight; Sec-Fetch-Site (or Origin on older browsers) proves the request comes from this page.
function checkSameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return;
  }
  if (!(req.headers["content-type"] || "").startsWith("application/json")) {
    throw new ApiError("Requête refusée : JSON attendu.", 415);
  }
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite) {
    if (fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new ApiError("Requête refusée : elle ne vient pas de cette page.", 403);
    }
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      // Refused below.
    }
    if (originHost !== req.headers.host) {
      throw new ApiError("Requête refusée : elle ne vient pas de cette page.", 403);
    }
  }
}

function requireLocal(req) {
  if (!isLocalRequest(req)) {
    throw new ApiError("Cette action n'est possible que sur l'ordinateur qui fait tourner l'application.", 403);
  }
}

/* Pages and static files */

function assetVersion() {
  let latest = 0;
  for (const sub of ["css", "js"]) {
    for (const name of fs.readdirSync(path.join(PUBLIC_DIR, sub))) {
      latest = Math.max(latest, fs.statSync(path.join(PUBLIC_DIR, sub, name)).mtimeMs);
    }
  }
  return String(Math.floor(latest / 1000));
}

const indexHtml = fs
  .readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8")
  .replaceAll("{{ asset_version }}", assetVersion())
  .replaceAll("{{ app_major_version }}", version.split(".")[0]);

function sendIndex(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(indexHtml);
}

function sendStatic(res, urlPath) {
  const relative = decodeURIComponent(urlPath.slice("/static/".length));
  const full = path.resolve(PUBLIC_DIR, relative);
  if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile() || full.endsWith(".html")) {
    throw new ApiError("Introuvable.", 404);
  }
  // Without no-cache, browsers keep serving an old app.js/styles.css for weeks after an update.
  res.writeHead(200, { "Content-Type": STATIC_TYPES[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(full).pipe(res);
}

/* API */

function configSummary(req) {
  const settings = getSettings(config);
  return {
    local: isLocalRequest(req),
    formats: formatOptions(settings),
    default_format: config.downloads.default_format,
    playlists: settings.playlists,
    output_dir: downloadsDir(config),
    retention_minutes: cleanupEnabled(config) ? config.cleanup.max_age_minutes : 0,
    max_filesize: config.downloads.max_filesize || null,
    update_enabled: Boolean(config.update.enabled),
  };
}

function fileListing() {
  const dir = downloadsDir(config);
  return { ...listFiles(dir, (full) => expiryFor(config, full)), output_dir: dir };
}

function scheduleShutdown() {
  appState.stopActiveProcess();
  setTimeout(() => {
    console.log("Application fermée depuis l'interface.");
    server.close();
    process.exit(0);
  }, 300).unref();
}

const routes = [
  ["GET", /^\/api\/config-summary$/, ({ req }) => configSummary(req)],
  ["GET", /^\/api\/settings$/, () => ({ settings: getSettings(config), defaults: defaultSettings(config) })],
  ["PUT", /^\/api\/settings$/, ({ body }) => ({ settings: saveSettings(config, body), defaults: defaultSettings(config) })],
  ["GET", /^\/api\/diagnostics$/, () => buildDiagnostics(config)],
  ["POST", /^\/api\/preview$/, ({ body }) => fetchLinkPreview(config, body.url)],
  [
    "POST",
    /^\/api\/download\/manual$/,
    ({ body }) => ({ ok: true, job_id: startManualDownload(config, body.url, body.format, Boolean(body.include_uploader)), message: "Téléchargement lancé." }),
  ],
  [
    "POST",
    /^\/api\/download\/playlist\/([^/]+)$/,
    ({ body, params }) => ({ ok: true, job_id: startPlaylistDownload(config, decodeURIComponent(params[0]), body.format), message: "Téléchargement de la playlist lancé." }),
  ],
  ["GET", /^\/api\/job$/, () => appState.snapshot()],
  ["POST", /^\/api\/job\/stop$/, () => ({ ok: true, message: appState.stopActiveProcess() ? "Arrêt demandé." : "Aucune tâche en cours à arrêter." })],
  ["POST", /^\/api\/update-ytdlp$/, () => ({ ok: true, job_id: startUpdateJob(config), message: "Mise à jour de yt-dlp lancée." })],
  ["GET", /^\/api\/files$/, () => fileListing()],
  [
    "DELETE",
    /^\/api\/files\/([^/]+)$/,
    ({ params }) => {
      forget(config, deleteFile(downloadsDir(config), decodeURIComponent(params[0])));
      return { ok: true, message: "Fichier supprimé." };
    },
  ],
  [
    "POST",
    /^\/api\/open-download-folder$/,
    ({ req }) => {
      requireLocal(req);
      openFolder(ensureDir(downloadsDir(config)));
      return { ok: true, message: "Dossier ouvert." };
    },
  ],
  [
    "POST",
    /^\/api\/pick-folder$/,
    async ({ req, body }) => {
      requireLocal(req);
      return { path: await pickFolder(typeof body.initial_dir === "string" ? body.initial_dir : downloadsDir(config)) };
    },
  ],
  [
    "POST",
    /^\/api\/shutdown$/,
    ({ req }) => {
      requireLocal(req);
      scheduleShutdown();
      return { ok: true, message: "Application fermée." };
    },
  ],
];

async function handle(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");

  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, version });
    return;
  }
  if (!checkAccess(req, res)) {
    return;
  }
  const isRead = req.method === "GET" || req.method === "HEAD";
  if (isRead && pathname === "/") {
    sendIndex(res);
    return;
  }
  if (isRead && pathname.startsWith("/static/")) {
    sendStatic(res, pathname);
    return;
  }
  const download = /^\/download\/([^/]+)$/.exec(pathname);
  if (download && isRead) {
    sendFile(res, downloadsDir(config), decodeURIComponent(download[1]), req.method);
    return;
  }

  for (const [method, pattern, handler] of routes) {
    const match = pattern.exec(pathname);
    if (!match || method !== req.method) {
      continue;
    }
    checkSameOrigin(req);
    const body = method === "GET" ? {} : await readJsonBody(req);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError("Corps JSON invalide.", 400);
    }
    sendJson(res, 200, await handler({ req, body, params: match.slice(1) }));
    return;
  }
  throw new ApiError("Introuvable.", 404);
}

const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  handle(req, res).catch((error) => {
    const status = error instanceof ApiError ? error.status : 500;
    if (!(error instanceof ApiError)) {
      console.error(error);
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, status, { detail: error instanceof ApiError ? error.detail : "Erreur interne du serveur." });
  });
});

function shutdown(signal) {
  console.log(`\n${signal} reçu : arrêt de l'application.`);
  appState.stopActiveProcess();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const url = `http://localhost:${config.app.port}/`;
    console.error(`Le port ${config.app.port} est déjà utilisé : l'application tourne sans doute déjà. Ouvre ${url}`);
    if (config.app.open_browser && config.listensLocallyOnly) {
      openUrl(url);
    }
    process.exit(0);
  }
  throw error;
});

startCleanup(config);

server.listen(config.app.port, config.app.host, () => {
  const localUrl = `http://localhost:${config.app.port}/`;
  console.log(`Wavback ${version}`);
  console.log(`  Interface    : ${localUrl}`);
  if (!config.listensLocallyOnly) {
    console.log(`  Réseau       : http://<adresse-de-cet-appareil>:${config.app.port}/ ${config.auth.password ? "(mot de passe requis)" : "(bloqué : aucun mot de passe dans config.json)"}`);
  }
  console.log(`  Téléchargés  : ${downloadsDir(config)}`);
  console.log(`  yt-dlp       : ${config.paths.ytDlp}${config.paths.ytDlpBundled ? "" : " (PATH)"}`);
  console.log(`  ffmpeg       : ${config.paths.ffmpegLocation || "ffmpeg du PATH"}`);
  console.log("Ferme cette fenêtre ou appuie sur Ctrl+C pour arrêter l'application.");
  if (config.app.open_browser) {
    openUrl(localUrl);
  }
});
