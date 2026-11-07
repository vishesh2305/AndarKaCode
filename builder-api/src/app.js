import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { createAuth } from "./auth/index.js";
import { createKeysRouter } from "./keys/routes.js";
import { generatedPageHeaders, rateLimit, sameSiteChanges, securityHeaders } from "./security.js";
import { slotsOf } from "./keys/slots.js";
import { Workspace } from "./models/workspace.js";
import { loadConfig } from "./config.js";
import { connectDb, isDbConnected } from "./db.js";
import { readiness, webBuildIsStale } from "./health.js";
import { log } from "./log.js";
import { Contract } from "./models/contract.js";
import { Job } from "./models/job.js";
import { Project } from "./models/project.js";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { currentContract, resumeAll, startPipeline, stopBuilding } from "./orchestrator.js";
import { dHash } from "./memory/dhash.js";
import { forgetAll, memoryCounts } from "./memory/index.js";
import { checkSpec } from "./spec/check.js";
import { appArchive, listAppFiles, safeAppPath, slug } from "./package-app.js";
import { REPO_ROOT, saveScreenshot, sha256, shrinkScreenshot } from "./storage.js";
import { databaseUri } from "./verify/index.js";
import { previewOf, startPreview, stopPreview, touchPreview } from "./verify/preview.js";
import { previewSeed } from "./verify/sample-rows.js";

// Step 20: every setting is checked before anything starts; a wrong one stops here with every problem listed.
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { port: PORT, host: HOST, mongodbUri: MONGODB_URI, defaultMode: DEFAULT_MODE, previewPort: PREVIEW_PORT, modes: MODES } = config;
const GATEWAY_URL = config.gateway?.url; // HOST defaults to 127.0.0.1: with AUTH=off (no sign-in), this computer only
const GATEWAY_API_KEY = config.gateway?.apiKey;
const MAX_SCREENSHOTS = 10; // one page each

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_SCREENSHOTS },
  fileFilter: (_req, file, done) => done(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype)),
});

async function gatewayHealth() {
  if (!GATEWAY_URL || !GATEWAY_API_KEY) return { reachable: false, error: "GATEWAY_URL/GATEWAY_API_KEY not set" };
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/health`, {
      headers: { "X-API-Key": GATEWAY_API_KEY },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? { reachable: true, ...(await res.json()) } : { reachable: false, error: `HTTP ${res.status}` };
  } catch (err) {
    // Over Tailscale a stopped Gateway looks like a timeout (the firewall drops the packets).
    const hint = err.name === "TimeoutError" ? "no answer in 3 s: is the Gateway running on Laptop B?" : err.message;
    return { reachable: false, error: hint };
  }
}

const app = express();

// The live preview (Step 16) has its own small server on another local port (another site than the UI),
// so a generated page in the Live view can keep its own login without reaching the UI or its API.
// /preview/<project>/... goes to that project's running app, untouched.
let previewOrigin = null; // set once the preview server listens
const previewSite = express();
const PASS_HEADERS = ["content-type", "authorization", "accept"];
previewSite.use("/preview/:id", (req, res) => {
  const preview = previewOf(req.params.id);
  if (!preview) return res.status(404).type("text/plain").send("No live preview is running for this project. Start it from the Pages tab.");
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

// Step 32a: security headers and the UI's Content Security Policy on every answer; changes only from our own
// site (with sign-in off too); no CORS.
app.use(securityHeaders({ previewOrigin: () => previewOrigin }));
app.use(sameSiteChanges(config.auth));
app.use(express.json({ limit: "1mb" }));

// Step 20: the servers' health checks. /healthz: the process is alive. /readyz: it can take work.
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => {
  const { status, body } = readiness({ dbConnected: isDbConnected() });
  res.status(status).json(body);
});

app.get("/api/health", async (_req, res) => {
  res.json({ db: isDbConnected(), gateway: await gatewayHealth() });
});

// Step 29: sign-in. With AUTH=on every /api route below needs a session; with AUTH=off nothing changes.
const auth = createAuth(config.auth);
const MINUTE = 60_000;
app.get("/auth/:provider/start", rateLimit({ name: "sign-in", limit: 20, windowMs: MINUTE, key: (req) => req.ip, message: "Too many sign-in attempts from this address" }));
app.use(auth.router);
app.use("/api", auth.requireSignIn);
app.use("/api", rateLimit({ name: "api", limit: 600, windowMs: MINUTE, key: (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`), message: "Too many requests" }));
// Step 31b: the workspace's own AI keys (BYOK) and its two slots.
app.use("/api/keys", createKeysRouter(config));

