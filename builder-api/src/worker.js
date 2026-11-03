// Step 24: the orchestrator service (ROLE=orchestrator). No UI and no project API: it finds unfinished
// projects nobody is building in MongoDB, takes their lease and builds them (reading, pages, backend,
// Sync Barrier, wiring, Check). Its only HTTP answers are the health checks for the server it runs on.
import express from "express";
import { loadConfig } from "./config.js";
import { connectDb, isDbConnected } from "./db.js";
import { readiness } from "./health.js";
import { log } from "./log.js";
import { resumeAll, stopBuilding } from "./orchestrator.js";

const config = loadConfig(process.env);
const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => {
  const { status, body } = readiness({ dbConnected: isDbConnected() });
  res.status(status).json(body);
});
app.use((_req, res) => res.status(404).json({ error: "This is the orchestrator service: no project API here (use the api service)" }));

try {
  await connectDb(config.mongodbUri);
} catch (err) {
  log.error(`Cannot connect to MongoDB at ${config.mongodbUri}: ${err.message}`);
  process.exit(1);
}
await resumeAll();

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    try {
      const given = await stopBuilding();
      if (given) log.info(`Stopping: gave ${given} project(s) back; the next start continues them at once`);
    } finally {
      process.exit(0);
    }
  });
}

app.listen(config.port, config.host, (err) => {
  if (err) {
    log.error(`Orchestrator could not start on ${config.host}:${config.port}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  log.info(`Orchestrator listening on http://${config.host}:${config.port} (health checks only)`);
});
