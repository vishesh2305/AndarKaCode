// Step 14: the fingerprints memory is kept under. Same work -> same key; anything that could change the
// result (the screenshot, the reading prompt, a page's instructions, a button's table) -> another key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { READING_VERSION, customKey, inventoryKey, pageKey } from "../src/memory/keys.js";
import { opsSpec } from "./fixtures/specs.js";

const SHOT = "a".repeat(64);
const OTHER = "b".repeat(64);
const recalc = opsSpec.operations.find((o) => o.name === "recalculateLeaveRequest");

describe("inventoryKey: what the vision AI read on one screenshot", () => {
  it("is the same for the same screenshot, and different for another screenshot", () => {
    assert.equal(inventoryKey(SHOT), inventoryKey(SHOT));
    assert.notEqual(inventoryKey(SHOT), inventoryKey(OTHER));
    assert.match(inventoryKey(SHOT), /^[a-f0-9]{64}$/);
  });

  it("changes when the reading prompt or schema changes (READING_VERSION), so old readings stop matching", () => {
    assert.match(READING_VERSION, /^[a-f0-9]{16}$/);
    assert.notEqual(inventoryKey(SHOT), inventoryKey(SHOT, "0".repeat(16)));
  });
});

describe("pageKey: one page Laptop B drew", () => {
  it("needs the same screenshot and the same instructions for that page", () => {
    assert.equal(pageKey(SHOT, "Page title \"Staff\""), pageKey(SHOT, "Page title \"Staff\""));
    assert.notEqual(pageKey(SHOT, "Page title \"Staff\""), pageKey(SHOT, "Page title \"Employees\""));
    assert.notEqual(pageKey(SHOT, "same"), pageKey(OTHER, "same"));
  });
});

describe("customKey: one custom button's code", () => {
  const withFields = (fields) => ({ ...opsSpec, entities: [{ ...opsSpec.entities[0], fields }] });

  it("is the same for the same button on the same kind of table, whatever the evidence or letter case", () => {
    const again = { ...recalc, button: "  recalculate ", evidence: "s3: row action 'Recalculate'" };
    assert.equal(customKey(opsSpec, recalc), customKey(opsSpec, again));
  });

  it("does not depend on the table's name, only on its fields", () => {
    const renamed = { ...opsSpec, entities: [{ ...opsSpec.entities[0], name: "absence", plural: "absences", label: "Absences" }] };
    assert.equal(customKey(renamed, { ...recalc, entity: "absence" }), customKey(opsSpec, recalc));
  });

  it("changes with the button text, row/page, or the table's fields (a type, a choice, a new field)", () => {
    const base = customKey(opsSpec, recalc);
    assert.notEqual(customKey(opsSpec, { ...recalc, button: "Recount" }), base);
    assert.notEqual(customKey(opsSpec, { ...recalc, scope: "page" }), base);
    const [employee, days, status] = opsSpec.entities[0].fields;
    assert.notEqual(customKey(withFields([employee, { ...days, type: "string" }, status]), recalc), base);
    assert.notEqual(customKey(withFields([employee, days, { ...status, options: ["Pending", "Approved"] }]), recalc), base);
    assert.notEqual(customKey(withFields([employee, days, status, { name: "note", label: "Note", type: "string" }]), recalc), base);
  });
});
