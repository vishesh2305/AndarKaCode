// Integration (Step 16): the Verifier on real generated apps. It starts each app on a throwaway database,
// uses every page like a person (jsdom + the binder, against the running app), runs the app's own tests,
// and reports each check with the layer to blame: page, spec or backend. Needs TEST_MONGODB_URI.
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { runningApps, stopAll } from "../src/verify/app-runner.js";
import { verifyApp } from "../src/verify/index.js";
import { wireApp } from "../src/wirer/index.js";
import { dashboardSpec, employeesSpec, loginStaffSpec } from "../test/fixtures/page-specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "verifier"); // outside integration/
const fixture = (name) => readFileSync(new URL(`../test/fixtures/pages/${name}`, import.meta.url), "utf8");
const dbUri = (name) => MONGODB_URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

async function build(name, spec, pages) {
  const appDir = path.join(OUT, name);
  await writeBackend(appDir, { ...generateBackend(spec, { name }), ...wireApp({ spec, pages }) });
  return appDir;
}
const verify = (name, spec, appDir) => verifyApp({ spec, appDir, mongoUri: dbUri(`verify_${name}`), testsMongoUri: dbUri(`verify_${name}_tests`) });
const check = (report, id) => report.checks.find((c) => c.id === id);
const statusOf = (report, id) => check(report, id)?.status;

before(() => rm(OUT, { recursive: true, force: true }));
after(async () => {
  await stopAll();
  await rm(OUT, { recursive: true, force: true });
});

describe("a good app (the real Laptop B employees page)", () => {
  let report;
  before(async () => {
    const appDir = await build("good", employeesSpec, [{ screenshot: 1, html: fixture("employees-real.html") }]);
    report = await verify("good", employeesSpec, appDir);
  });

  it("passes every check: health, its own tests, markers, add, reload, edit, search, delete", () => {
    for (const id of ["health", "tests", "markers:p1", "add:p1", "reload:p1", "edit:p1", "search:p1", "delete:p1"]) {
      assert.equal(statusOf(report, id), "pass", `${id}: ${check(report, id)?.detail}`);
    }
    assert.equal(report.ok, true);
    assert.equal(report.summary.fail, 0);
  });

  it("explains each check in plain words, with the page it is about", () => {
    const add = check(report, "add:p1");
    assert.equal(add.page, 1);
    assert.match(add.title, /Add Employee/);
    assert.match(add.detail, /saved/i);
  });

  it("leaves nothing behind: the app is stopped and its databases are gone", async () => {
    assert.equal(runningApps().length, 0);
    const conn = await mongoose.createConnection(MONGODB_URI).asPromise();
    try {
      const names = (await conn.listDatabases()).databases.map((d) => d.name);
      assert.ok(!names.includes("verify_good") && !names.includes("verify_good_tests"), names.join(", "));
    } finally {
      await conn.close();
    }
  });
});

describe("the 'Select Department' bug (22 Oct): Add refused by the spec's rules", () => {
  it("fails Add, quotes the backend's answer, and blames the spec", async () => {
    const spec = structuredClone(employeesSpec);
    spec.entities[0].fields.find((f) => f.name === "department").options = ["Select Department"];
    const appDir = await build("dropdown", spec, [{ screenshot: 1, html: fixture("employees-real.html") }]);
    const report = await verify("dropdown", spec, appDir);
    const add = check(report, "add:p1");
    assert.equal(add.status, "fail");
    assert.equal(add.layer, "spec");
    assert.match(add.detail, /Department/);
    assert.match(add.detail, /must be one of: Select Department/);
    assert.equal(report.ok, false);
  });
});

describe("a page that lost a marker", () => {
  it("passes when the binder can add it back from the page (label, header), with a warning that says so", async () => {
    const html = fixture("employees-real.html").replaceAll('data-field="salary"', "");
    const appDir = await build("repaired", employeesSpec, [{ screenshot: 1, html }]);
    const report = await verify("repaired", employeesSpec, appDir);
    assert.equal(statusOf(report, "markers:p1"), "pass", check(report, "markers:p1")?.detail);
    assert.ok(report.checks.some((c) => c.status === "warn" && /added by AndarKaCode.*salary/i.test(c.detail)));
    assert.equal(statusOf(report, "add:p1"), "pass", "Add works with the repaired marker");
  });

  it("fails the marker check and blames the page when nothing shows where it belongs", async () => {
    const html = fixture("employees-real.html")
      .replaceAll('data-field="salary"', "")
      .replace('id="salary" name="salary"', 'id="pay" name="pay"')
      .replace(/>Salary</g, ">Pay<");
    const appDir = await build("marker", employeesSpec, [{ screenshot: 1, html }]);
    const report = await verify("marker", employeesSpec, appDir);
    const markers = check(report, "markers:p1");
    assert.equal(markers.status, "fail");
    assert.equal(markers.layer, "page");
    assert.match(markers.detail, /Salary/);
  });
});