// Lifecycle step 1 (ARCHITECTURE.md §3): hash, shrink, store, create the project.
// One or more screenshots in "image" fields, in page order; each becomes one page.
app.post("/api/projects", upload.array("image", MAX_SCREENSHOTS), async (req, res) => {
  const files = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: 'Send PNG, JPEG or WebP files in "image" fields' });

  const mode = req.body.mode ?? DEFAULT_MODE;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'mode must be "local", "cloud" or "auto"' });

  // Check every file before writing any, so a bad file leaves nothing behind.
  const shrunk = [];
  for (const file of files) {
    try {
      shrunk.push(await shrinkScreenshot(file.buffer));
    } catch {
      return res.status(400).json({ error: `"${file.originalname}" is not a readable image` });
    }
  }

  const fallbackName = files[0].originalname.replace(/\.[^.]+$/, "") || "Untitled";
  const useMemory = req.body.fresh !== "true"; // "Start fresh" skips memory for this project
  const project = new Project({
    name: (req.body.name ?? "").trim() || fallbackName,
    imageHash: sha256(files[0].buffer),
    mode,
    useMemory,
    ...(req.user && { ownerId: req.user.id, workspaceId: req.user.workspaceId, keys: await slotsOf(await Workspace.findById(req.user.workspaceId)) }),
  });
  for (const [i, file] of files.entries()) {
    project.screenshots.push({ ...(await saveScreenshot(project._id, i + 1, shrunk[i])), sha256: sha256(file.buffer), dHash: await dHash(file.buffer) });
  }
  Object.assign(project, { imagePath: project.screenshots[0].path, imageWidth: shrunk[0].width, imageHeight: shrunk[0].height });
  await project.save();
  startPipeline(project._id); // runs in the background; poll GET /api/projects/:id
  res.status(201).json(project);
});

app.get("/api/projects", async (req, res) => {
  const projects = await Project.find(mine(req)).sort({ createdAt: -1 }).limit(50);
  res.json(projects);
});

// Step 30: with sign-in on, a person finds only their workspace's projects; another's answers 404, as if it
// did not exist. Sign-in off (req.user unset): this computer's single person sees every project.
const mine = (req) => (req.user ? { workspaceId: req.user.workspaceId } : {});
const owner = (req) => req.user ?? {}; // whose memory (src/memory/index.js memoryScope)
const findProject = (req) => (mongoose.isValidObjectId(req.params.id) ? Project.findOne({ _id: req.params.id, ...mine(req) }) : null);

app.get("/api/projects/:id", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const [contract, jobs] = await Promise.all([
    currentContract(project),
    Job.find({ projectId: project._id }).sort({ createdAt: 1 }),
  ]);
  res.json({ ...project.toJSON(), contract, jobs });
});

app.get("/api/projects/:id/contract", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const contract = await currentContract(project);
  if (!contract) return res.status(404).json({ error: `No Contract yet (state: ${project.state})` });
  res.json(contract);
});

// An edit is a new Contract version with a new hash; the Barrier then refuses anything built for the old one.
app.put("/api/projects/:id/contract", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const current = await currentContract(project);
  if (!current) return res.status(409).json({ error: `No Contract to edit yet (state: ${project.state})` });

  const { entities = [], operations = [], stats = [], auth = null, pages = [], openQuestions = [] } = req.body ?? {};
  const body = {
    entities: entities.map((e) => ({ ...e, sampleConst: `SAMPLE_${String(e?.plural ?? "").toUpperCase()}` })), // ours, not editable
    operations,
    stats,
    auth,
    pages,
    openQuestions,
  };
  const problems = checkSpec(body);
  if (problems.length) return res.status(400).json({ error: "Invalid App Spec", problems });

  const hash = contractHash(body);
  if (hash === current.hash) return res.json({ changed: false, contract: current });

  const contract = await Contract.create({ projectId: project._id, version: current.version + 1, hash, body });
  project.currentContractVersion = contract.version;
  if (!["UPLOADED", "CONTRACT_DRAFT", "BUILDING"].includes(project.state)) {
    project.state = "BUILDING"; // was SYNCED or NEEDS_ATTENTION: rebuild for the new version
    project.error = undefined;
  }
  await project.save();
  startPipeline(project._id);
  res.json({ changed: true, contract });
});

