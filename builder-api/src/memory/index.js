// Step 14: memory. A project that reaches READY leaves its verified work behind (readings, pages, custom
// code); a later project with the same screenshot, page instructions or button reuses it instead of asking
// the vision AI, Laptop B or the coding AI again. Memory never adds anything: what is reused is exactly
// what the same input produced before, and a reused page or code still goes through the Check.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { blobs } from "../blobs.js";
import { log } from "../log.js";
import { Job } from "../models/job.js";
import { Memory } from "../models/memory.js";
import { pageInstructions } from "../spec/instructions.js";
import { REPO_ROOT } from "../storage.js";
import { NEAR, bands, hammingDistance } from "./dhash.js";
import { buttonShape, customKey, instructionsHash, inventoryKey, pageKey } from "./keys.js";
import { fitsTable } from "./library.js";

const KINDS = ["inventory", "page", "custom"];
export const LIBRARY = "library";

/**
 * Step 30 (M2): whose memory a project (or a signed-in person, req.user) uses: its workspace's, or "local"
 * when sign-in is off. Required everywhere, so no lookup can search everyone's memory by forgetting it.
 */
export function memoryScope(owner) {
  if (!owner || typeof owner !== "object") throw new Error("memory needs a scope: pass the project or the signed-in person");
  return owner.workspaceId ? `ws:${owner.workspaceId}` : "local";
}

// The rows a lookup may see: its own scope (local includes rows from before Step 30, which have none),
// then the shared library.
function visible(owner) {
  const scope = memoryScope(owner);
  return { scope: { $in: scope === "local" ? [scope, null, LIBRARY] : [scope, LIBRARY] } };
}
const own = (owner) => {
  const scope = memoryScope(owner);
  return { scope: scope === "local" ? { $in: [scope, null] } : scope };
};
const ownFirst = (owner) => (a, b) => Number(b.scope === memoryScope(owner)) - Number(a.scope === memoryScope(owner)) || (a.scope === LIBRARY) - (b.scope === LIBRARY);

// Step 30 changed the unique index from (kind, key) to (scope, kind, key): the old one is dropped once, before
// the first write, so the same piece can be remembered by two workspaces.
let indexesReady = null;
const ready = () => {
  indexesReady ??= Memory.syncIndexes().catch((err) => {
    indexesReady = null; // tried again at the next write
    throw err;
  });
  return indexesReady;
};
const secondsOf = (job) => (job?.startedAt && job.finishedAt ? Math.round((job.finishedAt - job.startedAt) / 100) / 10 : null);

// A row keeps only its content's blob name (Step 21); this puts the content back. A row whose blob is gone
// counts as not remembered (the work is simply done again).
async function withPayload(memory) {
  if (!memory?.payloadKey) return memory ?? null;
  try {
    return { ...memory, payload: await blobs.getJson(memory.payloadKey) };
  } catch (err) {
    log.error(`memory ${memory.kind} ${memory.key}: ${err.message}`);
    return null;
  }
}

/** The remembered work for this key that this project or person may reuse (its own first), or null. */
export async function recall(kind, key, owner) {
  const rows = await Memory.find({ kind, key, ...visible(owner) }).lean();
  return withPayload(rows.sort(ownFirst(owner))[0]);
}

/** What a reused piece says about where it came from (kept on the job). */
export const origin = (memory) => ({ sourceProjectId: memory.sourceProjectId, sourceName: memory.sourceName, seconds: memory.seconds ?? null });

// Keeps the first project's work: a later identical piece doesn't replace its source. `lookup` fields
// (a page's dHash and instructions hash) describe the work itself, so they are filled in every time:
// pages remembered before they existed get them too.
// The content goes into the blob store; the row keeps its name and size.
async function keep(kind, key, { payload, provider, seconds, project, lookup = {} }) {
  await ready();
  const scope = memoryScope(project);
  const payloadKey = await blobs.putJson(payload);
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  return Memory.updateOne(
    { scope, kind, key },
    {
      $setOnInsert: { scope, kind, key, payloadKey, payloadBytes, provider: provider ?? null, seconds, sourceProjectId: project._id, sourceName: project.name },
      ...(Object.keys(lookup).length && { $set: lookup }),
    },
    { upsert: true }
  );
}

