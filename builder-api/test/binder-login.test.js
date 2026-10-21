// Binder (Step 15), login (only when a screenshot shows a login screen): signing in keeps the token
// and opens the first data page; data pages need a login; every request carries the token.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { apiMap } from "../src/wirer/index.js";
import { employeesSpec, loginOnlyPageSpec, loginStaffSpec } from "./fixtures/page-specs.js";
import { TOKEN_KEY, memoryApi, openPage, page } from "./helpers/page.js";

let open;
afterEach(() => {
  if (open) {
    assert.deepEqual(open.errors, [], "no script errors in the page");
    open.close();
    open = undefined;
  }
});
const start = async (options) => (open = await openPage(options));
const map = apiMap(loginStaffSpec);
const LOGIN_URL = "http://localhost:3000/page-1.html";
const STAFF_URL = "http://localhost:3000/page-2.html";
const staff = () => memoryApi("/api/employees", [{ fullName: "Meera Iyer", email: "meera@example.com", salary: 70000 }]);

const auth = (answers) => (req) => {
  if (req.path === "/api/auth/login") return answers.login ? answers.login(req) : { body: { token: "tok-1", user: { email: req.body.email } } };
  if (req.path === "/api/auth/register") return answers.register ? answers.register(req) : { status: 201, body: { token: "tok-new", user: {} } };
  if (req.path === "/api/auth/logout") return { status: 204 };
  return answers.data ? answers.data(req) : undefined;
};
const signIn = async (p, email = "admin@example.com", password = "change-me-please") => {
  p.$('[data-field="email"]').value = email;
  p.$('[data-field="password"]').value = password;
  await p.click(p.$('[data-action="login"]'));
};

describe("the login page", () => {
  it("signs in through the API, keeps the token and opens the first data page", async () => {
    const p = await start({ html: page("login.html"), map, api: auth({}), url: LOGIN_URL });
    await signIn(p);
    assert.deepEqual(p.calls.map((c) => [c.method, c.path, c.body]), [
      ["POST", "/api/auth/login", { email: "admin@example.com", password: "change-me-please" }],
    ]);
    assert.equal(p.window.localStorage.getItem(TOKEN_KEY), "tok-1");
    assert.deepEqual(p.navigations, ["page-2.html"]);
    assert.equal(p.window.pageLoginRan, undefined, "the page's own demo login did not run");
    assert.deepEqual(p.alerts, []);
  });

  it("shows a wrong password as the browser's bubble on the password field, and stays", async () => {
    const login = () => ({ status: 401, body: { error: "Wrong email or password" } });
    const p = await start({ html: page("login.html"), map, api: auth({ login }), url: LOGIN_URL });
    await signIn(p, "admin@example.com", "nope");
    assert.equal(p.$('[data-field="password"]').validationMessage, "Wrong email or password");
    assert.deepEqual(p.navigations, []);
    assert.equal(p.window.localStorage.getItem(TOKEN_KEY), null);
  });

  it("does not send an empty form", async () => {
    const p = await start({ html: page("login.html"), map, api: auth({}), url: LOGIN_URL });
    await signIn(p, "", "");
    assert.deepEqual(p.calls, []);
  });

  it("signs up with the same email and password when the sign-up link is shown", async () => {
    const p = await start({ html: page("login.html"), map, api: auth({}), url: LOGIN_URL });
    p.$('[data-field="email"]').value = "new@example.com";
    p.$('[data-field="password"]').value = "a-long-password";
    await p.click(p.$('[data-action="signup"]'));
    assert.deepEqual(p.calls.map((c) => [c.path, c.body]), [["/api/auth/register", { email: "new@example.com", password: "a-long-password" }]]);
    assert.equal(p.window.localStorage.getItem(TOKEN_KEY), "tok-new");
    assert.deepEqual(p.navigations, ["page-2.html"]);
  });

  it("shows a sign-up problem on its field (an email that already has an account)", async () => {
    const register = () => ({ status: 400, body: { error: "Invalid input", details: { password: "must be at least 8 characters" } } });
    const p = await start({ html: page("login.html"), map, api: auth({ register }), url: LOGIN_URL });
    p.$('[data-field="email"]').value = "new@example.com";
    p.$('[data-field="password"]').value = "short";
    await p.click(p.$('[data-action="signup"]'));
    assert.equal(p.$('[data-field="password"]').validationMessage, "must be at least 8 characters");
    assert.deepEqual(p.navigations, []);
  });

  it("says you are signed in when the app has no other page", async () => {
    const p = await start({ html: page("login.html"), map: apiMap(loginOnlyPageSpec), api: auth({}), url: LOGIN_URL });
    await signIn(p);
    assert.deepEqual(p.navigations, []);
    assert.deepEqual(p.alerts, ["You are signed in."]);
  });
});

describe("data pages behind the login", () => {
  it("sends you to the login page when you are not signed in, without asking for data", async () => {
    const p = await start({ html: page("staff-no-form.html"), map, api: auth({ data: staff() }), url: STAFF_URL });
    assert.deepEqual(p.navigations, ["page-1.html"]);
    assert.deepEqual(p.calls, []);
  });

  it("sends the token with every request", async () => {
    const data = staff();
    const p = await start({ html: page("staff-no-form.html"), map, api: auth({ data }), url: STAFF_URL, token: "tok-1" });
    await p.click(p.$('tbody [data-action="delete"]'));
    assert.deepEqual(p.calls.map((c) => [c.method, c.auth]), [
      ["GET", "Bearer tok-1"],
      ["DELETE", "Bearer tok-1"],
      ["GET", "Bearer tok-1"],
    ]);
    assert.deepEqual(p.navigations, []);
  });

  it("goes back to the login page when the login has expired", async () => {
    const data = () => ({ status: 401, body: { error: "Please log in" } });
    const p = await start({ html: page("staff-no-form.html"), map, api: auth({ data }), url: STAFF_URL, token: "old" });
    assert.deepEqual(p.navigations, ["page-1.html"]);
    assert.equal(p.window.localStorage.getItem(TOKEN_KEY), null);
    assert.deepEqual(p.alerts, [], "no pop-up, just the login page");
  });

  it("logs out through the API when the page has a logout button", async () => {
    const html = page("staff-no-form.html").replace("<h1", '<button data-action="logout">Log out</button><h1');
    const p = await start({ html, map, api: auth({ data: staff() }), url: STAFF_URL, token: "tok-1" });
    await p.click(p.$('[data-action="logout"]'));
    assert.deepEqual(p.calls.at(-1), { method: "POST", path: "/api/auth/logout", query: {}, body: undefined, auth: "Bearer tok-1" });
    assert.equal(p.window.localStorage.getItem(TOKEN_KEY), null);
    assert.deepEqual(p.navigations, ["page-1.html"]);
  });

  it("never sends a token in an app without a login screen", async () => {
    const p = await start({ html: page("employees-real.html"), map: apiMap(employeesSpec), api: memoryApi("/api/employees", []), token: "from-another-app" });
    assert.ok(p.calls.length > 0);
    assert.ok(p.calls.every((c) => c.auth === null));
    assert.deepEqual(p.navigations, []);
  });
});
