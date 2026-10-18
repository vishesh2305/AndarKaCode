import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { connectDb, isDbConnected } from "./db.js";
import { Contract } from "./models/contract.js";
import { Job } from "./models/job.js";
import { Project } from "./models/project.js";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { currentContract, resumeAll, startPipeline } from "./orchestrator.js";
import { checkSpec } from "./spec/check.js";
import { REPO_ROOT, saveScreenshot, sha256, shrinkScreenshot } from "./storage.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1"; // no login yet, so this Mac only (GitHub login: Step 15)
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/builder_db";
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;
const MODES = ["local", "cloud", "auto"];
const DEFAULT_MODE = MODES.includes(process.env.DEFAULT_MODE) ? process.env.DEFAULT_MODE : "local";
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
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  res.json({ db: isDbConnected(), gateway: await gatewayHealth() });
});

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
  const project = new Project({ name: (req.body.name ?? "").trim() || fallbackName, imageHash: sha256(files[0].buffer), mode });
  for (const [i, file] of files.entries()) {
    project.screenshots.push({ ...(await saveScreenshot(project._id, i + 1, shrunk[i])), sha256: sha256(file.buffer) });
  }
  Object.assign(project, { imagePath: project.screenshots[0].path, imageWidth: shrunk[0].width, imageHeight: shrunk[0].height });
  await project.save();
  startPipeline(project._id); // runs in the background; poll GET /api/projects/:id
  res.status(201).json(project);
});

app.get("/api/projects", async (_req, res) => {
  const projects = await Project.find().sort({ createdAt: -1 }).limit(50);
  res.json(projects);
});

const findProject = (id) => (mongoose.isValidObjectId(id) ? Project.findById(id) : null);

app.get("/api/projects/:id", async (req, res) => {
  const project = await findProject(req.params.id);
  if (!project) return res.status(404).json({ error: "No such project" });
  const [contract, jobs] = await Promise.all([
    currentContract(project),
    Job.find({ projectId: project._id }).sort({ createdAt: 1 }),
  ]);
  res.json({ ...project.toJSON(), contract, jobs });
});

app.get("/api/projects/:id/contract", async (req, res) => {
  const project = await findProject(req.params.id);
  if (!project) return res.status(404).json({ error: "No such project" });
  const contract = await currentContract(project);
  if (!contract) return res.status(404).json({ error: `No Contract yet (state: ${project.state})` });
  res.json(contract);
});

// An edit is a new Contract version with a new hash; the Barrier then refuses anything built for the old one.
app.put("/api/projects/:id/contract", async (req, res) => {
  const project = await findProject(req.params.id);
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
  const project = await findProject(req.params.id);
  if (!project) return res.status(404).json({ error: "No such project" });
  const contract = await currentContract(project);
  const page = Number(req.query.page ?? contract?.body.pages?.[0]?.screenshot ?? 1);
  const job = contract && (await Job.findOne({ projectId: project._id, kind: "frontend", contractHash: contract.hash, page, status: "done" }));
  if (!job) return res.status(404).json({ error: `No page ${page} for the current spec yet (state: ${project.state})` });
  res.sendFile(path.join(REPO_ROOT, job.artifactPath));
});

// Upload limits, bad JSON, anything unexpected: always answer in JSON.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.status ? err.message : "Internal error" });
});

try {
  await connectDb(MONGODB_URI);
} catch (err) {
  console.error(`Cannot connect to MongoDB at ${MONGODB_URI}: ${err.message}`);
  console.error("Is MongoDB running? On the Mac: brew services start mongodb-community");
  process.exit(1);
}
await resumeAll();

// Express 5 passes listen errors (e.g. port already in use) to this callback.
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Builder API could not start on ${HOST}:${PORT}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  console.log(`Builder API listening on http://${HOST}:${PORT}`);
});
