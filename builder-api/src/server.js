import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { connectDb, isDbConnected } from "./db.js";
import { Contract } from "./models/contract.js";
import { Job } from "./models/job.js";
import { Project } from "./models/project.js";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { checkContract } from "./contract-extractor.js";
import { currentContract, resumeAll, startPipeline } from "./orchestrator.js";
import { REPO_ROOT, saveScreenshot, sha256 } from "./storage.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1"; // no login yet, so this Mac only (GitHub login: Step 15)
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/builder_db";
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;
const MODES = ["local", "cloud", "auto"];
const DEFAULT_MODE = MODES.includes(process.env.DEFAULT_MODE) ? process.env.DEFAULT_MODE : "local";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
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
app.post("/api/projects", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Send a PNG, JPEG or WebP file in the "image" field' });

  const mode = req.body.mode ?? DEFAULT_MODE;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'mode must be "local", "cloud" or "auto"' });

  const fallbackName = req.file.originalname.replace(/\.[^.]+$/, "") || "Untitled";
  const project = new Project({
    name: (req.body.name ?? "").trim() || fallbackName,
    imageHash: sha256(req.file.buffer),
    mode,
  });
  try {
    Object.assign(project, await saveScreenshot(project._id, req.file.buffer));
  } catch {
    return res.status(400).json({ error: "The file is not a readable image" });
  }
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

  const { resource, fields, actions, rules, openQuestions = [] } = req.body ?? {};
  const body = { resource, fields, actions: [...new Set(actions ?? [])], rules, openQuestions };
  body.ui = { sampleConst: `SAMPLE_${String(resource?.plural ?? "").toUpperCase()}` }; // ours, not editable
  const problems = checkContract(body);
  if (problems.length) return res.status(400).json({ error: "Invalid Contract", problems });

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

// The generated page for the current Contract version, once Laptop B has built it.
app.get("/api/projects/:id/frontend", async (req, res) => {
  const project = await findProject(req.params.id);
  if (!project) return res.status(404).json({ error: "No such project" });
  const contract = await currentContract(project);
  const job = contract && (await Job.findOne({ projectId: project._id, kind: "frontend", contractHash: contract.hash, status: "done" }));
  if (!job) return res.status(404).json({ error: `No frontend for the current Contract yet (state: ${project.state})` });
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
