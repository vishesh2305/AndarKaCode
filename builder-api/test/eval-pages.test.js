// Step 18.1: the page exam. The same mock screenshots and the same fixed spec for every way of building
// pages, so the only thing that changes between two runs is the page builder. Each page gets its time,
// its markers (raw, then after the binder's repair) and a score the user gives by eye.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { PAGE_CASES, parseArgs, resultsTable, reviewHtml, runHash, scorePage } from "../src/eval/pages.js";
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
    assert.deepEqual(parseArgs([]), { method: "s2c", mode: "cloud", read: "auto", only: null });
  });

  it("takes the method, the mode, the reading mode and one case", () => {
    assert.deepEqual(parseArgs(["--method", "s2c", "--mode", "local", "--read", "local", "m1-edit-delete"]), {
      method: "s2c",
      mode: "local",
      read: "local",
      only: "m1-edit-delete",
    });
  });

  it("knows the single-call builder (Step 18.2)", () => {
    assert.equal(parseArgs(["--method", "single"]).method, "single");
  });

  it("refuses an unknown method, mode or case, and says what is allowed", () => {
    assert.throws(() => parseArgs(["--method", "magic"]), /method.*s2c, single/);
    assert.throws(() => parseArgs(["--mode", "fast"]), /mode.*local, cloud, auto/);
    assert.throws(() => parseArgs(["m9-nothing"]), /case.*m1-edit-delete/);
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
