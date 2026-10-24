// Step 14 piece 3: the verified-code library. A custom button's remembered code may be tried on another
// table when every field of the old table that the code uses is also in the new table, with the same type.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldsUsed, fitsTable } from "../src/memory/library.js";

const field = (name, type, extra = {}) => ({ name, label: name, type, ...extra });
const OLD = [field("fullName", "string"), field("salary", "number"), field("status", "enum", { options: ["Active", "Left"] })];
const RAISE = `export default async function ({ record, input, helpers }) {
  const salary = Math.round(record.salary * 1.1 * 100) / 100;
  await helpers.update(record.id, { salary });
  return { message: "New salary for " + record.fullName + ": " + salary + " (status unchanged)" };
}`;

describe("fieldsUsed: the old table's fields the code really uses", () => {
  it("finds fields read from the record, written in objects, and used as shorthand", () => {
    assert.deepEqual(fieldsUsed(RAISE, OLD).sort(), ["fullName", "salary"]);
  });

  it("does not count a field name that only appears inside text", () => {
    assert.ok(!fieldsUsed(RAISE, OLD).includes("status"));
  });

  it("finds filter and create keys, quoted or not", () => {
    const code = `export default async function ({ helpers }) {
  await helpers.updateMany({ "status": "Active" }, { salary: 0 });
  return {};
}`;
    assert.deepEqual(fieldsUsed(code, OLD).sort(), ["salary", "status"]);
  });

  it("returns null for code that does not parse", () => {
    assert.equal(fieldsUsed("export default async function (", OLD), null);
  });
});

describe("fitsTable: may the remembered code be tried on the new table?", () => {
  it("yes when every used field is there with the same type (other fields may differ)", () => {
    assert.equal(fitsTable(RAISE, OLD, [field("fullName", "string"), field("salary", "number"), field("email", "email")]), true);
  });

  it("no when a used field is missing (it would be dropped silently and the button would do nothing)", () => {
    assert.equal(fitsTable(RAISE, OLD, [field("fullName", "string"), field("pay", "number")]), false);
  });

  it("no when a used field has another type, or an enum other choices", () => {
    assert.equal(fitsTable(RAISE, OLD, [field("fullName", "string"), field("salary", "string")]), false);
    const code = `export default async function ({ record, helpers }) {
  await helpers.update(record.id, { status: "Left" });
  return {};
}`;
    assert.equal(fitsTable(code, OLD, [field("status", "enum", { options: ["Active", "Retired"] })]), false);
    assert.equal(fitsTable(code, OLD, [field("status", "enum", { options: ["Active", "Left"] })]), true);
  });

  it("no for code that does not parse", () => {
    assert.equal(fitsTable("not js (", OLD, OLD), false);
  });
});
