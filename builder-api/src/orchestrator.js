// Moves projects through the lifecycle (ARCHITECTURE.md §3). MongoDB is the source of truth:
// every step is saved before the next one starts, so a restart can pick up where it stopped.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { getFrontend, submitFrontend } from "./gateway-client.js";
import { Contract } from "./models/contract.js";
import { Job } from "./models/job.js";
import { Project } from "./models/project.js";
import { checkSpec } from "./spec/check.js";
import { deriveSpec } from "./spec/derive.js";
import { pageInstructions } from "./spec/instructions.js";
import { readInventory } from "./spec/inventory.js";
import { REPO_ROOT, saveArtifact } from "./storage.js";

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
    for (const shot of screenshotsOf(project)) {
      const image = await readFile(path.join(REPO_ROOT, shot.path));
      const { inventory, provider } = await readInventory(image.toString("base64"), { mode: project.mode });
      inventories.push(inventory);
      if (job.provider !== "cloud") job.provider = provider; // "cloud" if any screenshot needed the backup
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

// Backend branch: a placeholder until Step 10 (Backend Generator) so the Barrier can be tested now.
async function backendBranch(project, contract) {
  const query = { projectId: project._id, kind: "backend", contractHash: contract.hash, status: "done" };
  const existing = await Job.findOne(query);
  if (existing) return existing;
  const now = new Date();
  return Job.create({ ...query, startedAt: now, finishedAt: now, note: "Placeholder until Step 10 (Backend Generator)" });
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

async function run(projectId) {
  const project = await Project.findById(projectId);
  if (!project) return;
  try {
    if (project.state === "UPLOADED") await contractStage(project);
    if (["CONTRACT_DRAFT", "BUILDING"].includes(project.state)) await buildStage(project._id);
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
    { status: "running", kind: "contract" },
    { status: "failed", error: "Interrupted by a Builder API restart", finishedAt: new Date() }
  );
  const projects = await Project.find({ state: { $in: ["UPLOADED", "CONTRACT_DRAFT", "BUILDING"] } }, { _id: 1 });
  projects.forEach((p) => startPipeline(p._id));
  if (projects.length) console.log(`Resuming ${projects.length} project(s), ${interrupted.modifiedCount} interrupted job(s)`);
}
