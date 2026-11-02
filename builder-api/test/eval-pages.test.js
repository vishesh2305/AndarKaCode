// Step 18.1: the page exam. The same mock screenshots and the same fixed spec for every way of building
// pages, so the only thing that changes between two runs is the page builder. Each page gets its time,
// its markers (raw, then after the binder's repair) and a score the user gives by eye.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { browserCandidates, PAGE_CASES, parseArgs, resultsTable, reviewHtml, runHash, runPool, scorePage, shotArgs } from "../src/eval/pages.js";
import { REPO_ROOT } from "../src/storage.js";
import { employeesSpec } from "./fixtures/page-specs.js";
import { page } from "./helpers/page.js";

const HASH = "c".repeat(64);

describe("PAGE_CASES: the exam questions", () => {
  it("are the 8 sample mocks, every screenshot of them on disk", () => {
    assert.deepEqual(Object.keys(PAGE_CASES), [
      "m1-edit-delete",
      "m2-add-search-page",
      "m3-dashboard",
      "m4-login",
      "m5-relation",
      "m6-approve",
      "m7-custom-buttons",
      "m8-staff-raise",
    ]);
    for (const screens of Object.values(PAGE_CASES)) {
      for (const screen of screens) assert.ok(existsSync(path.join(REPO_ROOT, "samples/mocks", `${screen}.png`)), screen);
    }
  });

  it("keep the two relation screens together, so one spec links employees to departments", () => {
    assert.deepEqual(PAGE_CASES["m5-relation"], ["m5a-employees-dept", "m5b-departments"]);
  });
});

describe("parseArgs: what to run", () => {
  it("defaults to every case, S2C, cloud models, specs read by whichever model is available", () => {
    assert.deepEqual(parseArgs([]), { method: "s2c", mode: "cloud", read: "auto", prompt: "plain", thinking: "default", parallel: 1, specsOnly: false, only: null });
  });

  it("takes the method, the mode, the reading mode and one case", () => {
    assert.deepEqual(parseArgs(["--method", "s2c", "--mode", "local", "--read", "local", "m1-edit-delete"]), {
      method: "s2c",
      mode: "local",
      read: "local",
      prompt: "plain",
      thinking: "default",
      parallel: 1,
      specsOnly: false,
      only: "m1-edit-delete",
    });
  });

  it("knows the single-call builder (Step 18.2)", () => {
    assert.equal(parseArgs(["--method", "single"]).method, "single");
  });

  it("takes the strict prompt for the single-call builder (Step 18.3)", () => {
    assert.equal(parseArgs(["--method", "single", "--prompt", "strict"]).prompt, "strict");
  });

  it("refuses the strict prompt for S2C, which writes its own prompt", () => {
    assert.throws(() => parseArgs(["--prompt", "strict"]), /strict prompt.*--method single/);
  });

  it("builds N pages at the same time with --parallel N (Step 18.4)", () => {
    assert.equal(parseArgs(["--method", "single", "--parallel", "9"]).parallel, 9);
  });

  it("refuses --parallel that is not a whole number from 1 to 20", () => {
    for (const bad of ["0", "-2", "1.5", "many", "21"]) assert.throws(() => parseArgs(["--parallel", bad]), /parallel.*1 to 20/, bad);
  });

  it("takes --thinking low for the single call on Gemini, and refuses it for S2C", () => {
    assert.equal(parseArgs(["--method", "single", "--thinking", "low"]).thinking, "low");
    assert.throws(() => parseArgs(["--thinking", "low"]), /--thinking.*--method single/);
    assert.throws(() => parseArgs(["--method", "single", "--thinking", "none"]), /thinking.*default, low/);
  });

  it("can read and keep the specs only, without building pages", () => {
    assert.equal(parseArgs(["--specs-only", "m2-add-search-page"]).specsOnly, true);
    assert.equal(parseArgs(["--specs-only", "m2-add-search-page"]).only, "m2-add-search-page");
  });

  it("refuses an unknown method, mode or case, and says what is allowed", () => {
    assert.throws(() => parseArgs(["--method", "magic"]), /method.*s2c, single/);
    assert.throws(() => parseArgs(["--mode", "fast"]), /mode.*local, cloud, auto/);
    assert.throws(() => parseArgs(["m9-nothing"]), /case.*m1-edit-delete/);
    assert.throws(() => parseArgs(["--method", "single", "--prompt", "loud"]), /prompt.*plain, strict/);
  });
});

