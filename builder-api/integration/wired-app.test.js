// Integration (Step 15): the downloaded app working end to end. A generated backend on a real MongoDB
// serves its wired pages; jsdom (a browser without a screen) loads them over HTTP, runs the page's own
// scripts and the binder, and we use the page like a person: add, edit, search, delete, log in.
// Data must still be there after reloading the page. Needs TEST_MONGODB_URI (a throwaway database).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole, requestInterceptor } from "jsdom";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { wireApp } from "../src/wirer/index.js";
import { employeesSpec, loginStaffSpec } from "../test/fixtures/page-specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "wired"); // outside integration/
const fixture = (name) => readFileSync(new URL(`../test/fixtures/pages/${name}`, import.meta.url), "utf8");

const servers = [];
async function boot(name, spec, pages) {
  await mongoose.connection.dropDatabase();
  for (const modelName of mongoose.modelNames()) mongoose.deleteModel(modelName);
  const dir = path.join(OUT, name);
  await writeBackend(dir, { ...generateBackend(spec, { name }), ...wireApp({ spec, pages }) });
  const { app } = await import(pathToFileURL(path.join(dir, "backend/server.js")).href);
  const server = app.listen(0);
  servers.push(server);
  return { dir, base: `http://127.0.0.1:${server.address().port}` };
}

// Loads the app's own files (app.js) for real; the Tailwind CDN and other outside scripts get an empty answer.
const sameOriginOnly = (origin) => ({
  interceptors: [
    requestInterceptor((request) =>
      request.url.startsWith(origin) ? undefined : new Response("", { headers: { "Content-Type": "application/javascript" } })
    ),
  ],
});

/** Opens a page of the running app like a browser would. */
async function visit(base, file, { token } = {}) {
  const navigations = [];
  const alerts = [];
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (err) => /Not implemented: navigation/.test(err.message) || errors.push(err.message));
  console.on("error", (...args) => errors.push(args.join(" ")));
  const dom = await JSDOM.fromURL(`${base}/${file}`, {
    runScripts: "dangerously",
    resources: sameOriginOnly(base),
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(w) {
      w.fetch = (input, init) => fetch(new URL(String(input), w.location.href), init);
      w.alert = (m) => alerts.push(String(m));
      w.confirm = () => true;
      w.andarkacodeTestHooks = { navigate: (to) => navigations.push(String(to)) };
      w.HTMLElement.prototype.scrollIntoView = () => {};
      if (token) w.localStorage.setItem("andarkacode.token", token);
    },
  });
  const { window } = dom;
  const settled = async () => {
    const deadline = Date.now() + 5000;
    while (window.document.documentElement.dataset.andarkacode !== "ready" || window.document.readyState !== "complete") {
      if (Date.now() > deadline) throw new Error(`page not wired (state: ${window.document.documentElement.dataset.andarkacode}; ${errors.join("; ")})`);
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 150)); // a running request
  };
  await settled();
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  return { window, $, $$, navigations, alerts, errors, settled, close: () => window.close() };
}
const texts = (p, selector) => p.$$(selector).map((el) => el.textContent.trim());

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mongoose.connect(MONGODB_URI);
});
after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  await rm(OUT, { recursive: true, force: true });
});

