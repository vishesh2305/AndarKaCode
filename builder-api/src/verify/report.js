// The Verifier's report as plain text: verify-report.md in the downloaded zip, and the project's error line.
const MARK = { pass: "✓", fail: "✗", warn: "!", note: "i", skip: "–" };
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function reportMarkdown(report, { version, hash } = {}) {
  const failed = report.checks.filter((c) => c.status === "fail");
  const lines = [
    "# Verify report",
    "",
    `Checked by AndarKaCode${version ? ` for spec version ${version}` : ""}${hash ? ` (fingerprint \`${String(hash).slice(0, 12)}\`)` : ""}, in ${report.seconds} s.`,
    "The app was started on a throwaway database and every page was used like a person would; then the app's own tests ran.",
    "",
    failed.length ? `**${failed.length} check${failed.length === 1 ? "" : "s"} failed.**` : "**All checks passed.**",
    "",
    "| | Check | Page | What happened | Layer |",
    "|---|---|---|---|---|",
    ...report.checks.map((c) => `| ${MARK[c.status] ?? "?"} | ${cell(c.title)} | ${c.page ?? ""} | ${cell(c.detail)} | ${c.layer ?? ""} |`),
    "",
    "Layer: **page** = the page did not send something or lacks an input; **spec** = the backend's rules (made from the spec) refused what the page offers; **backend** = the server answered with an error.",
  ];
  return lines.join("\n") + "\n";
}

/** One line for the project's error: how many failed, and the first one. */
export function failureLine(report) {
  const failed = report.checks.filter((c) => c.status === "fail");
  const first = failed[0];
  return `${failed.length} check${failed.length === 1 ? "" : "s"} failed. First: ${first.title}${first.page ? ` (page ${first.page})` : ""}: ${first.detail}`;
}
