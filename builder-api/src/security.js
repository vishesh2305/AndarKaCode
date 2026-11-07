// Step 32a: the Builder API's outer layer. Security headers on every answer (helmet) with a Content Security
// Policy for the UI; generated pages in a sandbox of their own; changes accepted only from our own site; and
// rate limits counted in MongoDB, so every API instance shares them. There is no CORS: other sites' pages
// get no Access-Control-Allow-Origin, so they can't read our answers.
import helmet from "helmet";
import mongoose from "mongoose";
import { log } from "./log.js";

/** helmet, with the UI's policy. previewOrigin() is the live preview's address (another port), or null. */
export function securityHeaders({ previewOrigin }) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // React's style props
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", () => previewOrigin() ?? "'self'"], // the Pages tab shows the live preview
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * A generated page, served as its own sandboxed origin: its scripts and Tailwind run, but even opened directly
 * in a tab it is not our site, so it can't use our cookies or call our API (connect-src 'none').
 */
export const generatedPageHeaders = () => ({
  "Content-Security-Policy": [
    "sandbox allow-scripts",
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdn.tailwindcss.com",
    "style-src 'unsafe-inline' https:",
    "img-src data: blob: https:",
    "font-src data: https:",
    "connect-src 'none'",
    "frame-ancestors 'self'",
  ].join("; "),
});

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A change (POST, PUT, DELETE) whose Origin is another site is refused, with sign-in on or off: a page on
 * any website could otherwise send one to this computer's Builder API. Our own site is the address the
 * request came to, or PUBLIC_URL.
 */
export function sameSiteChanges({ publicUrl }) {
  const ours = publicUrl ? new URL(publicUrl).origin : null;
  return (req, res, next) => {
    const from = req.headers.origin;
    if (SAFE.has(req.method) || from === undefined || from === ours) return next();
    let host = null;
    try {
      host = new URL(from).host;
    } catch {
      // "null" (a sandboxed page) or nonsense: not our site
    }
    if (host && host === req.headers.host) return next();
    res.status(403).json({ error: "A change sent from another site is refused" });
  };
}

let ttlReady = null;
const hits = () => mongoose.connection.db.collection("rate_hits");

/**
 * At most `limit` requests per `windowMs` for each key(req) (an address, a person, a workspace), counted in
 * MongoDB. Past it: 429 with Retry-After and a plain sentence. If MongoDB can't count, the request goes on.
 */
export function rateLimit({ name, limit, windowMs, key, message }) {
  return async (req, res, next) => {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    try {
      ttlReady ??= hits().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await ttlReady;
      const row = await hits().findOneAndUpdate(
        { _id: `${name}|${key(req)}|${window}` },
        { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) } },
        { upsert: true, returnDocument: "after" }
      );
      if (row.n <= limit) return next();
    } catch (err) {
      ttlReady = null;
      log.error(`rate limit ${name}: ${err.message}`);
      return next();
    }
    const seconds = Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000));
    res.setHeader("Retry-After", String(seconds));
    res.status(429).json({ error: `${message}: try again in ${seconds} s` });
  };
}