describe("a wired app (the real Laptop B employees page) against its generated backend", () => {
  let base;
  before(async () => {
    ({ base } = await boot("employees", employeesSpec, [{ screenshot: 1, html: fixture("employees-real.html") }]));
  });

  it("starts empty: the sample rows are replaced by the (empty) database", async () => {
    const p = await visit(base, "page-1.html");
    assert.deepEqual(texts(p, '#employeeTableBody [data-field="fullName"]'), []);
    p.close();
  });

  it("adds, edits, searches and deletes on the page, and the data survives a reload", async () => {
    let p = await visit(base, "index.html");
    const set = (name, value) => (p.$(`#employeeForm [data-field="${name}"]`).value = value);
    const submit = async () => (p.$('#employeeForm button[type="submit"]').click(), p.settled());

    for (const [name, email, department, salary] of [
      ["Kavya Rao", "kavya@example.com", "HR", "52000"],
      ["Arjun Nair", "arjun@example.com", "Engineering", "81000"],
    ]) {
      set("fullName", name);
      set("email", email);
      set("department", department);
      set("salary", salary);
      await submit();
    }
    assert.deepEqual(texts(p, '#employeeTableBody [data-field="fullName"]'), ["Arjun Nair", "Kavya Rao"]);
    p.close();

    p = await visit(base, "page-1.html"); // reload: it was really saved
    assert.deepEqual(texts(p, '#employeeTableBody [data-field="fullName"]'), ["Arjun Nair", "Kavya Rao"]);

    // Edit Kavya's salary through the page's own form.
    const kavya = p.$$("#employeeTableBody tr").find((r) => r.textContent.includes("Kavya"));
    kavya.querySelector('[data-action="update"]').click();
    assert.equal(p.$('#employeeForm [data-field="email"]').value, "kavya@example.com");
    set("salary", "56000");
    await submit();
    p.close();

    p = await visit(base, "page-1.html");
    const row = p.$$("#employeeTableBody tr").find((r) => r.textContent.includes("Kavya"));
    assert.equal(row.querySelector('[data-field="salary"]').textContent.trim(), "56000");

    // Search through the API.
    const box = p.$('[data-action="search"]');
    box.value = "arj";
    box.dispatchEvent(new p.window.Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    await p.settled();
    assert.deepEqual(texts(p, '#employeeTableBody [data-field="fullName"]'), ["Arjun Nair"]);

    // Delete Arjun.
    p.$('#employeeTableBody [data-action="delete"]').click();
    await p.settled();
    p.close();

    p = await visit(base, "page-1.html");
    assert.deepEqual(texts(p, '#employeeTableBody [data-field="fullName"]'), ["Kavya Rao"]);
    assert.deepEqual(p.errors, []);
    p.close();
  });

  it("shows the backend's field problem on the field (a bad email)", async () => {
    const p = await visit(base, "page-1.html");
    // The browser's own email check would stop "x@y"; the backend wants a dot in the domain.
    p.$('#employeeForm [data-field="fullName"]').value = "Bad Email";
    p.$('#employeeForm [data-field="email"]').value = "x@y";
    p.$('#employeeForm [data-field="salary"]').value = "40000"; // required on this page
    p.$('#employeeForm button[type="submit"]').click();
    await p.settled();
    assert.equal(p.$('#employeeForm [data-field="email"]').validationMessage, "must be an email address");
    p.close();
  });
});

describe("a wired app with a login screen against its generated backend", () => {
  let base;
  let dir;
  before(async () => {
    ({ base, dir } = await boot("staff", loginStaffSpec, [
      { screenshot: 1, html: fixture("login.html") },
      { screenshot: 2, html: fixture("staff-no-form.html") },
    ]));
    const { ensureFirstUser } = await import(pathToFileURL(path.join(dir, "backend/auth/seed.js")).href);
    await ensureFirstUser({ email: "admin@example.com", password: "admin-pass-123" });
    const { Employee } = await import(pathToFileURL(path.join(dir, "backend/models/employee.model.js")).href);
    await Employee.create({ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 });
  });

  it("sends a visitor without a login to the login page", async () => {
    const p = await visit(base, "page-2.html");
    assert.deepEqual(p.navigations, ["page-1.html"]);
    p.close();
  });

  it("logs in on the login page, then the data page shows the real records and edits in the row", async () => {
    let p = await visit(base, "page-1.html");
    p.$('[data-field="email"]').value = "admin@example.com";
    p.$('[data-field="password"]').value = "admin-pass-123";
    p.$('[data-action="login"]').click();
    await p.settled();
    assert.deepEqual(p.navigations, ["page-2.html"]);
    const token = p.window.localStorage.getItem("andarkacode.token");
    assert.ok(token, "the token is kept");
    p.close();

    p = await visit(base, "page-2.html", { token });
    assert.deepEqual(p.navigations, []);
    assert.deepEqual(texts(p, 'tbody [data-field="fullName"]'), ["Meera Iyer"]);

    const edit = () => p.$('tbody [data-action="update"]');
    edit().click();
    p.$('tbody [data-field="salary"]').textContent = "72000";
    edit().click();
    await p.settled();
    p.close();

    p = await visit(base, "page-2.html", { token });
    assert.equal(p.$('tbody [data-field="salary"]').textContent.trim(), "72000");
    assert.deepEqual(p.errors, []);
    p.close();
  });

  it("refuses a wrong password, with the message on the password field", async () => {
    const p = await visit(base, "page-1.html");
    p.$('[data-field="email"]').value = "admin@example.com";
    p.$('[data-field="password"]').value = "wrong-password";
    p.$('[data-action="login"]').click();
    await p.settled();
    assert.match(p.$('[data-field="password"]').validationMessage, /wrong|incorrect/i);
    assert.deepEqual(p.navigations, []);
    p.close();
  });
});
