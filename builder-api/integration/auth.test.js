// Integration, Step 29: the whole sign-in, with the real Builder API (AUTH=on) and MongoDB, and fake GitHub
// and Google servers. The test is the browser: it follows the redirects by hand, keeps the cookies, and the
// fake providers check the PKCE proof like the real ones. Only invited accounts get in.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import sharp from "sharp";
import { invite } from "../src/auth/invites.js";
import { Session } from "../src/models/session.js";
import { User } from "../src/models/user.js";
import { Workspace } from "../src/models/workspace.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");

// Made up at every run: no key-like text in the repository.
const CLIENT_ID = randomBytes(6).toString("hex");
const CLIENT_SECRET = randomBytes(12).toString("hex");

// ---- fake providers: a code is handed out for a person (as if they had approved on GitHub/Google) ----
const codes = new Map(); // code -> { person, challenge }
const tokens = new Map(); // access token -> person
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

function server(handler) {
  return new Promise((resolve) => {
    const s = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { status = 200, json } = await handler(req, body);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(json));
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

// The code is good once, for the right app, with the verifier whose challenge started the sign-in.
function trade(params) {
  const grant = codes.get(params.code);
  codes.delete(params.code);
  if (!grant || params.client_id !== CLIENT_ID || params.client_secret !== CLIENT_SECRET || s256(params.code_verifier ?? "") !== grant.challenge) return null;
  const token = randomUUID();
  tokens.set(token, grant.person);
  return token;
}
const bearer = (req) => tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));

const fakeGitHub = await server(async (req, body) => {
  if (req.url === "/login/oauth/access_token") {
    const token = trade(JSON.parse(body));
    return { json: token ? { access_token: token, token_type: "bearer" } : { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } };
  }
  const person = bearer(req);
  if (!person) return { status: 401, json: { message: "Bad credentials" } };
  if (req.url === "/user") return { json: { id: person.id, login: person.login, name: person.name, avatar_url: null } };
  if (req.url === "/user/emails") return { json: [{ email: person.email, primary: true, verified: person.verified !== false }] };
  return { status: 404, json: {} };
});

const fakeGoogle = await server(async (req, body) => {
  const root = urlOf(fakeGoogle);
  if (req.url === "/.well-known/openid-configuration")
    return { json: { authorization_endpoint: `${root}/auth`, token_endpoint: `${root}/token`, userinfo_endpoint: `${root}/userinfo` } };
  if (req.url === "/token") {
    const token = trade(Object.fromEntries(new URLSearchParams(body)));
    return token ? { json: { access_token: token } } : { status: 400, json: { error: "invalid_grant" } };
  }
  const person = bearer(req);
  if (req.url === "/userinfo" && person) return { json: { sub: String(person.id), email: person.email, email_verified: person.verified !== false, name: person.name } };
  return { status: 401, json: {} };
});

// ---- the Builder API with sign-in on ----
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

