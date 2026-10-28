"use strict";

const { killTree } = require("./system");

const PROGRESS_LINE = /^\[download\]\s+[\d.]+%/;
const MAX_LOG_LINES = 2000;

function idleState() {
  return {
    job_id: null,
    job_type: null,
    title: null,
    format: null,
    status: "idle",
    summary: "Aucune tâche en cours.",
    started_at: null,
    finished_at: null,
    stdout_lines: [],
    stderr_lines: [],
    exit_code: null,
    error_message: null,
    files: [],
  };
}

function pushCapped(lines, text) {
  lines.push(text);
  if (lines.length > MAX_LOG_LINES) {
    lines.splice(0, lines.length - MAX_LOG_LINES);
  }
}

class AppState {
  constructor() {
    this.state = idleState();
    this.child = null;
    this.stopRequested = false;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  isRunning() {
    return this.state.status === "running";
  }

  beginJob({ jobId, jobType, summary, format = null, title = null }) {
    if (this.isRunning()) {
      return false;
    }
    this.state = {
      ...idleState(),
      job_id: jobId,
      job_type: jobType,
      title,
      format,
      status: "running",
      summary,
      started_at: new Date().toISOString(),
    };
    this.child = null;
    this.stopRequested = false;
    return true;
  }

  setChild(child) {
    this.child = child;
  }

  appendStdout(line) {
    const lines = this.state.stdout_lines;
    // Keep only the latest progress update so the console is not flooded.
    if (lines.length && PROGRESS_LINE.test(line) && PROGRESS_LINE.test(lines[lines.length - 1])) {
      lines[lines.length - 1] = line;
    } else {
      pushCapped(lines, line);
    }
  }

  appendStderr(line) {
    pushCapped(this.state.stderr_lines, line);
  }

  finishJob({ status, exitCode, errorMessage = null, summary = null, files = [] }) {
    Object.assign(this.state, {
      status,
      exit_code: exitCode,
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
      files,
    });
    if (summary) {
      this.state.summary = summary;
    }
    this.child = null;
  }

  stopActiveProcess() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return false;
    }
    this.stopRequested = true;
    killTree(child, "SIGTERM");
    // yt-dlp normally exits within a second; force it if ffmpeg is still busy.
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        killTree(child, "SIGKILL");
      }
    }, 5000).unref();
    return true;
  }
}

module.exports = { appState: new AppState() };
