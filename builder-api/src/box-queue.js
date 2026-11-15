// Step 33c: the box queue (VERIFY_LANE=queue), like the page queue (Step 26). The orchestrator submits
// "verify" and "press" work and waits for the answer; verifier services claim it with a lease (one atomic
// update), so each job runs once, and a dead verifier's job goes back to the queue when its lease runs out.
import { BoxJob } from "./models/box-job.js";

const POLL_MS = Number(process.env.BOX_POLL_MS ?? 500);
const WAIT_MS = Number(process.env.BOX_WAIT_MS ?? 30 * 60_000);

/** Queues work; resolves to its id. */
export async function submitBoxJob({ kind, input, priority = 0 }) {
  const job = await BoxJob.create({ kind, input, priority });
  return job.id;
}

/** Waits for the answer: the result, or the job's error thrown. */
export async function waitBoxJob(id, { pollMs = POLL_MS, timeoutMs = WAIT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await BoxJob.findById(id, { status: 1, result: 1, error: 1 }).lean();
    if (!job) throw new Error(`The ${id} box job is gone`);
    if (job.status === "done") return job.result ?? null;
    if (job.status === "failed") throw new Error(job.error);
    if (Date.now() > deadline) {
      const why = job.status === "queued" ? "no verifier service picked it up: is one running (ROLE=verifier)?" : "the verifier did not finish it";
      throw new Error(`Waited ${Math.round(timeoutMs / 60_000)} min for the app to be checked: ${why}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** The waiting job of highest priority, then oldest (or one whose lease ran out), for this worker; or null. */
export async function claimBoxJob({ worker, now = Date.now(), ms }) {
  const job = await BoxJob.findOneAndUpdate(
    { $or: [{ status: "queued" }, { status: "running", leaseUntil: { $lt: new Date(now) } }] },
    { $set: { status: "running", worker, leaseUntil: new Date(now + ms), startedAt: new Date(now) } },
    { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
  ).lean();
  return job && { id: String(job._id), kind: job.kind, input: job.input };
}

/** Keeps the job while it runs. False when the lease is no longer this worker's. */
export async function renewBoxJob(id, { worker, now = Date.now(), ms }) {
  const { modifiedCount } = await BoxJob.updateOne({ _id: id, status: "running", worker }, { $set: { leaseUntil: new Date(now + ms) } });
  return modifiedCount === 1;
}

/** Hands the answer back. False when this worker no longer holds the job. */
export async function finishBoxJob(id, { worker, result }) {
  const { modifiedCount } = await BoxJob.updateOne({ _id: id, status: "running", worker }, { $set: { status: "done", result: result ?? null, finishedAt: new Date() }, $unset: { leaseUntil: 1 } });
  return modifiedCount === 1;
}

/** Says the job could not be done, and why. */
export async function failBoxJob(id, { worker, error }) {
  const { modifiedCount } = await BoxJob.updateOne(
    { _id: id, status: "running", worker },
    { $set: { status: "failed", error: String(error).slice(0, 1000), finishedAt: new Date() }, $unset: { leaseUntil: 1 } }
  );
  return modifiedCount === 1;
}
