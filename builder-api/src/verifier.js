// Step 33c: the verifier service (ROLE=verifier), the one service that runs generated apps. It claims
// "verify" and "press" jobs from the box queue (src/box-queue.js) with a lease, VERIFY_PARALLEL at a time,
// runs each in a box (a sandbox with SANDBOX=docker: Step 33a) and hands the answer back. With SANDBOX=docker
// it makes sure the sandbox image is built before it takes any work. Its only HTTP answers are the health checks.
import os from "node:os";
import { randomUUID } from "node:crypto";
import express from "express";
import { claimBoxJob, failBoxJob, finishBoxJob, renewBoxJob } from "./box-queue.js";
import { loadConfig } from "./config.js";
import { connectDb, isDbConnected } from "./db.js";
import { readiness } from "./health.js";
import { log } from "./log.js";
import { runBoxJob } from "./verify/lane.js";
import { buildSandboxImage } from "./verify/sandbox.js";

const config = loadConfig(process.env);
const WORKER = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const PARALLEL = Number(process.env.VERIFY_PARALLEL ?? 2);
const PICKUP_MS = Number(process.env.PICKUP_MS ?? 1000);
const LEASE_MS = Number(process.env.LEASE_MS ?? 60_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;

// One lane: claim a job, run it while renewing its lease, hand the answer back; wait a little when none waits.
async function work() {
  while (!stopping) {
    let job = null;
    try {
      job = await claimBoxJob({ worker: WORKER, ms: LEASE_MS });
    } catch (err) {
      log.error(`claiming a box job failed: ${err.message}`);
    }
    if (!job) {
      await sleep(PICKUP_MS);
      continue;
    }
    const heartbeat = setInterval(() => renewBoxJob(job.id, { worker: WORKER, ms: LEASE_MS }).catch(() => {}), LEASE_MS / 3);
    heartbeat.unref();
    try {
      const result = await runBoxJob(job);
      if (!(await finishBoxJob(job.id, { worker: WORKER, result }))) log.error(`box job ${job.id}: done, but another verifier took it over first`);
    } catch (err) {
      log.error(`box job ${job.id} (${job.kind}): ${err.message}`);
      await failBoxJob(job.id, { worker: WORKER, error: err.message }).catch(() => {});
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
app.use((_req, res) => res.status(404).json({ error: "This is the verifier service: no project API here (use the api service)" }));

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
} else {
  log.info("SANDBOX=process: generated apps run as processes on this computer (development only)");
}
for (let i = 0; i < PARALLEL; i++) work();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true; // a job running now goes back to the queue when its lease runs out
    process.exit(0);
  });
}

app.listen(config.port, config.host, (err) => {
  if (err) {
    log.error(`verifier could not start on ${config.host}:${config.port}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  log.info(`verifier ${WORKER} on ${config.host}:${config.port}, ${PARALLEL} at a time, sandbox: ${config.sandbox.mode}`);
});
