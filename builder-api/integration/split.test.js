// Step 24: the Builder API as two services that only meet in MongoDB. ROLE=api takes uploads, serves the
// UI and status, and saves what should be built; ROLE=orchestrator finds those projects, takes their lease
// and builds them. Here both run as separate processes on one database, with a fake vision model and a
// fake Gateway, and an uploaded project reaches READY. (ROLE=all, the default, is the one process of today.)
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { databaseUri } from "../src/verify/index.js";
import { fakePage } from "./helpers/fake-s2c.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCKS = path.resolve(API_DIR, "../samples/mocks");
if (!process.env.TEST_MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");
const MONGODB_URI = databaseUri(process.env.TEST_MONGODB_URI, "split_test");
const FAKE_GATEWAY_KEY = randomBytes(16).toString("hex"); // made up at every run

function jsonServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { status = 200, json } = await handler(req, body ? JSON.parse(body) : null);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(json));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;

// The vision model reads every screenshot as the same small employees list.
const employees = {
  title: "Employees",
  kind: "list",
  tables: [{ entityHint: { singular: "employee", plural: "employees" }, columns: [{ label: "Full Name", values: ["Ann Lee"], badge: false }], rowActions: ["Edit", "Delete"] }],
  forms: [],
  buttons: [],
  search: false,
  filters: [],
  pagination: false,
  statCards: [],
  auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
};
const visionCalls = [];
const fakeOllama = await jsonServer(async () => (visionCalls.push(Date.now()), { json: { message: { content: JSON.stringify(employees) } } }));

const gatewayJobs = new Map();
const fakeGateway = await jsonServer(async (req, body) => {
  if (req.headers["x-api-key"] !== FAKE_GATEWAY_KEY) return { status: 401, json: { error: "bad key" } };
  if (req.method === "POST") {
    const jobId = randomUUID();
    gatewayJobs.set(jobId, { jobId, status: "done", provider: "local", contractHash: body.contractHash, html: fakePage(body.instructions) });
    return { status: 202, json: { jobId, status: "running" } };
  }
  const job = gatewayJobs.get(req.url.split("/").pop());
  return job ? { json: job } : { status: 404, json: { error: "no such job" } };
});

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// One service: a Builder API process with the given ROLE. Resolves once it says it is listening.
async function service(role) {
  const port = await freePort();
  const proc = spawn(process.execPath, ["src/server.js"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      ROLE: role,
      PORT: String(port),
      HOST: "127.0.0.1",
      MONGODB_URI,
      OLLAMA_URL: urlOf(fakeOllama),
      GATEWAY_URL: urlOf(fakeGateway),
      GATEWAY_API_KEY: FAKE_GATEWAY_KEY,
      GATEWAY_POLL_MS: "100",
      PICKUP_MS: "300",
      DEFAULT_MODE: "local",
      GEMINI_API_KEY: "",
      PREVIEW_PORT: "0",
    },
  });
  const s = { role, proc, root: `http://127.0.0.1:${port}`, log: "" };
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  for (let i = 0; i < 600; i++) {
    if (/listening/.test(s.log)) return s;
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${role} did not start:\n${s.log}`);
}

let api;
let orchestrator;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  [api, orchestrator] = await Promise.all([service("api"), service("orchestrator")]);
});
after(async () => {
  api?.proc.kill();
  orchestrator?.proc.kill();
  fakeOllama.close();
  fakeGateway.close();
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function upload() {
  const form = new FormData();
  form.append("fresh", "true");
  form.append("image", new Blob([await readFile(path.join(MOCKS, "m1-edit-delete.png"))], { type: "image/png" }), "m1.png");
  const res = await fetch(`${api.root}/api/projects`, { method: "POST", body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).id;
}

async function settled(id) {
  for (let i = 0; i < 300; i++) {
    const project = await (await fetch(`${api.root}/api/projects/${id}`)).json();
    if (["READY", "NEEDS_ATTENTION"].includes(project.state)) return project;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.fail(`not settled\n--- api\n${api.log.slice(-1500)}\n--- orchestrator\n${orchestrator.log.slice(-1500)}`);
}

describe("two services on one database (Step 24)", () => {
  it("the API takes the upload and the orchestrator builds it to READY", async () => {
    const before = visionCalls.length;
    const project = await settled(await upload());
    assert.equal(project.state, "READY", project.error);
    assert.equal(visionCalls.length, before + 1, "read once");
    assert.match(orchestrator.log, /READY/, "the orchestrator did the building");
    assert.doesNotMatch(api.log, /\] READY/, "the API did not build anything");
  });

  it("the orchestrator has no UI and no project API, only its health checks", async () => {
    assert.equal((await fetch(`${orchestrator.root}/healthz`)).status, 200);
    assert.deepEqual(await (await fetch(`${orchestrator.root}/readyz`)).json(), { ready: true, db: true });
    assert.equal((await fetch(`${orchestrator.root}/api/projects`)).status, 404);
  });

  it("a spec edit on the API is rebuilt by the orchestrator", async () => {
    const id = (await settled(await upload())).id;
    const project = await (await fetch(`${api.root}/api/projects/${id}`)).json();
    const edited = structuredClone(project.contract.body);
    edited.entities[0].label = "Staff";
    const res = await fetch(`${api.root}/api/projects/${id}/contract`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
    assert.equal(res.status, 200, await res.clone().text());
    let again;
    for (let i = 0; i < 300; i++) {
      again = await (await fetch(`${api.root}/api/projects/${id}`)).json();
      if (again.state === "READY" && again.contract.version === 2) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(again.contract.version, 2);
    assert.equal(again.state, "READY", again.error);
  });
});
