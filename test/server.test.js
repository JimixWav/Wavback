"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { tempConfig } = require("./helpers");

// The fake yt-dlp is a Node script with a shebang, which Windows cannot run directly.
const skip = process.platform === "win32" ? "fake yt-dlp needs a POSIX shebang" : false;

const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const json = { "Content-Type": "application/json" };

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

async function waitForJob() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await (await fetch(`${base}/api/job`)).json();
    if (job.status !== "running") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("job did not finish");
}

test("server end to end", { skip }, async (t) => {
  const temp = tempConfig({ app: { host: "127.0.0.1", port, open_browser: false } });
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, WAVBACK_CONFIG: temp.file, NO_BROWSER: "1" },
    stdio: "ignore",
  });
  t.after(() => server.kill());
  await waitForHealth();

  await t.test("the page loads without a password on this computer", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Wavback/);
    const summary = await (await fetch(`${base}/api/config-summary`)).json();
    assert.equal(summary.local, true);
    assert.equal(summary.output_dir, temp.downloads);
  });

  await t.test("a request through a proxy needs a password", async () => {
    const response = await fetch(`${base}/api/job`, { headers: { "X-Forwarded-For": "203.0.113.5" } });
    assert.equal(response.status, 403);
  });

  await t.test("requests from another website are refused", async () => {
    assert.equal((await fetch(`${base}/api/job/stop`, { method: "POST", body: "{}" })).status, 415);
    const crossSite = await fetch(`${base}/api/job/stop`, { method: "POST", headers: { ...json, "Sec-Fetch-Site": "cross-site" }, body: "{}" });
    assert.equal(crossSite.status, 403);
  });

  await t.test("a download produces a file that can be listed, downloaded and deleted", async () => {
    const start = await fetch(`${base}/api/download/manual`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc", format: "mp3" }),
    });
    assert.equal(start.status, 200);
    const job = await waitForJob();
    assert.equal(job.status, "success");
    assert.deepEqual(job.files, ["Тест é titre.mp3"]);

    const listing = await (await fetch(`${base}/api/files`)).json();
    assert.equal(listing.files[0].name, "Тест é titre.mp3");

    const file = await fetch(`${base}/download/${encodeURIComponent("Тест é titre.mp3")}`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "fake media");
    assert.match(file.headers.get("content-disposition"), /filename\*=UTF-8''/);

    const removed = await fetch(`${base}/api/files/${encodeURIComponent("Тест é titre.mp3")}`, { method: "DELETE", headers: json, body: "{}" });
    assert.equal(removed.status, 200);
    assert.deepEqual(fs.readdirSync(temp.downloads), []);
  });

  await t.test("yt-dlp errors are reported", async () => {
    await fetch(`${base}/api/download/manual`, { method: "POST", headers: json, body: JSON.stringify({ url: "https://youtu.be/fail", format: "mp3" }) });
    const job = await waitForJob();
    assert.equal(job.status, "error");
    assert.match(job.stderr_lines.join("\n"), /Video unavailable/);
  });

  await t.test("MP4 is refused for SoundCloud", async () => {
    const response = await fetch(`${base}/api/download/manual`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ url: "https://soundcloud.com/a/b", format: "mp4" }),
    });
    assert.equal(response.status, 422);
  });

  await t.test("the Quit button stops the server", async () => {
    const exited = new Promise((resolve) => server.on("exit", resolve));
    assert.equal((await fetch(`${base}/api/shutdown`, { method: "POST", headers: json, body: "{}" })).status, 200);
    assert.equal(await exited, 0);
  });
});
