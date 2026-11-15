// Step 35: the "Report a problem" form. What it sends, and what it says before sending.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportProblem } from "../src/report.js";

describe("reportProblem: the report form's payload", () => {
  it("sends the reason, and the project and address it is about when there are any", () => {
    assert.deepEqual(reportProblem({ reason: "  This copies my bank's login page ", projectId: "p1", url: " http://127.0.0.1:4001/preview/p1/t/page-1.html " }), {
      ok: true,
      body: { reason: "This copies my bank's login page", projectId: "p1", url: "http://127.0.0.1:4001/preview/p1/t/page-1.html" },
    });
    assert.deepEqual(reportProblem({ reason: "Spam everywhere on it" }), { ok: true, body: { reason: "Spam everywhere on it" } });
  });

  it("says what is missing instead of sending: a reason of a few words, at most 2000 characters, a real address", () => {
    assert.match(reportProblem({ reason: "bad" }).error, /a few words/);
    assert.match(reportProblem({ reason: "x".repeat(2001) }).error, /2000/);
    assert.match(reportProblem({ reason: "This copies a login page", url: "not an address" }).error, /address/);
  });
});
