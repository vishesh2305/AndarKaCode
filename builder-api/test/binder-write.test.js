// Binder (Step 15), writing: Add, Edit, Delete and the row/page buttons call the backend; field
// problems appear as the browser's own message bubbles; the page's own fake handlers never run.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { apiMap } from "../src/wirer/index.js";
import { dashboardSpec, employeesSpec, productsSpec, relationSpec, staffSpec } from "./fixtures/page-specs.js";
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
const writes = (p) => p.calls.filter((c) => c.method !== "GET");
const text = (el) => el.textContent.trim();
const fill = (p, values) => {
  for (const [name, value] of Object.entries(values)) {
    const el = p.$(`[data-field="${name}"]:is(input, select, textarea)`);
    if (el.type === "checkbox") el.checked = value;
    else el.value = value;
  }
};
const employeesPage = async (items = [{ fullName: "Meera Iyer", email: "meera@example.com", department: "Sales", salary: 70000 }]) => {
  const api = memoryApi("/api/employees", items);
  return { api, p: await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api }) };
};

describe("Add", () => {
  it("sends the form to the API with the spec's types, shows the new row and clears the form", async () => {
    const { p } = await employeesPage();
    fill(p, { fullName: "Kavya Rao", email: "kavya@example.com", department: "HR", salary: "52000" });
    await p.click(p.$('#employeeForm button[type="submit"]'));
    assert.deepEqual(writes(p), [
      { method: "POST", path: "/api/employees", query: {}, body: { fullName: "Kavya Rao", email: "kavya@example.com", department: "HR", salary: 52000 }, auth: null },
    ]);
    assert.deepEqual(p.$$('#employeeTableBody [data-field="fullName"]').map(text), ["Kavya Rao", "Meera Iyer"], "the list is reloaded from the API");
    assert.equal(p.$('[data-field="fullName"]:is(input)').value, "", "the form is cleared");
  });

  it("sends one record when Add is clicked twice quickly", async () => {
    const { p } = await employeesPage([]);
    fill(p, { fullName: "Kavya Rao", email: "kavya@example.com", salary: "52000" });
    const button = p.$('#employeeForm button[type="submit"]');
    button.click();
    button.click();
    await p.settle();
    assert.equal(writes(p).length, 1);
  });

  it("does not send a form the browser finds incomplete (required fields)", async () => {
    const { p } = await employeesPage();
    fill(p, { fullName: "", email: "kavya@example.com" });
    await p.click(p.$('#employeeForm button[type="submit"]'));
    assert.deepEqual(writes(p), []);
  });

  it("shows the API's field problems as the browser's own bubble on that field, cleared when typing", async () => {
    const list = memoryApi("/api/employees", []);
    const api = (r) => (r.method === "POST" ? { status: 400, body: { error: "Invalid input", details: { salary: "must be a number" } } } : list(r));
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api });
    fill(p, { fullName: "Kavya Rao", email: "kavya@example.com", salary: "12" });
    await p.click(p.$('#employeeForm button[type="submit"]'));
    const salary = p.$('input[data-field="salary"]');
    assert.equal(salary.validationMessage, "must be a number");
    assert.deepEqual(p.alerts, [], "no extra pop-up");
    p.type(salary, "13");
    assert.equal(salary.validationMessage, "");
  });

  it("works without a <form> element (a plain Add button), and the page's own Add never runs", async () => {
    const api = memoryApi("/api/products", []);
    const p = await start({ html: page("products-cards.html"), map: apiMap(productsSpec), api });
    fill(p, { name: "Desk Lamp", category: "Electronics", price: "899", inStock: true });
    await p.click(p.$('[data-action="create"]'));
    assert.deepEqual(writes(p).map((c) => c.body), [{ name: "Desk Lamp", category: "Electronics", price: 899, inStock: true }]);
    assert.equal(p.window.pageCreateRan, undefined);
    assert.equal(p.$$("#grid .card").length, 1);

    fill(p, { name: "" });
    await p.click(p.$('[data-action="create"]'));
    assert.equal(writes(p).length, 1, "an empty required field is not sent");
  });

  it("sends a relation as the chosen record's id and a date as YYYY-MM-DD", async () => {
    const departments = memoryApi("/api/departments", [{ name: "Finance" }]);
    const requests = memoryApi("/api/leaveRequests", []);
    const p = await start({ html: page("leave-relation.html"), map: apiMap(relationSpec), api: (r) => requests(r) ?? departments(r) });
    fill(p, { employeeName: "Kabir", department: departments.rows[0].id, from: "2026-12-01" });
    await p.click(p.$('[data-action="create"]'));
    assert.deepEqual(writes(p).map((c) => c.body), [{ employeeName: "Kabir", department: departments.rows[0].id, from: "2026-12-01" }]);
    assert.equal(p.window.pageSubmitRan, undefined);
  });
});

