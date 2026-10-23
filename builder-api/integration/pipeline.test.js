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
import { fakePage } from "./helpers/fake-s2c.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCKS = path.resolve(API_DIR, "../samples/mocks");
const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");

// ---- fake Ollama: answers /api/chat with the next prepared inventory ----
const inventoryQueue = [];
// ---- fake Gateway: finishes every job at once with a page built from the instructions (see helpers/fake-s2c.js);
// a "Staff" page comes back without markers, so the Verifier has something to catch ----
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

// A request without an image is the coding AI (Step 13): it gets the code prepared for that button.
const codeFor = {}; // button label -> function body, or null for code that is always refused
const codeRequests = [];
const fakeOllama = await jsonServer(async (req, body) => {
  if (!body.messages[0].images) {
    const button = Object.keys(codeFor).find((label) => body.messages[0].content.includes(`"${label}"`));
    codeRequests.push(button);
    const fnBody = button ? codeFor[button] : null;
    const code = `export default async function ({ record, input, helpers }) {\n${fnBody ?? "  process.exit(1);"}\n}`;
    return { json: { message: { content: "```js\n" + code + "\n```" } } };
  }
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
      html: /page title "Staff"/.test(body.instructions) ? `<!doctype html><html><body><!-- ${firstRule} --></body></html>` : fakePage(body.instructions),
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
      PREVIEW_IDLE_MS: "2500", // the live preview stops after 2.5 s without use (15 min normally)
      PREVIEW_PORT: "0", // any free port (normally the API's port + 1)
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
const settled = (p) => ["READY", "NEEDS_ATTENTION"].includes(p.state);

describe("pipeline: screenshots -> spec -> pages -> SYNCED -> Wire -> Check -> READY", () => {
  it("builds a spec from two screenshots and one page per screenshot", async () => {
    const before = submissions.length;
    const id = await upload(["m5a-employees-dept.png", "m5b-departments.png"], [employeesScreen, departmentsScreen]);
    const project = await waitFor(id, settled);

    assert.equal(project.state, "READY", project.error);
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
    assert.match(await page2.text(), /<h1>Departments<\/h1>/);
  });

  it("gives a login screenshot login instructions and auth in the spec", async () => {
    const before = submissions.length;
    const id = await upload(["m4-login.png", "m1-edit-delete.png"], [loginScreen, employeesScreen]);
    const project = await waitFor(id, settled);

    assert.equal(project.state, "READY", project.error);
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

  it("rebuilds the pages for a valid edit and reaches READY on the new version", async () => {
    const id = await upload(["m1-edit-delete.png"], [employeesScreen]);
    const v1 = await waitFor(id, settled);
    const edited = structuredClone(v1.contract.body);
    edited.entities[0].fields[0].label = "Employee Name";

    const res = await fetch(`${base}/projects/${id}/contract`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
    assert.equal(res.status, 200);
    const v2 = await waitFor(id, (p) => p.currentContractVersion === 2 && settled(p));

    assert.equal(v2.state, "READY", v2.error);
    assert.ok(v2.jobs.some((j) => j.kind === "frontend" && j.contractHash === v2.contract.hash && j.status === "done"));
    assert.match(await (await fetch(`${base}/projects/${id}/frontend`)).text(), /<html>/);
  });
});

describe("pipeline: real backend from the generator", () => {
  it("writes a generated backend for the current spec and stamps the job with its hash", async () => {
    const id = await upload(["m5a-employees-dept.png", "m5b-departments.png"], [employeesScreen, departmentsScreen]);
    const project = await waitFor(id, settled);
    assert.equal(project.state, "READY", project.error);

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

describe("pipeline: custom buttons get code from the coding AI (Step 13)", () => {
  let project;
  let backend;
  let root;
  before(async () => {
    codeFor["Give Raise"] = '  return { message: "Raise noted for " + record.fullName };';
    codeFor["Sync Payroll"] = null; // every answer is unsafe: the button is isolated
    const screen = { ...employeesScreen, tables: [{ ...employeesScreen.tables[0], rowActions: ["Edit", "Delete", "Give Raise"] }], buttons: [{ label: "Sync Payroll" }] };
    const id = await upload(["m1-edit-delete.png"], [screen]);
    project = await waitFor(id, settled);
    backend = project.jobs.find((j) => j.kind === "backend" && j.contractHash === project.contract.hash);
    root = path.resolve(API_DIR, "..", backend.artifactPath);
  });

  it("writes the code of a button that works when pressed, and says which AI wrote it", async () => {
    const fs = await import("node:fs/promises");
    assert.match(await fs.readFile(path.join(root, "backend/custom/giveRaiseEmployee.js"), "utf8"), /Raise noted/);
    const raise = backend.custom.find((c) => c.operation === "giveRaiseEmployee");
    assert.deepEqual({ ok: raise.ok, provider: raise.provider, answers: raise.answers }, { ok: true, provider: "local", answers: 1 });
    assert.equal(backend.provider, "local");
  });

  it("isolates a button whose code never passes: no file, the problem kept, the app still READY", async () => {
    const fs = await import("node:fs/promises");
    await assert.rejects(fs.access(path.join(root, "backend/custom/syncPayrollEmployee.js")));
    const sync = backend.custom.find((c) => c.operation === "syncPayrollEmployee");
    assert.equal(sync.ok, false);
    assert.equal(sync.answers, 4, "the first answer and 3 repairs");
    assert.match(sync.problem, /safety check refused it/);
    assert.match(backend.note, /custom buttons: 1 of 2 written/);
    assert.equal(project.state, "READY", project.error);
  });

  it("the app's own tests expect an answer from the written button and 501 from the isolated one", async () => {
    const fs = await import("node:fs/promises");
    const tests = await fs.readFile(path.join(root, "tests/api.test.js"), "utf8");
    assert.match(tests, /Give Raise answers \(its code is in backend\/custom\/giveRaiseEmployee\.js\)/);
    assert.match(tests, /Sync Payroll answers 501/);
    const { report } = await (await fetch(`${base}/projects/${project.id}/verify`)).json();
    assert.equal(report.checks.find((c) => c.id === "tests").status, "pass");
  });

  it("the Check presses the written button like a person and sees its answer; the isolated one says not available", async () => {
    const { report } = await (await fetch(`${base}/projects/${project.id}/verify`)).json();
    const raise = report.checks.find((c) => c.id === "action:giveRaiseEmployee:p1");
    assert.equal(raise?.status, "pass", JSON.stringify(raise));
    assert.match(raise.detail, /Raise noted for/);
    assert.equal(report.checks.find((c) => c.id === "action:syncPayrollEmployee:p1")?.status, "note");
  });
});

// ---- endpoints for the UI: screenshots, generated files, download as zip ----
describe("UI endpoints", () => {
  let id;
  before(async () => {
    id = await upload(["m5a-employees-dept.png", "m5b-departments.png"], [employeesScreen, departmentsScreen]);
    const project = await waitFor(id, settled);
    assert.equal(project.state, "READY", project.error);
  });

  it("serves each uploaded screenshot, and 404 for one that doesn't exist", async () => {
    const res = await fetch(`${base}/projects/${id}/screenshots/2`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/projects/${id}/screenshots/3`)).status, 404);
  });

  it("lists the generated app's files and shows one, refusing paths outside the app", async () => {
    const { files } = await (await fetch(`${base}/projects/${id}/files`)).json();
    const paths = files.map((f) => f.path);
    for (const p of ["package.json", "backend/server.js", "backend/routes/employee.routes.js", "tests/api.test.js"]) assert.ok(paths.includes(p), p);
    const content = await fetch(`${base}/projects/${id}/files/content?path=backend/server.js`);
    assert.equal(content.status, 200);
    assert.match(await content.text(), /express/);
    for (const bad of ["../../package.json", "..%2F..%2F.env", "/etc/passwd"]) {
      assert.equal((await fetch(`${base}/projects/${id}/files/content?path=${bad}`)).status, 400, bad);
    }
  });

  it("downloads the app as a zip with backend, pages, README and the spec", async () => {
    const res = await fetch(`${base}/projects/${id}/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition"), /attachment; filename="?[\w.-]+\.zip"?/); // quotes are optional

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const { spawnSync } = await import("node:child_process");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-"));
    try {
      await fs.writeFile(path.join(dir, "app.zip"), Buffer.from(await res.arrayBuffer()));
      const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "tar";
      assert.equal(spawnSync(tar, ["-xf", path.join(dir, "app.zip"), "-C", dir]).status, 0);
      for (const file of ["package.json", "backend/server.js", "tests/api.test.js", "frontend/index.html", "frontend/page-1.html", "frontend/page-2.html", "README.md", "app-spec.json"]) {
        await fs.access(path.join(dir, file));
      }
      const readme = await fs.readFile(path.join(dir, "README.md"), "utf8");
      assert.match(readme, /npm install/);
      assert.match(readme, /s1: /, "the README says why each part exists");

      // Step 15: the pages are wired to the backend (binder + map), the rest of each page unchanged.
      for (const file of ["frontend/app.js", "frontend/api-map.json"]) await fs.access(path.join(dir, file));
      const map = JSON.parse(await fs.readFile(path.join(dir, "frontend/api-map.json"), "utf8"));
      assert.equal(map.entities.employee.url, "/api/employees");
      for (const page of ["index.html", "page-1.html", "page-2.html"]) {
        assert.match(await fs.readFile(path.join(dir, "frontend", page), "utf8"), /<script src="app\.js"><\/script><\/body>/, page);
      }
      assert.match(readme, /connected to the backend/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the UI's page preview exactly as Laptop B built it (not wired)", async () => {
    const preview = await (await fetch(`${base}/projects/${id}/frontend?page=1`)).text();
    assert.match(preview, /<html>/);
    assert.doesNotMatch(preview, /app\.js/);
  });

  it("refuses to download a project that is not READY", async () => {
    const failed = await upload(["m4-login.png"], [emptyScreen]);
    await waitFor(failed, settled);
    assert.equal((await fetch(`${base}/projects/${failed}/download`)).status, 409);
  });
});

// ---- Step 16: after SYNCED, the pages are wired into the app and the Verifier checks it ----
const staffScreen = listScreen("Staff", { singular: "staffMember", plural: "staffMembers" }, [["Full Name", ["Ann Lee"]]], ["Delete"]);

async function unzip(res) {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-"));
  await fs.writeFile(path.join(dir, "app.zip"), Buffer.from(await res.arrayBuffer()));
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "tar";
  assert.equal(spawnSync(tar, ["-xf", path.join(dir, "app.zip"), "-C", dir]).status, 0);
  return { dir, read: (file) => fs.readFile(path.join(dir, file), "utf8"), cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

describe("Check (Step 16): wire, verify, READY", () => {
  let id;
  before(async () => {
    id = await upload(["m1-edit-delete.png"], [employeesScreen]);
    const project = await waitFor(id, settled);
    assert.equal(project.state, "READY", project.error);
  });

  it("keeps the report: every check passed, with Edit and Delete tried on the page", async () => {
    const res = await fetch(`${base}/projects/${id}/verify`);
    assert.equal(res.status, 200);
    const { report } = await res.json();
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.status === "fail")));
    for (const check of ["markers:p1", "health", "edit:p1", "delete:p1", "tests"]) {
      assert.equal(report.checks.find((c) => c.id === check)?.status, "pass", check);
    }
  });

  it("writes the wired pages into the app folder (the folder is the finished app)", async () => {
    const { files } = await (await fetch(`${base}/projects/${id}/files`)).json();
    const paths = files.map((f) => f.path);
    for (const p of ["frontend/app.js", "frontend/api-map.json", "frontend/page-1.html"]) assert.ok(paths.includes(p), p);
    assert.ok(!paths.some((p) => p.startsWith("node_modules")), "the package link is not part of the app");
  });

  it("downloads at READY, with verify-report.md in the zip and no package link", async () => {
    const res = await fetch(`${base}/projects/${id}/download`);
    assert.equal(res.status, 200);
    const zip = await unzip(res);
    try {
      assert.match(await zip.read("verify-report.md"), /All checks passed/);
      assert.match(await zip.read("frontend/page-1.html"), /<script src="app\.js"><\/script>/);
      const fs = await import("node:fs/promises");
      await assert.rejects(fs.access(path.join(zip.dir, "node_modules")));
    } finally {
      await zip.cleanup();
    }
  });
});

describe("Check (Step 16): a page without markers stops the project", () => {
  let id;
  let project;
  before(async () => {
    id = await upload(["m1-edit-delete.png"], [staffScreen]);
    project = await waitFor(id, settled);
  });

  it("goes to NEEDS_ATTENTION and says which check failed", () => {
    assert.equal(project.state, "NEEDS_ATTENTION");
    assert.match(project.error, /check/i);
    assert.match(project.error, /Missing on this page/);
  });

  it("keeps the report with the failing check and the layer to blame", async () => {
    const { report } = await (await fetch(`${base}/projects/${id}/verify`)).json();
    assert.equal(report.ok, false);
    const markers = report.checks.find((c) => c.id === "markers:p1");
    assert.equal(markers.status, "fail");
    assert.equal(markers.layer, "page");
  });

  it("refuses the download, unless asked for anyway (then the report is in the zip)", async () => {
    assert.equal((await fetch(`${base}/projects/${id}/download`)).status, 409);
    const res = await fetch(`${base}/projects/${id}/download?anyway=1`);
    assert.equal(res.status, 200);
    const zip = await unzip(res);
    try {
      assert.match(await zip.read("verify-report.md"), /Missing on this page/);
    } finally {
      await zip.cleanup();
    }
  });
});

// ---- Step 16: the live preview (the Pages tab's "Live" view) ----
describe("Live preview: the wired app on its own test database, on its own local address", () => {
  // e.g. http://127.0.0.1:4001: another site than the UI, so a generated page can't reach the UI.
  let previewOrigin;
  const origin = () => previewOrigin;
  let id;
  before(async () => {
    id = await upload(["m1-edit-delete.png"], [employeesScreen]);
    assert.equal((await waitFor(id, settled)).state, "READY");
  });

  it("starts on request, on another port than the UI, and serves the wired pages and their API", async () => {
    const res = await fetch(`${base}/projects/${id}/preview`, { method: "POST" });
    assert.equal(res.status, 200);
    const preview = await res.json();
    const url = new URL(preview.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.notEqual(url.port, new URL(base).port, "not the UI's address");
    assert.equal(url.pathname, `/preview/${id}/page-1.html`);
    previewOrigin = url.origin;
    assert.equal(preview.credentials, null, "no login screen: nothing to sign in with");
    assert.match(await (await fetch(preview.url)).text(), /<script src="app\.js"><\/script>/);
    assert.deepEqual(await (await fetch(`${origin()}/preview/${id}/health`)).json(), { ok: true, db: true });
    // It starts with the page's sample rows (here the fake page's one row), so row buttons can be tried at once.
    const { items } = await (await fetch(`${origin()}/preview/${id}/api/employees`)).json();
    assert.deepEqual(items.map((e) => e.fullName), ["Sample Full Name"]);
  });

  it("reuses the running preview, and stops on request", async () => {
    const again = await (await fetch(`${base}/projects/${id}/preview`, { method: "POST" })).json();
    assert.equal(again.url, `${previewOrigin}/preview/${id}/page-1.html`);
    assert.equal((await fetch(`${base}/projects/${id}/preview`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${origin()}/preview/${id}/health`)).status, 404);
  });

  it("gives sign-in details for an app with a login screen, and they work", async () => {
    const loginId = await upload(["m4-login.png", "m1-edit-delete.png"], [loginScreen, employeesScreen]);
    assert.equal((await waitFor(loginId, settled)).state, "READY");
    const { credentials } = await (await fetch(`${base}/projects/${loginId}/preview`, { method: "POST" })).json();
    assert.ok(credentials.email && credentials.password);
    const login = await fetch(`${origin()}/preview/${loginId}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    assert.equal(login.status, 200);
    await fetch(`${base}/projects/${loginId}/preview`, { method: "DELETE" });
  });

  it("is not available before the app is built and wired", async () => {
    const failed = await upload(["m4-login.png"], [emptyScreen]);
    await waitFor(failed, settled);
    assert.equal((await fetch(`${base}/projects/${failed}/preview`, { method: "POST" })).status, 409);
  });

  it("stops by itself when nobody uses it (PREVIEW_IDLE_MS)", async () => {
    await fetch(`${base}/projects/${id}/preview`, { method: "POST" });
    assert.equal((await fetch(`${origin()}/preview/${id}/health`)).status, 200);
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal((await fetch(`${origin()}/preview/${id}/health`)).status, 404);
  });
});
