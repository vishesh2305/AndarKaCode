// Spec Deriver: UI inventory (what the screenshots show) -> App Spec (only what the screens need).
// Rule under test: no evidence, no code (ARCHITECTURE.md v3.1 §0 and §4.2).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { camelCase, deriveSpec, inferType } from "../src/spec/derive.js";

// A screen with only what a test needs; everything else is "not visible".
const screen = (overrides) => ({
  title: "Employee Management",
  kind: "list",
  tables: [],
  forms: [],
  buttons: [],
  search: false,
  filters: [],
  pagination: false,
  statCards: [],
  auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
  ...overrides,
});

const employeeTable = (overrides = {}) => ({
  entityHint: { singular: "employee", plural: "employees" },
  columns: [
    { label: "Full Name", values: ["Ann Lee", "Raj Patel"] },
    { label: "Email", values: ["ann@corp.com", "raj@corp.com"] },
    { label: "Salary", values: ["52,000", "$61,500"] },
  ],
  rowActions: ["Edit", "Delete"],
  ...overrides,
});

const entity = (spec, name) => spec.entities.find((e) => e.name === name);
const field = (spec, entityName, fieldName) => entity(spec, entityName).fields.find((f) => f.name === fieldName);

describe("camelCase", () => {
  it("turns labels into camelCase field names", () => {
    assert.equal(camelCase("Full Name"), "fullName");
    assert.equal(camelCase("Salary ($)"), "salary");
    assert.equal(camelCase("date of birth"), "dateOfBirth");
    assert.equal(camelCase("E-mail"), "eMail");
  });
});

describe("inferType", () => {
  it("detects emails, numbers, currency, dates and yes/no from sample values", () => {
    assert.equal(inferType(["ann@corp.com", "raj@corp.com"]), "email");
    assert.equal(inferType(["52,000", "$61,500", "1200.50"]), "number");
    assert.equal(inferType(["2024-01-15", "15/02/2024", "Mar 3, 2024"]), "date");
    assert.equal(inferType(["Yes", "No"]), "boolean");
    assert.equal(inferType(["Ann Lee", "Raj"]), "string");
  });

  it("treats empty or mixed values as string", () => {
    assert.equal(inferType([]), "string");
    assert.equal(inferType(["ann@corp.com", "not an email"]), "string");
  });
});

describe("deriveSpec: a table with only Edit and Delete", () => {
  const spec = deriveSpec([screen({ tables: [employeeTable()] })]);
  const employee = entity(spec, "employee");

  it("creates one entity with fields from the columns", () => {
    assert.equal(spec.entities.length, 1);
    assert.deepEqual(
      employee.fields.map((f) => [f.name, f.type]),
      [["fullName", "string"], ["email", "email"], ["salary", "number"]]
    );
  });

  it("builds list, get, update and delete, but not create", () => {
    assert.deepEqual(Object.keys(employee.endpoints).sort(), ["delete", "get", "list", "update"]);
  });

  it("uses hard delete when no archive or restore control is visible", () => {
    assert.equal(employee.endpoints.delete.soft, false);
  });

  it("adds no search, filters, pagination, stats, operations or auth", () => {
    assert.equal(employee.endpoints.list.search, false);
    assert.deepEqual(employee.endpoints.list.filters, []);
    assert.equal(employee.endpoints.list.pagination, false);
    assert.deepEqual(spec.stats, []);
    assert.deepEqual(spec.operations, []);
    assert.equal(spec.auth, null);
  });

  it("gives every field and endpoint its evidence", () => {
    for (const f of employee.fields) assert.match(f.evidence, /^s1: /);
    for (const e of Object.values(employee.endpoints)) assert.match(e.evidence, /^s1: /);
  });
});

describe("deriveSpec: Add, search, filter and pagination", () => {
  const spec = deriveSpec([
    screen({
      tables: [employeeTable()],
      buttons: [{ label: "Add Employee", scope: "page" }],
      search: true,
      filters: [{ label: "Department", options: ["All", "HR", "Engineering"] }],
      pagination: true,
      forms: [
        {
          inputs: [
            { label: "Full Name", kind: "text", required: true },
            { label: "Email", kind: "email", required: true },
            { label: "Department", kind: "select", options: ["HR", "Engineering"] },
          ],
          submitLabel: "Save",
        },
      ],
    }),
  ]);
  const employee = entity(spec, "employee");

  it("builds create because an Add button is visible", () => {
    assert.match(employee.endpoints.create.evidence, /Add Employee/);
  });

  it("enables exactly the visible list features", () => {
    assert.equal(employee.endpoints.list.search, true);
    assert.deepEqual(employee.endpoints.list.filters, ["department"]);
    assert.equal(employee.endpoints.list.pagination, true);
  });

  it("marks form inputs with a required sign as required, table-only fields as optional", () => {
    assert.equal(field(spec, "employee", "fullName").required, true);
    assert.equal(field(spec, "employee", "salary").required, false);
  });

  it("adds form-only inputs as fields; a select with no page behind it becomes an enum + a question", () => {
    const department = field(spec, "employee", "department");
    assert.equal(department.type, "enum");
    assert.deepEqual(department.options, ["HR", "Engineering"]);
    assert.ok(spec.openQuestions.some((q) => q.field === "department" && q.default === "enum"));
  });
});

