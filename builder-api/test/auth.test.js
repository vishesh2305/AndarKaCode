// Step 29: sign-in. A person signs in with GitHub or Google (OAuth with PKCE and a state check); only an
// invited, verified email gets an account; the session lives in a cookie holding a random token, and
// MongoDB keeps only the token's hash. These are the parts that need no database: the settings, the
// providers (fetch is replaced by a fake), and the cookies. The whole sign-in runs in integration/auth.test.js.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { checkConfig } from "../src/config.js";
import { pkce, providersFrom } from "../src/auth/providers.js";
import { clearSessionCookie, hashToken, newToken, readCookie, SESSION_COOKIE, sessionCookie } from "../src/auth/sessions.js";
import { normalEmail } from "../src/auth/invites.js";

// Made up at every run: no key-like text in the repository.
const ID = randomBytes(6).toString("hex");
const SECRET = randomBytes(12).toString("hex");
const problemsOf = (env) => checkConfig(env).problems;
const signedIn = { AUTH: "on", PUBLIC_URL: "https://app.example.com", GITHUB_CLIENT_ID: ID, GITHUB_CLIENT_SECRET: SECRET };

describe("checkConfig: sign-in settings (Step 29)", () => {
  it("is off by default: this computer only, as before", () => {
    assert.equal(checkConfig({}).config.auth.on, false);
  });

  it("on, with GitHub: the address people use, the provider, 14-day sessions, a Secure cookie on https", () => {
    const { config, problems } = checkConfig(signedIn);
    assert.deepEqual(problems, []);
    assert.equal(config.auth.on, true);
    assert.equal(config.auth.publicUrl, "https://app.example.com");
    assert.equal(config.auth.github.clientId, ID);
    assert.equal(config.auth.google, null);
    assert.equal(config.auth.sessionDays, 14);
    assert.equal(config.auth.secureCookie, true);
  });

  it("no Secure cookie on a plain http address (the Mac, during development)", () => {
    assert.equal(checkConfig({ ...signedIn, PUBLIC_URL: "http://127.0.0.1:4000" }).config.auth.secureCookie, false);
  });

  it("refuses AUTH=on without PUBLIC_URL, or with no provider", () => {
    assert.match(problemsOf({ ...signedIn, PUBLIC_URL: "" })[0], /AUTH=on needs PUBLIC_URL/);
    assert.match(problemsOf({ AUTH: "on", PUBLIC_URL: "https://app.example.com" })[0], /AUTH=on needs GitHub or Google sign-in/);
  });

  it("refuses a provider's id without its secret, and an unknown AUTH", () => {
    assert.match(problemsOf({ ...signedIn, GITHUB_CLIENT_SECRET: "" }).join(), /GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET go together/);
    assert.match(problemsOf({ ...signedIn, GOOGLE_CLIENT_ID: ID }).join(), /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together/);
    assert.match(problemsOf({ AUTH: "maybe" })[0], /AUTH in builder-api\/\.env must be on or off/);
  });

  it("refuses a PUBLIC_URL that is not http(s), and sessions outside 1 to 90 days", () => {
    assert.match(problemsOf({ ...signedIn, PUBLIC_URL: "app.example.com" })[0], /PUBLIC_URL in builder-api\/\.env must start with http:\/\/ or https:\/\//);
    assert.match(problemsOf({ ...signedIn, SESSION_DAYS: "0" })[0], /SESSION_DAYS in builder-api\/\.env must be a whole number from 1 to 90/);
  });

  it("never prints a client secret", () => {
    const { problems } = checkConfig({ ...signedIn, PUBLIC_URL: "x", GITHUB_CLIENT_ID: "" });
    assert.ok(!problems.join().includes(SECRET));
  });
});

describe("pkce: the proof that the browser that started the sign-in is the one finishing it", () => {
  it("a random verifier and its S256 challenge", async () => {
    const { verifier, challenge } = pkce();
    assert.match(verifier, /^[A-Za-z0-9_-]{43,}$/);
    const { createHash } = await import("node:crypto");
    assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
    assert.notEqual(pkce().verifier, verifier);
  });
});

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const auth = (env) => checkConfig({ ...signedIn, ...env }).config.auth;
const REDIRECT = "https://app.example.com/auth/github/callback";

describe("GitHub sign-in", () => {
  const github = providersFrom(auth({})).github;

  it("sends the person to GitHub with our id, the way back, the state, the PKCE challenge and the email scope", () => {
    const url = new URL(github.authorizeUrl({ state: "st4te", challenge: "ch4llenge", redirectUri: REDIRECT }));
    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), ID);
    assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
    assert.equal(url.searchParams.get("state"), "st4te");
    assert.equal(url.searchParams.get("code_challenge"), "ch4llenge");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.match(url.searchParams.get("scope"), /user:email/);
  });

  it("trades the code for a token, then reads the person and their primary verified email", async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/login/oauth/access_token")) return reply(200, { access_token: "gh-token", token_type: "bearer" });
      if (String(url).endsWith("/user")) return reply(200, { id: 4242, login: "asha", name: "Asha K", avatar_url: "https://avatars.example/1" });
      if (String(url).endsWith("/user/emails"))
        return reply(200, [
          { email: "old@example.com", primary: false, verified: true },
          { email: "Asha@Example.com", primary: true, verified: true },
        ]);
      return reply(404, {});
    });
    const profile = await github.profile({ code: "c0de", verifier: "v3rifier", redirectUri: REDIRECT });
    assert.deepEqual(profile, { provider: "github", subject: "4242", email: "asha@example.com", emailVerified: true, name: "Asha K", avatarUrl: "https://avatars.example/1" });
    const token = JSON.parse(calls[0].init.body);
    assert.deepEqual([token.client_id, token.client_secret, token.code, token.code_verifier, token.redirect_uri], [ID, SECRET, "c0de", "v3rifier", REDIRECT]);
    assert.equal(calls[1].init.headers.Authorization, "Bearer gh-token");
  });

  it("a primary email that is not verified is not trusted", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
      if (String(url).endsWith("/access_token")) return reply(200, { access_token: "gh-token" });
      if (String(url).endsWith("/user")) return reply(200, { id: 1, login: "x" });
      return reply(200, [{ email: "x@example.com", primary: true, verified: false }]);
    });
    const profile = await github.profile({ code: "c", verifier: "v", redirectUri: REDIRECT });
    assert.equal(profile.emailVerified, false);
  });

  it("a code GitHub refuses fails with GitHub's reason", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }));
    await assert.rejects(github.profile({ code: "c", verifier: "v", redirectUri: REDIRECT }), /GitHub.*incorrect or expired/);
  });
});