/**
 * A page drawn from a copy of this screenshot (dHash at most NEAR bits away) with the same instructions:
 * { memory, distance } for the closest one, or null.
 */
export async function recallSimilarPage(dHash, instructions, owner) {
  const scoped = visible(owner);
  if (!dHash) return null;
  // Only the rows sharing a band can be NEAR bits away (Step 28, M3); rows remembered before the bands are
  // compared as before, until the next READY project with that page fills them in.
  const pages = await Memory.find({
    ...scoped,
    kind: "page",
    instructionsHash: instructionsHash(instructions),
    dHash: { $type: "string" },
    $or: [{ dHashBands: { $in: bands(dHash) } }, { dHashBands: { $exists: false } }],
  }).lean();
  const closest = pages
    .map((memory) => ({ memory, distance: hammingDistance(dHash, memory.dHash) }))
    .sort((a, b) => a.distance - b.distance || ownFirst(owner)(a.memory, b.memory))[0];
  if (!closest || closest.distance > NEAR) return null;
  const memory = await withPayload(closest.memory);
  return memory ? { memory, distance: closest.distance } : null;
}

/**
 * The verified-code library: remembered code for the same button (text, row or page) that may be tried on
 * this table, newest first. The exact match (customKey) is looked up before this.
 */
export async function recallLibrary(spec, op, owner) {
  const entity = spec.entities.find((e) => e.name === op.entity);
  const rows = await Memory.find({ ...visible(owner), kind: "custom", ...buttonShape(op), fields: { $type: "array" } }).sort({ createdAt: -1 }).limit(5).lean();
  const candidates = (await Promise.all(rows.map(withPayload))).filter(Boolean);
  return candidates.filter((memory) => fitsTable(memory.payload, memory.fields, entity.fields));
}

/** Called when a project reaches READY: its readings, pages and written custom code go into memory. */
export async function rememberProject(project, contract) {
  const spec = contract.body;
  const jobs = await Job.find({ projectId: project._id, status: "done" });
  const current = (kind) => jobs.filter((j) => j.kind === kind && j.contractHash === contract.hash);
  const reading = jobs.filter((j) => j.kind === "contract").at(-1);

  // The reading job reads every screenshot; each one's share of its time.
  const total = secondsOf(reading);
  const seconds = total === null ? null : Math.round((total / project.screenshots.length) * 10) / 10;
  for (const shot of project.screenshots) {
    if (shot.inventory) await keep("inventory", inventoryKey(shot.sha256), { payload: shot.inventory, provider: reading?.provider, seconds, project });
  }

  for (const job of current("frontend")) {
    const shot = project.screenshots[job.page - 1];
    if (!shot || !job.artifactPath) continue;
    const html = await readFile(path.join(REPO_ROOT, job.artifactPath), "utf8");
    const instructions = pageInstructions(spec, job.page);
    await keep("page", pageKey(shot.sha256, instructions), {
      payload: html,
      provider: job.provider,
      seconds: secondsOf(job),
      project,
      lookup: { ...(shot.dHash && { dHash: shot.dHash, dHashBands: bands(shot.dHash) }), instructionsHash: instructionsHash(instructions) },
    });
  }

  const backend = current("backend").at(-1);
  for (const c of backend?.custom ?? []) {
    const op = spec.operations.find((o) => o.name === c.operation);
    if (!c.ok || !op) continue;
    const code = await readFile(path.join(REPO_ROOT, backend.artifactPath, "backend", "custom", `${op.name}.js`), "utf8").catch(() => null);
    if (!code) continue;
    const fields = spec.entities.find((e) => e.name === op.entity).fields.map(({ name, type, options, ref }) => ({ name, type, options, ref }));
    await keep("custom", customKey(spec, op), { payload: code, provider: c.provider, seconds: c.seconds ?? null, project, lookup: { ...buttonShape(op), fields } });
  }
}

/** How many pieces of each kind this workspace (or the local scope) remembers; the library is not counted. */
export async function memoryCounts(owner) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const { _id, n } of await Memory.aggregate([{ $match: own(owner) }, { $group: { _id: "$kind", n: { $sum: 1 } } }])) counts[_id] = n;
  return counts;
}

/** Forgets everything this workspace (or the local scope) remembered; projects and the library stay. */
export async function forgetAll(owner) {
  return (await Memory.deleteMany(own(owner))).deletedCount;
}
