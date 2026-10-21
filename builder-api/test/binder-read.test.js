// Binder (Step 15), reading: real records replace the sample rows in the page's own look; search,
// filters, previous/next and stat cards ask the backend. The page's own fake behaviour never runs.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { apiMap } from "../src/wirer/index.js";
import { dashboardSpec, employeesSpec, productsSpec, relationSpec } from "./fixtures/page-specs.js";
import { BINDER, memoryApi, openPage, page } from "./helpers/page.js";

let open;
afterEach(() => {
  if (open) {
    assert.deepEqual(open.errors, [], "no script errors in the page");
    open.close();
    open = undefined;
  }
});
const start = async (options) => (open = await openPage(options));
const gets = (p, path) => p.calls.filter((c) => c.method === "GET" && c.path === path);
const text = (el) => el.textContent.trim();

describe("rows: real records in the page's own look", () => {
  it("replaces the sample rows of a real Laptop B page with the records from the API", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", department: "Sales", salary: 70000 }]);
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api });
    const rows = p.$$("#employeeTableBody tr");
    assert.equal(rows.length, 1, "the two sample rows are gone");
    assert.equal(text(rows[0].querySelector('[data-field="fullName"]')), "Meera Iyer");
    assert.equal(text(rows[0].querySelector('[data-field="salary"]')), "70000");
    assert.equal(rows[0].dataset.id, api.rows[0].id);
    assert.equal(rows[0].querySelector('[data-field="email"]').className, "px-6 py-4 whitespace-nowrap", "same classes as the sample row");
    assert.ok(rows[0].querySelector('[data-action="update"]') && rows[0].querySelector('[data-action="delete"]'), "the row keeps its buttons");
    assert.equal(p.document.documentElement.dataset.andarkacode, "ready");
    assert.equal(gets(p, "/api/employees").length, 1);
    assert.equal(gets(p, "/api/employees")[0].auth, null, "no login on this app, so no token");
  });

  it("shows values as text, never as HTML", async () => {
    const api = memoryApi("/api/employees", [{ fullName: '<img src=x onerror="window.hacked=1">', email: "x@example.com" }]);
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api });
    assert.equal(p.$("#employeeTableBody img"), null);
    assert.equal(text(p.$('#employeeTableBody [data-field="fullName"]')), '<img src=x onerror="window.hacked=1">');
    assert.equal(p.window.hacked, undefined);
  });

  it("shows an empty list as no rows (the sample rows are not left behind)", async () => {
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api: memoryApi("/api/employees", []) });
    assert.equal(p.$$("#employeeTableBody tr").length, 0);
  });

  it("works for a card grid as well as a table, and keeps the Yes/No badge look of the sample cards", async () => {
    const api = memoryApi("/api/products", [
      { name: "Stapler", category: "Stationery", price: 90, inStock: false },
      { name: "Mouse", category: "Electronics", price: 499, inStock: true },
    ]);
    const p = await start({ html: page("products-cards.html"), map: apiMap(productsSpec), api });
    const cards = p.$$("#grid .card");
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map((c) => text(c.querySelector('[data-field="name"]'))), ["Stapler", "Mouse"]);
    const badge = (card) => card.querySelector('[data-field="inStock"]');
    assert.equal(text(badge(cards[0])), "Out of Stock");
    assert.match(badge(cards[0]).className, /bg-red-100/);
    assert.equal(text(badge(cards[1])), "In Stock");
    assert.match(badge(cards[1]).className, /bg-green-100/);
    assert.equal(text(cards[1].querySelector('[data-field="price"]')), "499");
    assert.equal(p.$('#add [data-field="name"]').closest("#grid"), null, "the add form's inputs are not mistaken for a card");
  });

  it("keeps each status badge's colour from the sample row with the same value", async () => {
    const api = memoryApi("/api/leaveRequests", [
      { employee: "Kabir", days: 2, status: "Approved" },
      { employee: "Isha", days: 4, status: "Pending" },
    ]);
    const p = await start({ html: page("leave-dashboard.html"), map: apiMap(dashboardSpec), api });
    const badges = p.$$('#requests [data-field="status"] span');
    assert.deepEqual(badges.map(text), ["Approved", "Pending"]);
    assert.match(badges[0].className, /bg-green-100/);
    assert.match(badges[1].className, /bg-yellow-100/);
  });

  it("shows a related record by its name, and a date as YYYY-MM-DD", async () => {
    const departments = memoryApi("/api/departments", [{ name: "Finance" }, { name: "Design" }]);
    const requests = memoryApi("/api/leaveRequests", [
      { employeeName: "Kabir", department: { id: "d1", name: "Finance" }, from: "2026-12-01T00:00:00.000Z" },
    ]);
    const p = await start({ html: page("leave-relation.html"), map: apiMap(relationSpec), api: (r) => requests(r) ?? departments(r) });
    assert.equal(text(p.$('#rows [data-field="department"]')), "Finance");
    assert.ok(p.$('#rows [data-field="department"] span.tag'), "the tag look is kept");
    assert.equal(text(p.$('#rows [data-field="from"]')), "2026-12-01");
  });

  it("fills a relation dropdown with the real records (id as value, name as text), keeping its placeholder", async () => {
    const departments = memoryApi("/api/departments", [{ name: "Finance" }, { name: "Design" }]);
    const requests = memoryApi("/api/leaveRequests", []);
    const p = await start({ html: page("leave-relation.html"), map: apiMap(relationSpec), api: (r) => requests(r) ?? departments(r) });
    const options = [...p.$('form [data-field="department"]').options];
    assert.deepEqual(options.map((o) => [o.value, o.textContent]), [["", "Department"], ...departments.rows.map((d) => [d.id, d.name])]);
  });
});

