// Integration: the real Builder API + orchestrator + MongoDB, with a fake Ollama and a fake Gateway.
// Upload screenshots -> inventory per screenshot -> spec -> one Gateway job per page -> Barrier -> SYNCED.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_db_itest npm run test:integration
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCKS = path.resolve(API_DIR, "../samples/mocks");
const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");

// ---- fake Ollama: answers /api/chat with the next prepared inventory ----
const inventoryQueue = [];
// ---- fake Gateway: finishes every job at once and records what it was sent ----
const gatewayJobs = new Map();
const submissions = [];

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

const fakeOllama = await jsonServer(async (req) => {
  const inventory = inventoryQueue.shift();
  if (!inventory) return { status: 500, json: { error: "test prepared no inventory" } };
  return { json: { message: { content: JSON.stringify(inventory) } } };
});

const fakeGateway = await jsonServer(async (req, body) => {
  if (req.headers["x-api-key"] !== "test-key") return { status: 401, json: { error: "bad key" } };
  if (req.method === "POST" && req.url === "/v1/generations") {
    const jobId = randomUUID();
    submissions.push({ jobId, instructions: body.instructions, contractHash: body.contractHash, mode: body.mode });
    const firstRule = body.instructions.split("\n").find((l) => l.startsWith("Data:") || l.startsWith("This is a sign-in page")) ?? "";
    gatewayJobs.set(jobId, {
      jobId,
      status: "done",
      provider: "local",
      contractHash: body.contractHash,
      html: `<!doctype html><html><body><!-- ${firstRule} --></body></html>`,
    });
    return { status: 202, json: { jobId, status: "running" } };
  }
  const job = gatewayJobs.get(req.url.split("/").pop());
  return job ? { json: job } : { status: 404, json: { error: "no such job" } };
});

const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;

// ---- prepared inventories (what the vision model would report) ----
const listScreen = (title, hint, columns, rowActions, extra = {}) => ({
  title,
  kind: "list",
  tables: [{ entityHint: hint, columns: columns.map(([label, values]) => ({ label, values, badge: false })), rowActions }],
  forms: [],
  buttons: [],
  search: false,
  filters: [],
  pagination: false,
  statCards: [],
  auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
  ...extra,
});
const employeesScreen = listScreen("Employees", { singular: "employee", plural: "employees" }, [["Full Name", ["Ann Lee"]], ["Department", ["HR", "Sales"]]], ["Edit", "Delete"]);
const departmentsScreen = listScreen("Departments", { singular: "department", plural: "departments" }, [["Name", ["HR", "Sales"]]], ["Delete"]);
const loginScreen = {
  ...listScreen("Sign in", undefined, [], []),
  kind: "login",
  tables: [],
  auth: { loginForm: true, signupLink: false, userMenu: false, roleIndicators: [] },
};
const emptyScreen = { ...listScreen("", undefined, [], []), kind: "other", tables: [] };

// ---- the Builder API under test ----
let api;
let base;
let apiLog = "";

