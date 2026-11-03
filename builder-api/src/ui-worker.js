// Step 26: the ui-worker service (ROLE=ui-worker), the frontend server's page builder in production.
// It claims page jobs from the queue (src/page-queue.js) with a lease, UI_PARALLEL at a time, draws each one
// with one model call (shared/page.mjs: the single call chosen in Step 18), trying the job's model, once
// more, then the other model (shared/attempts.mjs), and hands the page back with its usage. Its only HTTP
// answers are the health checks.
import os from "node:os";
import { randomUUID } from "node:crypto";
import express from "express";
import { attemptPlan } from "../../shared/attempts.mjs";
import { withUsage } from "../../shared/meter.mjs";
import { buildPage } from "../../shared/page.mjs";
import { loadConfig } from "./config.js";
import { connectDb, isDbConnected, pingDb } from "./db.js";
import { readiness } from "./health.js";
import { log } from "./log.js";
import { claimPageJob, failPageJob, finishPageJob, renewPageJob } from "./page-queue.js";
import { measureDelay, placementCheck } from "./placement.js";

const config = loadConfig(process.env);
const WORKER = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const PARALLEL = Number(process.env.UI_PARALLEL ?? 4);
const PICKUP_MS = Number(process.env.PICKUP_MS ?? 1000);
const LEASE_MS = Number(process.env.LEASE_MS ?? 60_000);
const HAS_CLOUD = Boolean(process.env.GEMINI_API_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function draw(job) {
  const usage = [];
  let lastError = null;
  for (const provider of attemptPlan(job.mode, { hasCloud: HAS_CLOUD })) {
    try {
      const { html } = await withUsage(usage, () => buildPage({ imageB64: job.image.toString("base64"), instructions: job.instructions, mode: provider }));
      return { html, provider, usage };
    } catch (err) {
      lastError = err.message;
      log.error(`page ${job.id}: ${lastError}`);
    }
  }
  throw new Error(lastError ?? "no model to try");
}

let stopping = false;

// One lane: claim a page, draw it while renewing its lease, hand it back; wait a little when none waits.
async function lane() {
  while (!stopping) {
    let job = null;
    try {
      job = await claimPageJob({ worker: WORKER, ms: LEASE_MS });
    } catch (err) {
      log.error(`claiming a page failed: ${err.message}`);
    }
    if (!job) {
      await sleep(PICKUP_MS);
      continue;
    }
    const heartbeat = setInterval(() => renewPageJob(job.id, { worker: WORKER, ms: LEASE_MS }).catch(() => {}), LEASE_MS / 3);
    heartbeat.unref();
    try {
      const { html, provider, usage } = await draw(job);
      if (!(await finishPageJob(job.id, { worker: WORKER, html, provider, usage }))) log.error(`page ${job.id}: drawn, but another ui-worker took it over first`);
    } catch (err) {
      await failPageJob(job.id, { worker: WORKER, error: err.message }).catch(() => {});
    } finally {
      clearInterval(heartbeat);
    }
  }
}

const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => {
  const { status, body } = readiness({ dbConnected: isDbConnected() });
  res.status(status).json(body);
});
app.use((_req, res) => res.status(404).json({ error: "This is a ui-worker service: no project API here (use the api service)" }));

try {
  await connectDb(config.mongodbUri);
} catch (err) {
  log.error(`Cannot connect to MongoDB at ${config.mongodbUri}: ${err.message}`);
  process.exit(1);
}
// Step 28: this ui-worker may run on server 2; say plainly when server 1 (MongoDB) is too far away.
const placement = placementCheck({ ms: await measureDelay(pingDb), limit: config.placementMs });
(placement.ok ? log.info : log.error)(placement.message);
for (let i = 0; i < PARALLEL; i++) lane();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true; // a page being drawn now goes back to the queue when its lease runs out
    process.exit(0);
  });
}

app.listen(config.port, config.host, (err) => {
  if (err) {
    log.error(`ui-worker could not start on ${config.host}:${config.port}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  log.info(`ui-worker listening on http://${config.host}:${config.port} (health checks only), ${PARALLEL} pages at a time`);
});
