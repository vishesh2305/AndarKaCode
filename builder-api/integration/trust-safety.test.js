// Step 35: reports and the audit log. Anyone signed in can report a problem (a project, or an address where
// they saw one); a reviewer lists them with npm run review. The audit log keeps who did what and when, for
// the moments that matter (signing in, keys, projects, previews, downloads, reports, reviews); it only ever
// grows, keeps no secret, and nobody can change it through the API.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { AuditEvent } from "../src/models/audit-event.js";
import { Report } from "../src/models/report.js";
import { listReports } from "../src/safety/review.js";
import { jsonServer, startSignedInApi, urlOf } from "./helpers/signed-in-api.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");

const fakeGemini = await jsonServer(async () => ({ json: { models: [] } })); // every key is good
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let api;
let asha;
let key;

before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  api = await startSignedInApi({ MONGODB_URI, KEY_VAULT_SECRET: randomBytes(32).toString("hex"), GEMINI_BASE_URL: `${urlOf(fakeGemini)}/v1beta` });
  asha = await api.signIn("asha@example.com");
});
after(async () => {
  api?.stop();
  fakeGemini.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("Step 35: reports", () => {
  it("a signed-in person reports a problem: kept with who reported it, open until a reviewer closes it", async () => {
    const res = await api.get("/api/reports", asha, json({ projectId: "6af9f91b33053c3180d88650", url: "http://127.0.0.1:4001/preview/x/y/page-1.html", reason: "This copies my bank's login page" }));
    assert.equal(res.status, 201);
    const { id } = await res.json();
    const report = await Report.findById(id).lean();
    assert.equal(report.status, "open");
    assert.equal(report.reason, "This copies my bank's login page");
    assert.equal(report.reporter.email, "asha@example.com");
    assert.ok(report.reporter.workspaceId);
    assert.deepEqual((await listReports()).map((r) => r.id), [id]);
  });

  it("needs a reason (a few words, at most 2000 characters)", async () => {
    for (const reason of ["", "bad", "x".repeat(2001)]) {
      const res = await api.get("/api/reports", asha, json({ reason }));
      assert.equal(res.status, 400, JSON.stringify(reason.slice(0, 10)));
      assert.match((await res.json()).error, /reason/);
    }
  });

  it("only signed in", async () => {
    assert.equal((await api.get("/api/reports", null, json({ reason: "This copies my bank's login page" }))).status, 401);
  });
});

describe("Step 35: the audit log", () => {
  before(async () => {
    key = `AIza${randomBytes(18).toString("base64url")}`;
    assert.equal((await api.get("/api/keys", asha, json({ provider: "gemini", apiKey: key, label: "mine" }))).status, 201);
    const form = new FormData();
    form.append("image", new Blob([await readFile(new URL("../../samples/mocks/m1-edit-delete.png", import.meta.url))], { type: "image/png" }), "m1.png");
    assert.equal((await api.get("/api/projects", asha, { method: "POST", body: form })).status, 201);
  });

  it("keeps who did what: signing in, adding a key, a new project, a report", async () => {
    const events = await AuditEvent.find({ "actor.email": "asha@example.com" }).lean();
    const actions = events.map((e) => e.action);
    for (const action of ["auth.sign-in", "key.add", "project.create", "report.file"]) assert.ok(actions.includes(action), `${action} in ${actions.join(", ")}`);
    for (const event of events) {
      assert.ok(event.at instanceof Date);
      assert.ok(event.workspaceId, `${event.action} names the workspace`);
    }
  });

  it("never keeps a secret: a key appears only as its last four characters", async () => {
    const all = JSON.stringify(await AuditEvent.find({}).lean());
    assert.ok(!all.includes(key), "the key itself is nowhere in the log");
    const added = await AuditEvent.findOne({ action: "key.add" }).lean();
    assert.equal(added.details.lastFour, key.slice(-4));
    assert.equal(added.details.provider, "gemini");
    assert.ok(!all.includes("ak_session"), "no session cookie either");
  });

  it("has no route in the API: it can't be read, changed or emptied from a browser", async () => {
    for (const [method, path] of [["GET", "/api/audit"], ["DELETE", "/api/audit"], ["PUT", "/api/audit/x"]]) {
      assert.equal((await api.get(path, asha, { method })).status, 404, `${method} ${path}`);
    }
  });
});
