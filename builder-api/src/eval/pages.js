// Step 18.1: the page exam (docs/production-architecture.md §7, Stage 1). The same mock screenshots and
// the same fixed spec for every way of building pages, so two runs differ only in the page builder.
// Each page gets its time, its markers (raw: what the builder drew; after repair: what the Verifier
// would say in production) and a score the user gives by eye on the review page.
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const PROMPTS = ["plain", "strict"]; // strict: extra rules for button styles and exact text (Step 18.3)

/** [--method s2c|single] [--mode ...] [--read ...] [--prompt plain|strict] [--specs-only] [case] */
export function parseArgs(argv) {
  const options = { method: "s2c", mode: "cloud", read: "auto", prompt: "plain", specsOnly: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--method" || arg === "--mode" || arg === "--read" || arg === "--prompt") options[arg.slice(2)] = argv[++i];
    else if (arg === "--specs-only") options.specsOnly = true;
    else options.only = arg;
  }
  if (!METHODS.includes(options.method)) throw new Error(`Unknown method "${options.method}": use ${METHODS.join(", ")}`);
  for (const key of ["mode", "read"]) {
    if (!MODES.includes(options[key])) throw new Error(`Unknown ${key} "${options[key]}": use ${MODES.join(", ")}`);
  }
  if (!PROMPTS.includes(options.prompt)) throw new Error(`Unknown prompt "${options.prompt}": use ${PROMPTS.join(", ")}`);
  if (options.prompt === "strict" && options.method !== "single") throw new Error("The strict prompt is for --method single (Screenshot-to-Code writes its own prompt)");
  if (options.only && !PAGE_CASES[options.only]) throw new Error(`Unknown case "${options.only}": use ${Object.keys(PAGE_CASES).join(", ")}`);
  return options;
}

/** A headless Chrome/Edge command line for a 1280x800 picture of a built page, after its Tailwind script ran. */
export const shotArgs = ({ html, png }) => [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--screenshot=${png}`,
  "--window-size=1280,800",
  "--virtual-time-budget=8000",
  pathToFileURL(html).href,
];

/** Where Chrome or Edge may be, SHOT_BROWSER first. The exam uses the first one that exists. */
export function browserCandidates(platform, env) {
  const list = env.SHOT_BROWSER ? [env.SHOT_BROWSER] : [];
  if (platform === "win32") {
    for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean)) {
      list.push(path.win32.join(root, "Google/Chrome/Application/chrome.exe"), path.win32.join(root, "Microsoft/Edge/Application/msedge.exe"));
    }
  } else if (platform === "darwin") {
    list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    list.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }
  return list;
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
      : r.shot
        ? `<a href="${escape(r.file)}" title="open the live page"><img src="${escape(r.shot)}" alt="page built from ${escape(r.screen)}"></a>`
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
