// Wirer (Step 15): App Spec -> api-map.json (which marker calls which endpoint) + pages with the
// binder's <script> line. Rule under test: only what the spec has, and the pages keep their look.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { operationRoute } from "../src/generator/index.js";
import { apiMap, wireApp, wirePage } from "../src/wirer/index.js";
import { authSpec, catalogSpec, editDeleteSpec, loginOnlySpec, opsSpec, relationSpec } from "./fixtures/specs.js";

const SCRIPT = '<script src="app.js"></script>';

describe("apiMap: one entry per spec part, nothing else", () => {
  it("maps an Edit/Delete table to list, get, update and delete only", () => {
    const map = apiMap(editDeleteSpec);
    const employee = map.entities.employee;
    assert.equal(employee.url, "/api/employees");
    assert.deepEqual(employee.list, { search: false, filters: [], pagination: false });
    assert.deepEqual(
      { get: employee.get, create: employee.create, update: employee.update, delete: employee.delete },
      { get: true, create: false, update: true, delete: true }
    );
    assert.deepEqual(employee.actions, {});
    assert.equal(map.auth, null);
    assert.equal(map.stats, null);
  });

  it("carries search, filters, pagination and the field types the binder needs", () => {
    const product = apiMap(catalogSpec).entities.product;
    assert.deepEqual(product.list, { search: true, filters: ["category"], pagination: true });
    assert.equal(product.create, true);
    assert.deepEqual(
      product.fields.find((f) => f.name === "category"),
      { name: "category", label: "Category", type: "enum", options: ["Stationery", "Electronics"] }
    );
    assert.deepEqual(product.fields.find((f) => f.name === "inStock"), { name: "inStock", label: "In Stock", type: "boolean" });
  });

  it("names the page's sample-data array, so the binder can tell how each sample value was drawn", () => {
    assert.equal(apiMap(editDeleteSpec).entities.employee.sample, "SAMPLE_EMPLOYEES");
  });

  it("says which field names a related record, so a relation shows a name instead of an id", () => {
    const map = apiMap(relationSpec);
    assert.deepEqual(map.entities.leaveRequest.fields.find((f) => f.name === "department"), {
      name: "department",
      label: "Department",
      type: "ref",
      ref: "department",
    });
    assert.equal(map.entities.department.labelField, "name");
    assert.equal(map.entities.leaveRequest.labelField, "employeeName");
    assert.equal(map.entities.department.url, "/api/departments");
  });

  it("gives every button the same address as the generated backend route", () => {
    const { actions } = apiMap(opsSpec).entities.leaveRequest;
    assert.deepEqual(actions.approveLeaveRequest, {
      button: "Approve",
      kind: "setStatus",
      method: "POST",
      url: "/api/leaveRequests/:id/approve",
      row: true,
      available: true,
    });
    assert.deepEqual(actions.exportLeaveRequests, {
      button: "Export CSV",
      kind: "export",
      method: "GET",
      url: "/api/leaveRequests/export.csv",
      row: false,
      available: true,
    });
    for (const op of opsSpec.operations) {
      const route = operationRoute(op, op.entity);
      assert.equal(actions[op.name].url, `/api/leaveRequests${route.path}`, op.name);
      assert.equal(actions[op.name].method, route.method.toUpperCase(), op.name);
      assert.equal(actions[op.name].row, route.row, op.name);
    }
  });

  it("marks buttons whose code is not written yet (custom) as not available", () => {
    const { actions } = apiMap(opsSpec).entities.leaveRequest;
    assert.equal(actions.recalculateLeaveRequest.available, false);
    assert.equal(actions.syncPayrollLeaveRequest.available, false);
    assert.equal(actions.syncPayrollLeaveRequest.url, "/api/leaveRequests/sync-payroll");
  });

  it("lists the stat cards by their data-stat key", () => {
    assert.deepEqual(apiMap(opsSpec).stats, { url: "/api/stats", keys: ["totalRequests", "pending", "totalDays", "happinessIndex"] });
  });

  it("knows each page's file, its kind and its data, with index.html as the first page", () => {
    const map = apiMap(relationSpec);
    assert.deepEqual(map.pages, {
      "page-1.html": { kind: "list", entity: "leaveRequest" },
      "page-2.html": { kind: "list", entity: "department" },
      "index.html": { kind: "list", entity: "leaveRequest" },
    });
    assert.equal(map.home, "page-1.html");
  });

  it("has login entries only when a login screen was shown, and only the shown parts", () => {
    assert.deepEqual(apiMap(authSpec).auth, {
      login: "/api/auth/login",
      register: "/api/auth/register",
      me: "/api/auth/me",
      logout: "/api/auth/logout",
      loginPage: "page-1.html",
    });
    assert.equal(apiMap(authSpec).home, "page-2.html", "after logging in, go to the first page that isn't the login page");
    assert.deepEqual(apiMap(loginOnlySpec).auth, { login: "/api/auth/login", register: null, me: null, logout: null, loginPage: "page-1.html" });
    assert.equal(apiMap(loginOnlySpec).home, null);
    for (const spec of [editDeleteSpec, catalogSpec, relationSpec, opsSpec]) assert.equal(apiMap(spec).auth, null);
  });

  it("is pure and never copies screenshot evidence into the browser", () => {
    assert.equal(JSON.stringify(apiMap(opsSpec)), JSON.stringify(apiMap(opsSpec)));
    for (const spec of [editDeleteSpec, catalogSpec, relationSpec, opsSpec, authSpec]) {
      assert.doesNotMatch(JSON.stringify(apiMap(spec)), /evidence|s1: |s2: /);
    }
  });
});

