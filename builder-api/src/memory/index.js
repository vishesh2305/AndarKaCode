// Step 14: memory. A project that reaches READY leaves its verified work behind (readings, pages, custom
// code); a later project with the same screenshot, page instructions or button reuses it instead of asking
// the vision AI, Laptop B or the coding AI again. Memory never adds anything: what is reused is exactly
// what the same input produced before, and a reused page or code still goes through the Check.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Job } from "../models/job.js";
import { Memory } from "../models/memory.js";
import { pageInstructions } from "../spec/instructions.js";
import { REPO_ROOT } from "../storage.js";
import { customKey, inventoryKey, pageKey } from "./keys.js";

const KINDS = ["inventory", "page", "custom"];
const secondsOf = (job) => (job?.startedAt && job.finishedAt ? Math.round((job.finishedAt - job.startedAt) / 100) / 10 : null);

/** The remembered work for this key, or null. */
export const recall = (kind, key) => Memory.findOne({ kind, key }).lean();

/** What a reused piece says about where it came from (kept on the job). */
export const origin = (memory) => ({ sourceProjectId: memory.sourceProjectId, sourceName: memory.sourceName, seconds: memory.seconds ?? null });

// Keeps the first project's work: a later identical piece doesn't replace its source.
const keep = (kind, key, { payload, provider, seconds, project }) =>
  Memory.updateOne(
    { kind, key },
    { $setOnInsert: { kind, key, payload, provider: provider ?? null, seconds, sourceProjectId: project._id, sourceName: project.name } },
    { upsert: true }
  );

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
    await keep("page", pageKey(shot.sha256, pageInstructions(spec, job.page)), { payload: html, provider: job.provider, seconds: secondsOf(job), project });
  }

  const backend = current("backend").at(-1);
  for (const c of backend?.custom ?? []) {
    const op = spec.operations.find((o) => o.name === c.operation);
    if (!c.ok || !op) continue;
    const code = await readFile(path.join(REPO_ROOT, backend.artifactPath, "backend", "custom", `${op.name}.js`), "utf8").catch(() => null);
    if (code) await keep("custom", customKey(spec, op), { payload: code, provider: c.provider, seconds: c.seconds ?? null, project });
  }
}

/** How many pieces of each kind are remembered. */
export async function memoryCounts() {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const { _id, n } of await Memory.aggregate([{ $group: { _id: "$kind", n: { $sum: 1 } } }])) counts[_id] = n;
  return counts;
}

/** Forgets everything remembered (projects are not touched). */
export async function forgetAll() {
  return (await Memory.deleteMany({})).deletedCount;
}
