// Per-page instructions for Screenshot-to-Code: only what is on THAT screenshot, with the markers the binder needs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageInstructions } from "../src/spec/instructions.js";

const spec = {
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
        { name: "email", label: "Email", type: "email", required: true, evidence: "s1: form input 'Email'" },
      ],
      endpoints: {
        list: { search: true, filters: ["status"], pagination: true, evidence: "s1: table 'Employees'" },
        create: { evidence: "s1: button 'Add Employee'" },
        update: { evidence: "s1: row action 'Edit'" },
        get: { evidence: "s1: row action 'Edit' (loads the record)" },
      },
    },
    {
      name: "department",
      plural: "departments",
      label: "Departments",
      sampleConst: "SAMPLE_DEPARTMENTS",
      fields: [{ name: "name", label: "Name", type: "string", required: false, evidence: "s2: column 'Name'" }],
      endpoints: {
        list: { search: false, filters: [], pagination: false, evidence: "s2: table 'Departments'" },
        delete: { soft: false, evidence: "s2: row action 'Delete'" },
      },
    },
  ],
  operations: [
    { name: "approveEmployee", entity: "employee", kind: "setStatus", set: { status: "Approved" }, button: "Approve", evidence: "s1: row action 'Approve'" },
    { name: "exportEmployees", entity: "employee", kind: "export", button: "Export CSV", evidence: "s1: button 'Export CSV'" },
  ],
  stats: [{ label: "Total Employees", entity: "employee", metric: "count", evidence: "s1: stat card 'Total Employees'" }],
  auth: { login: { evidence: "s3: login form" }, signup: { evidence: "s3: sign-up link" }, me: null, roles: null },
  pages: [
    { screenshot: 1, kind: "list", entity: "employee" },
    { screenshot: 2, kind: "list", entity: "department" },
    { screenshot: 3, kind: "login" },
  ],
  openQuestions: [],
};

describe("pageInstructions: a list page", () => {
  const text = pageInstructions(spec, 1);

  it("lists only the fields shown on this page, with their exact names", () => {
    for (const name of ["fullName", "status", "department", "email"]) assert.match(text, new RegExp(`\\b${name}\\b`));
    assert.doesNotMatch(text, /\bname -> label "Name"/, "the departments page's field is not on this page");
  });

  it("asks for the markers of every control on this page", () => {
    assert.match(text, /data-action="create"/);
    assert.match(text, /data-action="update"/);
    assert.match(text, /data-action="search"/);
    assert.match(text, /data-filter="status"/);
    assert.match(text, /data-action="prevPage"/);
    assert.match(text, /data-action="nextPage"/);
    assert.match(text, /data-action="approveEmployee"/);
    assert.match(text, /data-action="exportEmployees"/);
    assert.match(text, /data-stat="totalEmployees"/);
    assert.match(text, /const SAMPLE_EMPLOYEES/);
  });

  it("does not ask for controls that are not on this page", () => {
    assert.doesNotMatch(text, /data-action="delete"/, "Delete is only on the departments page");
    assert.doesNotMatch(text, /data-action="login"/);
  });
});

describe("pageInstructions: other pages", () => {
  it("gives the departments page only its own field and its Delete button", () => {
    const text = pageInstructions(spec, 2);
    assert.match(text, /\bname -> label "Name"/);
    assert.match(text, /data-action="delete"/);
    assert.doesNotMatch(text, /fullName|data-action="create"|data-action="approveEmployee"/);
  });

  it("gives a login page the login markers only", () => {
    const text = pageInstructions(spec, 3);
    assert.match(text, /data-field="email"/);
    assert.match(text, /data-field="password"/);
    assert.match(text, /data-action="login"/);
    assert.match(text, /data-action="signup"/);
    assert.doesNotMatch(text, /SAMPLE_|data-action="create"/);
  });

  it("throws for a screenshot that has no page in the spec", () => {
    assert.throws(() => pageInstructions(spec, 9), /no page for screenshot 9/);
  });
});

describe("pageInstructions: a dropdown stored as text", () => {
  it("still asks for a <select> (the screenshot shows one), without a fixed list of values", () => {
    const text = pageInstructions(
      {
        ...spec,
        entities: [
          {
            ...spec.entities[0],
            fields: [
              { name: "fullName", label: "Full Name", type: "string", required: true, evidence: "s1: column 'Full Name'" },
              { name: "team", label: "Team", type: "string", control: "select", required: false, evidence: "s1: form input 'Team'" },
            ],
          },
          spec.entities[1],
        ],
      },
      1
    );
    assert.match(text, /team = a <select>/);
    assert.match(text, /- team -> label "Team" \(a dropdown\)/);
  });
});
