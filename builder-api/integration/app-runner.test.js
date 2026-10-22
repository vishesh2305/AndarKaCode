// Integration (Step 16): starting a GENERATED app in its own process, the way the Verifier and the
// live preview will: on 127.0.0.1, on a free port, with its own throwaway database, using the Builder
// API's installed packages (no npm install, no internet). Needs TEST_MONGODB_URI.
import assert from "node:assert/strict";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { linkPackages, runningApps, startApp, stopAll } from "../src/verify/app-runner.js";
import { wireApp } from "../src/wirer/index.js";
import { authSpec, editDeleteSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "runner"); // outside integration/
const dbUri = (name) => MONGODB_URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
const page = (title) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;

async function writeApp(name, spec, pages) {
  const dir = path.join(OUT, name);
  await writeBackend(dir, { ...generateBackend(spec, { name }), ...wireApp({ spec, pages }) });
  return dir;
}

before(() => rm(OUT, { recursive: true, force: true }));
after(async () => {
  await stopAll();
  await rm(OUT, { recursive: true, force: true });
});

describe("startApp: a generated app in its own process", () => {
  let app;
  let dir;
  before(async () => {
    dir = await writeApp("edit", editDeleteSpec, [{ screenshot: 1, html: page("Employees") }]);
    app = await startApp({ appDir: dir, mongoUri: dbUri("runner_edit") });
  });

  it("answers on 127.0.0.1 only, on a port it picked itself", async () => {
    const url = new URL(app.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(Number(url.port) > 0);
  });

  it("serves its API on its own database, and its wired pages", async () => {
    assert.deepEqual(await (await fetch(`${app.url}/health`)).json(), { ok: true, db: true });
    assert.deepEqual((await (await fetch(`${app.url}/api/employees`)).json()).items, []);
    assert.match(await (await fetch(`${app.url}/page-1.html`)).text(), /<script src="app\.js"><\/script>/);
    assert.equal((await fetch(`${app.url}/api-map.json`)).status, 200);
  });

  it("uses the Builder API's installed packages through a link (no npm install)", async () => {
    assert.ok((await lstat(path.join(dir, "node_modules"))).isSymbolicLink());
    await linkPackages(dir); // a second time is fine
  });

  it("stops: the port closes, it leaves the running list, and its database can be dropped", async () => {
    assert.ok(runningApps().includes(app));
    await app.stop({ dropDatabase: true });
    await assert.rejects(fetch(`${app.url}/health`));
    assert.ok(!runningApps().includes(app));
    const conn = await mongoose.createConnection(dbUri("runner_edit")).asPromise();
    try {
      const names = (await conn.listDatabases()).databases.map((d) => d.name);
      assert.ok(!names.includes("runner_edit"));
    } finally {
      await conn.close();
    }
  });
});

describe("startApp: an app with a login screen", () => {
  it("creates the first account from the settings it is given", async () => {
    const dir = await writeApp("auth", authSpec, [{ screenshot: 1, html: page("Sign in") }, { screenshot: 2, html: page("Employees") }]);
    const app = await startApp({
      appDir: dir,
      mongoUri: dbUri("runner_auth"),
      env: { ADMIN_EMAIL: "verify@example.com", ADMIN_PASSWORD: "verify-pass-123" },
    });
    try {
      const res = await fetch(`${app.url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "verify@example.com", password: "verify-pass-123" }),
      });
      assert.equal(res.status, 200);
      assert.ok((await res.json()).token);
      assert.equal((await fetch(`${app.url}/api/employees`)).status, 401, "data needs a login");
    } finally {
      await app.stop({ dropDatabase: true });
    }
  });
});

describe("startApp: an app that cannot start", () => {
  it("fails with the app's own error message, and leaves nothing running", async () => {
    const dir = await writeApp("broken", editDeleteSpec, [{ screenshot: 1, html: page("Employees") }]);
    const server = path.join(dir, "backend/server.js");
    await writeFile(server, (await readFile(server, "utf8")) + "\nthrow new Error('broken on purpose');\n");
    const before = runningApps().length;
    await assert.rejects(startApp({ appDir: dir, mongoUri: dbUri("runner_broken") }), /broken on purpose/);
    assert.equal(runningApps().length, before);
  });

  it("gives up after a time limit when the app never says it is ready", async () => {
    const dir = await writeApp("hangs", editDeleteSpec, [{ screenshot: 1, html: page("Employees") }]);
    const server = path.join(dir, "backend/server.js");
    await writeFile(server, (await readFile(server, "utf8")) + "\nawait new Promise(() => setInterval(() => {}, 1000)); // never ready, still alive\n");
    await assert.rejects(startApp({ appDir: dir, mongoUri: dbUri("runner_hangs"), timeoutMs: 1500 }), /did not start within/);
    assert.equal(runningApps().filter((a) => a.appDir === dir).length, 0);
  });
});
