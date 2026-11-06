// Moves projects through the lifecycle (ARCHITECTURE.md §3). MongoDB is the source of truth:
// every step is saved before the next one starts, so a restart can pick up where it stopped.
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { checkCustomCode } from "./custom/safety.js";
import { pressOnce } from "./custom/tester.js";
import { buttonDatabase, writeButtons } from "./custom/all.js";
import { writeCustomCode, writtenButtons } from "./custom/writer.js";
import { generateBackend, writeBackend } from "./generator/index.js";
import { origin, recall, recallLibrary, recallSimilarPage, rememberProject } from "./memory/index.js";
import { customKey, inventoryKey, pageKey } from "./memory/keys.js";
import { loadConfig } from "./config.js";
import { getFrontend, submitFrontend } from "./gateway-client.js";
import { getPage, submitPage } from "./page-queue.js";
import { Contract } from "./models/contract.js";
import { withUsage } from "../../shared/meter.mjs";
import { buildPage } from "../../shared/page.mjs";
import { callModel } from "../../shared/providers.mjs";
import { openSlotKey } from "./keys/slots.js";
import { askRerun, claimProject, freeProjects, releaseAll, releaseProject, renewLease } from "./lease.js";
import { log } from "./log.js";
import { Job } from "./models/job.js";
import { Project } from "./models/project.js";
import { checkSpec } from "./spec/check.js";
import { deriveSpec } from "./spec/derive.js";
import { pageInstructions } from "./spec/instructions.js";
import { readInventory } from "./spec/inventory.js";
import { readScreenshots } from "./spec/read-all.js";
import { REPO_ROOT, RUNS_DIR, saveArtifact } from "./storage.js";
import { databaseUri, verifyApp } from "./verify/index.js";
import { failureLine } from "./verify/report.js";
import { wireApp } from "./wirer/index.js";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/builder_db"; // the Verifier's throwaway databases live next to it
const POLL_MS = Number(process.env.GATEWAY_POLL_MS ?? 2000); // A polls B every 2 s (ARCHITECTURE.md §6)
const MAX_POLL_ERRORS = 30; // about a minute of Gateway/Tailscale trouble before giving up
const MAX_BUILD_ROUNDS = 3; // how many Contract edits one build follows before asking for attention

// Step 22: a project is built only by the Builder API holding its lease in MongoDB (src/lease.js), so two
// Builder APIs on one database never build it at once, and a dead one's projects are taken over.
const OWNER = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_MS = Number(process.env.LEASE_MS ?? 60_000);
// Step 24: ROLE=api only saves what should be built; ROLE=orchestrator (or all) builds it.
const ROLE = process.env.ROLE ?? "all";
const PICKUP_MS = Number(process.env.PICKUP_MS ?? (ROLE === "orchestrator" ? 1000 : LEASE_MS / 3));
// Step 26: pages go to Laptop B's Gateway (development) or into the page queue for ui-workers (production).
// Both lanes answer the same two calls, so the frontend branch below doesn't change.
const PAGE_LANE = loadConfig(process.env).pageLane;
const pages = PAGE_LANE === "queue" ? { submit: submitPage, get: getPage } : { submit: submitFrontend, get: getFrontend };
const active = new Set(); // projects this process is building now (its own second request becomes a rerun)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (hash) => hash?.slice(0, 12);

async function setState(project, state, error) {
  project.state = state;
  project.error = error;
  await project.save();
  log.info(`${state}${error ? `: ${error}` : ""}`, { project: project.id, state });
}

export const currentContract = (project) =>
  Contract.findOne({ projectId: project._id, version: project.currentContractVersion });

