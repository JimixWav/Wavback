"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { tempConfig } = require("./helpers");

const temp = tempConfig({ cleanup: { max_age_minutes: 120 } });
process.env.WAVBACK_CONFIG = temp.file;

const { loadConfig } = require("../src/config");
const cleanup = require("../src/cleanup");
const files = require("../src/files");
const { formatFlags, formatOptions } = require("../src/formats");
const settingsStore = require("../src/settings-store");
const { isYouTubeUrl, validateSupportedMediaUrl } = require("../src/validators");
const { toArgs } = require("../src/ytdlp");

const config = loadConfig();
const settings = settingsStore.getSettings(config);

test("toArgs turns flags into separate arguments", () => {
  assert.deepEqual(toArgs({ extractAudio: true, audioFormat: "mp3", noMtime: true, print: ["a", "b"], skip: false, empty: "" }), [
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--no-mtime",
    "--print",
    "a",
    "--print",
    "b",
    "--no-skip",
  ]);
});

test("only YouTube and SoundCloud links are accepted", () => {
  assert.equal(validateSupportedMediaUrl(" https://youtu.be/abc "), "https://youtu.be/abc");
  assert.equal(validateSupportedMediaUrl("https://soundcloud.com/a/b"), "https://soundcloud.com/a/b");
  assert.throws(() => validateSupportedMediaUrl("https://vimeo.com/1"), /YouTube et SoundCloud/);
  assert.throws(() => validateSupportedMediaUrl("file:///etc/passwd"), /http/);
  assert.throws(() => validateSupportedMediaUrl("https://youtube.com.evil.com/x"), /YouTube et SoundCloud/);
  assert.equal(isYouTubeUrl("https://music.youtube.com/watch?v=1"), true);
  assert.equal(isYouTubeUrl("https://soundcloud.com/a"), false);
});

test("audio formats map to the right yt-dlp options", () => {
  assert.deepEqual(formatFlags("mp3", settings), { extractAudio: true, audioFormat: "mp3", audioQuality: "320K" });
  assert.equal(formatFlags("flac", settings).postprocessorArgs, "ExtractAudio:-sample_fmt s16");
  assert.equal(formatFlags("wav", { ...settings, audio: { ...settings.audio, wav_bit_depth: 24, sample_rate: "48000" } }).postprocessorArgs, "ExtractAudio:-c:a pcm_s24le -ar 48000");
});

test("MP4 asks for H.264 up to the chosen resolution", () => {
  const flags = formatFlags("mp4", { ...settings, video: { max_height: "720" } });
  assert.equal(flags.formatSort, "res:720,vcodec:h264,acodec:m4a");
  assert.equal(flags.mergeOutputFormat, "mp4");
  assert.deepEqual(formatOptions(settings).map((option) => option.value), ["flac", "wav", "mp3", "m4a", "mp4"]);
});

test("settings are validated before being saved", () => {
  const valid = { ...settings, output_dir: temp.downloads, playlists: [{ label: "Mix", url: "https://soundcloud.com/x/sets/y" }] };
  const saved = settingsStore.saveSettings(config, valid);
  assert.match(saved.playlists[0].id, /^[0-9a-f]{8}$/);
  assert.ok(fs.existsSync(config.paths.settings));
  assert.throws(() => settingsStore.saveSettings(config, { ...valid, audio: { ...valid.audio, mp3_bitrate: "999" } }), /mp3_bitrate/);
  assert.throws(() => settingsStore.saveSettings(config, { ...valid, output_dir: "relative/dir" }), /chemin complet/);
  assert.throws(() => settingsStore.saveSettings(config, { ...valid, playlists: [{ label: "X", url: "https://evil.com" }] }), /Playlist « X »/);
});

test("job files include new files and skipped ones, never partial files", () => {
  const dir = path.join(temp.dir, "job");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "old.mp3"), "x");
  const before = files.snapshotNames(dir);
  fs.writeFileSync(path.join(dir, "new.flac"), "x");
  fs.writeFileSync(path.join(dir, "new.webm.part"), "x");
  const found = files.collectJobFiles(dir, before, ["[download] /somewhere/old.mp3 has already been downloaded"]);
  assert.deepEqual(found, ["new.flac", "old.mp3"]);
  files.removePartialFiles(dir, before);
  assert.equal(fs.existsSync(path.join(dir, "new.webm.part")), false);
});

test("files outside the download folder cannot be reached", () => {
  for (const name of ["../config.json", "..", ".hidden", "a/b.mp3", "x.part"]) {
    assert.throws(() => files.deleteFile(temp.downloads, name), /introuvable/i, name);
  }
});

test("the cleanup only deletes files it registered, once they are too old", () => {
  const dir = path.join(temp.dir, "mine");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "made-by-app.mp3"), "12345");
  fs.writeFileSync(path.join(dir, "user-file.mp3"), "x");
  cleanup.registerFiles(config, dir, ["made-by-app.mp3"]);
  assert.ok(cleanup.expiryFor(config, path.join(dir, "made-by-app.mp3")));
  assert.equal(cleanup.expiryFor(config, path.join(dir, "user-file.mp3")), null);

  assert.equal(cleanup.sweepRegistered(config, Date.now() + 119 * 60_000).deleted, 0);
  assert.deepEqual(cleanup.sweepRegistered(config, Date.now() + 121 * 60_000), { deleted: 1, freedBytes: 5 });
  assert.deepEqual(fs.readdirSync(dir), ["user-file.mp3"]);
});
