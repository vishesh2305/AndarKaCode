// Step 28: the two production servers. Server 1 runs the api, the orchestrator and MongoDB; server 2 runs
// ui-workers, which share only MongoDB with server 1: no disk. Here each ui-worker gets a runs folder of
// its own (RUNS_DIR), as on another machine. A ui-worker killed in the middle of a page leaves it to
// another, which takes it over when the lease runs out, and the project still reaches READY.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { shrinkScreenshot } from "../src/storage.js";
import { databaseUri } from "../src/verify/index.js";
import { fakePage } from "./helpers/fake-s2c.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCKS = path.resolve(API_DIR, "../samples/mocks");
if (!process.env.TEST_MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");
const MONGODB_URI = databaseUri(process.env.TEST_MONGODB_URI, "two_servers_test");

const listOf = (title, singular, plural, column, value) => ({
  title,
  kind: "list",
  tables: [{ entityHint: { singular, plural }, columns: [{ label: column, values: [value], badge: false }], rowActions: ["Edit", "Delete"] }],
  forms: [],
  buttons: [],
  search: false,
  filters: [],
  pagination: false,
  statCards: [],
  auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
});
const SCREENS = {
  "m1-edit-delete": listOf("Employees", "employee", "employees", "Full Name", "Ann Lee"),
  "m3-dashboard": listOf("Orders", "order", "orders", "Customer", "Raj Patel"),
};
const readingFor = new Map();
for (const [name, inventory] of Object.entries(SCREENS)) {
  readingFor.set((await shrinkScreenshot(await readFile(path.join(MOCKS, `${name}.png`)))).data.toString("base64"), inventory);
}

// The fake Ollama: readings at once; a page after `pages.delay` ms. `pages.started` counts page calls begun.
const pages = { delay: 300, started: 0 };
const fakeOllama = await new Promise((resolve) => {
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let content;
    if (body.format) content = JSON.stringify(readingFor.get(body.messages[0].images[0]));
    else {
      pages.started++;
      await new Promise((r) => setTimeout(r, pages.delay));
      content = "```html\n" + fakePage(body.messages[0].content) + "\n```";
    }
    if (res.destroyed) return; // the ui-worker that asked was killed
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ message: { content }, prompt_eval_count: 1000, eval_count: 500 }));
  });
  server.listen(0, "127.0.0.1", () => resolve(server));
});

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const services = [];
const folders = [];

async function service(role, extra = {}) {
  const port = await freePort();
  const env = { ...process.env, ROLE: role, PORT: String(port), HOST: "127.0.0.1", MONGODB_URI, OLLAMA_URL: `http://127.0.0.1:${fakeOllama.address().port}`, DEFAULT_MODE: "local", GEMINI_API_KEY: "", PREVIEW_PORT: "0", ...extra };
  delete env.GATEWAY_URL;
  delete env.GATEWAY_API_KEY;
  const proc = spawn(process.execPath, ["src/server.js"], { cwd: API_DIR, env });
  const s = { proc, root: `http://127.0.0.1:${port}`, log: "" };
  services.push(s);
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  for (let i = 0; i < 600; i++) {
    if (/listening/.test(s.log)) return s;
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${role} did not start:\n${s.log}`);
}

/** A ui-worker on "server 2": a runs folder of its own, so nothing on server 1's disk is reachable. */
async function server2Worker() {
  const runs = await mkdtemp(path.join(os.tmpdir(), "server-2-"));
  folders.push(runs);
  return service("ui-worker", { RUNS_DIR: runs, UI_PARALLEL: "2", PICKUP_MS: "100", LEASE_MS: "1500" });
}

async function build(screenshot) {
  const form = new FormData();
  form.append("fresh", "true");
  form.append("image", new Blob([await readFile(path.join(MOCKS, `${screenshot}.png`))], { type: "image/png" }), `${screenshot}.png`);
  const created = await fetch(`${builder.root}/api/projects`, { method: "POST", body: form });
  assert.equal(created.status, 201, await created.clone().text());
  return (await created.json()).id;
}

async function waitDone(id, logs) {
  let project;
  for (let i = 0; i < 400; i++) {
    project = await (await fetch(`${builder.root}/api/projects/${id}`)).json();
    if (["READY", "NEEDS_ATTENTION"].includes(project.state)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(project.state, "READY", `${project.error}\n${logs()}`);
  return project;
}

let builder;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  builder = await service("all", { PAGE_LANE: "queue", GATEWAY_POLL_MS: "100" });
});
after(async () => {
  for (const s of services) s.proc.kill();
  fakeOllama.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  for (const dir of folders) await rm(dir, { recursive: true, force: true });
});

describe("two servers that share only MongoDB (Step 28)", () => {
  let first;

  it("a ui-worker with a disk of its own draws the pages, and the project reaches READY", async () => {
    first = await server2Worker();
    const id = await build("m1-edit-delete");
    await waitDone(id, () => `--- builder\n${builder.log.slice(-1500)}\n--- server 2\n${first.log.slice(-1500)}`);
    assert.match(first.log, /MongoDB is [\d.]+ ms away/, "the ui-worker measured how far server 1 is");
  });

  it("a ui-worker killed in the middle of a page: another takes it over and the project still reaches READY", async () => {
    pages.delay = 2500;
    const before = pages.started;
    const id = await build("m3-dashboard");
    for (let i = 0; i < 200 && pages.started === before; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(pages.started, before + 1, "the first ui-worker began the page");
    first.proc.kill("SIGKILL");
    pages.delay = 300;

    const second = await server2Worker();
    await waitDone(id, () => `--- builder\n${builder.log.slice(-1500)}\n--- second\n${second.log.slice(-1500)}`);
    assert.equal(pages.started, before + 2, "the page was begun again, once");
    const job = await mongoose.connection.collection("pagejobs").find({ status: "done" }).sort({ createdAt: -1 }).limit(1).next();
    assert.ok(job.worker.includes(`:${second.proc.pid}:`), `drawn by the second ui-worker (${job.worker})`);
  });
});