describe("Google sign-in", () => {
  const google = providersFrom(auth({ GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRET })).google;
  const discovery = {
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  };

  it("finds Google's addresses from its discovery document, and asks for openid email profile", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => (String(url) === "https://accounts.google.com/.well-known/openid-configuration" ? reply(200, discovery) : reply(404, {})));
    const url = new URL(await google.authorizeUrl({ state: "s", challenge: "c", redirectUri: REDIRECT }));
    assert.equal(url.origin + url.pathname, discovery.authorization_endpoint);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });

  it("trades the code, then reads the person from the userinfo endpoint", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
      const u = String(url);
      if (u.endsWith("openid-configuration")) return reply(200, discovery);
      if (u === discovery.token_endpoint) return reply(200, { access_token: "g-token", id_token: "unused" });
      if (u === discovery.userinfo_endpoint) return reply(200, { sub: "1090", email: "Ravi@Example.com", email_verified: true, name: "Ravi", picture: "https://pic.example/r" });
      return reply(404, {});
    });
    const profile = await google.profile({ code: "c", verifier: "v", redirectUri: REDIRECT });
    assert.deepEqual(profile, { provider: "google", subject: "1090", email: "ravi@example.com", emailVerified: true, name: "Ravi", avatarUrl: "https://pic.example/r" });
  });
});

describe("the session cookie", () => {
  it("a new token is long and random; MongoDB keeps only its sha256", () => {
    const token = newToken();
    assert.match(token, /^[A-Za-z0-9_-]{43,}$/);
    assert.notEqual(newToken(), token);
    assert.match(hashToken(token), /^[a-f0-9]{64}$/);
    assert.notEqual(hashToken(token), token);
  });

  it("is HttpOnly, SameSite=Lax, for the whole site, for the session's days, and Secure on https", () => {
    const cookie = sessionCookie("tok", { secure: true, days: 14 });
    assert.ok(cookie.startsWith(`${SESSION_COOKIE}=tok;`));
    for (const part of ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${14 * 86400}`, "Secure"]) assert.ok(cookie.includes(part), `${part} in ${cookie}`);
    assert.ok(!sessionCookie("tok", { secure: false, days: 1 }).includes("Secure"));
  });

  it("signing out empties it at once", () => {
    assert.match(clearSessionCookie({ secure: false }), new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
  });

  it("is read from the Cookie header among others, and missing is null", () => {
    assert.equal(readCookie(`theme=dark; ${SESSION_COOKIE}=abc; x=1`, SESSION_COOKIE), "abc");
    assert.equal(readCookie("theme=dark", SESSION_COOKIE), null);
    assert.equal(readCookie(undefined, SESSION_COOKIE), null);
  });
});

describe("normalEmail: one person, one spelling", () => {
  it("trims and lowercases, so an invite matches however the provider writes it", () => {
    assert.equal(normalEmail("  Asha@Example.COM "), "asha@example.com");
  });
});
