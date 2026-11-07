// Integration, Step 32b: quotas and fair scheduling. Each workspace has a plan: free (a few builds a month)
// or pro (unlimited, with a fair-use guard). Past its plan's builds, a new build is refused politely: 429,
// how many it used, and when the next one is possible. Waiting work is picked up pro first, then oldest:
// projects by the orchestrator, pages by the ui-workers.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { freeProjects } from "../src/lease.js";
import { Project } from "../src/models/project.js";
import { User } from "../src/models/user.js";
import { Workspace } from "../src/models/workspace.js";
import { claimPageJob, submitPage } from "../src/page-queue.js";
import { startSignedInApi } from "./helpers/signed-in-api.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const MOCK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../samples/mocks/m7-custom-buttons.png");

let api;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  // ROLE=api: projects are saved, not built, so the test counts uploads only.
  api = await startSignedInApi({ MONGODB_URI, FREE_BUILDS: "2", FREE_BUILDS_DAYS: "30", PRO_BUILDS: "3", PRO_BUILDS_DAYS: "1" });
});
after(async () => {
  api?.stop();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const png = await readFile(MOCK);
async function upload(session) {
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "m7.png");
  return api.get("/api/projects", session, { method: "POST", body: form });
}
const setPlan = async (email, plan) => Workspace.updateOne({ ownerId: (await User.findOne({ email }))._id, personal: true }, { plan });

describe("Step 32b: a free workspace's quota", () => {
  let session;
  before(async () => {
    session = await api.signIn("free@example.com");
  });

  it("a new workspace is on the free plan, and /api/me says how much of the quota is used", async () => {
    const me = await (await api.get("/api/me", session)).json();
    assert.deepEqual({ plan: me.quota.plan, used: me.quota.used, limit: me.quota.limit, days: me.quota.days }, { plan: "free", used: 0, limit: 2, days: 30 });
  });

  it("builds within the quota", async () => {
    assert.equal((await upload(session)).status, 201);
    assert.equal((await upload(session)).status, 201);
  });

  it("the next build is refused politely: 429, how many were used, and when the next one is possible", async () => {
    const res = await upload(session);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    const body = await res.json();
    assert.match(body.error, /The free plan builds 2 apps every 30 days, and this workspace has built 2\. The next build is possible on .+\./);
    assert.equal(body.quota.used, 2);
    assert.ok(new Date(body.quota.resetsAt) > new Date());
  });

  it("a refused build leaves nothing behind", async () => {
    const me = await (await api.get("/api/me", session)).json();
    assert.equal(await Project.countDocuments({ workspaceId: me.workspace.id }), 2);
  });
});

describe("Step 32b: a pro workspace", () => {
  it("has its own, larger limit (fair use), and its projects are marked to go first", async () => {
    const session = await api.signIn("pro@example.com");
    await setPlan("pro@example.com", "pro");
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await upload(session)).status);
    assert.deepEqual(statuses, [201, 201, 201, 429]);
    const me = await (await api.get("/api/me", session)).json();
    assert.deepEqual([me.quota.plan, me.quota.limit, me.quota.days], ["pro", 3, 1]);
    const projects = await Project.find({ workspaceId: me.workspace.id }).lean();
    assert.ok(projects.every((p) => p.priority === 1));
  });
});

describe("Step 32b: fair scheduling, pro first, then oldest", () => {
  it("the orchestrator picks up waiting projects in that order", async () => {
    await Project.deleteMany({});
    const at = (min) => new Date(Date.now() - min * 60_000);
    const make = (name, priority, createdAt) => Project.create({ name, imageHash: "x", priority, createdAt });
    const oldFree = await make("old free", 0, at(30));
    const newPro = await make("new pro", 1, at(1));
    const newFree = await make("new free", 0, at(2));
    const oldPro = await make("old pro", 1, at(20));
    assert.deepEqual((await freeProjects()).map(String), [oldPro, newPro, oldFree, newFree].map((p) => p.id));
  });

  it("a ui-worker claims waiting pages in that order", async () => {
    const page = (n, priority) => submitPage({ imageDataUrl: `data:image/png;base64,${Buffer.from(`page ${n}`).toString("base64")}`, instructions: "x", contractHash: String(n).repeat(64).slice(0, 64), mode: "local", priority });
    const free1 = await page(1, 0);
    const pro = await page(2, 1);
    const free2 = await page(3, 0);
    const order = [];
    for (let i = 0; i < 3; i++) order.push((await claimPageJob({ worker: "w", ms: 60_000 })).id);
    assert.deepEqual(order, [pro.jobId, free1.jobId, free2.jobId]);
  });
});
