// Step 22: project leases in MongoDB, instead of "which projects is this process building" in memory.
// A Builder API builds a project only while it holds the project's lease: taken with one atomic update,
// renewed while it works, given back when done. Two Builder APIs on one database (the two production
// servers, or a restart) never build the same project at once, and a project whose builder died is taken
// over once its lease runs out.
import { Project } from "./models/project.js";

const UNFINISHED = ["UPLOADED", "CONTRACT_DRAFT", "BUILDING", "SYNCED", "INTEGRATING", "VERIFYING"];
const free = (now) => ({ $or: [{ "lease.until": { $exists: false } }, { "lease.until": null }, { "lease.until": { $lt: new Date(now) } }] });

/** Takes the project's lease for `ms` when it is free (or already ours). True when we hold it now. */
export async function claimProject(id, { owner, now = Date.now(), ms }) {
  const taken = await Project.findOneAndUpdate(
    { _id: id, $or: [...free(now).$or, { "lease.owner": owner }] },
    { $set: { lease: { owner, until: new Date(now + ms) } } },
    { returnDocument: "after", projection: { _id: 1 } }
  );
  return Boolean(taken);
}

/** Moves the lease's end on while working. False when the lease is no longer ours (it ran out and was taken). */
export async function renewLease(id, { owner, now = Date.now(), ms }) {
  const { modifiedCount } = await Project.updateOne({ _id: id, "lease.owner": owner }, { $set: { "lease.until": new Date(now + ms) } });
  return modifiedCount === 1;
}

/** Gives the lease back. { rerun } says whether someone asked to look again meanwhile; null if it wasn't ours. */
export async function releaseProject(id, { owner }) {
  const before = await Project.findOneAndUpdate({ _id: id, "lease.owner": owner }, { $unset: { lease: 1 }, $set: { rerun: false } }, { projection: { rerun: 1 } });
  return before ? { rerun: Boolean(before.rerun) } : null;
}

/** Asks whoever holds the project to look at it again when they are done (e.g. the spec was edited). */
export const askRerun = (id) => Project.updateOne({ _id: id }, { $set: { rerun: true } });

/** Unfinished projects nobody holds (or whose lease ran out): what a Builder API may pick up. */
export async function freeProjects({ now = Date.now() } = {}) {
  const rows = await Project.find({ state: { $in: UNFINISHED }, ...free(now) }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

/** A Builder API stopped on purpose (Ctrl+C, a deploy) gives every project it holds back, so a restart can
 *  continue them at once instead of waiting for the leases to run out. Returns how many it gave back. */
export async function releaseAll({ owner }) {
  const { modifiedCount } = await Project.updateMany({ "lease.owner": owner }, { $unset: { lease: 1 } });
  return modifiedCount;
}
