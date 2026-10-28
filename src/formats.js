"use strict";

const SAMPLE_RATE_LABELS = { 44100: "44,1 kHz", 48000: "48 kHz" };
const LOSSLESS_SOURCE_ONLY = "n'a d'intérêt que si la source est elle-même sans perte.";
const VIDEO_HEIGHTS = ["480", "720", "1080", "1440", "2160"];

function isVideo(format) {
  return format === "mp4";
}

function fileExtension(format) {
  return format;
}

function formatOptions(settings) {
  const { audio, video } = settings;
  const resampled = SAMPLE_RATE_LABELS[audio.sample_rate] ? ` Rééchantillonné en ${SAMPLE_RATE_LABELS[audio.sample_rate]}.` : "";

  const flac = audio.flac_bit_depth === 24
    ? ["FLAC 24", `Sans perte en 24 bits : ${LOSSLESS_SOURCE_ONLY}`]
    : ["FLAC", "Sans perte en 16 bits et environ un tiers plus léger que le WAV. Lu par Rekordbox."];
  const wav = audio.wav_bit_depth === 24
    ? ["WAV 24", `Non compressé en 24 bits : ${LOSSLESS_SOURCE_ONLY}`]
    : ["WAV", "Sans perte et non compressé : lu partout, mais c'est le format le plus lourd."];
  const mp3 = audio.mp3_bitrate === "v0"
    ? ["MP3 V0", "MP3 VBR V0 (environ 245 kbps) : excellente qualité, mais certaines CDJ anciennes placent mal les cue points."]
    : [`MP3 ${audio.mp3_bitrate}`, `MP3 à ${audio.mp3_bitrate} kbps constant : léger, lu par tous les logiciels et toutes les CDJ.`];
  const aac = [`AAC ${audio.aac_bitrate}`, `AAC à ${audio.aac_bitrate} kbps dans un fichier .m4a : léger et lu par Rekordbox.`];

  const height = Number(video.max_height);
  const codecNote = height > 1080
    ? " Au-delà de 1080p, YouTube ne diffuse qu'en VP9 ou AV1 : certains lecteurs (QuickTime, vieilles TV) ne les lisent pas."
    : " Vidéo H.264 et son AAC : lisible partout.";
  const mp4 = [`MP4 ${height === 2160 ? "4K" : `${height}p`}`, `Vidéo MP4 jusqu'à ${height}p, YouTube uniquement.${codecNote}`];

  return [
    { value: "flac", label: flac[0], hint: flac[1] + resampled, kind: "audio" },
    { value: "wav", label: wav[0], hint: wav[1] + resampled, kind: "audio" },
    { value: "mp3", label: mp3[0], hint: mp3[1] + resampled, kind: "audio" },
    { value: "m4a", label: aac[0], hint: aac[1] + resampled, kind: "audio" },
    { value: "mp4", label: mp4[0], hint: mp4[1], kind: "video" },
  ];
}

function audioFlags(format, audio) {
  let quality = "0";
  const ffmpegArgs = [];
  if (format === "mp3") {
    // CBR unless V0 is picked: VBR files can drift on cue points with some DJ players.
    quality = audio.mp3_bitrate === "v0" ? "0" : `${audio.mp3_bitrate}K`;
  } else if (format === "m4a") {
    quality = `${audio.aac_bitrate}K`;
  } else if (format === "flac") {
    // Left alone, ffmpeg turns decoded lossy audio into 24-bit FLAC, larger than the WAV for no gain.
    ffmpegArgs.push(audio.flac_bit_depth === 16 ? "-sample_fmt s16" : "-sample_fmt s32");
  } else if (format === "wav" && audio.wav_bit_depth === 24) {
    ffmpegArgs.push("-c:a pcm_s24le");
  }
  if (audio.sample_rate !== "source") {
    ffmpegArgs.push(`-ar ${audio.sample_rate}`);
  }

  const flags = { extractAudio: true, audioFormat: format, audioQuality: quality };
  if (ffmpegArgs.length) {
    flags.postprocessorArgs = `ExtractAudio:${ffmpegArgs.join(" ")}`;
  }
  return flags;
}

function videoFlags(video) {
  return {
    format: "bv*+ba/b",
    // Highest resolution up to the limit, then H.264 + AAC so the MP4 plays everywhere.
    formatSort: `res:${video.max_height},vcodec:h264,acodec:m4a`,
    mergeOutputFormat: "mp4",
    remuxVideo: "mp4",
  };
}

function formatFlags(format, settings) {
  return isVideo(format) ? videoFlags(settings.video) : audioFlags(format, settings.audio);
}

module.exports = { formatOptions, formatFlags, isVideo, fileExtension, VIDEO_HEIGHTS };
