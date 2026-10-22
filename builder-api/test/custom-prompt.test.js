// Step 13: what the coding AI is asked for one custom button, and how its code is taken from the answer.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customPrompt, extractCode, repairPrompt } from "../src/custom/prompt.js";
import { opsSpec } from "./fixtures/specs.js";

const op = (name) => opsSpec.operations.find((o) => o.name === name);

describe("customPrompt: one button, its table, the fixed shape and the rules", () => {
  const prompt = customPrompt(opsSpec, op("recalculateLeaveRequest"));

  it("names the button and says it is pressed on one row", () => {
    assert.match(prompt, /"Recalculate"/);
    assert.match(prompt, /each row of the "Leave Requests" table/);
    assert.match(prompt, /record: the row the button was pressed on/);
  });

  it("lists the table's fields with their types, choices and whether they are required", () => {
    assert.match(prompt, /- employee: text, required/);
    assert.match(prompt, /- days: number/);
    assert.match(prompt, /- status: one of "Pending", "Approved", "Rejected"/);
  });

  it("gives the fixed shape, every helper, and the rules the safety check enforces", () => {
    assert.match(prompt, /export default async function \(\{ record, input, helpers \}\)/);
    for (const helper of ["get(id)", "list(filter)", "create(values)", "update(id, changes)", "updateMany(filter, changes)", "remove(id)", "fail(message)"]) {
      assert.ok(prompt.includes(`helpers.${helper}`), helper);
    }
    assert.match(prompt, /no import or require/);
    assert.match(prompt, /for \.\.\. of/);
    assert.match(prompt, /dot notation/);
  });

  it("says a page button has no record", () => {
    assert.match(customPrompt(opsSpec, op("syncPayrollLeaveRequest")), /a button on the "Leave Requests" page[\s\S]*record: null/);
  });

  it("never passes screenshot evidence to the model", () => {
    assert.doesNotMatch(prompt, /s1: /);
  });
});

describe("repairPrompt: the same request, plus what went wrong", () => {
  it("includes the earlier code and the problem, and asks for the whole function again", () => {
    const prompt = repairPrompt(opsSpec, op("recalculateLeaveRequest"), "export default async function () {}", "line 1: the function must use helpers");
    assert.match(prompt, /export default async function \(\) \{\}/);
    assert.match(prompt, /line 1: the function must use helpers/);
    assert.match(prompt, /whole corrected function/);
  });
});

describe("extractCode: the function from the model's answer", () => {
  const fn = "export default async function ({ helpers }) {\n  return {};\n}";
  it("takes the first ```js or ```javascript block", () => {
    assert.equal(extractCode(`Here you go:\n\`\`\`js\n${fn}\n\`\`\`\nand more`), fn);
    assert.equal(extractCode(`\`\`\`javascript\n${fn}\n\`\`\``), fn);
  });
  it("takes a plain answer that is just the code", () => {
    assert.equal(extractCode(`  ${fn}  `), fn);
  });
  it("returns null when there is no code", () => {
    assert.equal(extractCode("Sorry, I can't do that."), null);
  });
});