before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  const port = await new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address(); // read before close: address() is null afterwards
      probe.close(() => resolve(free));
    });
  });
  base = `http://127.0.0.1:${port}/api`;
  api = spawn(process.execPath, ["src/server.js"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      MONGODB_URI,
      OLLAMA_URL: urlOf(fakeOllama),
      GATEWAY_URL: urlOf(fakeGateway),
      GATEWAY_API_KEY: "test-key",
      GATEWAY_POLL_MS: "100",
      DEFAULT_MODE: "local",
      GEMINI_API_KEY: "",
    },
  });
  api.stdout.on("data", (d) => (apiLog += d));
  api.stderr.on("data", (d) => (apiLog += d));
  for (let i = 0; i < 100; i++) {
    if (/listening/.test(apiLog)) return;
    if (api.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Builder API did not start:\n${apiLog}`);
});

after(() => {
  api?.kill();
  fakeOllama.close();
  fakeGateway.close();
});

async function upload(files, inventories) {
  inventoryQueue.push(...inventories);
  const form = new FormData();
  for (const file of files) {
    const bytes = await import("node:fs/promises").then((fs) => fs.readFile(path.join(MOCKS, file)));
    form.append("image", new Blob([bytes], { type: "image/png" }), file);
  }
  const res = await fetch(`${base}/projects`, { method: "POST", body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).id;
}

async function waitFor(id, done) {
  let project;
  for (let i = 0; i < 100; i++) {
    project = await (await fetch(`${base}/projects/${id}`)).json();
    if (done(project)) return project;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.fail(`Timed out in state ${project?.state} (${project?.error ?? "no error"})\n${apiLog.slice(-2000)}`);
}
const settled = (p) => ["SYNCED", "NEEDS_ATTENTION"].includes(p.state);

describe("pipeline: screenshots -> spec -> pages -> SYNCED", () => {
  it("builds a spec from two screenshots and one page per screenshot", async () => {
    const before = submissions.length;
    const id = await upload(["m5a-employees-dept.png", "m5b-departments.png"], [employeesScreen, departmentsScreen]);
    const project = await waitFor(id, settled);

    assert.equal(project.state, "SYNCED", project.error);
    const spec = project.contract.body;
    assert.deepEqual(spec.entities.map((e) => e.name), ["employee", "department"]);
    assert.equal(spec.entities[0].fields.find((f) => f.name === "department").type, "ref");

    const pages = project.jobs.filter((j) => j.kind === "frontend");
    assert.deepEqual(pages.map((j) => j.page).sort(), [1, 2]);
    assert.ok(pages.every((j) => j.status === "done" && j.contractHash === project.contract.hash));

    const sent = submissions.slice(before);
    assert.equal(sent.length, 2, "one Gateway job per screenshot");
    assert.ok(sent.some((s) => /Data: employee\b/.test(s.instructions)));
    assert.ok(sent.some((s) => /Data: department\b/.test(s.instructions)));

    const page2 = await fetch(`${base}/projects/${id}/frontend?page=2`);
    assert.equal(page2.status, 200);
    assert.match(await page2.text(), /Data: department/);
  });

  it("gives a login screenshot login instructions and auth in the spec", async () => {
    const before = submissions.length;
    const id = await upload(["m4-login.png", "m1-edit-delete.png"], [loginScreen, employeesScreen]);
    const project = await waitFor(id, settled);

    assert.equal(project.state, "SYNCED", project.error);
    assert.ok(project.contract.body.auth.login);
    assert.ok(submissions.slice(before).some((s) => /data-action="login"/.test(s.instructions)));
  });

  it("stops with NEEDS_ATTENTION when a screenshot shows nothing to build", async () => {
    const id = await upload(["m4-login.png"], [emptyScreen]);
    const project = await waitFor(id, settled);
    assert.equal(project.state, "NEEDS_ATTENTION");
    assert.match(project.error, /nothing to build/i);
  });
});

describe("pipeline: editing the spec", () => {
  it("rejects an invalid edit with the checker's problems", async () => {
    const id = await upload(["m1-edit-delete.png"], [employeesScreen]);
    const project = await waitFor(id, settled);
    const broken = structuredClone(project.contract.body);
    broken.entities[0].fields[0].type = "money";

    const res = await fetch(`${base}/projects/${id}/contract`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(broken) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).problems.join(), /unknown type "money"/);
  });

  it("rebuilds the pages for a valid edit and reaches SYNCED on the new version", async () => {
    const id = await upload(["m1-edit-delete.png"], [employeesScreen]);
    const v1 = await waitFor(id, settled);
    const edited = structuredClone(v1.contract.body);
    edited.entities[0].fields[0].label = "Employee Name";

    const res = await fetch(`${base}/projects/${id}/contract`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
    assert.equal(res.status, 200);
    const v2 = await waitFor(id, (p) => p.currentContractVersion === 2 && settled(p));

    assert.equal(v2.state, "SYNCED", v2.error);
    assert.ok(v2.jobs.some((j) => j.kind === "frontend" && j.contractHash === v2.contract.hash && j.status === "done"));
    assert.match(await (await fetch(`${base}/projects/${id}/frontend`)).text(), /<html>/);
  });
});

describe("pipeline: real backend from the generator", () => {
  it("writes a generated backend for the current spec and stamps the job with its hash", async () => {
    const id = await upload(["m5a-employees-dept.png", "m5b-departments.png"], [employeesScreen, departmentsScreen]);
    const project = await waitFor(id, settled);
    assert.equal(project.state, "SYNCED", project.error);

    const backend = project.jobs.find((j) => j.kind === "backend" && j.contractHash === project.contract.hash);
    assert.equal(backend.status, "done");
    assert.doesNotMatch(backend.note ?? "", /placeholder/i);
    const fs = await import("node:fs/promises");
    const root = path.resolve(API_DIR, "..", backend.artifactPath);
    for (const file of ["package.json", "backend/server.js", "backend/routes/employee.routes.js", "backend/routes/department.routes.js", "tests/api.test.js"]) {
      await fs.access(path.join(root, file));
    }
  });
});
