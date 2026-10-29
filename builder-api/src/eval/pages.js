// Step 18.1: the page exam (docs/production-architecture.md §7, Stage 1). The same mock screenshots and
// the same fixed spec for every way of building pages, so two runs differ only in the page builder.
// Each page gets its time, its markers (raw: what the builder drew; after repair: what the Verifier
// would say in production) and a score the user gives by eye on the review page.
import { createHash } from "node:crypto";
import { expectedMarkers, markerCheck, missingMarkers, pageMarkers } from "../verify/markers.js";
import { apiMap } from "../wirer/index.js";

/** case -> its screenshots (samples/mocks/<screen>.png); one spec per case, one page per screenshot. */
export const PAGE_CASES = {
  "m1-edit-delete": ["m1-edit-delete"],
  "m2-add-search-page": ["m2-add-search-page"],
  "m3-dashboard": ["m3-dashboard"],
  "m4-login": ["m4-login"],
  "m5-relation": ["m5a-employees-dept", "m5b-departments"],
  "m6-approve": ["m6-approve"],
  "m7-custom-buttons": ["m7-custom-buttons"],
  "m8-staff-raise": ["m8-staff-raise"],
};

export const METHODS = ["s2c", "single"]; // single: one model call per page (src/ai/page.js, Step 18.2)
const MODES = ["local", "cloud", "auto"];

/** [--method s2c] [--mode local|cloud|auto] [--read local|cloud|auto] [case] */
export function parseArgs(argv) {
  const options = { method: "s2c", mode: "cloud", read: "auto", only: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--method" || arg === "--mode" || arg === "--read") options[arg.slice(2)] = argv[++i];
    else options.only = arg;
  }
  if (!METHODS.includes(options.method)) throw new Error(`Unknown method "${options.method}": use ${METHODS.join(", ")}`);
  for (const key of ["mode", "read"]) {
    if (!MODES.includes(options[key])) throw new Error(`Unknown ${key} "${options[key]}": use ${MODES.join(", ")}`);
  }
  if (options.only && !PAGE_CASES[options.only]) throw new Error(`Unknown case "${options.only}": use ${Object.keys(PAGE_CASES).join(", ")}`);
  return options;
}

/** The Gateway hands back a page it already drew for the same (image, hash): each run asks with its own hash. */
export const runHash = (contractHash, runId) => createHash("sha256").update(`${contractHash}|${runId}`).digest("hex");

/** { present, total, missing, check }: raw markers on the page, and the Check after the binder's repair. */
export async function scorePage({ spec, n, html }) {
  const expected = expectedMarkers(spec, n);
  const total = expected.fields.length + expected.actions.length + expected.filters.length + expected.stats.length;
  const missing = missingMarkers(expected, await pageMarkers(html));
  const repaired = await pageMarkers(html, { map: apiMap(spec), file: `page-${n}.html` });
  return { present: total - missing.length, total, missing, check: markerCheck(expected, repaired).status };
}

const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

/** The results as a Markdown table; the score column stays blank for the user to fill in. */
export function resultsTable(rows) {
  const lines = [
    "| Screenshot | Page | Method | Provider | Seconds | Markers | Check after repair | Your score (1–5) | Missing |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const built = !r.error;
    const markers = built ? `${r.present}/${r.total}` : "—";
    const check = built ? r.check : "not built";
    const missing = built ? (r.missing.length ? r.missing.join("; ") : "—") : r.error;
    lines.push(`| ${r.screen} | ${r.page} | ${r.method} | ${r.provider ?? "—"} | ${r.seconds.toFixed(1)} | ${markers} | ${check} |  | ${cell(missing)} |`);
  }
  return lines.join("\n") + "\n";
}

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** A page that shows each screenshot (from mocksDir) next to the page built from it. */
export function reviewHtml(rows, { mocksDir }) {
  const sections = rows.map((r) => {
    const title = `${escape(r.screen)}: page ${r.page}, ${escape(r.method)} (${escape(r.provider ?? r.mode)}), ${r.seconds.toFixed(1)} s`;
    const built = r.error
      ? `<p class="failed">not built: ${escape(r.error)}</p>`
      : `<iframe src="${escape(r.file)}" title="page built from ${escape(r.screen)}"></iframe>`;
    const summary = r.error ? "" : `<p>Markers ${r.present}/${r.total} · Check after repair: ${escape(r.check)}</p>`;
    return `<section><h2>${title}</h2>${summary}<div class="pair"><img src="${escape(mocksDir)}/${escape(r.screen)}.png" alt="screenshot ${escape(r.screen)}">${built}</div></section>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Page exam review</title>
<style>
body { font-family: system-ui, sans-serif; margin: 16px; background: #fff; color: #111; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pair img, .pair iframe { width: 100%; height: 640px; object-fit: contain; object-position: top; border: 1px solid #ccc; }
.failed { color: #a00; }
</style></head><body>
<h1>Page exam review</h1>
<p>Left: the screenshot. Right: the page built from it. Give each page a score from 1 (nothing like it) to 5 (same look) in results.md.</p>
${sections.join("\n")}
</body></html>
`;
}
