// Step 34a: live previews through MongoDB. The api service asks (requestPreview, waitPreview, requestStop);
// the preview service (ROLE=preview, or this process with ROLE=all) claims the request, runs the preview and
// says how it is doing. A running preview whose service has not been heard of for PREVIEW_STALE_MS is
// treated as gone: asking again starts it again.
import { Preview } from "./models/preview.js";

const STALE_MS = Number(process.env.PREVIEW_STALE_MS ?? 60_000);
const WAIT_MS = Number(process.env.PREVIEW_WAIT_MS ?? 3 * 60_000);
const POLL_MS = 150;
const LIVE = ["queued", "starting", "running"];

/** Asks for the preview of this version of the app (reuses one that is coming or running). */
export async function requestPreview({ projectId, hash, files, seed, auth }) {
  const existing = await Preview.findOne({ projectId }, { files: 0, seed: 0 }).lean();
  const fresh = Date.now() - STALE_MS;
  const usable =
    existing?.hash === hash &&
    !existing.stopRequested &&
    (["queued", "starting"].includes(existing.status) || (existing.status === "running" && existing.seenAt?.getTime() > fresh));
  if (usable) return existing;
  // A new or newer request: the service running an older one stops it when it sees this.
  await Preview.updateOne(
    { projectId },
    { $set: { hash, files, seed, auth, status: "queued", requestedAt: new Date(), stopRequested: false }, $unset: { token: 1, credentials: 1, worker: 1, seenAt: 1, error: 1 } },
    { upsert: true }
  );
  return Preview.findOne({ projectId }, { files: 0, seed: 0 }).lean();
}

/** Waits until the preview runs: { token, credentials }; throws when it failed or stopped. */
export async function waitPreview(projectId, { timeoutMs = WAIT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const doc = await Preview.findOne({ projectId }, { status: 1, token: 1, credentials: 1, error: 1 }).lean();
    if (doc?.status === "running") return { token: doc.token, credentials: doc.credentials ?? null };
    if (doc?.status === "failed") throw new Error(doc.error);
    if (!doc || doc.status === "stopped") throw new Error("The preview was stopped");
    if (Date.now() > deadline) throw new Error(doc.status === "queued" ? "no preview service picked it up: is one running (ROLE=preview)?" : "it took too long to start");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Asks for the preview to stop (the service that runs it does). */
export async function requestStop(projectId) {
  await Preview.updateOne({ projectId, status: "queued" }, { $set: { status: "stopped" }, $unset: { files: 1, seed: 1 } });
  await Preview.updateOne({ projectId, status: { $in: LIVE } }, { $set: { stopRequested: true } });
}

// ---- the preview service's side ----

/** The oldest waiting request, now this worker's (with its files and rows); or null. */
export async function claimPreview({ worker }) {
  return Preview.findOneAndUpdate({ status: "queued" }, { $set: { status: "starting", worker, seenAt: new Date() } }, { sort: { requestedAt: 1 }, returnDocument: "after" }).lean();
}

/** It runs: its address's secret and the throwaway sign-in. False when the request changed meanwhile. */
export async function markRunning({ projectId, hash, worker, token, credentials }) {
  const { modifiedCount } = await Preview.updateOne(
    { projectId, hash, worker, status: "starting" },
    { $set: { status: "running", token, credentials, seenAt: new Date() }, $unset: { files: 1, seed: 1 } }
  );
  return modifiedCount === 1;
}

export async function markFailed({ projectId, hash, worker, error }) {
  await Preview.updateOne({ projectId, hash, worker, status: "starting" }, { $set: { status: "failed", error: String(error).slice(0, 500) }, $unset: { files: 1, seed: 1 } });
}

/** It stopped (on request, idle, or at its time limit), unless a newer request has replaced it. */
export async function markStopped({ projectId, worker, token }) {
  await Preview.updateOne({ projectId, worker, token, status: "running" }, { $set: { status: "stopped", stopRequested: false } });
}

/** This worker is alive and still runs these previews. */
export async function heartbeat({ worker, projectIds }) {
  if (projectIds.length) await Preview.updateMany({ projectId: { $in: projectIds }, worker, status: "running" }, { $set: { seenAt: new Date() } });
}

/** What MongoDB now says about the previews this worker runs. */
export const previewsOf = (projectIds) => Preview.find({ projectId: { $in: projectIds } }, { projectId: 1, status: 1, token: 1, worker: 1, stopRequested: 1 }).lean();
