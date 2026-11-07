// Step 32b: the quota and scheduling settings, and how many waiting projects an orchestrator starts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkConfig } from "../src/config.js";
import { quotaMessage, toStart } from "../src/quotas.js";

describe("the quota settings", () => {
  it("free: 5 builds per 30 days; pro: 50 a day (fair use); 4 projects built at once", () => {
    const { quotas, buildParallel } = checkConfig({}).config;
    assert.deepEqual(quotas, { free: { builds: 5, days: 30 }, pro: { builds: 50, days: 1 } });
    assert.equal(buildParallel, 4);
  });

  it("can be changed, within sensible bounds", () => {
    assert.deepEqual(checkConfig({ FREE_BUILDS: "3", FREE_BUILDS_DAYS: "7" }).config.quotas.free, { builds: 3, days: 7 });
    assert.match(checkConfig({ FREE_BUILDS: "-1" }).problems[0], /FREE_BUILDS in builder-api\/\.env must be a whole number from 0 to 10000/);
    assert.match(checkConfig({ PRO_BUILDS_DAYS: "0" }).problems[0], /PRO_BUILDS_DAYS in builder-api\/\.env must be a whole number from 1 to 365/);
    assert.match(checkConfig({ BUILD_PARALLEL: "0" }).problems[0], /BUILD_PARALLEL in builder-api\/\.env must be a whole number from 1 to 50/);
  });
});

describe("quotaMessage", () => {
  it("says the plan's limit, what was used, and when the next build is possible", () => {
    const text = quotaMessage({ plan: "free", used: 5, limit: 5, days: 30, resetsAt: new Date("2026-12-01T10:30:00Z") });
    assert.match(text, /^The free plan builds 5 apps every 30 days, and this workspace has built 5\. The next build is possible on /);
  });

  it("a one-day window says 'a day'", () => {
    assert.match(quotaMessage({ plan: "pro", used: 50, limit: 50, days: 1, resetsAt: new Date() }), /The pro plan builds 50 apps a day/);
  });
});

describe("toStart: which waiting projects an orchestrator starts now", () => {
  it("as many as it has room for, in the order given (pro first, then oldest), skipping its own running ones", () => {
    assert.deepEqual(toStart(["a", "b", "c", "d"], { active: new Set(["x"]), parallel: 3 }), ["a", "b"]);
    assert.deepEqual(toStart(["a", "b"], { active: new Set(["a"]), parallel: 3 }), ["b"]);
    assert.deepEqual(toStart(["a"], { active: new Set(["x", "y", "z"]), parallel: 3 }), []);
  });
});