// A generated page (?page=N, default: the first page) for the current spec version, once Laptop B has built it.
app.get("/api/projects/:id/frontend", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const contract = await currentContract(project);
  const page = Number(req.query.page ?? contract?.body.pages?.[0]?.screenshot ?? 1);
  const job = contract && (await Job.findOne({ projectId: project._id, kind: "frontend", contractHash: contract.hash, page, status: "done" }));
  if (!job) return res.status(404).json({ error: `No page ${page} for the current spec yet (state: ${project.state})` });
  res.set(generatedPageHeaders()); // its own sandbox, even when opened directly (Step 32a)
  res.sendFile(path.join(REPO_ROOT, job.artifactPath));
});

// ---- for the UI: screenshots, the generated app's files, and the app as a zip ----
const screenshotsOf = (project) => (project.screenshots?.length ? project.screenshots : [{ path: project.imagePath }]);

async function currentBuild(project) {
  const contract = await currentContract(project);
  if (!contract) return {};
  const [backendJob, frontendJobs] = await Promise.all([
    Job.findOne({ projectId: project._id, kind: "backend", contractHash: contract.hash, status: "done" }),
    Job.find({ projectId: project._id, kind: "frontend", contractHash: contract.hash, status: "done" }).sort({ page: 1 }),
  ]);
  return { contract, backendJob, frontendJobs };
}

app.get("/api/projects/:id/screenshots/:n", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const shot = screenshotsOf(project)[Number(req.params.n) - 1];
  if (!Number.isInteger(Number(req.params.n)) || !shot?.path) return res.status(404).json({ error: "No such screenshot" });
  res.type("image/png").sendFile(path.join(REPO_ROOT, shot.path));
});

app.get("/api/projects/:id/files", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const { backendJob } = await currentBuild(project);
  if (!backendJob) return res.status(404).json({ error: `No generated app for the current spec yet (state: ${project.state})` });
  res.json({ files: await listAppFiles(path.join(REPO_ROOT, backendJob.artifactPath)) });
});

app.get("/api/projects/:id/files/content", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const { backendJob } = await currentBuild(project);
  if (!backendJob) return res.status(404).json({ error: "No generated app yet" });
  const file = safeAppPath(path.join(REPO_ROOT, backendJob.artifactPath), req.query.path);
  if (!file) return res.status(400).json({ error: "That path is not inside the generated app" });
  res.type("text/plain; charset=utf-8").sendFile(file, (err) => err && !res.headersSent && res.status(404).json({ error: "No such file" }));
});

// The Verifier's latest report for the current spec (Step 16).
const latestVerify = (project, contract) =>
  contract && Job.findOne({ projectId: project._id, kind: "verify", contractHash: contract.hash, report: { $exists: true } }).sort({ createdAt: -1 });

app.get("/api/projects/:id/verify", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const contract = await currentContract(project);
  const job = await latestVerify(project, contract);
  if (!job) return res.status(404).json({ error: `Not checked yet (state: ${project.state})` });
  res.json({ state: project.state, checkedAt: job.finishedAt, seconds: job.report.seconds, report: job.report });
});

// Memory (Step 14): how much this workspace remembers, and forgetting it (projects and the library are kept).
app.get("/api/memory", async (req, res) => res.json(await memoryCounts(owner(req))));
app.delete("/api/memory", async (req, res) => res.json({ deleted: await forgetAll(owner(req)) }));