describe("runHash: a fresh page every run", () => {
  it("is a 64-character hash, the same for the same run and different for another run", () => {
    assert.match(runHash(HASH, "run-1"), /^[a-f0-9]{64}$/);
    assert.equal(runHash(HASH, "run-1"), runHash(HASH, "run-1"));
    assert.notEqual(runHash(HASH, "run-1"), runHash(HASH, "run-2"));
    assert.notEqual(runHash(HASH, "run-1"), HASH, "the Gateway would hand back a page it already drew");
  });
});

describe("scorePage: how many markers the page builder got right", () => {
  it("a complete page: every marker there, and the Check passes", async () => {
    const score = await scorePage({ spec: employeesSpec, n: 1, html: page("employees-real.html") });
    assert.equal(score.present, score.total);
    assert.ok(score.total >= 7, "4 fields + Add, Edit, Delete, search");
    assert.deepEqual(score.missing, []);
    assert.equal(score.check, "pass");
  });

  it("a page that forgot a marker: counted as missing, named the way a person sees it", async () => {
    const html = page("employees-real.html").replaceAll('data-field="salary"', "");
    const score = await scorePage({ spec: employeesSpec, n: 1, html });
    assert.equal(score.present, score.total - 1);
    assert.equal(score.missing.length, 1);
    assert.match(score.missing[0], /Salary/);
    assert.equal(score.check, "pass", "the binder adds it back from the column header, as in production");
  });

  it("a page with nothing the binder can repair fails the Check too", async () => {
    const score = await scorePage({ spec: employeesSpec, n: 1, html: "<html><body><h1>Employees</h1></body></html>" });
    assert.equal(score.present, 0);
    assert.equal(score.check, "fail");
  });
});

const ROWS = [
  { case: "m1-edit-delete", screen: "m1-edit-delete", page: 1, method: "s2c", mode: "cloud", provider: "cloud", seconds: 142.3, present: 7, total: 7, missing: [], check: "pass", file: "m1-edit-delete.s2c.html" },
  { case: "m4-login", screen: "m4-login", page: 1, method: "s2c", mode: "cloud", provider: "cloud", seconds: 118, present: 3, total: 4, missing: ['the "Sign up" button (data-action="signup")'], check: "fail", file: "m4-login.s2c.html" },
  { case: "m3-dashboard", screen: "m3-dashboard", page: 1, method: "s2c", mode: "cloud", seconds: 30, error: "Gateway at http://x is not reachable" },
];

describe("resultsTable: one row per page, ready for the evidence report", () => {
  it("has a header and one row per page, with time, markers, the Check and a blank score to fill in", () => {
    const lines = resultsTable(ROWS).trim().split("\n");
    assert.match(lines[0], /\| Screenshot \| Page \| Method \| Provider \| Seconds \| Markers \| Check after repair \| Your score \(1–5\) \| Missing \|/);
    assert.equal(lines.length, 2 + ROWS.length);
    assert.match(lines[2], /\| m1-edit-delete \| 1 \| s2c \| cloud \| 142\.3 \| 7\/7 \| pass \| {2}\| — \|/);
    assert.match(lines[3], /\| 3\/4 \| fail \| .*Sign up/);
  });

  it("shows a page that could not be built as failed, with the reason", () => {
    const row = resultsTable(ROWS).trim().split("\n")[4];
    assert.match(row, /\| m3-dashboard \| 1 \| s2c \| — \| 30\.0 \| — \| not built \| {2}\| Gateway at http:\/\/x is not reachable \|/);
  });

  it("keeps a | in a reason from breaking the table", () => {
    const row = resultsTable([{ ...ROWS[2], error: "a | b" }]).trim().split("\n")[2];
    assert.match(row, /a \\\| b/);
  });
});

