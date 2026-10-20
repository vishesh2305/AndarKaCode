// Backend generator, Step 12 (no database): login code exists ONLY when a login screen is shown,
// and sign-up, "me"/logout and roles only when those are shown too.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { authSpec, editDeleteSpec, loginOnlySpec } from "./fixtures/specs.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "auth"); // outside test/
const load = (dir, file) => import(pathToFileURL(path.join(OUT, dir, file)).href);
const routeTable = (router) =>
  router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));
const files = (spec) => generateBackend(spec, { name: "x" });
const AUTH_FILES = [
  "backend/auth/middleware.js",
  "backend/auth/passwords.js",
  "backend/auth/seed.js",
  "backend/models/loginSession.model.js",
  "backend/models/account.model.js",
  "backend/routes/auth.routes.js",
];

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await writeBackend(path.join(OUT, "full"), files(authSpec));
  await writeBackend(path.join(OUT, "login"), files(loginOnlySpec));
});
after(() => rm(OUT, { recursive: true, force: true }));

describe("auth: only with a login screen", () => {
  it("generates no login code at all when no login screen is shown", () => {
    const f = files(editDeleteSpec);
    assert.deepEqual(Object.keys(f).filter((p) => /auth|user\.model|session\.model/.test(p)), []);
    assert.doesNotMatch(f["backend/server.js"], /requireLogin|auth/);
    assert.doesNotMatch(f[".env.example"], /ADMIN|SESSION/);
  });

  it("generates accounts, login sessions, passwords, the guard, the first-user seed and auth routes with a login screen", () => {
    const names = Object.keys(files(loginOnlySpec));
    for (const file of AUTH_FILES) assert.ok(names.includes(file), file);
  });

  it("login screen alone -> only POST /login (no sign-up, no /me, no logout)", async () => {
    const { router } = await load("login", "backend/routes/auth.routes.js");
    assert.deepEqual(routeTable(router), ["POST /login"]);
  });

  it("sign-up link and user menu -> /register, /me and /logout too", async () => {
    const { router } = await load("full", "backend/routes/auth.routes.js");
    assert.deepEqual(routeTable(router).sort(), ["GET /me", "POST /login", "POST /logout", "POST /register"]);
  });

  it("adds a role to users only when role labels are shown", () => {
    // Checked in the generated text: two generated apps in one test process share Mongoose's model registry.
    assert.match(files(authSpec)["backend/models/account.model.js"], /role: \{ type: String, enum: \["admin","manager"\] \}/);
    assert.match(files(loginOnlySpec)["backend/models/account.model.js"], /email/);
    assert.doesNotMatch(files(loginOnlySpec)["backend/models/account.model.js"], /role/);
  });

  it("mounts /api/auth before the login guard, and the guard before every data route", () => {
    const server = files(authSpec)["backend/server.js"];
    const at = (text) => server.indexOf(text);
    assert.ok(at('app.use("/api/auth", authRoutes)') > 0);
    assert.ok(at('app.use("/api/auth", authRoutes)') < at('app.use("/api", requireLogin)'));
    assert.ok(at('app.use("/api", requireLogin)') < at('app.use("/api/employees", employeeRoutes)'));
  });

  it("lists the first user's login and the session length in .env.example", () => {
    const env = files(loginOnlySpec)[".env.example"];
    assert.match(env, /^ADMIN_EMAIL=/m);
    assert.match(env, /^ADMIN_PASSWORD=/m);
    assert.match(env, /^SESSION_HOURS=12$/m);
  });
});

describe("auth: passwords", () => {
  it("stores a salted scrypt hash, never the password, and verifies it", async () => {
    const { hashPassword, verifyPassword } = await load("login", "backend/auth/passwords.js");
    const hash = await hashPassword("correct horse");
    assert.doesNotMatch(hash, /correct horse/);
    assert.notEqual(hash, await hashPassword("correct horse"), "a new salt every time");
    assert.equal(await verifyPassword("correct horse", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
  });

  it("never sends the password hash out in JSON", async () => {
    const { Account } = await load("full", "backend/models/account.model.js");
    const json = new Account({ email: "a@x.com", passwordHash: "scrypt$x$y" }).toJSON();
    assert.equal(json.passwordHash, undefined);
    assert.equal(typeof json.id, "string");
  });
});

describe("auth: generated tests", () => {
  it("log in first and test the login rules", () => {
    const tests = files(authSpec)["tests/api.test.js"];
    for (const name of ["logs in with the right password", "refuses a wrong password", "pauses login after 5 wrong passwords", "refuses data without a login", "registers", "returns the logged-in user", "logs out"]) {
      assert.ok(tests.includes(`it("${name}`), name);
    }
  });
});
