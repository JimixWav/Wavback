"use strict";

const { ApiError } = require("./errors");
const { validateSupportedMediaUrl } = require("./validators");
const { describeSpawnError, runYtDlp } = require("./ytdlp");

const EXT_PLACEHOLDER = "{ext}";
const TIMEOUT_MS = 45_000;

// "S" makes yt-dlp sanitize each field exactly as it does for real file names;
// the extension depends on the format picked in the UI, so it stays a placeholder.
function nameTemplate(outputTemplate) {
  return outputTemplate.replaceAll("%(ext)s", EXT_PLACEHOLDER).replaceAll(")s", ")S");
}

function jsonValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null; // yt-dlp prints an unquoted NA for missing fields
  }
}

function asText(value) {
  return typeof value === "string" && value ? value : null;
}

async function fetchLinkPreview(config, rawUrl) {
  const url = validateSupportedMediaUrl(rawUrl);
  const names = `${nameTemplate(config.downloads.name_template_title)}\t${nameTemplate(config.downloads.name_template_uploader_title)}`;
  const stdout = [];
  const stderr = [];
  const { error, signal } = await runYtDlp(
    config,
    url,
    {
      noWarnings: true,
      flatPlaylist: true,
      skipDownload: true,
      windowsFilenames: true,
      print: [
        "playlist:P\t%(title)j\t%(playlist_count)j",
        "video:V\t%(title)j\t%(uploader,channel)j\t%(duration)j",
        `video:N\t${names}`,
      ],
    },
    { onStdout: (line) => stdout.push(line), onStderr: (line) => stderr.push(line), timeoutMs: TIMEOUT_MS }
  );

  if (error?.code === "ETIMEDOUT" || signal) {
    throw new ApiError("Le lien met trop de temps à répondre.", 504);
  }
  if (error) {
    throw new ApiError(describeSpawnError(error), 500);
  }

  const rows = stdout.map((line) => line.split("\t"));
  const playlist = rows.find((row) => row[0] === "P" && row.length >= 3);
  if (playlist) {
    const count = jsonValue(playlist[2]);
    return {
      kind: "playlist",
      title: asText(jsonValue(playlist[1])),
      count: Number.isInteger(count) ? count : rows.filter((row) => row[0] === "V").length,
    };
  }

  const video = rows.find((row) => row[0] === "V" && row.length >= 4);
  if (video) {
    const fileNames = rows.find((row) => row[0] === "N" && row.length >= 3);
    const duration = jsonValue(video[3]);
    return {
      kind: "video",
      title: asText(jsonValue(video[1])),
      uploader: asText(jsonValue(video[2])),
      duration: typeof duration === "number" ? duration : null,
      name_title_only: fileNames ? fileNames[1] : null,
      name_with_uploader: fileNames ? fileNames[2] : null,
    };
  }

  const errorLine = [...stderr].reverse().find((line) => line.startsWith("ERROR:"));
  const detail = errorLine ? errorLine.replace(/^ERROR:\s*/, "") : "yt-dlp n'a rien trouvé à ce lien.";
  throw new ApiError(`Impossible de lire ce lien : ${detail}`, 422);
}

module.exports = { fetchLinkPreview };
