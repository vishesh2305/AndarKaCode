// For integration tests that need people signed in (Step 29 on): the real Builder API with AUTH=on, a fake
// GitHub that hands out a code for whoever the test says, and a browser that follows the sign-in by hand.
// Everything the API prints is kept, so a test can check what reached the log.
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invite } from "../../src/auth/invites.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A small JSON server: handler(req, body text) -> { status?, json }. */
export function jsonServer(handler) {
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
export const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Starts the API (ROLE=api unless env says otherwise) with sign-in on; { root, log, get, signIn, stop }. */
export async function startSignedInApi(env = {}) {
  const clientId = randomBytes(6).toString("hex");
  const clientSecret = randomBytes(12).toString("hex");
  const codes = new Map();
  const tokens = new Map();
  const github = await jsonServer(async (req, body) => {
    if (req.url === "/login/oauth/access_token") {
      const p = JSON.parse(body);
      const grant = codes.get(p.code);
      codes.delete(p.code);
      const challenge = createHash("sha256").update(p.code_verifier ?? "").digest("base64url");
      if (!grant || p.client_secret !== clientSecret || challenge !== grant.challenge) return { json: { error: "bad_verification_code" } };
      const token = randomUUID();
      tokens.set(token, grant.person);
      return { json: { access_token: token } };
    }
    const person = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!person) return { status: 401, json: {} };
    if (req.url === "/user") return { json: { id: person.id, login: person.email, name: person.email.split("@")[0] } };
    return { json: [{ email: person.email, primary: true, verified: true }] };
  });

  const port = await freePort();
  const root = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ["src/server.js"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      ROLE: "api",
      PORT: String(port),
      HOST: "127.0.0.1",
      PREVIEW_PORT: "0",
      GATEWAY_URL: "",
      GATEWAY_API_KEY: "",
      GEMINI_API_KEY: "",
      AUTH: "on",
      PUBLIC_URL: root,
      GITHUB_CLIENT_ID: clientId,
      GITHUB_CLIENT_SECRET: clientSecret,
      GITHUB_URL: urlOf(github),
      GITHUB_API_URL: urlOf(github),
      ...env,
    },
  });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 300 && !/listening/.test(log); i++) {
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!/listening/.test(log)) throw new Error(`The Builder API did not start:\n${log}`);

  /** A request as the browser makes it: changes carry our Origin, like a page of ours. */
  const get = (p, cookie, init = {}) =>
    fetch(new URL(p, root), { redirect: "manual", ...init, headers: { Origin: root, ...(cookie && { Cookie: cookie }), ...init.headers } });

  /** Invites email, signs in with GitHub; the session cookie. */
  async function signIn(email) {
    await invite(email);
    const start = await get("/auth/github/start");
    const to = new URL(start.headers.get("location"));
    const login = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const code = randomUUID();
    codes.set(code, { person: { id: Math.floor(Math.random() * 1e9), email }, challenge: to.searchParams.get("code_challenge") });
    const res = await get(`/auth/github/callback?code=${code}&state=${to.searchParams.get("state")}`, login);
    const session = res.headers.getSetCookie().find((c) => c.startsWith("ak_session="));
    if (!session) throw new Error(`${email} could not sign in: ${res.headers.get("location")}`);
    return session.split(";")[0];
  }

  return {
    root,
    log: () => log,
    get,
    signIn,
    stop: () => (proc.kill(), github.close()),
  };
}
