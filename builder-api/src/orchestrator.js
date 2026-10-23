// Moves projects through the lifecycle (ARCHITECTURE.md §3). MongoDB is the source of truth:
// every step is saved before the next one starts, so a restart can pick up where it stopped.
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { checkCustomCode } from "./custom/safety.js";
import { pressOnce } from "./custom/tester.js";
import { writeCustomCode, writtenButtons } from "./custom/writer.js";
import { generateBackend, writeBackend } from "./generator/index.js";
import { origin, recall, rememberProject } from "./memory/index.js";
import { customKey, inventoryKey, pageKey } from "./memory/keys.js";
import { getFrontend, submitFrontend } from "./gateway-client.js";
import { Contract } from "./models/contract.js";
import { Job } from "./models/job.js";
import { Project } from "./models/project.js";
import { checkSpec } from "./spec/check.js";
import { deriveSpec } from "./spec/derive.js";
import { pageInstructions } from "./spec/instructions.js";
import { readInventory } from "./spec/inventory.js";
import { REPO_ROOT, RUNS_DIR, saveArtifact } from "./storage.js";
import { databaseUri, verifyApp } from "./verify/index.js";
import { failureLine } from "./verify/report.js";
import { wireApp } from "./wirer/index.js";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/builder_db"; // the Verifier's throwaway databases live next to it
const POLL_MS = Number(process.env.GATEWAY_POLL_MS ?? 2000); // A polls B every 2 s (ARCHITECTURE.md §6)
const MAX_POLL_ERRORS = 30; // about a minute of Gateway/Tailscale trouble before giving up
const MAX_BUILD_ROUNDS = 3; // how many Contract edits one build follows before asking for attention

const active = new Set(); // projectIds with a pipeline running in this process
const rerun = new Set(); // asked to start again while already running

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (hash) => hash?.slice(0, 12);

async function setState(project, state, error) {
  project.state = state;
  project.error = error;
  await project.save();
  console.log(`[${project.id}] ${state}${error ? `: ${error}` : ""}`);
}

export const currentContract = (project) =>
  Contract.findOne({ projectId: project._id, version: project.currentContractVersion });

// Records one piece of work as a Job; `work(job)` may set job.provider / job.contractHash.
async function runJob(project, kind, work) {
  const job = await Job.create({ projectId: project._id, kind, status: "running", startedAt: new Date() });
  try {
    const result = await work(job);
    job.status = "done";
    return result;
  } catch (err) {
    job.status = "failed";
    job.error = err.message.slice(0, 1000);
    throw err;
  } finally {
    job.finishedAt = new Date();
    await job.save();
  }
}

// Projects created before multi-screenshot uploads have only imagePath.
const screenshotsOf = (project) => (project.screenshots?.length ? project.screenshots : [{ path: project.imagePath }]);

// UPLOADED -> CONTRACT_DRAFT: each screenshot -> UI inventory; all inventories -> App Spec v1 (checked).
async function contractStage(project) {
  const { body, hash } = await runJob(project, "contract", async (job) => {
    const inventories = [];
    const reused = [];
    for (const shot of screenshotsOf(project)) {
      // A screenshot read before, in a project that reached READY: its reading is reused (Step 14).
      const memory = project.useMemory !== false && shot.sha256 ? await recall("inventory", inventoryKey(shot.sha256)) : null;
      if (memory) reused.push(memory);
      const { inventory, provider } = memory
        ? { inventory: memory.payload, provider: memory.provider }
        : await readInventory((await readFile(path.join(REPO_ROOT, shot.path))).toString("base64"), { mode: project.mode });
      inventories.push(inventory);
      if (job.provider !== "cloud") job.provider = provider; // "cloud" if any screenshot needed the backup
    }
    if (reused.length) {
      job.fromMemory = { ...origin(reused[0]), count: reused.length, seconds: reused.reduce((s, m) => s + (m.seconds ?? 0), 0) };
    }
    project.screenshots.forEach((shot, i) => (shot.inventory = inventories[i]));
    project.markModified("screenshots");

    const body = deriveSpec(inventories);
    const problems = checkSpec(body);
    if (problems.length) throw new Error(`Spec problems: ${problems.join("; ")}`);
    job.contractHash = contractHash(body);
    return { body, hash: job.contractHash };
  });

  const version = project.currentContractVersion + 1;
  await Contract.create({ projectId: project._id, version, hash, body });
  project.currentContractVersion = version;
  await setState(project, "CONTRACT_DRAFT");
}

