// Binder (Step 16): a marker Laptop B forgot is added when the page opens, from what a person sees:
// an input's label / name / placeholder, a table column's header, a button's text. Only when the match is
// clear; existing markers are never changed; every repair is written down for the Verifier.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { apiMap } from "../src/wirer/index.js";
import { dashboardSpec, employeesSpec } from "./fixtures/page-specs.js";
import { memoryApi, openPage, page } from "./helpers/page.js";

let open;
afterEach(() => {
  if (open) {
    assert.deepEqual(open.errors, [], "no script errors in the page");
    open.close();
    open = undefined;
  }
});
const start = async (options) => (open = await openPage(options));
const repairs = (p) => JSON.parse(p.document.documentElement.dataset.andarkacodeRepaired ?? "[]");
const employees = () => memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", department: "Sales", salary: 70000 }]);
const text = (el) => el.textContent.trim();

describe("repairing a field marker", () => {
  it("finds the form input by its label and the table column by its header", async () => {
    const html = page("employees-real.html").replaceAll('data-field="salary"', "");
    const p = await start({ html, map: apiMap(employeesSpec), api: employees() });
    assert.equal(p.$('#employeeForm [data-field="salary"]')?.id, "salary", "the input labelled Salary");
    assert.equal(text(p.$('#employeeTableBody [data-field="salary"]')), "70000", "the cell under the Salary header shows the real value");
    assert.ok(repairs(p).some((r) => /salary/.test(r) && /Salary/.test(r)), JSON.stringify(repairs(p)));

    p.$('#employeeForm [data-field="fullName"]').value = "Kavya Rao";
    p.$('#employeeForm [data-field="email"]').value = "kavya@example.com";
    p.$('#employeeForm [data-field="salary"]').value = "52000";
    await p.click(p.$('#employeeForm button[type="submit"]'));
    assert.equal(p.calls.find((c) => c.method === "POST").body.salary, 52000, "Add sends the repaired field");
  });

  it("does not guess when two inputs have the same label", async () => {
    const html = page("employees-real.html")
      .replaceAll('data-field="salary"', "")
      .replace('id="salary" name="salary"', 'id="pay1" name="pay1"')
      .replace("</form>", '<label for="pay2">Salary</label><input id="pay2" name="pay2"></form>');
    const p = await start({ html, map: apiMap(employeesSpec), api: employees() });
    assert.equal(p.$('#employeeForm [data-field="salary"]'), null);
  });

  it("never changes a marker that is already there", async () => {
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api: employees() });
    assert.deepEqual(repairs(p), []);
  });
});

describe("repairing a button marker", () => {
  it("finds Edit and Delete in the rows by their text, and they work", async () => {
    const html = page("employees-real.html").replace('data-action="update"', "").replace('data-action="delete"', "");
    const api = employees();
    const id = api.rows[0].id;
    const p = await start({ html, map: apiMap(employeesSpec), api });
    assert.ok(p.$('#employeeTableBody [data-action="update"]'));
    await p.click(p.$('#employeeTableBody [data-action="delete"]'));
    assert.ok(p.calls.some((c) => c.method === "DELETE" && c.path === `/api/employees/${id}`));
  });

  it("finds the search box by its placeholder", async () => {
    const html = page("employees-real.html").replace('data-action="search"', "");
    const p = await start({ html, map: apiMap(employeesSpec), api: employees() });
    const box = p.$('[data-action="search"]');
    assert.equal(box?.placeholder, "Search employees");
    p.type(box, "mee");
    await p.settle(400);
    assert.equal(p.calls.at(-1).query.q, "mee");
  });

  it("finds a row button by the spec's button text (Approve)", async () => {
    const html = page("leave-dashboard.html").replace('data-action="approveLeaveRequest" ', "");
    const p = await start({ html, map: apiMap(dashboardSpec), api: memoryApi("/api/leaveRequests", [{ employee: "Isha", days: 2, status: "Pending" }]) });
    assert.ok(p.$('#requests [data-action="approveLeaveRequest"]'));
    assert.ok(repairs(p).some((r) => /approveLeaveRequest/.test(r)));
  });

  it("finds the previous/next arrows", async () => {
    const html = page("leave-dashboard.html").replace('data-action="prevPage" ', "").replace('data-action="nextPage" ', "");
    const p = await start({ html, map: apiMap(dashboardSpec), api: memoryApi("/api/leaveRequests", []) });
    assert.equal(text(p.$('[data-action="prevPage"]')), "Previous");
    assert.equal(text(p.$('[data-action="nextPage"]')), "Next");
  });
});

describe("markers-only mode (the Verifier reads markers after repair, without using the API)", () => {
  it("repairs and stops: no requests, the page keeps its sample rows", async () => {
    const html = page("employees-real.html").replaceAll('data-field="salary"', "");
    const p = await start({ html, map: apiMap(employeesSpec), api: employees(), hooks: { markersOnly: true } });
    assert.equal(p.document.documentElement.dataset.andarkacode, "ready");
    assert.deepEqual(p.calls, []);
    assert.equal(p.$$("#employeeTableBody tr").length, 2, "the sample rows stay");
    assert.ok(p.$('#employeeTableBody [data-field="salary"]'));
  });
});
