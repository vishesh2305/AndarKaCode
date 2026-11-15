// Step 34a: the preview service (ROLE=preview), on server 2 in production. It runs the live previews the
// api service asks for through MongoDB, each in a box (a sandbox with SANDBOX=docker), and serves them on
// its own address (PREVIEW_PORT; the browser's PREVIEW_ORIGIN, another site than the UI): only
// /preview/<project>/<token>/... and its health checks. It shares no disk with server 1.
import os from "node:os";
import { randomUUID } from "node:crypto";
import express from "express";
import { loadConfig } from "./config.js";
import { connectDb, isDbConnected } from "./db.js";
import { readiness } from "./health.js";
import { log } from "./log.js";
import { startPreviewWorker } from "./preview-worker.js";
import { previewRoutes } from "./verify/preview-site.js";
import { buildSandboxImage } from "./verify/sandbox.js";

const config = loadConfig(process.env);
const WORKER = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => {
  const { status, body } = readiness({ dbConnected: isDbConnected() });
  res.status(status).json(body);
});
app.use(previewRoutes());
app.use((_req, res) => res.status(404).json({ error: "This is the preview service: only live previews here" }));

try {
  await connectDb(config.mongodbUri);
} catch (err) {
  log.error(`Cannot connect to MongoDB at ${config.mongodbUri}: ${err.message}`);
  process.exit(1);
}
if (config.sandbox.mode === "docker") {
  log.info("Making sure the sandbox image is built (the first time takes a minute or two)");
  try {
    await buildSandboxImage();
  } catch (err) {
    log.error(`The sandbox image could not be built: ${err.message}`);
    process.exit(1);
  }
}
startPreviewWorker({ worker: WORKER, mongodbUri: config.mongodbUri, log });

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0)); // its sandboxes go with it

app.listen(config.previewPort, config.host, (err) => {
  if (err) {
    log.error(`The preview service could not start on ${config.host}:${config.previewPort}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  log.info(`preview service ${WORKER} on ${config.host}:${config.previewPort}, sandbox: ${config.sandbox.mode}`);
});
