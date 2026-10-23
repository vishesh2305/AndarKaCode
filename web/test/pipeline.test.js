// pipelineStatus: a project (as GET /api/projects/:id returns it) -> what each metro station shows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pipelineStatus } from "../src/pipeline.js";

const HASH = "a".repeat(64);
const OLD = "b".repeat(64);
const t = (s) => new Date(Date.UTC(2026, 9, 20, 10, 0, s)).toISOString();
const job = (kind, status, extra = {}) => ({ kind, status, startedAt: t(0), finishedAt: status === "running" ? undefined : t(10), ...extra });
const project = (overrides) => ({
  state: "UPLOADED",
  currentContractVersion: 0,
  contract: null,
  jobs: [],
  screenshots: [{ path: "x" }, { path: "y" }],
  ...overrides,
});
const withSpec = (overrides) =>
  project({
    currentContractVersion: 1,
    contract: { version: 1, hash: HASH, body: { pages: [{ screenshot: 1 }, { screenshot: 2 }] } },
    ...overrides,
  });
const statuses = (p) => Object.fromEntries(Object.entries(pipelineStatus(p).stations).map(([id, s]) => [id, s.status]));

describe("pipelineStatus", () => {
  it("just uploaded: reading is in progress, everything after waits", () => {
    const s = statuses(project({ jobs: [job("contract", "running")] }));
    assert.deepEqual(s, {
      upload: "done", read: "active", plan: "waiting", pages: "waiting", backend: "waiting",
      sync: "waiting", wire: "waiting", verify: "waiting", ready: "waiting",
    });
    assert.equal(pipelineStatus(project({ jobs: [job("contract", "running")] })).current, "read");
  });

  it("building: plan done, pages in progress on the GPU, backend done", () => {
    const p = withSpec({
      state: "BUILDING",
      jobs: [job("contract", "done"), job("backend", "done", { contractHash: HASH }), job("frontend", "done", { contractHash: HASH, page: 1 }), job("frontend", "running", { contractHash: HASH, page: 2 })],
    });
    const s = statuses(p);
    assert.equal(s.plan, "done");
    assert.equal(s.pages, "active");
    assert.equal(s.backend, "done");
    assert.equal(s.sync, "waiting");
    assert.equal(pipelineStatus(p).current, "pages");
    assert.deepEqual(pipelineStatus(p).stations.pages.pages, [{ page: 1, status: "done" }, { page: 2, status: "running" }]);
  });

  it("SYNCED: everything up to the sync check is done, and wiring is next", () => {
    const p = withSpec({
      state: "SYNCED",
      jobs: [job("contract", "done"), job("backend", "done", { contractHash: HASH }), job("frontend", "done", { contractHash: HASH, page: 1 }), job("frontend", "done", { contractHash: HASH, page: 2 })],
    });
    const s = statuses(p);
    for (const id of ["upload", "read", "plan", "pages", "backend", "sync"]) assert.equal(s[id], "done", id);
    assert.equal(s.wire, "active");
    assert.equal(pipelineStatus(p).current, "wire");
  });

  it("ignores jobs built for an older spec version", () => {
    const p = withSpec({
      state: "BUILDING",
      jobs: [job("contract", "done"), job("frontend", "done", { contractHash: OLD, page: 1 }), job("backend", "done", { contractHash: OLD })],
    });
    assert.equal(statuses(p).pages, "active");
    assert.equal(statuses(p).backend, "active");
  });

  it("a failed screenshot reading marks Read as failed, with the reason", () => {
    const p = project({ state: "NEEDS_ATTENTION", error: "local: Ollama down", jobs: [job("contract", "failed", { error: "local: Ollama down" })] });
    assert.equal(statuses(p).read, "failed");
    assert.equal(pipelineStatus(p).current, "read");
    assert.equal(pipelineStatus(p).error, "local: Ollama down");
  });

  it("a spec the checker rejects marks Plan as failed, not Read", () => {
    const p = project({ state: "NEEDS_ATTENTION", error: "Spec problems: Nothing to build", jobs: [job("contract", "failed", { error: "Spec problems: Nothing to build" })] });
    assert.equal(statuses(p).read, "done");
    assert.equal(statuses(p).plan, "failed");
    assert.equal(pipelineStatus(p).current, "plan");
  });

  it("a failed page build marks Pages as failed", () => {
    const p = withSpec({
      state: "NEEDS_ATTENTION",
      error: "Gateway at http://x is not reachable",
      jobs: [job("contract", "done"), job("backend", "done", { contractHash: HASH }), job("frontend", "failed", { contractHash: HASH, page: 1, error: "Gateway at http://x is not reachable" })],
    });
    assert.equal(statuses(p).pages, "failed");
    assert.equal(pipelineStatus(p).current, "pages");
  });

  it("reports how long each finished station took", () => {
    const p = withSpec({ state: "BUILDING", jobs: [job("contract", "done")] });
    assert.equal(pipelineStatus(p).stations.read.seconds, 10);
  });

  // ---- Step 16: Wire, Check, Ready ----
  const built = [job("contract", "done"), job("backend", "done", { contractHash: HASH }), job("frontend", "done", { contractHash: HASH, page: 1 }), job("frontend", "done", { contractHash: HASH, page: 2 })];
  const report = (fails = 0) => ({
    ok: fails === 0,
    seconds: 7.5,
    summary: { pass: 9, fail: fails, warn: 1, note: 1, skip: 0 },
    checks: [
      { id: "add:p1", page: 1, title: "Add saves", status: fails ? "fail" : "pass", layer: fails ? "spec" : undefined, detail: fails ? "Department: must be one of: Select Department" : "Saved" },
      { id: "tests", title: "The app's own tests pass", status: "pass", detail: "12 tests passed." },
    ],
  });

  it("VERIFYING: wired, the Check is running", () => {
    const p = withSpec({ state: "VERIFYING", jobs: [...built, job("verify", "running", { contractHash: HASH })] });
    const s = statuses(p);
    assert.equal(s.sync, "done");
    assert.equal(s.wire, "done");
    assert.equal(s.verify, "active");
    assert.equal(s.ready, "waiting");
    assert.equal(pipelineStatus(p).current, "verify");
  });

  it("READY: every check passed; the Check station carries the report", () => {
    const p = withSpec({ state: "READY", jobs: [...built, job("verify", "done", { contractHash: HASH, report: report() })] });
    const s = statuses(p);
    for (const id of ["sync", "wire", "verify", "ready"]) assert.equal(s[id], "done", id);
    assert.equal(pipelineStatus(p).current, "ready");
    const verify = pipelineStatus(p).stations.verify;
    assert.deepEqual(verify.summary, { pass: 9, fail: 0, warn: 1, note: 1, skip: 0 });
    assert.equal(verify.seconds, 7.5);
    assert.equal(verify.checks.length, 2);
  });

  it("checks failed: the Check station is failed (not the sync), Ready waits, the failures come first", () => {
    const p = withSpec({ state: "NEEDS_ATTENTION", error: "1 check failed. First: Add saves", jobs: [...built, job("verify", "done", { contractHash: HASH, report: report(1) })] });
    const s = statuses(p);
    assert.equal(s.sync, "done");
    assert.equal(s.wire, "done");
    assert.equal(s.verify, "failed");
    assert.equal(s.ready, "waiting");
    assert.equal(pipelineStatus(p).current, "verify");
    assert.equal(pipelineStatus(p).stations.verify.checks[0].status, "fail");
    assert.equal(pipelineStatus(p).canDownloadAnyway, true);
  });

  it("only a check of the CURRENT spec counts", () => {
    const p = withSpec({ state: "BUILDING", jobs: [...built.slice(0, 1), job("verify", "done", { contractHash: OLD, report: report() })] });
    assert.equal(statuses(p).verify, "waiting");
    assert.equal(pipelineStatus(p).canDownloadAnyway, false);
  });
});

