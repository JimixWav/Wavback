#!/usr/bin/env node
// Stand-in for yt-dlp used by the tests: same command line, same kind of output, no network.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const url = args[args.length - 1];
const title = "Тест é titre";

if (args.includes("--version")) {
  console.log("2026.10.26");
  process.exit(0);
}
if (url.includes("fail")) {
  console.error("ERROR: [youtube] fail: Video unavailable");
  process.exit(1);
}
if (args.includes("--print")) {
  if (url.includes("list=")) {
    console.log('P\t"Ma playlist"\t3');
  } else {
    console.log(`V\t${JSON.stringify(title)}\t"Chaîne"\t19`);
  }
  process.exit(0);
}

const template = value("--output");
const ext = value("--audio-format") || value("--merge-output-format") || "mp4";
const target = template.replace("%(uploader)s", "Chaîne").replace("%(title)s", title).replace("%(ext)s", ext);
console.log(`[download] Destination: ${target.replace(/\.[^.]+$/, ".webm")}`);
console.log("[download] 100.0% of    3.10MiB at  1.00MiB/s ETA 00:00");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "fake media");
console.log(`[ExtractAudio] Destination: ${target}`);