let api;
let root;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  const port = await freePort();
  root = `http://127.0.0.1:${port}`;
  api = spawn(process.execPath, ["src/server.js"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      ROLE: "api",
      PORT: String(port),
      HOST: "127.0.0.1",
      PREVIEW_PORT: "0",
      MONGODB_URI,
      GATEWAY_URL: "",
      GATEWAY_API_KEY: "",
      GEMINI_API_KEY: "",
      AUTH: "on",
      PUBLIC_URL: root,
      GITHUB_CLIENT_ID: CLIENT_ID,
      GITHUB_CLIENT_SECRET: CLIENT_SECRET,
      GITHUB_URL: urlOf(fakeGitHub),
      GITHUB_API_URL: urlOf(fakeGitHub),
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_ISSUER: urlOf(fakeGoogle),
    },
  });
  let log = "";
  api.stdout.on("data", (d) => (log += d));
  api.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 300 && !/listening/.test(log); i++) {
    if (api.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!/listening/.test(log)) throw new Error(`The Builder API did not start:\n${log}`);
});
after(async () => {
  api?.kill();
  fakeGitHub.close();
  fakeGoogle.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---- the browser ----
const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(";")[0]);
const cookieValue = (res, name) => cookiesOf(res).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
const get = (p, cookie, init = {}) => fetch(new URL(p, root), { redirect: "manual", ...init, headers: { ...(cookie && { Cookie: cookie }), ...init.headers } });

/** Signs in as person with provider; { res: the callback's answer, session: the session cookie or undefined }. */
async function signIn(provider, person, { tamper } = {}) {
  const start = await get(`/auth/${provider}/start`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location"));
  const login = cookiesOf(start).join("; ");
  const code = randomUUID();
  codes.set(code, { person, challenge: to.searchParams.get("code_challenge") });
  let state = to.searchParams.get("state");
  let cookie = login;
  if (tamper === "state") state = randomUUID();
  if (tamper === "cookie") cookie = "";
  const res = await get(`/auth/${provider}/callback?code=${code}&state=${state}`, cookie);
  const token = cookieValue(res, "ak_session");
  return { res, session: token ? `ak_session=${token}` : undefined, token };
}

const person = (email, extra = {}) => ({ id: Math.floor(Math.random() * 1e9), login: email.split("@")[0], name: email.split("@")[0], email, ...extra });

describe("Step 29: only invited accounts get in", () => {
  it("nothing in the API without signing in (the health checks and /api/me stay open)", async () => {
    assert.equal((await get("/api/projects")).status, 401);
    assert.match((await (await get("/api/projects")).json()).error, /Sign in/);
    assert.equal((await get("/healthz")).status, 200);
    const me = await (await get("/api/me")).json();
    assert.deepEqual(me, { auth: true, user: null, providers: ["github", "google"] });
  });

  it("an invited GitHub account signs in: a session cookie, a personal workspace, and the API opens", async () => {
    await invite("asha@example.com");
    const { res, session } = await signIn("github", person("Asha@Example.com", { name: "Asha K" }));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `${root}/`);
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("ak_session="));
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /SameSite=Lax/);

    const me = await (await get("/api/me", session)).json();
    assert.equal(me.user.email, "asha@example.com");
    assert.equal(me.user.name, "Asha K");
    assert.equal(me.workspace.name, "Asha K's workspace");
    assert.equal(me.workspace.role, "owner");
    assert.equal((await get("/api/projects", session)).status, 200);
  });

  it("an account that is not invited is turned away: no session, no account kept", async () => {
    const { res, session } = await signIn("github", person("stranger@example.com"));
    assert.equal(res.headers.get("location"), `${root}/?signin=not-invited`);
    assert.equal(session, undefined);
    assert.equal(await User.countDocuments({ email: "stranger@example.com" }), 0);
  });

  it("an invited email that the provider has not verified is turned away", async () => {
    await invite("unverified@example.com");
    const { res, session } = await signIn("google", person("unverified@example.com", { verified: false }));
    assert.equal(res.headers.get("location"), `${root}/?signin=not-verified`);
    assert.equal(session, undefined);
  });

  it("a sign-in finished with another state, or in another browser (no login cookie), is refused", async () => {
    await invite("mallory@example.com");
    for (const tamper of ["state", "cookie"]) {
      const { res, session } = await signIn("github", person("mallory@example.com"), { tamper });
      assert.equal(res.headers.get("location"), `${root}/?signin=failed`, tamper);
      assert.equal(session, undefined, tamper);
    }
  });

  it("the same verified email through Google is the same person, with the same workspace", async () => {
    assert.equal((await signIn("github", person("ravi@example.com"))).session, undefined, "not invited yet");
    await invite("ravi@example.com");
    const a = await signIn("github", person("ravi@example.com"));
    const b = await signIn("google", person("ravi@example.com"));
    const [meA, meB] = await Promise.all([a, b].map(async ({ session }) => (await get("/api/me", session)).json()));
    assert.equal(meA.user.id, meB.user.id);
    assert.equal(meA.workspace.id, meB.workspace.id);
    assert.equal(await Workspace.countDocuments({ ownerId: meA.user.id }), 1);
    const user = await User.findById(meA.user.id);
    assert.deepEqual(user.identities.map((i) => i.provider).sort(), ["github", "google"]);
  });

  it("MongoDB keeps only the token's hash, never the token", async () => {
    await invite("hash@example.com");
    const { token } = await signIn("github", person("hash@example.com"));
    assert.equal(await Session.countDocuments({ tokenHash: token }), 0);
    assert.equal(await Session.countDocuments({ tokenHash: createHash("sha256").update(token).digest("hex") }), 1);
  });

  it("signing out ends the session: the cookie is emptied and the old token no longer opens anything", async () => {
    await invite("leave@example.com");
    const { session } = await signIn("github", person("leave@example.com"));
    const out = await get("/auth/logout", session, { method: "POST", headers: { Origin: root } });
    assert.equal(out.status, 204);
    assert.match(out.headers.getSetCookie().join(), /ak_session=;.*Max-Age=0/);
    assert.equal((await get("/api/projects", session)).status, 401);
  });

  it("an expired session opens nothing", async () => {
    await invite("old@example.com");
    const { session, token } = await signIn("github", person("old@example.com"));
    await Session.updateOne({ tokenHash: createHash("sha256").update(token).digest("hex") }, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await get("/api/projects", session)).status, 401);
  });

  // Found on the Mac: the app opened at 127.0.0.1 while PUBLIC_URL said localhost. The login cookie was set
  // for 127.0.0.1, the provider sent the person back to localhost, and the cookie stayed behind ("failed").
  it("a sign-in started on another address of this server moves to PUBLIC_URL first, once", async () => {
    const asked = (p) =>
      new Promise((resolve, reject) => {
        const req = httpRequest(new URL(p, root), { headers: { Host: "localhost:1" } }, (res) => (res.resume(), resolve(res)));
        req.on("error", reject).end();
      });
    const moved = await asked("/auth/github/start");
    assert.equal(moved.statusCode, 302);
    assert.equal(moved.headers.location, `${root}/auth/github/start?moved=1`);
    assert.equal(moved.headers["set-cookie"], undefined, "no login cookie on the wrong address");
    // A proxy that rewrites the Host header must not loop: the second time, the sign-in goes ahead.
    const ahead = await asked("/auth/github/start?moved=1");
    assert.equal(new URL(ahead.headers.location).pathname, "/login/oauth/authorize");
  });

  it("a change sent from another site, with a signed-in cookie, is refused", async () => {
    await invite("csrf@example.com");
    const { session } = await signIn("github", person("csrf@example.com"));
    const res = await get("/api/memory", session, { method: "DELETE", headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    assert.equal((await get("/api/memory", session, { method: "DELETE", headers: { Origin: root } })).status, 200);
  });
});