// Step 13: custom buttons, and which view the Pages tab opens on.
describe("custom buttons and the Pages tab", () => {
  const custom = [
    { operation: "giveRaiseEmployee", button: "Give Raise", ok: true, provider: "cloud", answers: 2 },
    { operation: "syncPayrollEmployee", button: "Sync Payroll", ok: false, provider: null, answers: 4, problem: "the safety check refused it: line 2: process is not allowed" },
  ];
  const built = withSpec({ jobs: [job("contract", "done"), job("backend", "done", { contractHash: HASH, note: "10 files", custom })] });

  it("the Backend station carries each custom button's result", () => {
    assert.deepEqual(pipelineStatus(built).stations.backend.custom, custom);
  });

  it("the Backend station says who wrote each button, or why it was left out", async () => {
    const { STATIONS } = await import("../src/stations.js");
    const facts = Object.fromEntries(STATIONS.backend.details(built, pipelineStatus(built).stations.backend));
    assert.equal(facts["Give Raise"], "written by Gemini (cloud backup), 2 answers");
    assert.match(facts["Sync Payroll"], /^not written, says "not available yet": the safety check refused it/);
  });

  it("opens the Pages tab on Live once the app is Ready, otherwise as built", async () => {
    const { startView } = await import("../src/pipeline.js");
    assert.equal(startView({ state: "READY" }), "live");
    for (const state of ["BUILDING", "SYNCED", "VERIFYING", "NEEDS_ATTENTION"]) assert.equal(startView({ state }), "built", state);
  });
});
