// Integration, Step 32a: the Builder API's outer layer. Security headers on every answer (helmet), a Content
// Security Policy that lets the UI embed its live preview and nothing else, generated pages served in a
// sandbox of their own (opened directly, they still can't reach our API or cookies), changes accepted only
// from our own site (also with sign-in off), no CORS for other sites, and rate limits that answer politely.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { jsonServer, startSignedInApi, urlOf } from "./helpers/signed-in-api.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");

const fakeGemini = await jsonServer(async () => ({ json: { models: [] } })); // every key is good

let on; // sign-in on
let off; // sign-in off (this computer only)
let session; // signed in before the sign-in limit is tried
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  [on, off] = await Promise.all([
    startSignedInApi({ MONGODB_URI, KEY_VAULT_SECRET: randomBytes(32).toString("hex"), GEMINI_BASE_URL: `${urlOf(fakeGemini)}/v1beta` }),
    startSignedInApi({ MONGODB_URI, AUTH: "off" }),
  ]);
  session = await on.signIn("limits@example.com");
});
after(async () => {
  on?.stop();
  off?.stop();
  fakeGemini.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("Step 32a: security headers", () => {
  it("every answer carries them, and says nothing about the server", async () => {
    const res = await on.get("/healthz");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  it("the Content Security Policy: our own scripts only, framed only by us, the live preview allowed as a frame", async () => {
    const csp = (await on.get("/healthz")).headers.get("content-security-policy");
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-src 'self' http:\/\/127\.0\.0\.1:\d+/, "the live preview runs on its own port");
  });

  it("no CORS: another site's page can't read our answers", async () => {
    const res = await on.get("/api/me", null, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    const preflight = await on.get("/api/projects", null, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  });
});

describe("Step 32a: generated pages", () => {
  it("are served in a sandbox of their own: scripts run, but not as our site", async () => {
    const { generatedPageHeaders } = await import("../src/security.js");
    const csp = generatedPageHeaders()["Content-Security-Policy"];
    assert.match(csp, /sandbox allow-scripts/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.match(csp, /https:\/\/cdn\.tailwindcss\.com/, "the pages' Tailwind still loads");
    assert.match(csp, /connect-src 'none'/, "and they can't call anything");
  });
});

describe("Step 32a: changes only from our own site", () => {
  it("with sign-in off too: another site's page can't clear this computer's memory", async () => {
    const evil = await off.get("/api/memory", null, { method: "DELETE", headers: { Origin: "https://evil.example" } });
    assert.equal(evil.status, 403);
    assert.match((await evil.json()).error, /another site/);
    assert.equal((await off.get("/api/memory", null, { method: "DELETE" })).status, 200, "from our own page it works");
  });
});

describe("Step 32a: rate limits answer politely", () => {
  it("starting sign-ins: 20 a minute from one address, then 429 with when to try again", async () => {
    const answers = []; // the sign-in before these tests was the first of the 20
    for (let i = 0; i < 20; i++) answers.push(await on.get("/auth/github/start"));
    assert.ok(answers.slice(0, 19).every((r) => r.status === 302));
    const limited = answers[19];
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.match((await limited.json()).error, /Too many sign-in attempts.*try again in \d+ s/);
  });

  it("adding keys: 10 an hour per workspace (each one asks its provider)", async () => {
    const add = () => on.get("/api/keys", session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini", apiKey: `AIza${randomBytes(18).toString("hex")}` }) });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await add()).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
    assert.equal(statuses[10], 429);
  });

  it("the counts are kept in MongoDB, so every API instance shares them", async () => {
    assert.ok((await mongoose.connection.db.collection("rate_hits").countDocuments()) > 0);
  });
});
