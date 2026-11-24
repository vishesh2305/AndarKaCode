// Step 35: review. The orchestrator holds a project whose screenshots look like a phishing clone
// (brands.js) right after reading, before any page is drawn or any model paid for. A reviewer (npm run
// review) then releases it, and it is built like any other project, or blocks it: no preview, no download.
// Every step goes to the audit log, with who and why.
import { audit } from "../audit.js";
import { Project } from "../models/project.js";
import { Report } from "../models/report.js";
import { requestStop } from "../preview-queue.js";
import { flagsOf } from "./brands.js";

export const HELD_MESSAGE = (flags) =>
  `Held for review: ${flags.map((f) => f.reason).join("; ")}. It looks like it could copy another organisation's login or payment page, so a person will look at it before it is built (usually within a day). If it is your own organisation's, say so with "Report a problem".`;

/** After reading: holds the project when its screenshots are flagged (and nobody released it). True when held. */
export async function holdIfFlagged(project) {
  if (["released"].includes(project.review?.status)) return false;
  const flags = flagsOf((project.screenshots ?? []).map((s) => s.inventory));
  if (!flags.length) return false;
  project.review = { status: "held", flags, at: new Date() };
  project.state = "HELD";
  project.error = HELD_MESSAGE(flags);
  await project.save();
  await audit("review.held", { actor: { service: "orchestrator" }, workspaceId: project.workspaceId, target: { kind: "project", id: project.id }, details: { flags } });
  return true;
}

async function decide(projectId, { status, by, note, state }) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error(`No project ${projectId}`);
  const from = project.state;
  project.review = { ...(project.review ?? {}), status, by, note, at: new Date() };
  project.markModified("review");
  if (state) project.state = state;
  if (status === "released") project.error = undefined;
  if (status === "blocked") project.error = `This project was blocked after a review${note ? `: ${note}` : ""}.`;
  await project.save();
  await audit(`review.${status}`, { actor: { email: by, service: "review script" }, workspaceId: project.workspaceId, target: { kind: "project", id: project.id }, details: { note, from } });
  return project;
}

/** A held project goes on being built (from its spec); a project that is not held is only marked released. */
export async function releaseProject(projectId, { by, note } = {}) {
  const project = await Project.findById(projectId, { state: 1 }).lean();
  return decide(projectId, { status: "released", by, note, state: project?.state === "HELD" ? "CONTRACT_DRAFT" : null });
}

/** No preview and no download any more; a running preview is stopped. */
export async function blockProject(projectId, { by, note } = {}) {
  const project = await decide(projectId, { status: "blocked", by, note, state: "BLOCKED" });
  await requestStop(project.id).catch(() => {});
  return project;
}

/** The projects waiting for a review, oldest first. */
export const listHeld = () => Project.find({ state: "HELD" }, { name: 1, workspaceId: 1, review: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean();

/** Reports ("open" by default), oldest first: [{ id, reporter, projectId, url, reason, status, createdAt }]. */
export async function listReports({ status = "open" } = {}) {
  return (await Report.find(status ? { status } : {}).sort({ createdAt: 1 }).lean()).map(({ _id, ...r }) => ({ id: String(_id), ...r }));
}

export async function closeReport(id, { by, note } = {}) {
  const report = await Report.findByIdAndUpdate(id, { $set: { status: "closed", closedBy: by, note } }, { returnDocument: "after" });
  if (!report) throw new Error(`No report ${id}`);
  await audit("report.close", { actor: { email: by, service: "review script" }, target: { kind: "report", id }, details: { note } });
  return report;
}