describe("reviewHtml: each screenshot next to the page built from it, to score by eye", () => {
  it("shows the screenshot and the page side by side for every built page", () => {
    const html = reviewHtml(ROWS, { mocksDir: "../../.." });
    assert.match(html, /<img src="..\/..\/..\/m1-edit-delete.png"/);
    assert.match(html, /<iframe src="m1-edit-delete.s2c.html"/);
    assert.match(html, /<iframe src="m4-login.s2c.html"/);
  });

  it("shows the browser's picture of the page when there is one, with a link to the live page", () => {
    const html = reviewHtml([{ ...ROWS[0], shot: "m1-edit-delete.s2c.png" }], { mocksDir: "../../.." });
    assert.match(html, /<img src="m1-edit-delete.s2c.png"/);
    assert.match(html, /<a href="m1-edit-delete.s2c.html"/);
    assert.doesNotMatch(html, /<iframe/);
  });

  it("names a page that was not built instead of showing an empty frame", () => {
    const html = reviewHtml(ROWS, { mocksDir: "../../.." });
    assert.doesNotMatch(html, /<iframe src="undefined"/);
    assert.match(html, /not built: Gateway at http:\/\/x is not reachable/);
  });

  it("escapes text, so a reason with < > cannot break the page", () => {
    const html = reviewHtml([{ ...ROWS[2], error: "<script>x</script>" }], { mocksDir: "." });
    assert.doesNotMatch(html, /<script>x/);
    assert.match(html, /&lt;script&gt;x/);
  });
});

describe("shotArgs: a picture of each built page, the same size as the screenshots", () => {
  it("asks a headless browser for a 1280x800 PNG of the page file, after Tailwind has loaded", () => {
    const html = path.resolve("out/m1.single.html");
    const args = shotArgs({ html, png: path.resolve("out/m1.single.png") });
    assert.ok(args.includes("--headless=new"));
    assert.ok(args.includes(`--screenshot=${path.resolve("out/m1.single.png")}`));
    assert.ok(args.includes("--window-size=1280,800"));
    assert.ok(args.some((a) => /^--virtual-time-budget=\d+$/.test(a)), "time for the Tailwind script to run");
    assert.equal(args.at(-1), pathToFileURL(html).href, "the page last, as a file URL");
  });
});

describe("browserCandidates: where to look for Chrome or Edge", () => {
  it("tries SHOT_BROWSER first, when it is set", () => {
    assert.equal(browserCandidates("win32", { SHOT_BROWSER: "C:\\b.exe" })[0], "C:\\b.exe");
  });

  it("knows Chrome and Edge on Windows, and Chrome on a Mac", () => {
    const win = browserCandidates("win32", { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" });
    assert.ok(win.some((p) => /Google.Chrome.Application.chrome\.exe$/.test(p)));
    assert.ok(win.some((p) => /Microsoft.Edge.Application.msedge\.exe$/.test(p)));
    assert.ok(browserCandidates("darwin", {}).includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  });
});

describe("runPool: N pages at the same time (Step 18.4)", () => {
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));

  it("never runs more than N at once, and starts the next one as soon as one ends", async () => {
    let running = 0;
    let most = 0;
    await runPool([30, 10, 10, 10, 10], 2, async (ms) => {
      most = Math.max(most, ++running);
      await tick(ms);
      running--;
    });
    assert.equal(most, 2);
  });

  it("keeps the results in the order of the items, whatever order they finish in", async () => {
    const results = await runPool([30, 5, 15], 3, async (ms, i) => (await tick(ms), `page ${i + 1}`));
    assert.deepEqual(results, ["page 1", "page 2", "page 3"]);
  });

  it("with N = 1 runs them one after another, like before", async () => {
    const order = [];
    await runPool([20, 5], 1, async (ms, i) => (order.push(`start ${i}`), await tick(ms), order.push(`end ${i}`)));
    assert.deepEqual(order, ["start 0", "end 0", "start 1", "end 1"]);
  });
});
