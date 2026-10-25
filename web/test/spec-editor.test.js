import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toCamelCase,
  isValidCamelCase,
  updateField,
  addField,
  removeField,
  resolveOpenQuestion,
  validateSpec,
} from "../src/spec-editor.js";

const sampleSpec = () => ({
  entities: [
    {
      name: "employee",
      plural: "employees",
      label: "Employees",
      fields: [
        { name: "fullName", label: "Full Name", type: "string", required: true, evidence: "s1: table" },
        { name: "status", label: "Status", type: "enum", options: ["Active", "Inactive"], required: false, evidence: "s1: badge" },
      ],
      endpoints: {
        list: { search: true, filters: [], pagination: true, evidence: "s1: table" },
        delete: { soft: false, evidence: "s1: delete" },
      },
    },
    {
      name: "department",
      plural: "departments",
      label: "Departments",
      fields: [
        { name: "name", label: "Name", type: "string", required: true, evidence: "s2: table" },
      ],
      endpoints: {
        list: { search: false, filters: [], pagination: false, evidence: "s2: table" },
      },
    },
  ],
  operations: [
    { name: "activateEmployee", entity: "employee", kind: "setStatus", set: { status: "Active" }, button: "Activate", evidence: "s1: button" },
  ],
  stats: [],
  auth: null,
  pages: [{ screenshot: 1, entity: "employee", kind: "list" }],
  openQuestions: [
    {
      entity: "employee",
      field: "status",
      question: 'Is "Status" a fixed list, or data you manage on its own page?',
      default: "enum",
    },
  ],
});

describe("spec-editor: toCamelCase and validation", () => {
  it("converts spaces, hyphens, and weird casing to camelCase", () => {
    assert.equal(toCamelCase("Full Name"), "fullName");
    assert.equal(toCamelCase("phone-number"), "phoneNumber");
    assert.equal(toCamelCase("Department (HR)"), "department");
    assert.equal(toCamelCase("salary ($)"), "salary");
    assert.equal(toCamelCase("alreadyCamel"), "alreadyCamel");
  });

  it("checks valid camelCase", () => {
    assert.equal(isValidCamelCase("fullName"), true);
    assert.equal(isValidCamelCase("status"), true);
    assert.equal(isValidCamelCase("Full Name"), false);
    assert.equal(isValidCamelCase("status_1"), false);
    assert.equal(isValidCamelCase(""), false);
  });
});

describe("spec-editor: updateField", () => {
  it("changes field type from string to number", () => {
    const spec = sampleSpec();
    const updated = updateField(spec, "employee", "fullName", { type: "number" });
    const f = updated.entities[0].fields.find((x) => x.name === "fullName");
    assert.equal(f.type, "number");
  });

  it("changes field type to enum and initializes options", () => {
    const spec = sampleSpec();
    const updated = updateField(spec, "employee", "fullName", { type: "enum" });
    const f = updated.entities[0].fields.find((x) => x.name === "fullName");
    assert.equal(f.type, "enum");
    assert.ok(f.options && f.options.length > 0);
  });

  it("updates enum options via optionsString", () => {
    const spec = sampleSpec();
    const updated = updateField(spec, "employee", "status", { optionsString: "Pending, Approved, Rejected" });
    const f = updated.entities[0].fields.find((x) => x.name === "status");
    assert.deepEqual(f.options, ["Pending", "Approved", "Rejected"]);
  });

  it("changes field type to ref and links to another entity", () => {
    const spec = sampleSpec();
    const updated = updateField(spec, "employee", "fullName", { type: "ref", ref: "department" });
    const f = updated.entities[0].fields.find((x) => x.name === "fullName");
    assert.equal(f.type, "ref");
    assert.equal(f.ref, "department");
  });
});

describe("spec-editor: addField and removeField", () => {
  it("adds a new field to an entity with evidence", () => {
    const spec = sampleSpec();
    const updated = addField(spec, "employee", {
      name: "emailAddress",
      label: "Email Address",
      type: "email",
      required: true,
    });
    const fields = updated.entities[0].fields;
    assert.equal(fields.length, 3);
    const added = fields.find((x) => x.name === "emailAddress");
    assert.ok(added);
    assert.equal(added.type, "email");
    assert.equal(added.required, true);
    assert.ok(added.evidence.length > 0);
  });

  it("removes a field and cleans up dependent operations", () => {
    const spec = sampleSpec();
    assert.equal(spec.operations.length, 1);
    const updated = removeField(spec, "employee", "status");
    const fields = updated.entities[0].fields;
    assert.equal(fields.length, 1);
    assert.equal(fields[0].name, "fullName");
    // Operation activateEmployee depended on status: "Active", so it should be cleaned up
    assert.equal(updated.operations.length, 0);
  });
});

describe("spec-editor: resolveOpenQuestion", () => {
  it("answers an open question and updates target field to enum", () => {
    const spec = sampleSpec();
    const updated = resolveOpenQuestion(spec, 0, "Fixed list (enum)", "enum");
    assert.equal(updated.openQuestions[0].resolved, true);
    assert.equal(updated.openQuestions[0].answer, "Fixed list (enum)");
    const f = updated.entities[0].fields.find((x) => x.name === "status");
    assert.equal(f.type, "enum");
  });

  it("answers an open question and changes target field to string", () => {
    const spec = sampleSpec();
    const updated = resolveOpenQuestion(spec, 0, "Free text", "string");
    assert.equal(updated.openQuestions[0].resolved, true);
    const f = updated.entities[0].fields.find((x) => x.name === "status");
    assert.equal(f.type, "string");
    assert.equal(f.options, undefined);
  });
});

describe("spec-editor: validateSpec", () => {
  it("passes for valid spec", () => {
    const problems = validateSpec(sampleSpec());
    assert.deepEqual(problems, []);
  });

  it("catches non-camelCase fields", () => {
    const spec = sampleSpec();
    spec.entities[0].fields[0].name = "Full Name";
    const problems = validateSpec(spec);
    assert.ok(problems.some((p) => p.includes("must be camelCase")));
  });

  it("catches enum without options", () => {
    const spec = sampleSpec();
    spec.entities[0].fields[1].options = [];
    const problems = validateSpec(spec);
    assert.ok(problems.some((p) => p.includes("requires at least one option")));
  });

  it("catches relation to unknown entity", () => {
    const spec = sampleSpec();
    spec.entities[0].fields[0].type = "ref";
    spec.entities[0].fields[0].ref = "nonExistent";
    const problems = validateSpec(spec);
    assert.ok(problems.some((p) => p.includes("points to unknown entity")));
  });
});
