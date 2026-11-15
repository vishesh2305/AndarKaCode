// The live preview's own address (Step 16; Step 34a: served by the preview service, or this process with
// ROLE=all). /preview/<project>/<token>/... goes to that project's running app, untouched, only with the
// preview's secret token; anything else is a 404. Only the headers the app needs pass: never a cookie, either
// way (Step 34b).
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import express from "express";
import { previewOf, touchPreview } from "./preview.js";

const PASS_HEADERS = ["content-type", "authorization", "accept"];
const NOT_HERE = "No live preview here. Start it from the Pages tab.";

const sameToken = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Step 34b: on every answer: no Referer leaves (the token stays in this address, not in the Tailwind CDN's
// logs), and neither caches nor search engines keep a preview.
const PRIVATE = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** An express router for /preview/<project>/<token>/... */
export function previewRoutes() {
  const site = express.Router();
  site.use((_req, res, next) => (res.set(PRIVATE), next()));
  site.use("/preview/:id/:token", (req, res) => {
    const preview = previewOf(req.params.id);
    if (!preview || !sameToken(preview.token, req.params.token)) return res.status(404).type("text/plain").send(NOT_HERE);
    touchPreview(req.params.id);
    const headers = Object.fromEntries(PASS_HEADERS.filter((h) => req.headers[h]).map((h) => [h, req.headers[h]]));
    const upstream = http.request(new URL(req.url, preview.app.url), { method: req.method, headers }, (answer) => {
      // The app sets no cookie here either (Step 34b); our privacy headers win over the app's.
      const { connection, "keep-alive": keepAlive, "transfer-encoding": encoding, "set-cookie": cookie, "referrer-policy": rp, "cache-control": cc, ...rest } = answer.headers;
      res.writeHead(answer.statusCode, { ...rest, ...PRIVATE });
      answer.pipe(res);
    });
    upstream.on("error", () => res.headersSent || res.status(502).type("text/plain").send("The live preview stopped answering."));
    req.pipe(upstream);
  });
  site.use("/preview", (_req, res) => res.status(404).type("text/plain").send(NOT_HERE));
  return site;
}
