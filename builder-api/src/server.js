import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { connectDb, isDbConnected } from "./db.js";
import { Project } from "./models/project.js";
import { saveScreenshot, sha256 } from "./storage.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1"; // no login yet, so this Mac only (GitHub login: Step 15)
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/builder_db";
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

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
    return { reachable: false, error: err.message };
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

  const fallbackName = req.file.originalname.replace(/\.[^.]+$/, "") || "Untitled";
  const project = new Project({
    name: (req.body.name ?? "").trim() || fallbackName,
    imageHash: sha256(req.file.buffer),
  });
  try {
    Object.assign(project, await saveScreenshot(project._id, req.file.buffer));
  } catch {
    return res.status(400).json({ error: "The file is not a readable image" });
  }
  await project.save();
  res.status(201).json(project);
});

app.get("/api/projects", async (_req, res) => {
  const projects = await Project.find().sort({ createdAt: -1 }).limit(50);
  res.json(projects);
});

app.get("/api/projects/:id", async (req, res) => {
  const project = mongoose.isValidObjectId(req.params.id) ? await Project.findById(req.params.id) : null;
  if (!project) return res.status(404).json({ error: "No such project" });
  res.json(project);
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

// Express 5 passes listen errors (e.g. port already in use) to this callback.
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Builder API could not start on ${HOST}:${PORT}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  console.log(`Builder API listening on http://${HOST}:${PORT}`);
});
