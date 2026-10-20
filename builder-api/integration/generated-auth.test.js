// Integration: the GENERATED login (Step 12) against a real MongoDB.
// Needs TEST_MONGODB_URI (a throwaway database; it is dropped).
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { authSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "auth-app"); // outside integration/
const load = (file) => import(pathToFileURL(path.join(OUT, file)).href);

let server;
let base;
async function call(method, route, { body, token } = {}) {
  const headers = { ...(body && { "Content-Type": "application/json" }), ...(token && { Authorization: `Bearer ${token}` }) };
  const res = await fetch(`${base}${route}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}
const login = (email, password) => call("POST", "/api/auth/login", { body: { email, password } });

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await writeBackend(OUT, generateBackend(authSpec, { name: "staff" }));
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  const { app } = await load("backend/server.js");
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const { Account } = await load("backend/models/account.model.js");
  const { hashPassword } = await load("backend/auth/passwords.js");
  await Account.create({ email: "admin@corp.com", passwordHash: await hashPassword("admin-pass-123"), role: "admin" });
});
after(async () => {
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await rm(OUT, { recursive: true, force: true });
});

describe("generated login", () => {
  it("refuses data without a token, and with a made-up token", async () => {
    assert.equal((await call("GET", "/api/employees")).status, 401);
    assert.equal((await call("GET", "/api/employees", { token: "made-up" })).status, 401);
    assert.equal((await call("GET", "/health")).status, 200, "/health stays public");
  });

  it("logs in with the right password and then serves data", async () => {
    const res = await login("Admin@Corp.com", "admin-pass-123");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, "string");
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal((await call("GET", "/api/employees", { token: res.body.token })).status, 200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrong = await login("admin@corp.com", "nope");
    const unknown = await login("nobody@corp.com", "nope");
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  it("pauses login after 5 wrong passwords, even for the right one", async () => {
    const { Account } = await load("backend/models/account.model.js");
    const { hashPassword } = await load("backend/auth/passwords.js");
    await Account.create({ email: "target@corp.com", passwordHash: await hashPassword("target-pass-1") });
    for (let i = 0; i < 5; i++) assert.equal((await login("target@corp.com", "guess" + i)).status, 401);
    assert.equal((await login("target@corp.com", "target-pass-1")).status, 429);
  });

  it("stores only a fingerprint of the token, and refuses an expired session", async () => {
    const { token } = (await login("admin@corp.com", "admin-pass-123")).body;
    const sessions = mongoose.connection.collection("loginSessions");
    assert.equal(await sessions.countDocuments({ tokenHash: token }), 0, "the raw token is never stored");
    await sessions.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await call("GET", "/api/employees", { token })).status, 401);
  });
});

describe("generated sign-up, me and logout", () => {
  it("registers a new user (logged in straight away), refuses a duplicate and a short password", async () => {
    const res = await call("POST", "/api/auth/register", { body: { email: "new@corp.com", password: "new-pass-123" } });
    assert.equal(res.status, 201);
    assert.equal((await call("GET", "/api/employees", { token: res.body.token })).status, 200);
    assert.equal((await call("POST", "/api/auth/register", { body: { email: "NEW@corp.com", password: "other-pass-1" } })).status, 409);
    const short = await call("POST", "/api/auth/register", { body: { email: "s@corp.com", password: "123" } });
    assert.equal(short.status, 400);
    assert.ok(short.body.details.password);
  });

  it("returns the logged-in user with their role, and logout ends the session", async () => {
    const { token } = (await login("admin@corp.com", "admin-pass-123")).body;
    const me = await call("GET", "/api/auth/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "admin@corp.com");
    assert.equal(me.body.user.role, "admin");
    assert.equal((await call("POST", "/api/auth/logout", { token })).status, 204);
    assert.equal((await call("GET", "/api/auth/me", { token })).status, 401);
  });
});

describe("first user from .env", () => {
  it("creates the first user from ADMIN_EMAIL/ADMIN_PASSWORD only when there are no users", async () => {
    const { Account } = await load("backend/models/account.model.js");
    const { ensureFirstUser } = await load("backend/auth/seed.js");
    await Account.deleteMany({});
    assert.equal(await ensureFirstUser({ email: "boss@corp.com", password: "boss-pass-123" }), true);
    assert.equal(await ensureFirstUser({ email: "second@corp.com", password: "second-pass-1" }), false);
    assert.equal(await Account.countDocuments(), 1);
    assert.equal((await login("boss@corp.com", "boss-pass-123")).status, 200);
  });
});
