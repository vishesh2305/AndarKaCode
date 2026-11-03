// Step 29: the session cookie. It holds a random token; MongoDB keeps only the token's sha256.
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "ak_session";
export const LOGIN_COOKIE = "ak_login"; // the browser that started a sign-in (10 minutes)

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

// Lax, not Strict: the provider sends the person back with a top-level GET from its own site, and the
// login cookie must come along. A change (POST, PUT, DELETE) from another site is refused by the Origin check.
function cookie(name, value, { secure, maxAge }) {
  return [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export const sessionCookie = (token, { secure, days }) => cookie(SESSION_COOKIE, token, { secure, maxAge: days * 86400 });
export const clearSessionCookie = ({ secure }) => cookie(SESSION_COOKIE, "", { secure, maxAge: 0 });
export const loginCookie = (value, { secure }) => cookie(LOGIN_COOKIE, value, { secure, maxAge: 600 });
export const clearLoginCookie = ({ secure }) => cookie(LOGIN_COOKIE, "", { secure, maxAge: 0 });

/** One cookie's value from a Cookie header, or null. */
export function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim() || null;
  }
  return null;
}