describe("Edit", () => {
  it("fills the page's form with the row, saves with PUT, then goes back to adding", async () => {
    const { p, api } = await employeesPage();
    const button = p.$('#employeeForm button[type="submit"]');
    await p.click(p.$('#employeeTableBody [data-action="update"]'));
    assert.equal(p.$('input[data-field="fullName"]').value, "Meera Iyer");
    assert.equal(p.$('select[data-field="department"]').value, "Sales");
    assert.equal(p.$('input[data-field="salary"]').value, "70000");
    assert.equal(text(button), "Save changes");
    assert.deepEqual(p.alerts, [], "the page's own 'not implemented' alert did not run");

    fill(p, { salary: "75000" });
    await p.click(button);
    assert.deepEqual(writes(p), [
      {
        method: "PUT",
        path: `/api/employees/${api.rows[0].id}`,
        query: {},
        body: { fullName: "Meera Iyer", email: "meera@example.com", department: "Sales", salary: 75000 },
        auth: null,
      },
    ]);
    assert.equal(text(p.$('#employeeTableBody [data-field="salary"]')), "75000");
    assert.equal(text(button), "Add Employee");
    assert.equal(p.$('input[data-field="fullName"]').value, "");
  });

  it("edits inside the row when the page has no form: Edit becomes Save", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);
    const p = await start({ html: page("staff-no-form.html"), map: apiMap(staffSpec), api });
    const row = () => p.$("tbody tr");
    await p.click(row().querySelector('[data-action="update"]'));
    const name = row().querySelector('[data-field="fullName"]');
    assert.equal(name.getAttribute("contenteditable"), "true");
    assert.equal(text(row().querySelector('[data-action="update"]')), "Save");
    name.querySelector("div").textContent = "Meera I. Iyer";
    row().querySelector('[data-field="salary"]').textContent = "71000";
    await p.click(row().querySelector('[data-action="update"]'));
    assert.deepEqual(writes(p).map((c) => [c.method, c.path, c.body]), [
      ["PUT", `/api/employees/${api.rows[0].id}`, { fullName: "Meera I. Iyer", email: "meera@example.com", salary: 71000 }],
    ]);
    assert.equal(text(row().querySelector('[data-field="fullName"]')), "Meera I. Iyer");
    assert.equal(row().querySelector('[data-field="fullName"]').hasAttribute("contenteditable"), false, "editing ended");
    assert.equal(text(row().querySelector('[data-action="update"]')), "Edit");
  });

  it("cancels an in-row edit with Escape, without saving", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);
    const p = await start({ html: page("staff-no-form.html"), map: apiMap(staffSpec), api });
    await p.click(p.$('tbody [data-action="update"]'));
    p.$('tbody [data-field="salary"]').textContent = "1";
    p.$('tbody [data-field="salary"]').dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await p.settle();
    assert.deepEqual(writes(p), []);
    assert.equal(text(p.$('tbody [data-field="salary"]')), "70000");
    assert.equal(text(p.$('tbody [data-action="update"]')), "Edit");
  });
});

