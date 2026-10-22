// Integration (Step 13): a custom button's code running inside a GENERATED app. The code sees only its
// helpers (its own table, with the same validation as Add/Edit), only plain data crosses in or out, code
// can't be made from strings, and every stretch of it has a time limit. Needs TEST_MONGODB_URI.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { opsSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "custom"); // outside integration/

let server;
let base;
let LeaveRequest;
let pending;
let approved;
const write = (name, code) => writeFile(path.join(OUT, "backend", "custom", `${name}.js`), code);
const forget = (name) => rm(path.join(OUT, "backend", "custom", `${name}.js`), { force: true });
const call = async (method, route, body) => {
  const res = await fetch(`${base}/api${route}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const recalc = (id) => call("POST", `/leaveRequests/${id}/recalculate`);
const wrap = (body) => `export default async function ({ record, input, helpers }) {\n${body}\n}`;

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  for (const name of mongoose.modelNames()) mongoose.deleteModel(name);
  await writeBackend(OUT, generateBackend(opsSpec, { name: "custom" }));
  await mkdir(path.join(OUT, "backend", "custom"), { recursive: true });
  ({ LeaveRequest } = await import(pathToFileURL(path.join(OUT, "backend/models/leaveRequest.model.js")).href));
  const { app } = await import(pathToFileURL(path.join(OUT, "backend/server.js")).href);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await mongoose.disconnect();
  await rm(OUT, { recursive: true, force: true });
});
beforeEach(async () => {
  await LeaveRequest.deleteMany({});
  pending = await LeaveRequest.create({ employee: "Isha", days: 2, status: "Pending" });
  approved = await LeaveRequest.create({ employee: "Kabir", days: 5, status: "Approved" });
  await LeaveRequest.create({ employee: "Meera", days: 1, status: "Pending" });
});

describe("a custom button with no code yet", () => {
  it("still answers 501 'not available yet'", async () => {
    await forget("recalculateLeaveRequest");
    const res = await recalc(pending.id);
    assert.equal(res.status, 501);
    assert.match(res.body.error, /not available yet/);
  });
});

describe("a custom button with working code", () => {
  before(() =>
    write(
      "recalculateLeaveRequest",
      wrap(`  if (record.status === "Approved") helpers.fail("Approved requests can't be recalculated");
  const updated = await helpers.update(record.id, { days: record.days + 1, secret: "not a field" });
  return { message: \`Now \${updated.days} days\`, record: updated };`)
    )
  );

  it("runs on its row: the change is saved, and its message comes back", async () => {
    const res = await recalc(pending.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.message, "Now 3 days");
    assert.equal((await LeaveRequest.findById(pending.id)).days, 3);
  });

  it("only changes the table's own fields", async () => {
    await recalc(pending.id);
    assert.equal((await LeaveRequest.findById(pending.id).lean()).secret, undefined);
  });

  it("can refuse with a message (helpers.fail) -> 400", async () => {
    const res = await recalc(approved.id);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Approved requests can't be recalculated");
  });

  it("404 for a record that does not exist", async () => {
    assert.equal((await recalc(new mongoose.Types.ObjectId().toString())).status, 404);
  });
});

describe("helpers check values like Add and Edit do", () => {
  it("refuses a value of the wrong type -> 400 with the field's problem", async () => {
    await write("recalculateLeaveRequest", wrap(`  await helpers.update(record.id, { days: "lots" });\n  return {};`));
    const res = await recalc(pending.id);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /days: must be a number/);
  });

  it("a page button can list and count (filters use the table's fields)", async () => {
    await write("syncPayrollLeaveRequest", wrap(`  const open = await helpers.list({ status: "Pending" });\n  return { message: open.length + " pending" };`));
    const res = await call("POST", "/leaveRequests/sync-payroll");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.message, "2 pending");
  });
});

describe("when the code is wrong or tries to get out", () => {
  it("an error in the code -> 500 'custom code failed', and the app keeps working", async () => {
    await write("recalculateLeaveRequest", wrap("  return record.nothing.here;"));
    const res = await recalc(pending.id);
    assert.equal(res.status, 500);
    assert.match(res.body.error, /custom code failed/);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  it("finds no process, no require, and can't make code from strings", async () => {
    await write("recalculateLeaveRequest", wrap('  return { message: [typeof process, typeof require, typeof fetch].join(",") };'));
    assert.equal((await recalc(pending.id)).body.message, "undefined,undefined,undefined");

    await write("recalculateLeaveRequest", wrap('  return { message: helpers.update.constructor("return typeof process")() };'));
    const escape = await recalc(pending.id);
    assert.equal(escape.status, 500);
    assert.doesNotMatch(JSON.stringify(escape.body), /object/);
  });

  it("stops a stuck loop before its first await", async () => {
    await write("recalculateLeaveRequest", wrap("  for (const x of [1]) { while (true) {} }\n  return {};"));
    const started = Date.now();
    const res = await recalc(pending.id);
    assert.equal(res.status, 500);
    assert.match(res.body.error, /took too long/);
    assert.ok(Date.now() - started < 5000);
    assert.equal((await fetch(`${base}/health`)).status, 200, "the app still answers");
  });

  it("stops a stuck loop after an await too", async () => {
    await write("recalculateLeaveRequest", wrap("  await helpers.list({});\n  while (true) {}\n  return {};"));
    const res = await recalc(pending.id);
    assert.equal(res.status, 500);
    assert.match(res.body.error, /took too long/);
    assert.equal((await fetch(`${base}/health`)).status, 200, "the app still answers");
  });
});