async function pollGateway(job) {
  let errors = 0;
  for (;;) {
    await sleep(POLL_MS);
    let remote;
    try {
      remote = await getFrontend(job.remoteJobId);
      errors = 0;
    } catch (err) {
      if (err.status === 404) throw Object.assign(new Error("Gateway no longer knows this job"), { gone: true });
      if (++errors >= MAX_POLL_ERRORS) throw new Error(`Gateway unreachable for a minute: ${err.message}`);
      continue;
    }
    if (remote.status === "done") return remote;
    if (remote.status === "failed") throw new Error(`Frontend failed on Laptop B: ${remote.error}`);
  }
}

// Frontend branch, one per page: reuse a finished job for this hash, resume a running one, or start a new one.
async function frontendBranch(project, contract, n) {
  const query = { projectId: project._id, kind: "frontend", contractHash: contract.hash, page: n };
  const existing = await Job.findOne({ ...query, status: { $in: ["done", "running"] } }).sort({ createdAt: -1 });
  if (existing?.status === "done") return existing;

  // The same screenshot with the same instructions drew a page that passed the Check before (Step 14).
  const shot = screenshotsOf(project)[n - 1];
  const memory = !existing && project.useMemory !== false && shot.sha256 ? await recall("page", pageKey(shot.sha256, pageInstructions(contract.body, n))) : null;
  if (memory) {
    const now = new Date();
    const artifactPath = await saveArtifact(project._id, `frontend/v${contract.version}/page-${n}.html`, memory.payload);
    return Job.create({ ...query, status: "done", provider: memory.provider, artifactPath, fromMemory: origin(memory), startedAt: now, finishedAt: now });
  }

  const job = existing ?? (await Job.create({ ...query, status: "running", startedAt: new Date() }));

  try {
    let remote;
    for (let attempt = 1; !remote; attempt++) {
      if (!job.remoteJobId) {
        const image = await readFile(path.join(REPO_ROOT, screenshotsOf(project)[n - 1].path));
        const submitted = await submitFrontend({
          imageDataUrl: `data:image/png;base64,${image.toString("base64")}`,
          instructions: pageInstructions(contract.body, n),
          contractHash: contract.hash,
          mode: project.mode,
        });
        job.remoteJobId = submitted.jobId;
        await job.save(); // saved before polling, so a restart resumes this exact Gateway job
      }
      try {
        remote = await pollGateway(job);
      } catch (err) {
        if (!err.gone || attempt > 1) throw err;
        job.remoteJobId = undefined; // the Gateway restarted and lost it: submit once more
      }
    }
    if (remote.contractHash !== contract.hash) throw new Error("Gateway returned a page for a different Contract");

    job.provider = remote.provider;
    job.artifactPath = await saveArtifact(project._id, `frontend/v${contract.version}/page-${n}.html`, remote.html);
    if (remote.finishedEarly) job.note = "Gateway took the complete page while the model kept editing";
    job.status = "done";
    return job;
  } catch (err) {
    job.status = "failed";
    job.error = err.message.slice(0, 1000);
    throw err;
  } finally {
    job.finishedAt = new Date();
    await job.save();
  }
}

