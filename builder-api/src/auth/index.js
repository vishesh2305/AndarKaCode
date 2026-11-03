// Step 29: sign-in for the Builder API. With AUTH=on every /api route needs a session (GET /api/me and
// GET /api/health excepted); /auth/<provider>/start and /callback do the sign-in, POST /auth/logout ends it.
// With AUTH=off nothing changes: this computer only, no accounts.
import express from "express";
import { log } from "../log.js";
import { Login, Session } from "../models/session.js";
import { User } from "../models/user.js";
import { Workspace } from "../models/workspace.js";
import { accountFor } from "./accounts.js";
import { pkce, providersFrom } from "./providers.js";
import { clearLoginCookie, clearSessionCookie, hashToken, LOGIN_COOKIE, loginCookie, newToken, readCookie, SESSION_COOKIE, sessionCookie } from "./sessions.js";

const LOGIN_MINUTES = 10;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function createAuth(auth) {
  const providers = auth.on ? providersFrom(auth) : {};
  const names = Object.keys(providers);
  const secure = auth.secureCookie;
  const origin = auth.publicUrl && new URL(auth.publicUrl).origin;
  const redirectUri = (name) => `${auth.publicUrl}/auth/${name}/callback`;
  const back = (res, reason) => res.redirect(302, `${auth.publicUrl}/${reason ? `?signin=${reason}` : ""}`);

  /** The signed-in browser's { session, user }, or null. */
  async function current(req) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return null;
    const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
    const user = session && (await User.findById(session.userId));
    return user ? { session, user } : null;
  }

  // A change sent by a page on another site carries our cookie too (SameSite=Lax lets top-level visits
  // through): the browser's Origin header says where it came from.
  const fromElsewhere = (req) => !SAFE.has(req.method) && req.headers.origin !== undefined && req.headers.origin !== origin;

  const router = express.Router();

  router.get("/api/me", async (req, res) => {
    if (!auth.on) return res.json({ auth: false, user: null });
    const signed = await current(req);
    if (!signed) return res.json({ auth: true, user: null, providers: names });
    const { user, session } = signed;
    const workspace = await Workspace.findById(session.workspaceId);
    const role = workspace?.members.find((m) => m.userId.equals(user._id))?.role ?? null;
    res.json({
      auth: true,
      user: { id: user.id, email: user.email, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null },
      workspace: workspace && { id: workspace.id, name: workspace.name, role },
      providers: names,
    });
  });

  router.get("/auth/:provider/start", async (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider) return res.status(404).json({ error: "No such sign-in" });
    // The login cookie belongs to the address the browser is on, and the provider sends the person back to
    // PUBLIC_URL: start there (127.0.0.1 and localhost are two sites to a browser). Once, so a proxy that
    // rewrites the Host header can't make it loop.
    if (req.headers.host !== new URL(auth.publicUrl).host && req.query.moved === undefined) {
      return res.redirect(302, `${auth.publicUrl}/auth/${provider.name}/start?moved=1`);
    }
    const browser = newToken();
    const state = newToken();
    const { verifier, challenge } = pkce();
    await Login.create({ state, browserHash: hashToken(browser), provider: provider.name, verifier, expiresAt: new Date(Date.now() + LOGIN_MINUTES * 60_000) });
    res.setHeader("Set-Cookie", loginCookie(browser, { secure }));
    res.redirect(302, await provider.authorizeUrl({ state, challenge, redirectUri: redirectUri(provider.name) }));
  });

  router.get("/auth/:provider/callback", async (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider) return res.status(404).json({ error: "No such sign-in" });
    const browser = readCookie(req.headers.cookie, LOGIN_COOKIE);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    // Used once, whatever happens next.
    const login = state && (await Login.findOneAndDelete({ state, provider: provider.name, expiresAt: { $gt: new Date() } }));
    res.setHeader("Set-Cookie", clearLoginCookie({ secure }));
    if (!login || !browser || hashToken(browser) !== login.browserHash || typeof req.query.code !== "string") {
      log.info(`sign-in with ${provider.name} refused: ${req.query.error ?? "unknown or used state, or another browser"}`);
      return back(res, "failed");
    }
    let account;
    try {
      const profile = await provider.profile({ code: req.query.code, verifier: login.verifier, redirectUri: redirectUri(provider.name) });
      account = await accountFor(profile);
      if (account.refused) log.info(`sign-in with ${provider.name} refused: ${account.refused} (${profile.email || "no email"})`);
    } catch (err) {
      log.error(`sign-in with ${provider.name} failed: ${err.message}`);
      return back(res, "failed");
    }
    if (account.refused) return back(res, account.refused);
    const token = newToken();
    await Session.create({
      tokenHash: hashToken(token),
      userId: account.user._id,
      workspaceId: account.workspace._id,
      expiresAt: new Date(Date.now() + auth.sessionDays * 86_400_000),
    });
    res.setHeader("Set-Cookie", [clearLoginCookie({ secure }), sessionCookie(token, { secure, days: auth.sessionDays })]);
    back(res, null);
  });

  router.post("/auth/logout", async (req, res) => {
    if (fromElsewhere(req)) return res.status(403).json({ error: "Sign-out from another site refused" });
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await Session.deleteOne({ tokenHash: hashToken(token) });
    res.setHeader("Set-Cookie", clearSessionCookie({ secure }));
    res.status(204).end();
  });

  // In front of every /api route mounted after it.
  async function requireSignIn(req, res, next) {
    if (!auth.on) return next();
    if (fromElsewhere(req)) return res.status(403).json({ error: "A change sent from another site is refused" });
    const signed = await current(req);
    if (!signed) return res.status(401).json({ error: "Sign in first" });
    req.user = { id: signed.user._id, workspaceId: signed.session.workspaceId };
    next();
  }

  return { router, requireSignIn };
}
