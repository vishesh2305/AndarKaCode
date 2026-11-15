// Step 34a: the live preview as its own service (ROLE=preview), on its own address. The api service runs no
// generated app: it asks for a preview through MongoDB (previews), with the app's files and its starting
// rows inside the request (the preview service is on server 2, which shares no disk with server 1). The
// preview service starts it in a box (a sandbox with SANDBOX=docker; a process here), gives it a secret
// address, says in MongoDB how it is doing, and stops it on request or when nobody uses it.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { Preview } from "../src/models/preview.js";
import { requestPreview, requestStop, waitPreview } from "../src/preview-queue.js";
import { databaseUri } from "../src/verify/index.js";
import { tarOf } from "../src/verify/tar.js";
import { wireApp } from "../src/wirer/index.js";
import { employeesSpec } from "../test/fixtures/page-specs.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(API_DIR, ".generated", "preview-service");
if (!process.env.TEST_MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");
const MONGODB_URI = databaseUri(process.env.TEST_MONGODB_URI, "preview_service_test");
const fixture = (name) => readFileSync(new URL(`../test/fixtures/pages/${name}`, import.meta.url), "utf8");
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const until = async (check, what) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out: ${what}`);
};

let service;
let files;
const seed = { employees: [{ fullName: "Asha Rao", email: "asha@example.com", createdAt: new Date(), updatedAt: new Date() }] };
const ask = (projectId, hash = "h1") => requestPreview({ projectId, hash, files, seed, auth: false });
const home = (projectId, token) => `http://127.0.0.1:${service.port}/preview/${projectId}/${token}/`;

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  // The app is packed, then its folder is deleted: the preview service has only what the request carries.
  const appDir = path.join(OUT, "app");
  await writeBackend(appDir, { ...generateBackend(employeesSpec, { name: "preview" }), ...wireApp({ spec: employeesSpec, pages: [{ screenshot: 1, html: fixture("employees-real.html") }] }) });
  files = await tarOf(appDir);
  await rm(OUT, { recursive: true, force: true });

  const port = await freePort();
  const env = { ...process.env, ROLE: "preview", PREVIEW_PORT: String(port), PORT: String(await freePort()), HOST: "127.0.0.1", MONGODB_URI, SANDBOX: "process", PICKUP_MS: "100", PREVIEW_IDLE_MS: "3000", GEMINI_API_KEY: "" };
  const proc = spawn(process.execPath, ["src/server.js"], { cwd: API_DIR, env });
  let output = "";
  proc.stdout.on("data", (c) => (output += c));
  proc.stderr.on("data", (c) => (output += c));
  service = { proc, port, output: () => output };
  await until(() => fetch(`http://127.0.0.1:${port}/readyz`).then((r) => r.ok, () => false), `the preview service to start:\n${output}`);
});
after(async () => {
  service?.proc.kill();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

describe("the preview service (ROLE=preview)", () => {
  let token;

  it("starts a preview from the request alone (its files and starting rows), at a secret address", async () => {
    await ask("p1");
    ({ token } = await waitPreview("p1"));
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert.deepEqual(await (await fetch(`${home("p1", token)}health`)).json(), { ok: true, db: true });
    const { items } = await (await fetch(`${home("p1", token)}api/employees`)).json();
    assert.deepEqual(items.map((e) => e.fullName), ["Asha Rao"]);
    assert.match(await (await fetch(`${home("p1", token)}page-1.html`)).text(), /<script src="app\.js"><\/script>/);
    const doc = await Preview.findOne({ projectId: "p1" }).lean();
    assert.equal(doc.status, "running");
    assert.equal(doc.files, undefined, "the files are dropped once it runs");
  });

  it("is not there without its secret", async () => {
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/preview/p1/health`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/preview/p1/${"a".repeat(32)}/health`)).status, 404);
  });

  it("asked again for the same version: the same preview, the same address", async () => {
    await ask("p1");
    assert.equal((await waitPreview("p1")).token, token);
  });

  it("a new version of the app: a new preview at a new address; the old address is gone", async () => {
    await ask("p1", "h2");
    const next = (await waitPreview("p1")).token;
    assert.notEqual(next, token);
    assert.equal((await fetch(`${home("p1", token)}health`)).status, 404);
    assert.equal((await fetch(`${home("p1", next)}health`)).status, 200);
    token = next;
  });

  it("stops on request", async () => {
    await requestStop("p1");
    await until(async () => (await fetch(`${home("p1", token)}health`)).status === 404, "the preview to stop");
    await until(async () => (await Preview.findOne({ projectId: "p1" }).lean()).status === "stopped", "stopped in MongoDB");
  });

  it("stops by itself when nobody uses it, and says so in MongoDB", async () => {
    await ask("p2");
    const { token: t } = await waitPreview("p2");
    assert.equal((await fetch(`${home("p2", t)}health`)).status, 200);
    await new Promise((r) => setTimeout(r, 4000));
    assert.equal((await fetch(`${home("p2", t)}health`)).status, 404);
    assert.equal((await Preview.findOne({ projectId: "p2" }).lean()).status, "stopped");
  });

  it("a preview whose service is gone (not seen for a while) is started again when asked for", async () => {
    await Preview.create({ projectId: "p3", hash: "h1", status: "running", token: "z".repeat(32), worker: "gone", seenAt: new Date(Date.now() - 10 * 60_000), auth: false });
    await ask("p3");
    const { token: t } = await waitPreview("p3");
    assert.notEqual(t, "z".repeat(32));
    assert.equal((await fetch(`${home("p3", t)}health`)).status, 200);
    await requestStop("p3");
  });

  it("answers only previews and its health checks", async () => {
    const res = await fetch(`http://127.0.0.1:${service.port}/api/projects`);
    assert.equal(res.status, 404);
  });
});