// Backend branch: the template generator (no AI, deterministic). Writes runs/<id>/app/v<N>/.
// Then each custom button gets its code from the coding AI (Step 13), one at a time, tried in that app.
// A button whose code never passes is left out: it answers "not available yet" and the rest still works.
async function backendBranch(project, contract) {
  const existing = await Job.findOne({ projectId: project._id, kind: "backend", contractHash: contract.hash, status: "done" });
  if (existing) return existing;
  return runJob(project, "backend", async (job) => {
    job.contractHash = contract.hash;
    const spec = contract.body;
    const files = generateBackend(spec, { name: project.name });
    const dir = path.join(RUNS_DIR, project.id, "app", `v${contract.version}`);
    await writeBackend(dir, files);
    job.artifactPath = path.relative(REPO_ROOT, dir).split(path.sep).join("/");
    job.note = `${Object.keys(files).length} files generated from templates`;

    const customOps = spec.operations.filter((op) => op.kind === "custom");
    if (!customOps.length) return job;
    job.custom = [];
    for (const op of customOps) {
      const started = Date.now();
      const mongoUri = databaseUri(MONGODB_URI, `custom_${project.id}`);
      const test = (code) => pressOnce({ spec, op, appDir: dir, mongoUri, code });
      // The same button on the same kind of table got verified code before (Step 14): it is pressed in this
      // app first, and only if it doesn't pass here does the coding AI write new code.
      const memory = project.useMemory !== false ? await recall("custom", customKey(spec, op)) : null;
      const remembered = memory && checkCustomCode(memory.payload).ok && !(await test(memory.payload));
      const result = remembered
        ? { ok: true, provider: memory.provider, answers: 0, fromMemory: origin(memory) }
        : await writeCustomCode({ spec, op, mode: project.mode, test });
      if (!result.ok) await rm(path.join(dir, "backend", "custom", `${op.name}.js`), { force: true });
      job.custom.push({
        operation: op.name,
        button: op.button,
        ok: result.ok,
        provider: result.provider ?? null,
        answers: result.answers,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        ...(result.fromMemory && { fromMemory: result.fromMemory }),
        ...(result.problem && { problem: result.problem.slice(0, 500) }),
      });
    }
    const written = job.custom.filter((c) => c.ok);
    if (written.length) {
      job.provider = written.some((c) => c.provider === "cloud") ? "cloud" : "local";
      const tests = generateBackend(spec, { name: project.name, customWritten: written.map((c) => c.operation) })["tests/api.test.js"];
      await writeBackend(dir, { "tests/api.test.js": tests });
    }
    job.note += `; custom buttons: ${written.length} of ${customOps.length} written by the coding AI`;
    return job;
  });
}

// CONTRACT_DRAFT -> BUILDING -> SYNCED. Every page and the backend are built at the same time.
async function buildStage(projectId) {
  for (let round = 1; round <= MAX_BUILD_ROUNDS; round++) {
    const project = await Project.findById(projectId);
    if (project.state !== "BUILDING") await setState(project, "BUILDING");
    const contract = await currentContract(project);
    // A restart can leave a job for an older Contract marked "running"; nothing waits for it any more.
    await Job.updateMany(
      { projectId, kind: "frontend", status: "running", contractHash: { $ne: contract.hash } },
      { status: "cancelled", error: `Superseded by Contract v${contract.version}`, finishedAt: new Date() }
    );
    const [backend, ...pages] = await Promise.all([
      backendBranch(project, contract),
      ...contract.body.pages.map((page) => frontendBranch(project, contract, page.screenshot)),
    ]);

    // Sync Barrier: every page and the backend must match the Contract that is current NOW;
    // the user may have edited it meanwhile.
    const latest = await currentContract(await Project.findById(projectId));
    const stale = [backend, ...pages].filter((job) => job.contractHash !== latest.hash);
    if (stale.length === 0) {
      await setState(project, "SYNCED");
      return;
    }
    console.log(
      `[${projectId}] Barrier refused: built for ${short(stale[0].contractHash)}, ` +
        `Contract is now v${latest.version} (${short(latest.hash)}). Rebuilding.`
    );
  }
  throw new Error(`The Contract changed ${MAX_BUILD_ROUNDS} times during one build`);
}