// ---- Step 30: each workspace sees and reaches only its own projects ----
describe("Step 30: user B never sees or reaches user A's projects", () => {
  let a;
  let b;
  let projectA;
  before(async () => {
    await Promise.all([invite("owner-a@example.com"), invite("owner-b@example.com")]);
    a = (await signIn("github", person("owner-a@example.com"))).session;
    b = (await signIn("github", person("owner-b@example.com"))).session;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#4cc9f0" } }).png().toBuffer();
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "a-screen.png");
    form.append("name", "A's private app");
    const res = await get("/api/projects", a, { method: "POST", body: form, headers: { Origin: root } });
    assert.equal(res.status, 201);
    projectA = await res.json();
  });

  it("a new project belongs to its creator and their workspace", async () => {
    const meA = await (await get("/api/me", a)).json();
    assert.equal(projectA.ownerId, meA.user.id);
    assert.equal(projectA.workspaceId, meA.workspace.id);
  });

  it("A sees it; B's list doesn't have it", async () => {
    const ids = async (session) => (await (await get("/api/projects", session)).json()).map((p) => p.id);
    assert.ok((await ids(a)).includes(projectA.id));
    assert.ok(!(await ids(b)).includes(projectA.id));
  });

  it("every route to A's project answers B as if it did not exist (404)", async () => {
    const p = `/api/projects/${projectA.id}`;
    const routes = [
      ["GET", p],
      ["GET", `${p}/contract`],
      ["PUT", `${p}/contract`],
      ["GET", `${p}/frontend`],
      ["GET", `${p}/screenshots/1`],
      ["GET", `${p}/files`],
      ["GET", `${p}/files/content?path=README.md`],
      ["GET", `${p}/verify`],
      ["POST", `${p}/preview`],
      ["DELETE", `${p}/preview`],
      ["GET", `${p}/download`],
    ];
    for (const [method, route] of routes) {
      const res = await get(route, b, { method, headers: { Origin: root, "Content-Type": "application/json" }, ...(method === "PUT" && { body: "{}" }) });
      assert.equal(res.status, 404, `${method} ${route}`);
    }
    assert.equal((await get(`${p}/screenshots/1`, a)).status, 200, "A still reaches it");
  });
});
