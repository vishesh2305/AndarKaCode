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
  it("just uploaded: reading is in progress, everything after waits, future steps are coming soon", () => {
    const s = statuses(project({ jobs: [job("contract", "running")] }));
    assert.deepEqual(s, {
      upload: "done", read: "active", plan: "waiting", pages: "waiting", backend: "waiting",
      sync: "waiting", wire: "soon", verify: "soon", ready: "soon",
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

  it("SYNCED: everything up to the sync check is done", () => {
    const p = withSpec({
      state: "SYNCED",
      jobs: [job("contract", "done"), job("backend", "done", { contractHash: HASH }), job("frontend", "done", { contractHash: HASH, page: 1 }), job("frontend", "done", { contractHash: HASH, page: 2 })],
    });
    const s = statuses(p);
    for (const id of ["upload", "read", "plan", "pages", "backend", "sync"]) assert.equal(s[id], "done", id);
    assert.equal(pipelineStatus(p).current, "sync");
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
});
