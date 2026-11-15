// The live preview's own address (Step 16; Step 34a: served by the preview service, or this process with
// ROLE=all). /preview/<project>/<token>/... goes to that project's running app, untouched, only with the
// preview's secret token; anything else is a 404. Only the headers the app needs pass: never a cookie.
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import express from "express";
import { previewOf, touchPreview } from "./preview.js";

const PASS_HEADERS = ["content-type", "authorization", "accept"];
const NOT_HERE = "No live preview here. Start it from the Pages tab.";

const sameToken = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** An express router for /preview/<project>/<token>/... */
export function previewRoutes() {
  const site = express.Router();
  site.use("/preview/:id/:token", (req, res) => {
    const preview = previewOf(req.params.id);
    if (!preview || !sameToken(preview.token, req.params.token)) return res.status(404).type("text/plain").send(NOT_HERE);
    touchPreview(req.params.id);
    const headers = Object.fromEntries(PASS_HEADERS.filter((h) => req.headers[h]).map((h) => [h, req.headers[h]]));
    const upstream = http.request(new URL(req.url, preview.app.url), { method: req.method, headers }, (answer) => {
      const { connection, "keep-alive": keepAlive, "transfer-encoding": encoding, ...rest } = answer.headers;
      res.writeHead(answer.statusCode, rest);
      answer.pipe(res);
    });
    upstream.on("error", () => res.headersSent || res.status(502).type("text/plain").send("The live preview stopped answering."));
    req.pipe(upstream);
  });
  site.use("/preview", (_req, res) => res.status(404).type("text/plain").send(NOT_HERE));
  return site;
}