// SYNCED -> INTEGRATING (Wire: the wired pages go into the app folder, so the folder is the finished app)
// -> VERIFYING (Check: the Verifier on throwaway databases) -> READY, or NEEDS_ATTENTION with the report.
async function verifyStage(projectId) {
  let project = await Project.findById(projectId);
  const contract = await currentContract(project);
  const query = { projectId: project._id, contractHash: contract.hash, status: "done" };
  const backend = await Job.findOne({ ...query, kind: "backend" });
  const pages = await Job.find({ ...query, kind: "frontend" });
  const appDir = path.join(REPO_ROOT, backend.artifactPath);

  await setState(project, "INTEGRATING");
  const built = await Promise.all(pages.map(async (job) => ({ screenshot: job.page, html: await readFile(path.join(REPO_ROOT, job.artifactPath), "utf8") })));
  const customWritten = writtenButtons(backend);
  await writeBackend(appDir, wireApp({ spec: contract.body, pages: built, customWritten }));

  await setState(project, "VERIFYING");
  const job = await runJob(project, "verify", async (job) => {
    job.contractHash = contract.hash;
    job.report = await verifyApp({
      spec: contract.body,
      appDir,
      customWritten,
      mongoUri: databaseUri(MONGODB_URI, `verify_${project.id}`),
      testsMongoUri: databaseUri(MONGODB_URI, `verify_${project.id}_tests`),
    });
    job.note = `${job.report.summary.pass} passed, ${job.report.summary.fail} failed, in ${job.report.seconds} s`;
    return job;
  });

  project = await Project.findById(projectId);
  if ((await currentContract(project)).hash !== contract.hash) return; // the spec was edited meanwhile: the rerun builds again
  if (job.report.ok) {
    // Every check passed: this project's readings, pages and custom code may be reused (Step 14).
    await rememberProject(project, contract).catch((err) => console.error(`[${project.id}] could not remember: ${err.message}`));
    await setState(project, "READY");
  }
  else await setState(project, "NEEDS_ATTENTION", failureLine(job.report).slice(0, 500));
}

async function run(projectId) {
  const project = await Project.findById(projectId);
  if (!project) return;
  try {
    if (project.state === "UPLOADED") await contractStage(project);
    if (["CONTRACT_DRAFT", "BUILDING"].includes(project.state)) await buildStage(project._id);
    if (["SYNCED", "INTEGRATING", "VERIFYING"].includes((await Project.findById(projectId)).state)) await verifyStage(project._id);
  } catch (err) {
    await setState(await Project.findById(projectId), "NEEDS_ATTENTION", err.message.slice(0, 500));
  }
}

/** Starts (or continues) a project's pipeline in the background; safe to call at any time. */
export function startPipeline(projectId) {
  const id = projectId.toString();
  if (active.has(id)) {
    rerun.add(id); // look again once the current run ends (e.g. the Contract was edited)
    return;
  }
  active.add(id);
  run(id)
    .catch((err) => console.error(`[${id}] pipeline crashed:`, err))
    .finally(() => {
      active.delete(id);
      if (rerun.delete(id)) startPipeline(id);
    });
}

/** On startup: finish what a restart cut off. Running frontend jobs keep their Gateway jobId and resume. */
export async function resumeAll() {
  const interrupted = await Job.updateMany(
    { status: "running", kind: { $in: ["contract", "verify"] } },
    { status: "failed", error: "Interrupted by a Builder API restart", finishedAt: new Date() }
  );
  // SYNCED projects from before Step 16 get wired and checked too.
  const projects = await Project.find({ state: { $in: ["UPLOADED", "CONTRACT_DRAFT", "BUILDING", "SYNCED", "INTEGRATING", "VERIFYING"] } }, { _id: 1 });
  projects.forEach((p) => startPipeline(p._id));
  if (projects.length) console.log(`Resuming ${projects.length} project(s), ${interrupted.modifiedCount} interrupted job(s)`);
}
