// Step 54a, region fix, in the Pages tab: what the picker in the page's frame says (checked: it is a hint from
// generated code), and where a page's fixes stand.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixWords, pageFixes, pickFrom } from "../src/fix.js";
import { pipelineStatus } from "../src/pipeline.js";

const frame = {};
const message = (data, source = frame) => ({ source, data });

describe("pickFrom: a message from the picker", () => {
  it("a part, or a style, with its label", () => {
    assert.deepEqual(pickFrom(message({ type: "ak-pick", kind: "part", n: 4, label: "h1 “TechFest”" }), frame), { kind: "part", n: 4, label: "h1 “TechFest”" });
    assert.deepEqual(pickFrom(message({ type: "ak-pick", kind: "style", selector: '[data-action="checkIn"]', label: "button" }), frame), {
      kind: "style",
      selector: '[data-action="checkIn"]',
      label: "button",
    });
  });

  it("the picker's own error is passed on", () => {
    assert.deepEqual(pickFrom(message({ type: "ak-pick", error: "Draw the box around one part" }), frame), { error: "Draw the box around one part" });
  });

  it("anything else is ignored: another frame, another type, a bad shape", () => {
    assert.equal(pickFrom(message({ type: "ak-pick", kind: "part", n: 4 }, {}), frame), null);
    assert.equal(pickFrom(message({ type: "other", kind: "part", n: 4 }), frame), null);
    assert.equal(pickFrom(message({ type: "ak-pick", kind: "part", n: "4; drop" }), frame), null);
    assert.equal(pickFrom(message({ type: "ak-pick", kind: "style", selector: 7 }), frame), null);
    assert.equal(pickFrom(message(null), frame), null);
  });

  it("long labels are cut", () => {
    assert.equal(pickFrom(message({ type: "ak-pick", kind: "part", n: 1, label: "x".repeat(500) }), frame).label.length, 100);
  });
});

const HASH = "a".repeat(64);
const project = (state, fixes, revisions) => ({
  state,
  currentContractVersion: 1,
  contract: { hash: HASH, version: 1, body: { pages: [{ screenshot: 1 }], entities: [], operations: [], stats: [] } },
  jobs: [{ kind: "frontend", status: "done", page: 1, contractHash: HASH, startedAt: "2026-11-25T10:00:00Z", finishedAt: "2026-11-25T10:01:00Z", fixes, revisions }],
});

describe("pageFixes: where a page's fixes stand", () => {
  it("no fixes yet", () => {
    assert.deepEqual(pageFixes(project("READY"), 1), { latest: null, kept: 0, canUndo: false, fixing: false });
  });

  it("a fix being made", () => {
    const fix = { id: "f1", label: "h1", note: "purple", status: "running" };
    assert.deepEqual(pageFixes(project("REPAIRING", [fix]), 1), { latest: fix, kept: 0, canUndo: false, fixing: true });
  });

  it("a kept fix can be undone", () => {
    const fix = { id: "f1", label: "h1", note: "purple", status: "done" };
    assert.deepEqual(pageFixes(project("READY", [fix], ["runs/x/page-1.html"]), 1), { latest: fix, kept: 1, canUndo: true, fixing: false });
  });

  it("fixWords says it in plain words", () => {
    assert.match(fixWords({ label: "button “Check In”", note: "purple", status: "running" }), /^Fixing button “Check In”…/);
    assert.match(fixWords({ label: "h1", note: "bigger", status: "done", provider: "local", seconds: 12.5 }), /^Fixed h1: “bigger” \(local AI, 12\.5 s\)/);
    assert.match(fixWords({ label: "h1", note: "x", status: "failed", problem: "it lost markers" }), /^Couldn't fix h1: it lost markers/);
    assert.match(fixWords({ label: "h1", note: "x", status: "undone" }), /^Undone: h1/);
  });
});

describe("pipelineStatus while a part is being fixed", () => {
  it("Pages is working on it, and counts the kept fixes", () => {
    const status = pipelineStatus(project("REPAIRING", [{ status: "done" }, { status: "running" }], ["a"]));
    assert.equal(status.stations.pages.status, "active");
    assert.equal(status.stations.pages.fixed, 1);
    assert.equal(status.current, "pages");
  });
});