// The live preview: start (or reuse) it, or stop it. Available once the app is wired (after the Wire stage).
app.post("/api/projects/:id/preview", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const { contract, backendJob } = await currentBuild(project);
  const appDir = backendJob && path.join(REPO_ROOT, backendJob.artifactPath);
  if (!appDir || !existsSync(path.join(appDir, "frontend", "app.js"))) {
    return res.status(409).json({ error: `The live preview is available once the app is built and wired (now: ${project.state})` });
  }
  try {
    const preview = await startPreview({
      projectId: project.id,
      hash: contract.hash,
      appDir,
      auth: Boolean(contract.body.auth),
      mongoUri: databaseUri(MONGODB_URI, `preview_${project.id}`),
      // The rows the screenshots show: from each page's sample array, else from the screenshot's table.
      seed: async () => {
        const pages = [];
        for (const page of contract.body.pages) {
          const html = await readFile(path.join(appDir, "frontend", `page-${page.screenshot}.html`), "utf8").catch(() => "");
          pages.push({ screenshot: page.screenshot, html });
        }
        return previewSeed({ spec: contract.body, pages, inventories: (project.screenshots ?? []).map((s) => s.inventory) });
      },
    });
    const first = contract.body.pages[0]?.screenshot ?? 1;
    res.json({ url: `${previewOrigin}/preview/${project.id}/page-${first}.html`, credentials: preview.credentials });
  } catch (err) {
    res.status(500).json({ error: `The live preview could not start: ${err.message}` });
  }
});

app.delete("/api/projects/:id/preview", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  await stopPreview(project.id);
  res.status(204).end();
});

// READY: download. Checks failed: only when asked for anyway (?anyway=1), with the report in the zip.
app.get("/api/projects/:id/download", async (req, res) => {
  const project = await findProject(req);
  if (!project) return res.status(404).json({ error: "No such project" });
  const { contract, backendJob, frontendJobs } = await currentBuild(project);
  const verify = await latestVerify(project, contract);
  const anyway = req.query.anyway === "1" && project.state === "NEEDS_ATTENTION" && verify;
  if (project.state !== "READY" && !anyway) {
    return res.status(409).json({ error: `The app can be downloaded once every check passes (now: ${project.state})` });
  }
  if (!backendJob) return res.status(409).json({ error: "The generated backend is missing; rebuild the project" });
  const zip = await appArchive({ project, contract, backendJob, frontendJobs, screenshots: screenshotsOf(project), report: verify?.report });
  res.type("application/zip").attachment(`${slug(project.name)}-v${contract.version}.zip`).send(zip);
});

// The UI (web/, after `npm run build`): served from the same address as the API.
const WEB_DIST = path.join(REPO_ROOT, "web", "dist");
if (existsSync(path.join(WEB_DIST, "index.html"))) {
  app.use(express.static(WEB_DIST));
  app.use((req, res, next) => (req.method === "GET" && !req.path.startsWith("/api") ? res.sendFile(path.join(WEB_DIST, "index.html")) : next()));
}

// Upload limits, bad JSON, anything unexpected: always answer in JSON.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }
  // Only the unexpected is logged: a request the API refused (bad JSON, too large) may carry a user's key
  // in its body, and the error object keeps that body (Step 31b).
  if (!err.status) console.error(err);
  res.status(err.status ?? 500).json({ error: err.status ? err.message : "Internal error" });
});

try {
  await connectDb(MONGODB_URI);
} catch (err) {
  console.error(`Cannot connect to MongoDB at ${MONGODB_URI}: ${err.message}`);
  console.error("Is MongoDB running? On the Mac: brew services start mongodb-community");
  process.exit(1);
}
if (config.role !== "api") await resumeAll(); // the API service leaves the building to the orchestrator (Step 24)

// Step 22: stopped on purpose (Ctrl+C, a deploy's SIGTERM): give the projects back before exiting, so the
// next start continues them at once. A crash can't do this; then the leases run out by themselves.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) process.exit(1); // a second Ctrl+C: stop now
    stopping = true;
    try {
      const given = await stopBuilding();
      if (given) log.info(`Stopping: gave ${given} project(s) back; the next start continues them at once`);
    } finally {
      process.exit(0);
    }
  });
}
if (await webBuildIsStale(path.join(REPO_ROOT, "web"))) {
  log.info("The UI build is older than its source (git pull does not rebuild it): run `npm run build` in web/, then reload the page.");
}

// Express 5 passes listen errors (e.g. port already in use) to this callback.
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Builder API could not start on ${HOST}:${PORT}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  log.info(`Builder API listening on http://${HOST}:${PORT}`);
});

const previewServer = previewSite.listen(PREVIEW_PORT, HOST, (err) => {
  if (err) {
    console.error(`The live preview could not start on ${HOST}:${PREVIEW_PORT}: ${err.code ?? err.message} (set PREVIEW_PORT to a free port)`);
    return;
  }
  previewOrigin = config.previewOrigin ?? `http://${HOST}:${previewServer.address().port}`;
  console.log(`Live preview on ${previewOrigin}`);
});
