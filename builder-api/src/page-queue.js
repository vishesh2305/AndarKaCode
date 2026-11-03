// Step 26: the page queue (PAGE_LANE=queue), for production where there is no Laptop B. The orchestrator
// uses submitPage/getPage exactly like the Gateway's submitFrontend/getFrontend; ui-worker services use
// claimPageJob/renewPageJob/finishPageJob/failPageJob. A claim is one atomic update with a lease, so each
// page is drawn by one worker, and a dead worker's page goes back to the queue once its lease runs out.
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { blobs } from "./blobs.js";
import { PageJob } from "./models/page-job.js";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const notFound = () => Object.assign(new Error("No such page job"), { status: 404 });

/** Queues a page (the same screenshot and spec give the same job, unless it failed). Like submitFrontend. */
export async function submitPage({ imageDataUrl, instructions, contractHash, mode }) {
  const key = sha256(`${sha256(imageDataUrl)}|${contractHash}`);
  const existing = await PageJob.findOne({ key, status: { $ne: "failed" } }).sort({ createdAt: -1 });
  if (existing) return { jobId: existing.id, status: existing.status };
  const image = Buffer.from(imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, ""), "base64");
  const job = await PageJob.create({ key, imageKey: await blobs.put(image), instructions, contractHash, mode });
  return { jobId: job.id, status: job.status };
}

/** How the page is going; the HTML once it is done. Like getFrontend; a job it doesn't know is a 404. */
export async function getPage(jobId) {
  const job = mongoose.isValidObjectId(jobId) ? await PageJob.findById(jobId).lean() : null;
  if (!job) throw notFound();
  return {
    jobId: String(job._id),
    status: job.status,
    provider: job.provider,
    contractHash: job.contractHash,
    ...(job.status === "done" && { html: (await blobs.get(job.htmlKey)).toString("utf8"), usage: job.usage ?? [] }),
    ...(job.status === "failed" && { error: job.error }),
  };
}

/** The oldest waiting page (or one whose worker's lease ran out) for this worker, with its screenshot; or null. */
export async function claimPageJob({ worker, now = Date.now(), ms }) {
  const job = await PageJob.findOneAndUpdate(
    { $or: [{ status: "queued" }, { status: "running", leaseUntil: { $lt: new Date(now) } }] },
    { $set: { status: "running", worker, leaseUntil: new Date(now + ms), startedAt: new Date(now) } },
    { sort: { createdAt: 1 }, returnDocument: "after" }
  ).lean();
  if (!job) return null;
  return { id: String(job._id), image: await blobs.get(job.imageKey), instructions: job.instructions, mode: job.mode, contractHash: job.contractHash };
}

/** Keeps the page while drawing it. False when the lease is no longer this worker's. */
export async function renewPageJob(id, { worker, now = Date.now(), ms }) {
  const { modifiedCount } = await PageJob.updateOne({ _id: id, status: "running", worker }, { $set: { leaseUntil: new Date(now + ms) } });
  return modifiedCount === 1;
}

/** Hands the drawn page back. False when this worker no longer holds it (it was taken over). */
export async function finishPageJob(id, { worker, html, provider, usage }) {
  const htmlKey = await blobs.put(html);
  const { modifiedCount } = await PageJob.updateOne(
    { _id: id, status: "running", worker },
    { $set: { status: "done", htmlKey, provider, usage, finishedAt: new Date() }, $unset: { leaseUntil: 1 } }
  );
  return modifiedCount === 1;
}

/** Says the page could not be drawn, and why. */
export async function failPageJob(id, { worker, error }) {
  const { modifiedCount } = await PageJob.updateOne(
    { _id: id, status: "running", worker },
    { $set: { status: "failed", error: String(error).slice(0, 500), finishedAt: new Date() }, $unset: { leaseUntil: 1 } }
  );
  return modifiedCount === 1;
}
