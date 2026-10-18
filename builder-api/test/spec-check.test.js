// checkSpec: the App Spec must be buildable and every item must carry evidence (ARCHITECTURE.md v3.1 §4.3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSpec } from "../src/spec/check.js";

const validSpec = () => ({
  entities: [
    {
      name: "employee",
      plural: "employees",
      label: "Employees",
      sampleConst: "SAMPLE_EMPLOYEES",
      fields: [
        { name: "fullName", label: "Full Name", type: "string", required: true, evidence: "s1: column 'Full Name'" },
        { name: "status", label: "Status", type: "enum", options: ["Pending", "Approved"], required: false, evidence: "s1: column 'Status'" },
        { name: "department", label: "Department", type: "ref", ref: "department", required: false, evidence: "s1: column 'Department'; s2: table 'Departments'" },
        { name: "salary", label: "Salary", type: "number", required: false, evidence: "s1: column 'Salary'" },
      ],
      endpoints: { list: { search: true, filters: [], pagination: false, evidence: "s1: table" }, delete: { soft: false, evidence: "s1: row action 'Delete'" } },
    },
    {
      name: "department",
      plural: "departments",
      label: "Departments",
      sampleConst: "SAMPLE_DEPARTMENTS",
      fields: [{ name: "name", label: "Name", type: "string", required: false, evidence: "s2: column 'Name'" }],
      endpoints: { list: { search: false, filters: [], pagination: false, evidence: "s2: table" } },
    },
  ],
  operations: [
    { name: "approveEmployee", entity: "employee", kind: "setStatus", set: { status: "Approved" }, button: "Approve", evidence: "s1: row action 'Approve'" },
  ],
  stats: [{ label: "Total Salary", entity: "employee", metric: "sum", field: "salary", evidence: "s1: stat card" }],
  auth: null,
  pages: [
    { screenshot: 1, kind: "list", entity: "employee" },
    { screenshot: 2, kind: "list", entity: "department" },
  ],
  openQuestions: [],
});

const problemsAfter = (change) => {
  const spec = validSpec();
  change(spec);
  return checkSpec(spec);
};

describe("checkSpec", () => {
  it("accepts a valid spec", () => {
    assert.deepEqual(checkSpec(validSpec()), []);
  });

  it("rejects a spec with nothing to build", () => {
    assert.match(checkSpec({ entities: [], operations: [], stats: [], auth: null, pages: [], openQuestions: [] }).join(), /nothing to build/i);
  });

  it("accepts a login-only spec", () => {
    const spec = { entities: [], operations: [], stats: [], auth: { login: { evidence: "s1: login form" }, signup: null, me: null, roles: null }, pages: [{ screenshot: 1, kind: "login" }], openQuestions: [] };
    assert.deepEqual(checkSpec(spec), []);
  });

  it("rejects names that are not camelCase and duplicate names", () => {
    assert.match(problemsAfter((s) => (s.entities[0].fields[0].name = "Full Name")).join(), /"Full Name" is not camelCase/);
    assert.match(problemsAfter((s) => (s.entities[1].name = "employee")).join(), /entity "employee" appears twice/);
    assert.match(problemsAfter((s) => s.entities[1].fields.push({ ...s.entities[1].fields[0] })).join(), /field "name" appears twice/);
  });

  it("rejects unknown field types, enums without options and relations to missing entities", () => {
    assert.match(problemsAfter((s) => (s.entities[0].fields[0].type = "money")).join(), /unknown type "money"/);
    assert.match(problemsAfter((s) => (s.entities[0].fields[1].options = [])).join(), /enum field "status" has no options/);
    assert.match(problemsAfter((s) => (s.entities[0].fields[2].ref = "team")).join(), /relation to unknown entity "team"/);
  });

  it("rejects unknown endpoints and an entity with no endpoints", () => {
    assert.match(problemsAfter((s) => (s.entities[0].endpoints.purge = { evidence: "s1: x" })).join(), /unknown endpoint "purge"/);
    assert.match(problemsAfter((s) => (s.entities[1].endpoints = {})).join(), /entity "department" has no endpoints/);
  });

  it("rejects items without evidence (no evidence, no code)", () => {
    assert.match(problemsAfter((s) => delete s.entities[0].fields[0].evidence).join(), /field "fullName" has no evidence/);
    assert.match(problemsAfter((s) => (s.entities[0].endpoints.delete.evidence = " ")).join(), /endpoint "employee.delete" has no evidence/);
    assert.match(problemsAfter((s) => delete s.operations[0].evidence).join(), /operation "approveEmployee" has no evidence/);
  });

  it("rejects operations and stats that point at missing things", () => {
    assert.match(problemsAfter((s) => (s.operations[0].set = { status: "Archived" })).join(), /sets status to "Archived", which is not one of its options/);
    assert.match(problemsAfter((s) => (s.operations[0].kind = "magic")).join(), /unknown kind "magic"/);
    assert.match(problemsAfter((s) => (s.stats[0].field = "bonus")).join(), /sums unknown number field "bonus"/);
  });

  it("rejects pages that point at a missing entity", () => {
    assert.match(problemsAfter((s) => (s.pages[1].entity = "team")).join(), /page 2 shows unknown entity "team"/);
  });
});
