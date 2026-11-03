// Step 26: the ui-worker service. With PAGE_LANE=queue there is no Laptop B: the orchestrator puts page jobs
// into MongoDB and a ui-worker (ROLE=ui-worker) draws them with one model call each, several at the same
// time, and hands them back with their usage. Here: one Builder API (ROLE=all, PAGE_LANE=queue) and one
// ui-worker (UI_PARALLEL=3) on one database, a fake model that is slow on purpose, and 3 screenshots.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
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
const MONGODB_URI = databaseUri(process.env.TEST_MONGODB_URI, "ui_worker_test");

// Each screenshot is read as a list of its own table, so the spec has 3 pages on 3 tables.
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
  "m6-approve": listOf("Requests", "request", "requests", "Reason", "Holiday"),
};
// The vision model is sent the upload shrunk to 1280 px (as base64): that is how it knows which screenshot.
const readingFor = new Map();
for (const [name, inventory] of Object.entries(SCREENS)) {
  readingFor.set((await shrinkScreenshot(await readFile(path.join(MOCKS, `${name}.png`)))).data.toString("base64"), inventory);
}

// The fake Ollama: a reading (a JSON schema is sent) gets the employees list; a page (no schema) gets a page
// built from the instructions inside the prompt, after 600 ms, and the most pages drawn at once is counted.
const pages = { running: 0, most: 0, drawn: 0 };
const fakeOllama = await new Promise((resolve) => {
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let content;
    if (body.format) content = JSON.stringify(readingFor.get(body.messages[0].images[0]));
    else {
      pages.most = Math.max(pages.most, ++pages.running);
      await new Promise((r) => setTimeout(r, 600));
      pages.running--;
      pages.drawn++;
      content = "```html\n" + fakePage(body.messages[0].content) + "\n```";
    }
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

async function service(role, extra = {}) {
  const port = await freePort();
  const env = { ...process.env, ROLE: role, PORT: String(port), HOST: "127.0.0.1", MONGODB_URI, OLLAMA_URL: `http://127.0.0.1:${fakeOllama.address().port}`, DEFAULT_MODE: "local", GEMINI_API_KEY: "", PREVIEW_PORT: "0", ...extra };
  delete env.GATEWAY_URL;
  delete env.GATEWAY_API_KEY;
  const proc = spawn(process.execPath, ["src/server.js"], { cwd: API_DIR, env });
  const s = { proc, root: `http://127.0.0.1:${port}`, log: "" };
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  for (let i = 0; i < 600; i++) {
    if (/listening/.test(s.log)) return s;
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${role} did not start:\n${s.log}`);
}

let builder;
let worker;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  [builder, worker] = await Promise.all([service("all", { PAGE_LANE: "queue", GATEWAY_POLL_MS: "100" }), service("ui-worker", { UI_PARALLEL: "3", PICKUP_MS: "100" })]);
});
after(async () => {
  builder?.proc.kill();
  worker?.proc.kill();
  fakeOllama.close();
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("ui-worker: pages from the queue, several at the same time (Step 26)", () => {
  it("draws the 3 pages of a 3-screenshot project at the same time, and the project reaches READY", async () => {
    const form = new FormData();
    form.append("fresh", "true");
    for (const name of Object.keys(SCREENS)) {
      form.append("image", new Blob([await readFile(path.join(MOCKS, `${name}.png`))], { type: "image/png" }), `${name}.png`);
    }
    const created = await fetch(`${builder.root}/api/projects`, { method: "POST", body: form });
    assert.equal(created.status, 201, await created.clone().text());
    const { id } = await created.json();

    let project;
    for (let i = 0; i < 300; i++) {
      project = await (await fetch(`${builder.root}/api/projects/${id}`)).json();
      if (["READY", "NEEDS_ATTENTION"].includes(project.state)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(project.state, "READY", `${project.error}\n--- builder\n${builder.log.slice(-1500)}\n--- worker\n${worker.log.slice(-1500)}`);
    assert.equal(pages.drawn, 3);
    assert.equal(pages.most, 3, "all 3 pages were drawn at the same time");
    const frontend = project.jobs.filter((j) => j.kind === "frontend");
    assert.equal(frontend.length, 3);
    assert.ok(frontend.every((j) => j.usage?.[0]?.purpose === "page" && j.usage[0].outputTokens === 500), "each page's usage came back from the ui-worker");
  });

  it("the ui-worker has only its health checks", async () => {
    assert.equal((await fetch(`${worker.root}/healthz`)).status, 200);
    assert.equal((await fetch(`${worker.root}/api/projects`)).status, 404);
  });
});