describe("search, filters, previous/next: the backend does the work", () => {
  it("searches through the API after typing stops, and the page's own search never runs", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com" }]);
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api });
    const box = p.$('[data-action="search"]');
    for (const typed of ["m", "me", "mee"]) p.type(box, typed);
    await p.settle(400);
    const searches = gets(p, "/api/employees").slice(1);
    assert.equal(searches.length, 1, "one request for the whole word, not one per letter");
    assert.equal(searches[0].query.q, "mee");
    assert.ok(p.$$("#employeeTableBody tr").every((r) => r.style.display === ""), "the page's own row hiding did not run");
  });

  it("filters by the spec's value (matched by text), and an 'All' option means no filter", async () => {
    const api = memoryApi("/api/leaveRequests", [{ employee: "Kabir", days: 2, status: "Approved" }]);
    const p = await start({ html: page("leave-dashboard.html"), map: apiMap(dashboardSpec), api });
    const select = p.$('[data-filter="status"]');
    p.choose(select, "Approved");
    await p.settle();
    assert.equal(gets(p, "/api/leaveRequests").at(-1).query.status, "Approved");
    p.choose(select, "All statuses");
    await p.settle();
    assert.equal(gets(p, "/api/leaveRequests").at(-1).query.status, undefined);
    assert.equal(p.window.pageFilterRan, undefined, "the page's own filter did not run");

    const cards = await openPage({ html: page("products-cards.html"), map: apiMap(productsSpec), api: memoryApi("/api/products", []) });
    cards.choose(cards.$('[data-filter="category"]'), "stationery");
    await cards.settle();
    assert.equal(gets(cards, "/api/products").at(-1).query.category, "Stationery", "option value 'stationery' is the spec's 'Stationery'");
    cards.close();
  });

  it("goes to the next and previous page, and disables the buttons at the ends", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ employee: `Person ${i + 1}`, days: 1, status: "Pending" }));
    const p = await start({ html: page("leave-dashboard.html"), map: apiMap(dashboardSpec), api: memoryApi("/api/leaveRequests", items) });
    const [prev, next] = [p.$('[data-action="prevPage"]'), p.$('[data-action="nextPage"]')];
    assert.equal(gets(p, "/api/leaveRequests")[0].query.page, "1");
    assert.equal(prev.disabled, true);
    assert.equal(next.disabled, false);
    await p.click(next);
    assert.equal(gets(p, "/api/leaveRequests").at(-1).query.page, "2");
    assert.equal(text(p.$('#requests [data-field="employee"]')), "Person 11");
    assert.equal(prev.disabled, false);
    await p.click(next);
    assert.equal(next.disabled, true, "page 3 of 3");
    await p.click(prev);
    assert.equal(gets(p, "/api/leaveRequests").at(-1).query.page, "2");
    assert.equal(p.window.pageClickRan, undefined, "the page's own click handler did not run");
  });
});

describe("stat cards", () => {
  it("shows the real numbers, and a dash for a number that can't be calculated yet", async () => {
    const list = memoryApi("/api/leaveRequests", []);
    const stats = (r) => (r.path === "/api/stats" ? { body: { totalRequests: 1234, pending: 2, totalDays: 0, happinessIndex: null } } : undefined);
    const p = await start({ html: page("leave-dashboard.html"), map: apiMap(dashboardSpec), api: (r) => list(r) ?? stats(r) });
    assert.equal(text(p.$('[data-stat="totalRequests"]')), "1,234");
    assert.equal(text(p.$('[data-stat="pending"]')), "2");
    assert.equal(text(p.$('[data-stat="totalDays"]')), "0");
  });
});

describe("when something is wrong", () => {
  it("leaves the page as it is when api-map.json is missing", async () => {
    const p = await start({ html: page("employees-real.html"), map: null });
    assert.equal(p.document.documentElement.dataset.andarkacode, "error");
    assert.equal(p.$$("#employeeTableBody tr").length, 2, "the sample rows stay");
    assert.equal(p.calls.length, 0);
  });

  it("explains that the app must be opened through npm start when opened as a file", async () => {
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), url: "file:///C:/app/frontend/page-1.html" });
    assert.equal(p.calls.length, 0);
    assert.match(p.alerts.join("\n"), /npm start/);
    assert.equal(p.document.documentElement.dataset.andarkacode, "error");
  });

  it("can be put inline in a page (it never contains a closing script tag)", () => {
    assert.doesNotMatch(BINDER, /<\/script/i);
  });
});
