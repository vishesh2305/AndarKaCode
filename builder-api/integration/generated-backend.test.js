// Integration: a GENERATED backend running against a real MongoDB. Proves the generated code works,
// not just that it looks right. Needs TEST_MONGODB_URI (a throwaway database; it is dropped).
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { catalogSpec, editDeleteSpec, opsSpec, relationSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "backend"); // outside integration/: generated apps contain their own *.test.js

const servers = [];
async function boot(name, spec) {
  // Each generated app runs alone in real life; here they share one connection, so start each one clean
  // (two specs may both define e.g. a LeaveRequest model with different fields).
  await mongoose.connection.dropDatabase();
  for (const modelName of mongoose.modelNames()) mongoose.deleteModel(modelName);
  await writeBackend(path.join(OUT, name), generateBackend(spec, { name }));
  const { app } = await import(pathToFileURL(path.join(OUT, name, "backend/server.js")).href);
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body && JSON.stringify(body),
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return call;
}
const model = (name, file, exportName) => import(pathToFileURL(path.join(OUT, name, file)).href).then((m) => m[exportName]);

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
});
after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  await rm(OUT, { recursive: true, force: true });
});

describe("generated backend: Edit/Delete screen", () => {
  let call;
  let ann;
  before(async () => {
    call = await boot("edit", editDeleteSpec);
    const Employee = await model("edit", "backend/models/employee.model.js", "Employee");
    ann = await Employee.create({ fullName: "Ann Lee", email: "ann@corp.com", salary: 52000 });
    await Employee.create({ fullName: "Raj Patel", email: "raj@corp.com" });
  });

  it("lists records as { items, total } with id instead of _id", async () => {
    const { status, body } = await call("GET", "/employees");
    assert.equal(status, 200);
    assert.equal(body.total, 2);
    assert.equal(typeof body.items[0].id, "string");
    assert.equal(body.items[0]._id, undefined);
  });

  it("gets one record, and 404 for unknown or malformed ids", async () => {
    assert.equal((await call("GET", `/employees/${ann.id}`)).body.fullName, "Ann Lee");
    assert.equal((await call("GET", `/employees/${new mongoose.Types.ObjectId()}`)).status, 404);
    assert.equal((await call("GET", "/employees/not-an-id")).status, 404);
  });

  it("updates with validation: a bad email is a 400 with details, a good change is saved", async () => {
    const bad = await call("PUT", `/employees/${ann.id}`, { email: "nope" });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.details, { email: "must be an email address" });
    const ok = await call("PUT", `/employees/${ann.id}`, { salary: "60000" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.salary, 60000);
    assert.equal(ok.body.fullName, "Ann Lee", "a partial update keeps other fields");
  });

  it("deletes for real (no Archive control on screen), then 404", async () => {
    assert.equal((await call("DELETE", `/employees/${ann.id}`)).status, 204);
    assert.equal((await call("GET", `/employees/${ann.id}`)).status, 404);
    assert.equal(await mongoose.connection.collection("employees").countDocuments({ _id: ann._id }), 0);
  });

  it("has no create route (no Add button on screen)", async () => {
    assert.equal((await call("POST", "/employees", { fullName: "X", email: "x@y.z" })).status, 404);
  });
});

describe("generated backend: Add + search + filter + paging screen", () => {
  let call;
  before(async () => {
    call = await boot("catalog", catalogSpec);
    for (const [name, category, price] of [
      ["Gel Pen", "Stationery", 2.5],
      ["USB Cable", "Electronics", 8.99],
      ["Notebook", "Stationery", 4],
      ["Pen (blue).*", "Stationery", 1],
    ]) {
      assert.equal((await call("POST", "/products", { name, category, price, inStock: "true" })).status, 201);
    }
  });

  it("creates with validation: missing required field and bad enum are 400", async () => {
    const res = await call("POST", "/products", { category: "Food" });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details).sort(), ["category", "name"]);
  });

  it("searches text fields, case-insensitively, treating the query as plain text", async () => {
    assert.deepEqual((await call("GET", "/products?q=pen")).body.items.map((p) => p.name).sort(), ["Gel Pen", "Pen (blue).*"]);
    assert.deepEqual((await call("GET", "/products?q=.*")).body.items.map((p) => p.name), ["Pen (blue).*"]);
  });

  it("filters by the dropdown's field", async () => {
    const { body } = await call("GET", "/products?category=Electronics");
    assert.deepEqual(body.items.map((p) => p.name), ["USB Cable"]);
  });

  it("pages results and reports the total", async () => {
    const { body } = await call("GET", "/products?page=2&limit=3");
    assert.equal(body.total, 4);
    assert.equal(body.items.length, 1);
    assert.equal(body.page, 2);
  });
});

