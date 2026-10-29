// Step 18.1: the page exam with a REAL page builder (src/eval/pages.js has the tested parts).
// Usage (builder-api/): npm run eval:pages -- [--method s2c|single] [--mode local|cloud|auto] [--read local|cloud|auto] [caseName]
// Not part of `npm test`: model output varies and a page takes minutes.
// Each case's spec is read once and kept in samples/mocks/specs/ (commit it), so every method and every
// laptop is tested on the same spec. Results go to samples/mocks/results/pages/<run>/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { contractHash } from "../../shared/hash.mjs";
import { buildPage } from "../src/ai/page.js";
import { PAGE_CASES, parseArgs, resultsTable, reviewHtml, runHash, scorePage } from "../src/eval/pages.js";
import { getFrontend, submitFrontend } from "../src/gateway-client.js";
import { checkSpec } from "../src/spec/check.js";
import { deriveSpec } from "../src/spec/derive.js";
import { pageInstructions } from "../src/spec/instructions.js";
import { readInventory } from "../src/spec/inventory.js";
import { REPO_ROOT, shrinkScreenshot } from "../src/storage.js";

const MOCKS = path.join(REPO_ROOT, "samples/mocks");
const SPECS = path.join(MOCKS, "specs");
const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60_000; // a local page can take 5 min; anything past 15 min counts as failed

const options = parseArgs(process.argv.slice(2));
const runId = `${options.method}-${options.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = path.join(MOCKS, "results/pages", runId);
await mkdir(outDir, { recursive: true });

const shrunk = async (screen) => (await shrinkScreenshot(await readFile(path.join(MOCKS, `${screen}.png`)))).data;

/** The case's fixed spec: from samples/mocks/specs/, or read once now and kept there. */
async function fixedSpec(name, screens) {
  const file = path.join(SPECS, `${name}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")).spec;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const inventories = [];
  const providers = [];
  for (const screen of screens) {
    const { inventory, provider } = await readInventory((await shrunk(screen)).toString("base64"), { mode: options.read });
    inventories.push(inventory);
    providers.push(provider);
  }
  const spec = deriveSpec(inventories);
  const problems = checkSpec(spec);
  if (problems.length) throw new Error(`Spec problems: ${problems.join("; ")}`);
  await mkdir(SPECS, { recursive: true });
  await writeFile(file, JSON.stringify({ readBy: providers, readAt: new Date().toISOString(), inventories, spec }, null, 2) + "\n");
  console.log(`  spec read by ${providers.join("+")} and kept in samples/mocks/specs/${name}.json (commit it)`);
  return spec;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page builders. Each: { image (PNG buffer), instructions, hash } -> { html, provider }.
const BUILDERS = {
  async s2c({ image, instructions, hash }) {
    const { jobId } = await submitFrontend({ imageDataUrl: `data:image/png;base64,${image.toString("base64")}`, instructions, contractHash: hash, mode: options.mode });
    for (const started = Date.now(); Date.now() - started < MAX_WAIT_MS; ) {
      await sleep(POLL_MS);
      const remote = await getFrontend(jobId);
      if (remote.status === "done") return { html: remote.html, provider: remote.provider };
      if (remote.status === "failed") throw new Error(`Screenshot-to-Code failed: ${remote.error}`);
    }
    throw new Error(`no page after ${MAX_WAIT_MS / 60_000} min`);
  },
  // One model call from this computer: Ollama here for local, Gemini for cloud (no Gateway, no Laptop B).
  single: ({ image, instructions }) => buildPage({ imageB64: image.toString("base64"), instructions, mode: options.mode }),
};

const rows = [];
async function save() {
  await writeFile(path.join(outDir, "results.json"), JSON.stringify(rows, null, 2) + "\n");
  await writeFile(path.join(outDir, "results.md"), `# Page exam: ${runId}\n\n${resultsTable(rows)}`);
  await writeFile(path.join(outDir, "review.html"), reviewHtml(rows, { mocksDir: "../../.." }));
}

console.log(`Page exam ${runId}`);
for (const [name, screens] of Object.entries(PAGE_CASES)) {
  if (options.only && name !== options.only) continue;
  console.log(`\n${name}`);
  let spec;
  try {
    spec = await fixedSpec(name, screens);
  } catch (err) {
    console.log(`  FAILED to get a spec: ${err.message.slice(0, 300)}`);
    continue;
  }
  const hash = runHash(contractHash(spec), runId);
  for (const { screenshot: n } of spec.pages) {
    const screen = screens[n - 1];
    const row = { case: name, screen, page: n, method: options.method, mode: options.mode };
    const started = Date.now();
    try {
      const { html, provider } = await BUILDERS[options.method]({ image: await shrunk(screen), instructions: pageInstructions(spec, n), hash });
      row.seconds = (Date.now() - started) / 1000;
      row.provider = provider;
      row.file = `${screen}.${options.method}.html`;
      await writeFile(path.join(outDir, row.file), html);
      Object.assign(row, await scorePage({ spec, n, html }));
      console.log(`  page ${n}: ${row.seconds.toFixed(1)} s, markers ${row.present}/${row.total}, Check after repair ${row.check} (${provider})`);
    } catch (err) {
      row.seconds = (Date.now() - started) / 1000;
      row.error = err.message.slice(0, 300);
      console.log(`  page ${n}: FAILED after ${row.seconds.toFixed(1)} s: ${row.error}`);
    }
    rows.push(row);
    await save(); // after every page, so a stopped run keeps what it measured
  }
}

console.log(`\n${rows.filter((r) => !r.error).length}/${rows.length} pages built. Open to score by eye:\n  ${path.join(outDir, "review.html")}`);
