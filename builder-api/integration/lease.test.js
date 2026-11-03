// Step 22: project leases in MongoDB. A Builder API may build a project only while it holds the project's
// lease, taken with one atomic update and renewed while it works. Two Builder APIs on the same database
// (the two production servers, or a restart) never build the same project at the same time, and a
// project whose builder died is taken over once its lease runs out.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { askRerun, claimProject, releaseProject, renewLease, freeProjects } from "../src/lease.js";
import { Project } from "../src/models/project.js";
import { databaseUri } from "../src/verify/index.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");

before(async () => {
  await mongoose.connect(databaseUri(MONGODB_URI, "lease_test"));
  await mongoose.connection.dropDatabase();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let project;
beforeEach(async () => {
  project = await Project.create({ name: "Leased", imageHash: "h".repeat(64), state: "BUILDING" });
});

const T = new Date("2026-11-03T10:00:00Z").getTime();

describe("claimProject: one builder at a time", () => {
  it("gives a free project to the first who asks, until the lease runs out", async () => {
    assert.ok(await claimProject(project._id, { owner: "A", now: T, ms: 60_000 }));
    const saved = await Project.findById(project._id).lean();
    assert.equal(saved.lease.owner, "A");
    assert.equal(saved.lease.until.getTime(), T + 60_000);
  });

  it("refuses a project another builder holds", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    assert.equal(await claimProject(project._id, { owner: "B", now: T + 1000, ms: 60_000 }), false);
  });

  it("lets another builder take over once the lease has run out (the first one died)", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    assert.ok(await claimProject(project._id, { owner: "B", now: T + 61_000, ms: 60_000 }));
    assert.equal((await Project.findById(project._id).lean()).lease.owner, "B");
  });

  it("gives the project to exactly one of ten builders asking at the same moment", async () => {
    const owners = Array.from({ length: 10 }, (_, i) => `server-${i}`);
    const won = await Promise.all(owners.map((owner) => claimProject(project._id, { owner, now: T, ms: 60_000 })));
    assert.equal(won.filter(Boolean).length, 1);
  });
});

describe("renewLease: keep it while working", () => {
  it("moves the end of the lease on, for its holder only", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    assert.equal(await renewLease(project._id, { owner: "A", now: T + 20_000, ms: 60_000 }), true);
    assert.equal((await Project.findById(project._id).lean()).lease.until.getTime(), T + 80_000);
    assert.equal(await renewLease(project._id, { owner: "B", now: T + 20_000, ms: 60_000 }), false);
  });

  it("says the lease is lost when another builder took it over", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    await claimProject(project._id, { owner: "B", now: T + 61_000, ms: 60_000 });
    assert.equal(await renewLease(project._id, { owner: "A", now: T + 62_000, ms: 60_000 }), false);
  });
});

describe("releaseProject and askRerun: done, or look again", () => {
  it("frees the project for the next builder", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    assert.deepEqual(await releaseProject(project._id, { owner: "A" }), { rerun: false });
    assert.ok(await claimProject(project._id, { owner: "B", now: T + 1000, ms: 60_000 }));
  });

  it("tells the holder to look again when someone asked while it was working (e.g. the spec was edited)", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    await askRerun(project._id);
    assert.deepEqual(await releaseProject(project._id, { owner: "A" }), { rerun: true });
    assert.equal((await Project.findById(project._id).lean()).rerun, false, "the request is used up");
  });

  it("does nothing for a builder that no longer holds the lease", async () => {
    await claimProject(project._id, { owner: "A", now: T, ms: 60_000 });
    await claimProject(project._id, { owner: "B", now: T + 61_000, ms: 60_000 });
    assert.equal(await releaseProject(project._id, { owner: "A" }), null);
    assert.equal((await Project.findById(project._id).lean()).lease.owner, "B");
  });
});

describe("freeProjects: what a builder may pick up at start, and every so often", () => {
  it("lists unfinished projects nobody holds, or whose lease ran out; never finished ones or held ones", async () => {
    await Project.deleteMany({});
    const make = (name, state, lease) => Project.create({ name, imageHash: "h".repeat(64), state, ...(lease && { lease }) });
    const free = await make("free", "BUILDING");
    const expired = await make("expired", "VERIFYING", { owner: "dead", until: new Date(T - 1000) });
    await make("held", "BUILDING", { owner: "alive", until: new Date(T + 60_000) });
    await make("ready", "READY");
    await make("attention", "NEEDS_ATTENTION");
    const ids = (await freeProjects({ now: T })).map(String).sort();
    assert.deepEqual(ids, [free._id, expired._id].map(String).sort());
  });
});