describe("deriveSpec: login screen", () => {
  it("builds auth only when a login form is visible", () => {
    const login = screen({
      title: "Sign in",
      kind: "login",
      forms: [{ inputs: [{ label: "Email", kind: "email" }, { label: "Password", kind: "password" }], submitLabel: "Sign in" }],
      auth: { loginForm: true, signupLink: false, userMenu: false, roleIndicators: [] },
    });
    const spec = deriveSpec([login, screen({ tables: [employeeTable()] })]);

    assert.match(spec.auth.login.evidence, /^s1: /);
    assert.equal(spec.auth.signup, null);
    assert.equal(spec.auth.roles, null);
    assert.equal(entity(spec, "employee").name, "employee");
    assert.equal(spec.entities.length, 1, "the login form is not an entity");
  });

  it("adds sign-up and roles only when they are visible", () => {
    const login = screen({
      kind: "login",
      auth: { loginForm: true, signupLink: true, userMenu: true, roleIndicators: ["Admin", "Manager"] },
    });
    const spec = deriveSpec([login]);
    assert.ok(spec.auth.signup);
    assert.ok(spec.auth.me);
    assert.deepEqual(spec.auth.roles.values, ["admin", "manager"]);
  });
});

describe("deriveSpec: stat cards", () => {
  const spec = deriveSpec([
    screen({
      kind: "dashboard",
      tables: [
        employeeTable({
          columns: [
            { label: "Full Name", values: ["Ann"] },
            { label: "Salary", values: ["52,000"] },
            { label: "Status", values: ["Pending", "Approved"], badge: true },
          ],
        }),
      ],
      statCards: [
        { label: "Total Employees", value: "42" },
        { label: "Pending", value: "5" },
        { label: "Total Salary", value: "$1.2M" },
        { label: "Happiness Index", value: "8.1" },
      ],
    }),
  ]);

  it("derives a count for the entity, a count by status and a sum of a number field", () => {
    assert.deepEqual(spec.stats[0], { label: "Total Employees", entity: "employee", metric: "count", evidence: spec.stats[0].evidence });
    assert.deepEqual(spec.stats[1].where, { status: "Pending" });
    assert.equal(spec.stats[2].metric, "sum");
    assert.equal(spec.stats[2].field, "salary");
  });

  it("marks a stat it cannot derive as custom and asks about it", () => {
    assert.equal(spec.stats[3].metric, "custom");
    assert.ok(spec.openQuestions.some((q) => q.stat === "Happiness Index"));
  });

  it("builds exactly one stat per visible card", () => {
    assert.equal(spec.stats.length, 4);
  });
});

describe("deriveSpec: two related pages", () => {
  const employees = screen({
    tables: [
      employeeTable({
        columns: [
          { label: "Full Name", values: ["Ann"] },
          { label: "Department", values: ["HR", "Engineering"] },
        ],
      }),
    ],
  });
  const departments = screen({
    title: "Departments",
    tables: [
      {
        entityHint: { singular: "department", plural: "departments" },
        columns: [{ label: "Name", values: ["HR", "Engineering"] }],
        rowActions: ["Delete"],
      },
    ],
  });
  const spec = deriveSpec([employees, departments]);

  it("turns a column naming another page's entity into a relation", () => {
    const department = field(spec, "employee", "department");
    assert.equal(department.type, "ref");
    assert.equal(department.ref, "department");
    assert.match(department.evidence, /s2/);
  });

  it("lists one page per screenshot", () => {
    assert.deepEqual(spec.pages, [
      { screenshot: 1, kind: "list", entity: "employee" },
      { screenshot: 2, kind: "list", entity: "department" },
    ]);
  });
});

describe("deriveSpec: row buttons beyond edit and delete", () => {
  const spec = deriveSpec([
    screen({
      tables: [
        employeeTable({
          columns: [
            { label: "Full Name", values: ["Ann"] },
            { label: "Status", values: ["Pending", "Approved", "Rejected"], badge: true },
          ],
          rowActions: ["Approve", "Reject", "Recalculate"],
        }),
      ],
      buttons: [{ label: "Export CSV", scope: "page" }],
    }),
  ]);
  const op = (name) => spec.operations.find((o) => o.name === name);

  it("maps a button that matches a status value to a template setStatus operation", () => {
    assert.deepEqual(
      { kind: op("approveEmployee").kind, set: op("approveEmployee").set },
      { kind: "setStatus", set: { status: "Approved" } }
    );
    assert.equal(op("rejectEmployee").set.status, "Rejected");
  });

  it("maps an export button to a template export operation", () => {
    assert.equal(op("exportEmployees").kind, "export");
  });

  it("leaves a button no template understands to the AI layer", () => {
    assert.equal(op("recalculateEmployee").kind, "custom");
    assert.equal(op("recalculateEmployee").button, "Recalculate");
  });

  it("builds no update or delete because Edit and Delete are not visible", () => {
    const endpoints = Object.keys(entity(spec, "employee").endpoints);
    assert.deepEqual(endpoints, ["list"]);
  });
});

