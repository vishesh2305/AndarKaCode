// Backend generator, piece 11.4 (no database): every generated app gets tests/api.test.js with one test
// per endpoint and button the screenshots show, and nothing for what they don't show.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateBackend } from "../src/generator/index.js";
import { catalogSpec, editDeleteSpec, opsSpec, relationSpec } from "./fixtures/specs.js";

const testsOf = (spec) => generateBackend(spec, { name: "x" })["tests/api.test.js"];

describe("generated tests/api.test.js", () => {
  it("exists for every generated app", () => {
    for (const spec of [editDeleteSpec, catalogSpec, relationSpec, opsSpec]) assert.ok(testsOf(spec));
  });

  it("tests exactly the visible endpoints: Edit/Delete screen has no create test", () => {
    const tests = testsOf(editDeleteSpec);
    for (const name of ["lists", "gets one", "updates", "deletes"]) assert.ok(tests.includes(`it("${name}`), name);
    assert.doesNotMatch(tests, /it\("creates/);
    assert.doesNotMatch(tests, /it\("searches|it\("filters|it\("pages/);
  });

  it("tests search, filter and paging only when the screenshot shows them", () => {
    const tests = testsOf(catalogSpec);
    for (const name of ["creates", "searches", "filters by category", "pages"]) assert.ok(tests.includes(`it("${name}`), name);
    assert.doesNotMatch(tests, /it\("(updates|deletes)/);
  });

  it("tests every button and the stat cards", () => {
    const tests = testsOf(opsSpec);
    assert.match(tests, /it\("Approve sets status to Approved/);
    assert.match(tests, /it\("Export CSV/);
    assert.match(tests, /it\("Recalculate answers 501/);
    assert.match(tests, /it\("stat cards/);
  });

  it("names each test after its screenshot evidence", () => {
    assert.match(testsOf(editDeleteSpec), /s1: row action 'Delete'/);
  });

  it("reads the test database from MONGODB_URI_TEST, never the app's real database", () => {
    const tests = testsOf(editDeleteSpec);
    assert.match(tests, /process\.env\.MONGODB_URI_TEST/);
    assert.doesNotMatch(tests, /process\.env\.MONGODB_URI\b(?!_TEST)/);
  });
});
