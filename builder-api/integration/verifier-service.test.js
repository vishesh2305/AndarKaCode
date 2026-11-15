// Step 33c: the verifier service (ROLE=verifier). With VERIFY_LANE=queue the orchestrator does not run
// generated apps itself: it puts "verify this app" and "press this button" into MongoDB (box_jobs) and the
// verifier service, the one service that may start sandboxes (SANDBOX=docker; a process here), claims them
// with a lease and hands back the same answer the orchestrator used to get itself.
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
import { claimBoxJob, submitBoxJob, waitBoxJob } from "../src/box-queue.js";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { BoxJob } from "../src/models/box-job.js";
import { databaseUri } from "../src/verify/index.js";
import { lane } from "../src/verify/lane.js";
import { wireApp } from "../src/wirer/index.js";
import { employeesSpec } from "../test/fixtures/page-specs.js";
import { opsSpec } from "../test/fixtures/specs.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(API_DIR, ".generated", "verifier-service");
if (!process.env.TEST_MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");
const MONGODB_URI = databaseUri(process.env.TEST_MONGODB_URI, "verifier_service_test");
const fixture = (name) => readFileSync(new URL(`../test/fixtures/pages/${name}`, import.meta.url), "utf8");
const wrap = (body) => `export default async function ({ record, input, helpers }) {\n${body}\n}`;
const op = (name) => opsSpec.operations.find((o) => o.name === name);

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

let verifier;
let goodApp;
let opsApp;

async function startVerifier() {
  const port = await freePort();
  const env = { ...process.env, ROLE: "verifier", PORT: String(port), HOST: "127.0.0.1", MONGODB_URI, SANDBOX: "process", PICKUP_MS: "100", GEMINI_API_KEY: "", PREVIEW_PORT: "0" };
  const proc = spawn(process.execPath, ["src/server.js"], { cwd: API_DIR, env });
  let output = "";
  proc.stdout.on("data", (c) => (output += c));
  proc.stderr.on("data", (c) => (output += c));
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/readyz`).then((r) => r.ok, () => false);
    if (ok) return { proc, port, output: () => output };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the verifier did not start:\n${output}`);
}

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  goodApp = path.join(OUT, "good");
  await writeBackend(goodApp, { ...generateBackend(employeesSpec, { name: "good" }), ...wireApp({ spec: employeesSpec, pages: [{ screenshot: 1, html: fixture("employees-real.html") }] }) });
  opsApp = path.join(OUT, "ops");
  await writeBackend(opsApp, generateBackend(opsSpec, { name: "ops" }));
});
after(async () => {
  verifier?.proc.kill();
  delete process.env.VERIFY_LANE;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  await rm(OUT, { recursive: true, force: true });
});

describe("the box queue", () => {
  it("hands out the waiting job of highest priority, then the oldest, each to one worker with a lease", async () => {
    const free = await submitBoxJob({ kind: "press", input: { n: 1 } });
    const pro = await submitBoxJob({ kind: "press", input: { n: 2 }, priority: 1 });
    const first = await claimBoxJob({ worker: "a", ms: 60_000 });
    const second = await claimBoxJob({ worker: "b", ms: 60_000 });
    assert.deepEqual([first.id, second.id], [pro, free]);
    assert.equal(await claimBoxJob({ worker: "c", ms: 60_000 }), null);
  });

  it("a job whose worker's lease ran out goes to another worker", async () => {
    await BoxJob.deleteMany({});
    const id = await submitBoxJob({ kind: "press", input: {} });
    await claimBoxJob({ worker: "gone", ms: 1 });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await claimBoxJob({ worker: "next", ms: 60_000 })).id, id);
    await BoxJob.deleteMany({});
  });
});

describe("the verifier service (ROLE=verifier)", () => {
  before(async () => {
    verifier = await startVerifier();
  });

  it("presses a button and answers like pressOnce: null when it works, the problem when not", async () => {
    const works = await waitBoxJob(await submitBoxJob({ kind: "press", input: { spec: opsSpec, op: op("recalculateLeaveRequest"), appDir: opsApp, mongoUri: databaseUri(MONGODB_URI, "vs_press"), code: wrap("  return { message: 'ok' };") } }));
    assert.equal(works, null);
    const fails = await waitBoxJob(await submitBoxJob({ kind: "press", input: { spec: opsSpec, op: op("recalculateLeaveRequest"), appDir: opsApp, mongoUri: databaseUri(MONGODB_URI, "vs_press"), code: wrap("  return record.nothing.here;") } }));
    assert.match(fails, /answered 500: custom code failed/);
  });

  it("verifies an app and hands back the whole report", async () => {
    const report = await waitBoxJob(await submitBoxJob({ kind: "verify", input: { spec: employeesSpec, appDir: goodApp, customWritten: [], mongoUri: databaseUri(MONGODB_URI, "vs_verify"), testsMongoUri: databaseUri(MONGODB_URI, "vs_verify_tests") } }));
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.status === "fail")));
    assert.ok(report.checks.some((c) => c.id === "tests" && c.status === "pass"));
  });

  it("the orchestrator's lane with VERIFY_LANE=queue goes through the service, not this process", async () => {
    process.env.VERIFY_LANE = "queue";
    const problem = await lane.press({ spec: opsSpec, op: op("recalculateLeaveRequest"), appDir: opsApp, mongoUri: databaseUri(MONGODB_URI, "vs_lane"), code: wrap("  return { message: 'ok' };") });
    assert.equal(problem, null);
    const job = await BoxJob.findOne({ kind: "press" }).sort({ createdAt: -1 }).lean();
    assert.equal(job.status, "done");
    assert.match(job.worker, new RegExp(`:${verifier.proc.pid}:`), "claimed by the verifier service");
  });

  it("a job that throws fails with its reason, and the service carries on", async () => {
    await assert.rejects(waitBoxJob(await submitBoxJob({ kind: "press", input: { spec: opsSpec, op: { name: "nope", entity: "Nope" }, appDir: opsApp, mongoUri: databaseUri(MONGODB_URI, "vs_bad"), code: "" } })), /./);
    assert.equal((await fetch(`http://127.0.0.1:${verifier.port}/readyz`)).status, 200);
  });

  it("answers only its health checks over HTTP", async () => {
    const res = await fetch(`http://127.0.0.1:${verifier.port}/api/projects`);
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /verifier service/);
  });
});