describe("deriveSpec: archive control", () => {
  it("uses soft delete when an Archive or Restore control is visible", () => {
    const spec = deriveSpec([
      screen({ tables: [employeeTable()], buttons: [{ label: "Show Archived", scope: "page" }] }),
    ]);
    assert.equal(entity(spec, "employee").endpoints.delete.soft, true);
  });
});

describe("deriveSpec: naming", () => {
  it("falls back to the screen title when the inventory gives no entity hint", () => {
    const spec = deriveSpec([
      screen({ title: "Product List", tables: [{ columns: [{ label: "Name", values: ["Pen"] }], rowActions: [] }] }),
    ]);
    assert.equal(spec.entities[0].name, "product");
    assert.equal(spec.entities[0].plural, "products");
    assert.equal(spec.entities[0].sampleConst, "SAMPLE_PRODUCTS");
  });

  it("skips Actions, ID and row-number columns", () => {
    const spec = deriveSpec([
      screen({
        tables: [
          employeeTable({
            columns: [
              { label: "#", values: ["1", "2"] },
              { label: "ID", values: ["E-1"] },
              { label: "Full Name", values: ["Ann"] },
              { label: "Actions", values: [] },
            ],
          }),
        ],
      }),
    ]);
    assert.deepEqual(entity(spec, "employee").fields.map((f) => f.name), ["fullName"]);
  });
});

describe("deriveSpec: View and page-level buttons", () => {
  it("builds get (but not update) for a View row button", () => {
    const spec = deriveSpec([screen({ tables: [employeeTable({ rowActions: ["View"] })] })]);
    assert.deepEqual(Object.keys(entity(spec, "employee").endpoints).sort(), ["get", "list"]);
  });

  it("sends an unknown page-level button to the AI layer as a page-wide operation", () => {
    const spec = deriveSpec([
      screen({ tables: [employeeTable({ rowActions: [] })], buttons: [{ label: "Recalculate Bonuses", scope: "page" }] }),
    ]);
    assert.deepEqual(
      { kind: spec.operations[0].kind, scope: spec.operations[0].scope, button: spec.operations[0].button },
      { kind: "custom", scope: "page", button: "Recalculate Bonuses" }
    );
  });
});

// Found by the real-model eval (samples/mocks/m2-add-search-page): the model read the screen correctly.
describe("deriveSpec: bugs found with real screenshots", () => {
  it("treats a '+ Add Product' button as create, not as a custom operation", () => {
    const spec = deriveSpec([screen({ tables: [employeeTable()], buttons: [{ label: "+ Add Product", scope: "page" }] })]);
    assert.ok(entity(spec, "employee").endpoints.create);
    assert.deepEqual(spec.operations, []);
  });

  it("names a filter shown as 'All categories' after the field it filters ('category')", () => {
    const spec = deriveSpec([
      screen({ tables: [employeeTable()], filters: [{ label: "All categories", options: [] }] }),
    ]);
    assert.deepEqual(entity(spec, "employee").endpoints.list.filters, ["category"]);
  });
});

// Found by the real-model eval on the Mac (same model, different answers than on Laptop B).
describe("deriveSpec: rules rely on the strongest evidence", () => {
  it("treats Yes/No values shown as coloured badges as boolean, not enum", () => {
    const spec = deriveSpec([
      screen({ tables: [employeeTable({ columns: [{ label: "In Stock", values: ["Yes", "No", "Yes"], badge: true }] })] }),
    ]);
    assert.equal(field(spec, "employee", "inStock").type, "boolean");
  });

  it("treats a screen with a login form and no table as a login page, even if its kind says 'form'", () => {
    const spec = deriveSpec([
      screen({
        title: "Sign in",
        kind: "form",
        forms: [{ inputs: [{ label: "Email *", kind: "text", required: true }, { label: "Password *", kind: "password", required: true }], submitLabel: "Sign in" }],
        auth: { loginForm: true, signupLink: true, userMenu: false, roleIndicators: [] },
      }),
    ]);
    assert.deepEqual(spec.entities, []);
    assert.ok(spec.auth.login);
    assert.deepEqual(spec.pages, [{ screenshot: 1, kind: "login" }]);
  });
});
