// Step 54a, region fix, in the Pages tab. Pure: tested in web/test/fix.test.js.

const MAX_LABEL = 100;

/**
 * The picker's message from the page's frame: { kind: "part", n, label }, { kind: "style", selector, label },
 * { error }, or null for anything else. The page is generated code, so its message is only a hint: the
 * Builder API checks the part again.
 */
export function pickFrom(event, frameWindow) {
  if (!frameWindow || event?.source !== frameWindow) return null;
  const d = event.data;
  if (!d || typeof d !== "object" || d.type !== "ak-pick") return null;
  if (typeof d.error === "string") return { error: d.error.slice(0, 200) };
  const label = typeof d.label === "string" ? d.label.slice(0, MAX_LABEL) : "";
  if (d.kind === "part" && Number.isInteger(d.n) && d.n > 0) return { kind: "part", n: d.n, label };
  if (d.kind === "style" && typeof d.selector === "string" && d.selector.length <= 200) return { kind: "style", selector: d.selector, label };
  return null;
}

/** { latest, kept, canUndo, fixing } for page n of the current spec. */
export function pageFixes(project, n) {
  const job = (project.jobs ?? []).filter((j) => j.kind === "frontend" && j.status === "done" && j.contractHash === project.contract?.hash && j.page === n).at(-1);
  const fixes = job?.fixes ?? [];
  const latest = fixes.at(-1) ?? null;
  return {
    latest,
    kept: fixes.filter((f) => f.status === "done").length,
    canUndo: (job?.revisions?.length ?? 0) > 0,
    fixing: project.state === "REPAIRING" || ["queued", "running"].includes(latest?.status),
  };
}

const PROVIDERS = { local: "local AI", cloud: "Gemini" };

/** One line about a fix, in plain words. */
export function fixWords(fix) {
  if (!fix) return null;
  if (["queued", "running"].includes(fix.status)) return `Fixing ${fix.label}… (then the page is checked again)`;
  if (fix.status === "done") {
    const how = [PROVIDERS[fix.provider] ?? fix.provider, fix.seconds != null && `${fix.seconds} s`].filter(Boolean).join(", ");
    return `Fixed ${fix.label}: “${fix.note}”${how ? ` (${how})` : ""}`;
  }
  if (fix.status === "failed") return `Couldn't fix ${fix.label}: ${fix.problem ?? "no answer"}. The page is as it was.`;
  return `Undone: ${fix.label} (“${fix.note}”)`;
}