describe("login + staff (no Add on the page: a record is put in first, from the page's sample rows)", () => {
  it("signs in, sends visitors without a login to the login page, edits in the row and deletes", async () => {
    const appDir = await build("staff", loginStaffSpec, [
      { screenshot: 1, html: fixture("login.html") },
      { screenshot: 2, html: fixture("staff-no-form.html") },
    ]);
    const report = await verify("staff", loginStaffSpec, appDir);
    for (const id of ["login:p1", "login-required:p2", "edit:p2", "delete:p2", "markers:p1", "markers:p2", "tests"]) {
      assert.equal(statusOf(report, id), "pass", `${id}: ${check(report, id)?.detail}`);
    }
    assert.equal(report.ok, true);
  });
});

describe("the real products page (m2): Add with no form, filters, page buttons", () => {
  it("adds through the new row, filters by category and asks for page 1", async () => {
    const spec = JSON.parse(fixture("products-real.spec.json"));
    const appDir = await build("products", spec, [{ screenshot: 1, html: fixture("products-real.html") }]);
    const report = await verify("products", spec, appDir);
    for (const id of ["add:p1", "reload:p1", "edit:p1", "search:p1", "filter:category:p1", "pages:p1", "delete:p1"]) {
      assert.equal(statusOf(report, id), "pass", `${id}: ${check(report, id)?.detail}`);
    }
  });
});

describe("a dashboard: status buttons, Export, custom buttons and stat cards", () => {
  let report;
  before(async () => {
    const appDir = await build("dashboard", dashboardSpec, [{ screenshot: 1, html: fixture("leave-dashboard.html") }]);
    report = await verify("dashboard", dashboardSpec, appDir);
  });

  it("runs Approve on a row and sees the record change", () => {
    assert.equal(statusOf(report, "action:approveLeaveRequest:p1"), "pass", check(report, "action:approveLeaveRequest:p1")?.detail);
  });

  it("downloads the CSV for Export", () => {
    assert.equal(statusOf(report, "action:exportLeaveRequests:p1"), "pass", check(report, "action:exportLeaveRequests:p1")?.detail);
  });

  it("notes custom buttons as 'not built yet' (Step 13), not as failures", () => {
    const custom = check(report, "action:recalculateLeaveRequest:p1");
    assert.equal(custom.status, "note");
    assert.match(custom.detail, /not available yet|Step 13/);
  });

  it("checks the stat cards show the backend's numbers", () => {
    assert.equal(statusOf(report, "stats:p1"), "pass", check(report, "stats:p1")?.detail);
  });
});

describe("an app whose own tests fail", () => {
  it("fails the tests check, names the failing test, and blames the backend", async () => {
    const appDir = await build("tests", employeesSpec, [{ screenshot: 1, html: fixture("employees-real.html") }]);
    const file = path.join(appDir, "tests/api.test.js");
    await writeFile(file, (await readFile(file, "utf8")) + '\nit("fails on purpose", () => { throw new Error("broken"); });\n');
    const report = await verify("tests", employeesSpec, appDir);
    const tests = check(report, "tests");
    assert.equal(tests.status, "fail");
    assert.equal(tests.layer, "backend");
    assert.match(tests.detail, /fails on purpose/);
    assert.equal(runningApps().length, 0);
  });
});

describe("a page whose own script fails (found on the Mac, 22 Oct)", () => {
  it("passes the person checks through rows built from the table header, and warns about the script error", async () => {
    const html = fixture("employees-real.html").replace("renderEmployeesTable();", "renderEmployeesTable(;");
    const appDir = await build("broken", employeesSpec, [{ screenshot: 1, html }]);
    const report = await verify("broken", employeesSpec, appDir);
    for (const id of ["markers:p1", "add:p1", "reload:p1", "edit:p1", "search:p1", "delete:p1"]) {
      assert.equal(statusOf(report, id), "pass", `${id}: ${check(report, id)?.detail}`);
    }
    assert.ok(report.checks.some((c) => c.status === "warn" && /own script has an error/.test(c.detail)));
    assert.ok(!report.checks.some((c) => /Constraints not satisfied/.test(c.detail ?? "")), "no misleading browser message");
  });
});