// Records one piece of work as a Job; `work(job)` may set job.provider / job.contractHash.
async function runJob(project, kind, work) {
  const job = await Job.create({ projectId: project._id, kind, status: "running", startedAt: new Date() });
  const usage = []; // Step 25: every model call made while doing this job
  try {
    const result = await withUsage(usage, () => work(job));
    job.status = "done";
    return result;
  } catch (err) {
    job.status = "failed";
    job.error = err.message.slice(0, 1000);
    throw err;
  } finally {
    if (usage.length) job.usage = usage;
    job.finishedAt = new Date();
    await job.save();
  }
}

// Step 31c: a model call on the workspace's own key in this slot, or null when the slot is empty (the server's
// models, by mode). The key is opened from the vault at the first call, and only kept in memory.
function slotModel(project, slot) {
  const chosen = project.keys?.[slot];
  if (!chosen?.keyId) return null;
  let opened = null;
  return {
    provider: chosen.provider,
    call: async (request) => {
      const key = await (opened ??= openSlotKey(project, slot));
      return callModel({ ...request, provider: key.provider, model: key.model, apiKey: key.apiKey });
    },
  };
}

// Projects created before multi-screenshot uploads have only imagePath.
const screenshotsOf = (project) => (project.screenshots?.length ? project.screenshots : [{ path: project.imagePath }]);

// UPLOADED -> CONTRACT_DRAFT: each screenshot -> UI inventory; all inventories -> App Spec v1 (checked).
async function contractStage(project) {
  const { body, hash } = await runJob(project, "contract", async (job) => {
    // All screenshots at the same time (Step 23). A screenshot read before, in a project that reached
    // READY, takes its reading from memory (Step 14).
    const own = slotModel(project, "frontend");
    const ownReader = own && { byok: ({ prompt, schema, imageB64 }) => own.call({ prompt, schema, imageB64, json: true, temperature: 0, purpose: "read" }) };
    const { inventories, provider, reused } = await readScreenshots(screenshotsOf(project), {
      recall: (shot) => (project.useMemory !== false && shot.sha256 ? recall("inventory", inventoryKey(shot.sha256), project) : null),
      read: async (shot) => {
        const imageB64 = (await readFile(path.join(REPO_ROOT, shot.path))).toString("base64");
        if (!own) return readInventory(imageB64, { mode: project.mode });
        return { ...(await readInventory(imageB64, { mode: "byok", providers: ownReader })), provider: own.provider };
      },
    });
    job.provider = provider; // "cloud" if any screenshot needed the backup
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
      remote = await pages.get(job.remoteJobId);
      errors = 0;
    } catch (err) {
      if (err.status === 404) throw Object.assign(new Error("Gateway no longer knows this job"), { gone: true });
      if (++errors >= MAX_POLL_ERRORS) throw new Error(`Gateway unreachable for a minute: ${err.message}`);
      continue;
    }
    if (remote.status === "done") return remote;
    if (remote.status === "failed") throw new Error(`Frontend failed ${PAGE_LANE === "queue" ? "in the ui-worker" : "on Laptop B"}: ${remote.error}`);
  }
}

