// Binder (Step 15) on pages Laptop B really built (21 Oct, real Ollama + Screenshot-to-Code) for
// samples/mocks m2 (products) and m4 + m1 (login + staff), with their real specs. These found what the
// hand-written pages didn't: an Add button with no form, numbered page buttons marked prev/next,
// formatted prices, and a "Showing 1-3 of 24" line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { apiMap } from "../src/wirer/index.js";
import { memoryApi, openPage, page } from "./helpers/page.js";

const spec = (name) => JSON.parse(readFileSync(new URL(`./fixtures/pages/${name}`, import.meta.url), "utf8"));
const productsMap = apiMap(spec("products-real.spec.json"));
const staffMap = apiMap(spec("staff-login-real.spec.json"));

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
const button = (p, label) => p.$$("button").find((b) => text(b) === label);
const products = (n) => Array.from({ length: n }, (_, i) => ({ name: `Item ${i + 1}`, category: "Stationery", price: i + 0.5, inStock: i % 2 === 0 }));

describe("the real products page (m2)", () => {
  it("shows prices the way the sample rows did ($ and two decimals), and Yes/No", async () => {
    const api = memoryApi("/api/products", [{ name: "Stapler", category: "Stationery", price: 12, inStock: false }]);
    const p = await start({ html: page("products-real.html"), map: productsMap, api });
    assert.equal(text(p.$('tbody [data-field="price"]')), "$12.00");
    assert.equal(text(p.$('tbody [data-field="inStock"]')), "No");
  });

  it("keeps the 'Showing 1-3 of 24' line true", async () => {
    const p = await start({ html: page("products-real.html"), map: productsMap, api: memoryApi("/api/products", products(25)) });
    assert.ok(p.$$("span").some((s) => text(s) === "Showing 1-10 of 25"));
    await p.click(button(p, "2"));
    assert.ok(p.$$("span").some((s) => text(s) === "Showing 11-20 of 25"));
  });

  it("goes to the page number on a numbered button, even when it is marked prevPage/nextPage", async () => {
    const p = await start({ html: page("products-real.html"), map: productsMap, api: memoryApi("/api/products", products(25)) });
    await p.click(button(p, "3"));
    assert.equal(p.calls.at(-1).query.page, "3");
    assert.equal(text(p.$('tbody [data-field="name"]')), "Item 21");
    await p.click(button(p, "<"));
    assert.equal(p.calls.at(-1).query.page, "2");
    const before = p.calls.length;
    await p.click(button(p, "8"));
    assert.equal(p.calls.length, before, "there is no page 8: nothing happens");
    await p.click(button(p, "1"));
    assert.equal(button(p, "<").disabled, true, "on page 1, < is off");
    assert.equal(button(p, "2").disabled, false, "numbered buttons stay on");
  });

  it("adds through a new row in the page's own look when the page has an Add button but no form", async () => {
    const api = memoryApi("/api/products", [{ name: "Stapler", category: "Stationery", price: 12, inStock: false }]);
    const p = await start({ html: page("products-real.html"), map: productsMap, api });
    const add = p.$('[data-action="create"]');
    await p.click(add);
    const rows = p.$$("tbody tr");
    assert.equal(rows.length, 2, "a new row on top");
    const cell = (name) => rows[0].querySelector(`[data-field="${name}"]`);
    assert.equal(cell("name").getAttribute("contenteditable"), "true");
    assert.equal(text(cell("name")), "", "the new row starts empty");
    assert.equal(cell("name").className, rows[1].querySelector('[data-field="name"]').className, "same look as the other rows");
    assert.equal(text(add), "Save");

    cell("name").textContent = "Desk Lamp";
    cell("category").textContent = "Electronics";
    cell("price").textContent = "$12.50";
    cell("inStock").textContent = "Yes";
    await p.click(add);
    assert.deepEqual(writes(p).map((c) => c.body), [{ name: "Desk Lamp", category: "Electronics", price: 12.5, inStock: true }]);
    assert.deepEqual(p.$$('tbody [data-field="name"]').map(text), ["Desk Lamp", "Stapler"]);
    assert.equal(text(add), "+ Add Product");
    assert.equal(p.$$("tbody [contenteditable]").length, 0);
  });

  it("cancels a new row with Escape, and saves it with Enter", async () => {
    const api = memoryApi("/api/products", []);
    const p = await start({ html: page("products-real.html"), map: productsMap, api });
    const add = p.$('[data-action="create"]');
    await p.click(add);
    const key = (el, k) => el.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
    key(p.$('tbody [data-field="name"]'), "Escape");
    await p.settle();
    assert.equal(p.$$("tbody tr").length, 0);
    assert.equal(text(add), "+ Add Product");

    await p.click(add);
    p.$('tbody [data-field="name"]').textContent = "Ruler";
    key(p.$('tbody [data-field="name"]'), "Enter");
    await p.settle();
    assert.deepEqual(writes(p).map((c) => c.body), [{ name: "Ruler" }]);
  });

  it("tells what is missing when a new row can't be saved", async () => {
    const list = memoryApi("/api/products", []);
    const api = (r) => (r.method === "POST" ? { status: 400, body: { error: "Invalid input", details: { name: "is required" } } } : list(r));
    const p = await start({ html: page("products-real.html"), map: productsMap, api });
    await p.click(p.$('[data-action="create"]'));
    await p.click(p.$('[data-action="create"]'));
    assert.deepEqual(p.alerts, ["Name: is required"]);
    assert.equal(p.$$("tbody [contenteditable]").length > 0, true, "the row stays open to fix it");
  });
});

describe("the real login + staff pages (m4 + m1)", () => {
  it("signs in on the real login page", async () => {
    const api = (r) => (r.path === "/api/auth/login" ? { body: { token: "tok-1" } } : undefined);
    const p = await start({ html: page("login-real.html"), map: staffMap, api });
    p.$('[data-field="email"]').value = "admin@example.com";
    p.$('[data-field="password"]').value = "a-password-1";
    await p.click(p.$('[data-action="login"]'));
    assert.deepEqual(p.navigations, ["page-2.html"]);
  });

  it("edits a row in place on the real staff page and sends the token", async () => {
    const api = memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);
    const p = await start({ html: page("staff-real.html"), map: staffMap, api, url: "http://localhost:3000/page-2.html", token: "tok-1" });
    await p.click(p.$('tbody [data-action="update"]'));
    p.$('tbody [data-field="salary"]').textContent = "72000";
    await p.click(p.$('tbody [data-action="update"]'));
    assert.deepEqual(writes(p).map((c) => [c.method, c.body.salary, c.auth]), [["PUT", 72000, "Bearer tok-1"]]);
    assert.equal(text(p.$('tbody [data-field="salary"]')), "72000");
  });
});
