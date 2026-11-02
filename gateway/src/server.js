import express from "express";
import { requireApiKey } from "./auth.js";
import { buildPage } from "../../shared/page.mjs";
import { createJobQueue } from "./jobs.js";
import { generateHtml, providerParams } from "./s2c-client.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const API_KEY = process.env.GATEWAY_API_KEY ?? "";
const S2C_WS_URL = process.env.S2C_WS_URL ?? "ws://127.0.0.1:7001/generate-code";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
// Step 23b: pages are drawn by one model call unless PAGE_BUILDER=s2c; several cloud pages at once.
const BUILDERS = ["single", "s2c"];
const PAGE_BUILDER = process.env.PAGE_BUILDER ?? "single";
const LIMITS = { local: Number(process.env.LOCAL_PARALLEL ?? 1), cloud: Number(process.env.CLOUD_PARALLEL ?? 4) };
if (!BUILDERS.includes(PAGE_BUILDER)) {
  console.error(`PAGE_BUILDER in gateway/.env must be one of: ${BUILDERS.join(", ")}`);
  process.exit(1);
}

if (API_KEY.length < 16) {
  console.error("GATEWAY_API_KEY in gateway/.env must be at least 16 characters.");
  process.exit(1);
}

// Any HTTP answer from Screenshot-to-Code's port means it is up.
async function isS2cUp() {
  const httpUrl = new URL(S2C_WS_URL);
  httpUrl.protocol = httpUrl.protocol === "wss:" ? "https:" : "http:";
  httpUrl.pathname = "/";
  try {
    await fetch(httpUrl, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// Same check as `ollama ps`: how much of each loaded model sits in VRAM.
async function loadedModels() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2000) });
    const { models = [] } = await res.json();
    return models.map((m) => ({
      name: m.name,
      gpu: `${Math.round((100 * m.size_vram) / m.size)}% GPU`,
    }));
  } catch {
    return null; // Ollama is not running
  }
}

const builders = {
  // One model call per page (shared/page.mjs): Ollama here for local, Gemini for cloud.
  single: async ({ provider, image, instructions }) => {
    const { html } = await buildPage({ imageB64: image.replace(/^data:image\/[a-z]+;base64,/, ""), instructions, mode: provider });
    return { html };
  },
  s2c: ({ provider, image, instructions, onProgress }) =>
    generateHtml({ wsUrl: S2C_WS_URL, imageDataUrl: image, instructions, provider: providerParams(provider, { ollamaUrl: OLLAMA_URL, geminiApiKey: GEMINI_API_KEY }), onProgress }),
};
const queue = createJobQueue({ builders, defaultBuilder: PAGE_BUILDER, limits: LIMITS, hasCloud: GEMINI_API_KEY !== null });

// Returns an error message, or null when the request body is usable.
function checkGenerationRequest(body) {
  const { image, instructions = "", contractHash, type = "create", mode = "auto", builder = PAGE_BUILDER } = body ?? {};
  if (typeof image !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(image))
    return "image must be a data URL: data:image/png;base64,...";
  if (typeof instructions !== "string") return "instructions must be a string";
  if (typeof contractHash !== "string" || !/^[a-f0-9]{64}$/.test(contractHash))
    return "contractHash must be a 64-character sha256 hex string";
  if (type !== "create") return 'only type "create" is supported for now';
  if (!["auto", "local", "cloud"].includes(mode)) return 'mode must be "auto", "local" or "cloud"';
  if (!BUILDERS.includes(builder)) return `builder must be one of: ${BUILDERS.join(", ")}`;
  if (mode === "cloud" && !GEMINI_API_KEY) return "cloud mode needs GEMINI_API_KEY in gateway/.env";
  return null;
}

const app = express();
app.use(requireApiKey(API_KEY));
app.use(express.json({ limit: "15mb" }));

app.get("/v1/health", async (_req, res) => {
  const [s2cUp, models] = await Promise.all([isS2cUp(), loadedModels()]);
  res.json({
    s2cUp,
    ollamaUp: models !== null,
    models: models ?? [],
    queueLength: queue.queueLength(),
    pageBuilder: PAGE_BUILDER,
    parallel: LIMITS,
    cloudAvailable: GEMINI_API_KEY !== null,
  });
});

app.post("/v1/generations", (req, res) => {
  const problem = checkGenerationRequest(req.body);
  if (problem) return res.status(400).json({ error: problem });

  const { image, instructions = "", contractHash, mode = "auto", builder = PAGE_BUILDER } = req.body;
  const { job, created } = queue.submit({ image, instructions, contractHash, mode, builder });
  // 202 = accepted, still working; 200 = this exact request was already submitted.
  res.status(created ? 202 : 200).json(queue.view(job));
});

app.get("/v1/generations/:id", (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return res.status(404).json({ error: "No such job (the Gateway may have restarted)" });
  res.json(queue.view(job));
});

// Bad JSON, too-large bodies, anything unexpected: always answer in JSON.
app.use((err, _req, res, _next) => {
  res.status(err.status ?? 500).json({ error: err.message });
});

// Express 5 passes listen errors (e.g. port already in use) to this callback.
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Gateway could not start on ${HOST}:${PORT}: ${err.code ?? err.message}`);
    if (err.code === "EADDRINUSE") console.error("Another Gateway is probably still running. Stop it first.");
    process.exit(1);
  }
  console.log(`Gateway listening on http://${HOST}:${PORT}`);
});
