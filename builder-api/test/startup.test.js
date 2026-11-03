// Step 20: the Builder API's start-up and its health answers. A wrong setting stops it before it touches
// the database; /healthz says the process is alive, /readyz whether it can take work (the database);
// logs can be JSON lines for production; an outdated UI build is pointed out at start.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { logLine } from "../src/log.js";
import { readiness, webBuildIsStale } from "../src/health.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function start(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/server.js"], { cwd: API_DIR, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 15_000);
    child.on("exit", (code) => (clearTimeout(timer), resolve({ code, output })));
  });
}

describe("start-up with a wrong setting", () => {
  it("stops at once with code 1 and names every wrong setting, before trying the database", async () => {
    const { code, output } = await start({ PORT: "abc", DEFAULT_MODE: "clod", MONGODB_URI: "mongodb://127.0.0.1:1/never" });
    assert.equal(code, 1);
    assert.match(output, /PORT in builder-api\/\.env/);
    assert.match(output, /DEFAULT_MODE/);
    assert.doesNotMatch(output, /Cannot connect to MongoDB/);
  });
});

describe("readiness: may this Builder API take work?", () => {
  it("is ready when the database is connected", () => {
    assert.deepEqual(readiness({ dbConnected: true }), { status: 200, body: { ready: true, db: true } });
  });

  it("answers 503 while the database is not connected", () => {
    assert.deepEqual(readiness({ dbConnected: false }), { status: 503, body: { ready: false, db: false } });
  });
});

describe("logLine: one log entry", () => {
  const entry = { level: "info", msg: "NEEDS_ATTENTION: no page", project: "p1", time: "2026-11-03T10:00:00.000Z" };

  it("is one JSON line for production (LOG_FORMAT=json)", () => {
    const line = logLine(entry, "json");
    assert.doesNotMatch(line, /\n/);
    assert.deepEqual(JSON.parse(line), entry);
  });

  it("is plain text by default, with the project first, as the logs read today", () => {
    assert.equal(logLine(entry, "text"), "[p1] NEEDS_ATTENTION: no page");
    assert.equal(logLine({ level: "info", msg: "Builder API listening" }, "text"), "Builder API listening");
  });
});

describe("webBuildIsStale: is web/dist older than the web source?", () => {
  async function webFolder({ built, changed }) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-"));
    await mkdir(path.join(dir, "src", "components"), { recursive: true });
    await mkdir(path.join(dir, "dist"), { recursive: true });
    await writeFile(path.join(dir, "src", "components", "Header.jsx"), "x");
    await writeFile(path.join(dir, "dist", "index.html"), "x");
    await utimes(path.join(dir, "dist", "index.html"), built, built);
    await utimes(path.join(dir, "src", "components", "Header.jsx"), changed, changed);
    return dir;
  }

  it("is true when a source file changed after the last build", async () => {
    assert.equal(await webBuildIsStale(await webFolder({ built: new Date(2026, 10, 1), changed: new Date(2026, 10, 3) })), true);
  });

  it("is false when the build is newer than every source file", async () => {
    assert.equal(await webBuildIsStale(await webFolder({ built: new Date(2026, 10, 3), changed: new Date(2026, 10, 1) })), false);
  });

  it("is false when there is no build at all (nothing to warn about: the UI is simply not served)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-"));
    assert.equal(await webBuildIsStale(dir), false);
  });
});