describe("generated backend: related pages with soft delete", () => {
  let call;
  let hr;
  before(async () => {
    call = await boot("relation", relationSpec);
    const Department = await model("relation", "backend/models/department.model.js", "Department");
    hr = await Department.create({ name: "HR" });
  });

  it("refuses a relation to a record that does not exist", async () => {
    const res = await call("POST", "/leaveRequests", { employeeName: "Ann", department: new mongoose.Types.ObjectId().toString(), from: "2026-11-02" });
    assert.equal(res.status, 400);
    assert.match(res.body.details.department, /existing/);
  });

  it("creates with a real relation and returns the related record populated", async () => {
    const created = await call("POST", "/leaveRequests", { employeeName: "Ann", department: hr.id, from: "2026-11-02" });
    assert.equal(created.status, 201);
    const { body } = await call("GET", `/leaveRequests/${created.body.id}`);
    assert.equal(body.department.name, "HR");
    assert.equal(body.department.id, hr.id);
  });

  it("soft-deletes: hidden from the list and get, but kept in the database", async () => {
    const { body: created } = await call("POST", "/leaveRequests", { employeeName: "Raj", department: hr.id, from: "2026-12-01" });
    assert.equal((await call("DELETE", `/leaveRequests/${created.id}`)).status, 204);
    assert.equal((await call("GET", `/leaveRequests/${created.id}`)).status, 404);
    assert.ok(!(await call("GET", "/leaveRequests")).body.items.some((r) => r.id === created.id));
    const kept = await mongoose.connection.collection("leaveRequests").findOne({ _id: new mongoose.Types.ObjectId(created.id) });
    assert.ok(kept.deletedAt instanceof Date);
  });
});

describe("generated backend: status buttons, export, custom buttons and stat cards", () => {
  let call;
  let base;
  let ann;
  before(async () => {
    call = await boot("ops", opsSpec);
    base = `http://127.0.0.1:${servers.at(-1).address().port}/api`;
    const LeaveRequest = await model("ops", "backend/models/leaveRequest.model.js", "LeaveRequest");
    ann = await LeaveRequest.create({ employee: "Ann Lee", days: 3, status: "Pending" });
    await LeaveRequest.create({ employee: 'Raj "RJ" Patel, Jr.', days: 2, status: "Pending" });
    await LeaveRequest.create({ employee: "=HYPERLINK(evil)", days: 5, status: "Approved" });
  });

  it("Approve sets the status the button stands for", async () => {
    const res = await call("POST", `/leaveRequests/${ann.id}/approve`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "Approved");
    assert.equal((await call("POST", `/leaveRequests/${new mongoose.Types.ObjectId()}/reject`)).status, 404);
  });

  it("Export CSV returns every record with the column labels, safely escaped", async () => {
    const res = await fetch(`${base}/leaveRequests/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    const csv = await res.text();
    assert.equal(csv.split("\n")[0], "Employee,Days,Status");
    assert.match(csv, /"Raj ""RJ"" Patel, Jr\.",2,Pending/, "quotes and commas escaped");
    assert.match(csv, /'=HYPERLINK\(evil\)/, "a value starting with = can't run as a spreadsheet formula");
  });

  it("custom buttons answer 501 until the AI layer writes them", async () => {
    const row = await call("POST", `/leaveRequests/${ann.id}/recalculate`);
    assert.equal(row.status, 501);
    assert.match(row.body.error, /Recalculate/);
    assert.equal((await call("POST", "/leaveRequests/sync-payroll")).status, 501);
  });

  it("stats return exactly the visible cards' numbers (custom ones are null for now)", async () => {
    const { status, body } = await call("GET", "/stats");
    assert.equal(status, 200);
    assert.deepEqual(body, { totalRequests: 3, pending: 1, totalDays: 10, happinessIndex: null });
  });
});
