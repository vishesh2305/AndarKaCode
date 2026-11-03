// Step 29: GitHub and Google sign-in, OAuth 2.0 with PKCE. Each provider sends the person to its own page
// (authorizeUrl), then trades the code it sent back for a token and reads who they are (profile):
// { provider, subject, email (lowercase), emailVerified, name, avatarUrl }.
import { createHash, randomBytes } from "node:crypto";
import { normalEmail } from "./invites.js";

const TIMEOUT_MS = 10_000;

/** A random verifier, and the challenge sent ahead of it (S256). */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function call(name, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => ({}));
  // GitHub answers a refused code with 200 and an error field.
  if (!res.ok || body.error) throw new Error(`${name} refused the sign-in: ${body.error_description ?? body.error ?? body.message ?? `HTTP ${res.status}`}`);
  return body;
}

function github({ clientId, clientSecret, url, apiUrl }) {
  return {
    name: "github",
    authorizeUrl: ({ state, challenge, redirectUri }) =>
      `${url}/login/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: "read:user user:email", state, code_challenge: challenge, code_challenge_method: "S256", allow_signup: "true" })}`,
    async profile({ code, verifier, redirectUri }) {
      const { access_token: token } = await call("GitHub", `${url}/login/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri }),
      });
      const headers = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
      const user = await call("GitHub", `${apiUrl}/user`, { headers });
      const emails = await call("GitHub", `${apiUrl}/user/emails`, { headers });
      const primary = (Array.isArray(emails) ? emails : []).find((e) => e.primary);
      return {
        provider: "github",
        subject: String(user.id),
        email: normalEmail(primary?.email ?? ""),
        emailVerified: primary?.verified === true,
        name: user.name || user.login,
        avatarUrl: user.avatar_url ?? null,
      };
    },
  };
}

function google({ clientId, clientSecret, issuer }) {
  let discovery = null; // Google's addresses, read once from its discovery document (again after a failure)
  const endpoints = () => {
    discovery ??= call("Google", `${issuer}/.well-known/openid-configuration`).catch((err) => {
      discovery = null;
      throw err;
    });
    return discovery;
  };
  return {
    name: "google",
    async authorizeUrl({ state, challenge, redirectUri }) {
      const { authorization_endpoint: at } = await endpoints();
      return `${at}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" })}`;
    },
    // The person comes from the userinfo endpoint, asked with the token we were just given over TLS,
    // so the id_token needs no signature check here.
    async profile({ code, verifier, redirectUri }) {
      const { token_endpoint: tokenUrl, userinfo_endpoint: userinfoUrl } = await endpoints();
      const { access_token: token } = await call("Google", tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
      });
      const info = await call("Google", userinfoUrl, { headers: { Authorization: `Bearer ${token}` } });
      return {
        provider: "google",
        subject: String(info.sub),
        email: normalEmail(info.email ?? ""),
        emailVerified: info.email_verified === true,
        name: info.name || info.email,
        avatarUrl: info.picture ?? null,
      };
    },
  };
}

/** The providers that are set up: { github?, google? }. */
export function providersFrom(auth) {
  return { ...(auth.github && { github: github(auth.github) }), ...(auth.google && { google: google(auth.google) }) };
}
