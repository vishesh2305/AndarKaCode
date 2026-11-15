// Step 33b: with SANDBOX=docker, everything that runs a generated app runs it in a sandbox (Step 33a): the
// Verifier (the app used like a person, and its own tests), the button tester (custom code pressed once),
// and the live preview. Their answers are the same as before; nothing is left running afterwards.
// Needs Docker (the sandbox image is built first, cached after the first time).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { pressOnce } from "../src/custom/tester.js";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { runningApps } from "../src/verify/app-runner.js";
import { verifyApp } from "../src/verify/index.js";
import { previewOf, startPreview, stopPreview } from "../src/verify/preview.js";
import { buildSandboxImage, openSandboxes } from "../src/verify/sandbox.js";
import { wireApp } from "../src/wirer/index.js";
import { employeesSpec } from "../test/fixtures/page-specs.js";
import { opsSpec } from "../test/fixtures/specs.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "sandbox-callers");
const fixture = (name) => readFileSync(new URL(`../test/fixtures/pages/${name}`, import.meta.url), "utf8");
// Where our own MongoDB would be: with the sandbox, nothing may be created there (it is not even reachable).
const OURS = "mongodb://127.0.0.1:1/never_used";

const op = (name) => opsSpec.operations.find((o) => o.name === name);
const wrap = (body) => `export default async function ({ record, input, helpers }) {\n${body}\n}`;

const nothingLeft = async () => {
  assert.deepEqual(openSandboxes(), [], "no sandbox left open");
  assert.deepEqual(runningApps(), [], "no app started as a process");
};

before(async () => {
  process.env.SANDBOX = "docker";
  await rm(OUT, { recursive: true, force: true });
  await buildSandboxImage();
});
after(async () => {
  delete process.env.SANDBOX;
  await rm(OUT, { recursive: true, force: true });
});

describe("the Verifier, with SANDBOX=docker", () => {
  it("passes a good app on every check (health, its own tests, add, edit, search, delete) and leaves nothing behind", async () => {
    const appDir = path.join(OUT, "good");
    await writeBackend(appDir, { ...generateBackend(employeesSpec, { name: "good" }), ...wireApp({ spec: employeesSpec, pages: [{ screenshot: 1, html: fixture("employees-real.html") }] }) });
    const report = await verifyApp({ spec: employeesSpec, appDir, mongoUri: OURS, testsMongoUri: OURS });
    for (const id of ["health", "tests", "markers:p1", "add:p1", "reload:p1", "edit:p1", "search:p1", "delete:p1"]) {
      const check = report.checks.find((c) => c.id === id);
      assert.equal(check?.status, "pass", `${id}: ${check?.detail}`);
    }
    assert.equal(report.ok, true);
    await nothingLeft();
  });
});

describe("the button tester, with SANDBOX=docker", () => {
  const appDir = path.join(OUT, "ops");
  before(() => writeBackend(appDir, generateBackend(opsSpec, { name: "ops" })));

  it("working code: no problem", async () => {
    const code = wrap("  const updated = await helpers.update(record.id, { days: (record.days ?? 0) + 1 });\n  return { message: `Now ${updated.days}` };");
    assert.equal(await pressOnce({ spec: opsSpec, op: op("recalculateLeaveRequest"), appDir, mongoUri: OURS, code }), null);
    await nothingLeft();
  });

  it("code that throws, or changes other rows: the same problems as before", async () => {
    const thrown = await pressOnce({ spec: opsSpec, op: op("recalculateLeaveRequest"), appDir, mongoUri: OURS, code: wrap("  return record.nothing.here;") });
    assert.match(thrown, /pressing "Recalculate" answered 500: custom code failed/);
    const others = await pressOnce({ spec: opsSpec, op: op("recalculateLeaveRequest"), appDir, mongoUri: OURS, code: wrap("  await helpers.updateMany({}, { days: 42 });\n  return { message: 'x' };") });
    assert.match(others, /also changed another row/);
    await nothingLeft();
  });
});

describe("the live preview, with SANDBOX=docker", () => {
  it("starts with its starting rows, answers through its address, and is removed when it stops", async () => {
    const appDir = path.join(OUT, "preview");
    await writeBackend(appDir, { ...generateBackend(employeesSpec, { name: "preview" }), ...wireApp({ spec: employeesSpec, pages: [{ screenshot: 1, html: fixture("employees-real.html") }] }) });
    const seed = async () => ({ employees: [{ name: "Asha Rao", email: "asha@example.com", createdAt: new Date(), updatedAt: new Date() }] });
    const preview = await startPreview({ projectId: "p-sandbox", hash: "h1", appDir, auth: false, mongoUri: OURS, seed });
    assert.equal(previewOf("p-sandbox"), preview);
    const { items } = await (await fetch(`${preview.app.url}/api/employees`)).json();
    assert.deepEqual(items.map((e) => e.name), ["Asha Rao"]);
    assert.equal((await fetch(`${preview.app.url}/page-1.html`)).status, 200);
    assert.equal(openSandboxes().length, 1);

    await stopPreview("p-sandbox");
    assert.equal(previewOf("p-sandbox"), null);
    await assert.rejects(fetch(`${preview.app.url}/health`, { signal: AbortSignal.timeout(3000) }));
    await nothingLeft();
  });
});

describe("nothing of ours was touched", () => {
  it("our MongoDB was never needed (its address does not even answer)", async () => {
    await assert.rejects(mongoose.createConnection(OURS, { serverSelectionTimeoutMS: 500 }).asPromise());
  });
});
