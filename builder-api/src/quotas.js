// Step 32b: quotas and fair scheduling. A workspace's plan (free or pro) allows a number of builds in a window
// of days (a new project is a build). Past it, a new build is refused with a plain sentence and the time the
// next one is possible. Pro projects are picked up first.
import { Project } from "./models/project.js";

const DAY = 86_400_000;
export const priorityOf = (plan) => (plan === "pro" ? 1 : 0);

/** { plan, used, limit, days, resetsAt }: resetsAt is when the next build is possible, or null if it is now. */
export async function quotaOf(workspace, quotas, now = Date.now()) {
  const plan = workspace?.plan === "pro" ? "pro" : "free";
  const { builds: limit, days } = quotas[plan];
  const since = new Date(now - days * DAY);
  const counted = await Project.find({ workspaceId: workspace._id, createdAt: { $gte: since } }, { createdAt: 1 }).sort({ createdAt: 1 }).lean();
  const used = counted.length;
  // Past the limit, the next build is possible once enough of the counted ones are older than the window.
  const freeing = used >= limit ? counted[used - limit] : null;
  const resetsAt = used < limit ? null : freeing ? new Date(freeing.createdAt.getTime() + days * DAY) : null;
  return { plan, used, limit, days, resetsAt };
}

const when = (date) => `${date.toUTCString().slice(5, 22)} UTC`;

/** The refusal, in one plain sentence. */
export function quotaMessage({ plan, used, limit, days, resetsAt }) {
  const window = days === 1 ? "a day" : `every ${days} days`;
  const next = resetsAt ? ` The next build is possible on ${when(resetsAt)}.` : "";
  return `The ${plan} plan builds ${limit} apps ${window}, and this workspace has built ${used}.${next}`;
}

/** Which of the waiting projects (already pro first, then oldest) to start now, given this process's room. */
export function toStart(ids, { active, parallel }) {
  const room = Math.max(0, parallel - active.size);
  return ids.filter((id) => !active.has(String(id))).slice(0, room);
}