describe("wirePage: one script line, the rest of the page unchanged", () => {
  const page = '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><h1>Employees</h1><script>const SAMPLE_EMPLOYEES = [];</script></body></html>';

  it("adds the binder right before </body>, after the page's own scripts", () => {
    const wired = wirePage(page);
    assert.ok(wired.includes(`${SCRIPT}</body>`));
    assert.equal(wired.replace(SCRIPT, ""), page, "nothing else in the page changes");
  });

  it("uses the last </body>, in any letter case", () => {
    const tricky = '<html><BODY><script>const s = "</body>";</script></BODY></html>';
    assert.equal(wirePage(tricky), `<html><BODY><script>const s = "</body>";</script>${SCRIPT}</BODY></html>`);
  });

  it("appends the line when the page has no </body>", () => {
    assert.equal(wirePage("<h1>Hi</h1>"), `<h1>Hi</h1>\n${SCRIPT}\n`);
  });

  it("wires a page only once", () => {
    assert.equal(wirePage(wirePage(page)), wirePage(page));
  });
});

describe("wireApp: the frontend folder of the downloaded app", () => {
  const html = (n) => `<!doctype html><html><body><p>page ${n}</p></body></html>`;

  it("returns the binder, the map and every wired page, with index.html = the first page", () => {
    const files = wireApp({ spec: relationSpec, pages: [{ screenshot: 1, html: html(1) }, { screenshot: 2, html: html(2) }] });
    assert.deepEqual(Object.keys(files).sort(), [
      "frontend/api-map.json",
      "frontend/app.js",
      "frontend/index.html",
      "frontend/page-1.html",
      "frontend/page-2.html",
    ]);
    assert.equal(files["frontend/app.js"], readFileSync(new URL("../../templates/frontend/app.js", import.meta.url), "utf8"));
    assert.deepEqual(JSON.parse(files["frontend/api-map.json"]), apiMap(relationSpec));
    assert.equal(files["frontend/page-2.html"], wirePage(html(2)));
    assert.equal(files["frontend/index.html"], files["frontend/page-1.html"]);
  });

  it("skips a page that was not built, and accepts Buffers", () => {
    const files = wireApp({ spec: relationSpec, pages: [{ screenshot: 2, html: Buffer.from(html(2)) }] });
    assert.equal(files["frontend/page-1.html"], undefined);
    assert.equal(files["frontend/index.html"], undefined, "index.html is the first page of the spec, which is missing");
    assert.equal(files["frontend/page-2.html"], wirePage(html(2)));
  });
});