// Frontend branch, one per page: reuse a finished job for this hash, resume a running one, or start a new one.
async function frontendBranch(project, contract, n) {
  const query = { projectId: project._id, kind: "frontend", contractHash: contract.hash, page: n };
  const existing = await Job.findOne({ ...query, status: { $in: ["done", "running"] } }).sort({ createdAt: -1 });
  if (existing?.status === "done") return existing;

  // The same screenshot with the same instructions drew a page that passed the Check before (Step 14).
  // Else a copy of that screenshot (resized, re-saved: nearly the same picture) with the same instructions.
  const shot = screenshotsOf(project)[n - 1];
  const instructions = pageInstructions(contract.body, n);
  let reuse = null;
  if (!existing && project.useMemory !== false && shot.sha256) {
    const same = await recall("page", pageKey(shot.sha256, instructions), project);
    const similar = same ? null : await recallSimilarPage(shot.dHash, instructions, project);
    reuse = same ? { memory: same, fromMemory: origin(same) } : similar && { memory: similar.memory, fromMemory: { ...origin(similar.memory), similar: true, distance: similar.distance } };
  }
  if (reuse) {
    const now = new Date();
    const artifactPath = await saveArtifact(project._id, `frontend/v${contract.version}/page-${n}.html`, reuse.memory.payload);
    return Job.create({ ...query, status: "done", provider: reuse.memory.provider, artifactPath, fromMemory: reuse.fromMemory, startedAt: now, finishedAt: now });
  }

  // Step 31c: the workspace's own frontend key draws the page right here, twice at most: a user's key never
  // goes to Laptop B's Gateway (development only), and needs no ui-worker.
  const own = slotModel(project, "frontend");
  if (own) {
    return runJob(project, "frontend", async (job) => {
      Object.assign(job, { contractHash: contract.hash, page: n, provider: own.provider });
      const imageB64 = (await readFile(path.join(REPO_ROOT, shot.path))).toString("base64");
      const draw = ({ prompt }) => own.call({ prompt, imageB64, purpose: "page" });
      let html;
      for (let attempt = 1; !html; attempt++) {
        try {
          ({ html } = await buildPage({ imageB64, instructions, mode: "byok", providers: { byok: draw } }));
        } catch (err) {
          if (attempt >= 2 || /was deleted|KEY_VAULT_SECRET/.test(err.message)) throw err;
        }
      }
      job.artifactPath = await saveArtifact(project._id, `frontend/v${contract.version}/page-${n}.html`, html);
      return job;
    });
  }

  const job = existing ?? (await Job.create({ ...query, status: "running", startedAt: new Date() }));

  try {
    let remote;
    for (let attempt = 1; !remote; attempt++) {
      if (!job.remoteJobId) {
        const image = await readFile(path.join(REPO_ROOT, screenshotsOf(project)[n - 1].path));
        const submitted = await pages.submit({
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
    if (remote.usage?.length) job.usage = remote.usage; // Step 25: what Laptop B's model calls used for this page
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
// Then every custom button gets its code from the coding AI (Step 13), all at the same time (Step 23c),
// each tried in that app on its own throwaway database.
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
    const own = slotModel(project, "backend"); // Step 31c: the workspace's own backend key writes the code
    // Every button at the same time (Step 23c), each pressed on its own throwaway database.
    job.custom = await writeButtons(customOps, { writeOne: async (op, i) => {
      const started = Date.now();
      const mongoUri = databaseUri(MONGODB_URI, buttonDatabase(project.id, i));
      const test = (code) => pressOnce({ spec, op, appDir: dir, mongoUri, code });
      // Verified code from memory is pressed in this app first (Step 14): the same button on the same kind of
      // table, else the same button on a table whose fields still fit the code (the library). Only if none
      // passes here does the coding AI write new code.
      let result = null;
      if (project.useMemory !== false) {
        const exact = await recall("custom", customKey(spec, op), project);
        const library = (await recallLibrary(spec, op, project)).filter((m) => m.key !== exact?.key);
        const tries = [...(exact ? [{ memory: exact, similar: false }] : []), ...library.map((memory) => ({ memory, similar: true }))];
        for (const { memory, similar } of tries) {
          if (checkCustomCode(memory.payload).ok && !(await test(memory.payload))) {
            result = { ok: true, provider: memory.provider, answers: 0, fromMemory: { ...origin(memory), ...(similar && { similar }) } };
            break;
          }
        }
      }
      result ??= own
        ? { ...(await writeCustomCode({ spec, op, mode: "byok", test, providers: { byok: (prompt) => own.call({ prompt, purpose: "code" }) } })), provider: own.provider }
        : await writeCustomCode({ spec, op, mode: project.mode, test });
      if (!result.ok) await rm(path.join(dir, "backend", "custom", `${op.name}.js`), { force: true });
      return {
        operation: op.name,
        button: op.button,
        ok: result.ok,
        provider: result.provider ?? null,
        answers: result.answers,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        ...(result.fromMemory && { fromMemory: result.fromMemory }),
        ...(result.problem && { problem: result.problem.slice(0, 500) }),
      };
    } });
    const written = job.custom.filter((c) => c.ok);
    if (written.length) {
      job.provider = own ? own.provider : written.some((c) => c.provider === "cloud") ? "cloud" : "local";
      const tests = generateBackend(spec, { name: project.name, customWritten: written.map((c) => c.operation) })["tests/api.test.js"];
      await writeBackend(dir, { "tests/api.test.js": tests });
    }
    const reused = written.filter((c) => c.fromMemory).length;
    job.note += `; custom buttons: ${written.length} of ${customOps.length} written ${reused ? `(${reused} from memory)` : "by the coding AI"}`;
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

/** Starts (or continues) a project's pipeline in the background; safe to call at any time, from any server. */
export function startPipeline(projectId) {
  // The API service never builds: an orchestrator picks the project up from MongoDB within PICKUP_MS
  // (an unfinished project nobody holds), and one already building it looks again when it is done.
  if (ROLE === "api") return void askRerun(projectId).catch((err) => log.error(`asking for a build failed: ${err.message}`, { project: projectId.toString() }));
  buildWithLease(projectId.toString()).catch((err) => log.error(`pipeline crashed: ${err.stack ?? err.message}`, { project: projectId.toString() }));
}

async function buildWithLease(id) {
  if (active.has(id)) return void (await askRerun(id)); // look again once the current run ends (e.g. a spec edit)
  active.add(id);
  let again = false;
  try {
    if (!(await claimProject(id, { owner: OWNER, ms: LEASE_MS }))) {
      // Another Builder API holds it: ask it to look again, unless it finished in the meantime.
      await askRerun(id);
      if (!(await claimProject(id, { owner: OWNER, ms: LEASE_MS }))) return;
    }
    const heartbeat = setInterval(() => {
      renewLease(id, { owner: OWNER, ms: LEASE_MS })
        .then((mine) => mine || log.error("lost the project's lease (its time ran out); another Builder API may take it over", { project: id }))
        .catch(() => {});
    }, LEASE_MS / 3);
    heartbeat.unref();
    try {
      await run(id);
    } finally {
      clearInterval(heartbeat);
    }
    again = (await releaseProject(id, { owner: OWNER }))?.rerun ?? false;
  } finally {
    active.delete(id);
  }
  if (again) await buildWithLease(id);
}

// Unfinished projects nobody holds: at start (a restart cut them off) and every lease period (a Builder
// API died). Only their running reading and Check jobs were interrupted; running page jobs keep their
// Gateway jobId and resume. SYNCED projects from before Step 16 get wired and checked too.
async function pickUpFree() {
  const ids = await freeProjects();
  const interrupted = ids.length
    ? await Job.updateMany(
        { projectId: { $in: ids }, status: "running", kind: { $in: ["contract", "verify"] } },
        { status: "failed", error: "Interrupted: its Builder API stopped", finishedAt: new Date() }
      )
    : { modifiedCount: 0 };
  ids.forEach((id) => startPipeline(id));
  return { projects: ids.length, interrupted: interrupted.modifiedCount };
}

/** On startup: finish what was cut off, then keep looking for projects a stopped Builder API left behind. */
export async function resumeAll() {
  const { projects, interrupted } = await pickUpFree();
  if (projects) log.info(`Resuming ${projects} project(s), ${interrupted} interrupted job(s)`);
  // Every PICKUP_MS (a third of a lease; every second in the orchestrator service, where new projects come
  // from the API this way): a crashed builder's projects wait at most a lease plus this.
  setInterval(() => pickUpFree().catch((err) => log.error(`looking for free projects failed: ${err.message}`)), PICKUP_MS).unref();
}

/** Stopping on purpose (Ctrl+C, a deploy): give every project back, so the next start continues them at once. */
export const stopBuilding = () => releaseAll({ owner: OWNER });