describe("Delete", () => {
  it("asks first, deletes through the API and reloads; the page's own delete never runs", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);
    const p = await start({ html: page("staff-no-form.html"), map: apiMap(staffSpec), api });
    const id = api.rows[0].id;
    await p.click(p.$('tbody [data-action="delete"]'));
    assert.equal(p.confirms.length, 1);
    assert.match(p.confirms[0], /Delete/);
    assert.deepEqual(writes(p).map((c) => [c.method, c.path]), [["DELETE", `/api/employees/${id}`]]);
    assert.equal(p.$$("tbody tr").length, 0);
    assert.equal(p.window.pageDeleteRan, undefined);
  });

  it("does nothing when the answer is No", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);
    const p = await start({ html: page("staff-no-form.html"), map: apiMap(staffSpec), api, confirmAnswer: false });
    await p.click(p.$('tbody [data-action="delete"]'));
    assert.deepEqual(writes(p), []);
    assert.equal(p.$$("tbody tr").length, 1);
  });

  it("shows the server's message when something goes wrong", async () => {
    const list = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);
    const api = (r) => (r.method === "DELETE" ? { status: 500, body: { error: "Internal error" } } : list(r));
    const p = await start({ html: page("staff-no-form.html"), map: apiMap(staffSpec), api });
    await p.click(p.$('tbody [data-action="delete"]'));
    assert.deepEqual(p.alerts, ["Internal error"]);
    assert.equal(p.$$("tbody tr").length, 1);
  });
});

describe("row and page buttons", () => {
  const dashboard = async (extra = () => undefined) => {
    const list = memoryApi("/api/leaveRequests", [{ employee: "Isha", days: 4, status: "Pending" }]);
    const api = (r) => {
      if (r.path.endsWith("/approve")) {
        const row = list.rows.find((x) => r.path.includes(x.id));
        row.status = "Approved";
        return { body: row };
      }
      if (r.path === "/api/stats") return { body: { totalRequests: 1, pending: list.rows.filter((x) => x.status === "Pending").length, totalDays: 4 } };
      return extra(r) ?? list(r);
    };
    return { list, p: await start({ html: page("leave-dashboard.html"), map: apiMap(dashboardSpec), api }) };
  };

  it("runs a status button on its row, then refreshes the row look and the stat cards", async () => {
    const { p, list } = await dashboard();
    await p.click(p.$('#requests [data-action="approveLeaveRequest"]'));
    assert.deepEqual(writes(p).map((c) => [c.method, c.path]), [["POST", `/api/leaveRequests/${list.rows[0].id}/approve`]]);
    const badge = p.$('#requests [data-field="status"] span');
    assert.equal(text(badge), "Approved");
    assert.match(badge.className, /bg-green-100/, "the Approved look from the sample row");
    assert.equal(text(p.$('[data-stat="pending"]')), "0");
    assert.equal(p.window.pageClickRan, undefined);
  });

  it("says a custom button is not available yet, without calling the API", async () => {
    const { p } = await dashboard();
    await p.click(p.$('#requests [data-action="recalculateLeaveRequest"]'));
    await p.click(p.$('[data-action="syncPayrollLeaveRequest"]'));
    assert.deepEqual(writes(p), []);
    assert.deepEqual(p.alerts, ['"Recalculate" is not available yet.', '"Sync Payroll" is not available yet.']);
  });

  it("downloads the real CSV for Export", async () => {
    const csv = (r) =>
      r.path === "/api/leaveRequests/export.csv" ? new Response("Employee,Days\nIsha,4\n", { headers: { "content-type": "text/csv" } }) : undefined;
    const { p } = await dashboard(csv);
    await p.click(p.$('[data-action="exportLeaveRequests"]'));
    assert.equal(p.calls.filter((c) => c.path === "/api/leaveRequests/export.csv").length, 1);
    assert.equal(p.downloads.length, 1);
    assert.equal(await p.downloads[0].text(), "Employee,Days\nIsha,4\n");
  });
});
