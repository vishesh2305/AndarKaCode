// Backend generator, piece 11.1: package.json, .env.example, server.js, models, validation.
// Generated files are written to test/.generated/ and RUN: imported, validated against, started.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "core"); // outside test/: generated apps contain their own *.test.js
const ev = (what) => `s1: ${what}`;

// Edit/Delete only: list, get, update, delete.
const editDeleteSpec = {
  entities: [
    {
      name: "employee",
      plural: "employees",
      label: "Employees",
      sampleConst: "SAMPLE_EMPLOYEES",
      fields: [
        { name: "fullName", label: "Full Name", type: "string", required: true, evidence: ev("column 'Full Name'") },
        { name: "email", label: "Email", type: "email", required: true, evidence: ev("column 'Email'") },
        { name: "salary", label: "Salary", type: "number", required: false, evidence: ev("column 'Salary'") },
      ],
      endpoints: {
        list: { search: false, filters: [], pagination: false, evidence: ev("table 'Employees'") },
        get: { evidence: ev("row action 'Edit' (loads the record)") },
        update: { evidence: ev("row action 'Edit'") },
        delete: { soft: false, evidence: ev("row action 'Delete'") },
      },
    },
  ],
  operations: [],
  stats: [],
  auth: null,
  pages: [{ screenshot: 1, kind: "list", entity: "employee" }],
  openQuestions: [],
};

// A list-only dashboard: no create/update, so no validation file.
const listOnlySpec = {
  ...editDeleteSpec,
  entities: [{ ...editDeleteSpec.entities[0], endpoints: { list: editDeleteSpec.entities[0].endpoints.list } }],
};

// Relations, enum, boolean, date, soft delete.
const richSpec = {
  entities: [
    {
      name: "department",
      plural: "departments",
      label: "Departments",
      sampleConst: "SAMPLE_DEPARTMENTS",
      fields: [{ name: "name", label: "Name", type: "string", required: true, evidence: "s2: column 'Name'" }],
      endpoints: { list: { search: false, filters: [], pagination: false, evidence: "s2: table" } },
    },
    {
      name: "leaveRequest",
      plural: "leaveRequests",
      label: "Leave Requests",
      sampleConst: "SAMPLE_LEAVEREQUESTS",
      fields: [
        { name: "department", label: "Department", type: "ref", ref: "department", required: true, evidence: ev("column 'Department'; s2: table") },
        { name: "from", label: "From", type: "date", required: true, evidence: ev("column 'From'") },
        { name: "status", label: "Status", type: "enum", options: ["Pending", "Approved"], required: false, evidence: ev("column 'Status'") },
        { name: "paid", label: "Paid", type: "boolean", required: false, evidence: ev("column 'Paid'") },
      ],
      endpoints: {
        list: { search: false, filters: [], pagination: false, evidence: ev("table") },
        create: { evidence: ev("button 'Add'") },
        delete: { soft: true, evidence: ev("row action 'Delete'; s1: button 'Show Archived'") },
      },
    },
  ],
  operations: [],
  stats: [],
  auth: null,
  pages: [
    { screenshot: 1, kind: "list", entity: "leaveRequest" },
    { screenshot: 2, kind: "list", entity: "department" },
  ],
  openQuestions: [],
};

const load = (dir, file) => import(pathToFileURL(path.join(OUT, dir, file)).href);

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await writeBackend(path.join(OUT, "edit"), generateBackend(editDeleteSpec, { name: "Employee Directory" }));
  await writeBackend(path.join(OUT, "rich"), generateBackend(richSpec, { name: "Leave Desk" }));
});
after(() => rm(OUT, { recursive: true, force: true }));

describe("generateBackend: only the files the spec needs", () => {
  it("makes package.json, .env.example, server, model, validation, controller and routes for an entity with update", () => {
    assert.deepEqual(Object.keys(generateBackend(editDeleteSpec, { name: "x" })).sort(), [
      ".env.example",
      "backend/controllers/employee.controller.js",
      "backend/models/employee.model.js",
      "backend/routes/employee.routes.js",
      "backend/server.js",
      "backend/validation/employee.validation.js",
      "package.json",
      "tests/api.test.js",
    ]);
  });

  it("makes no validation file when nothing can be created or updated", () => {
    const files = Object.keys(generateBackend(listOnlySpec, { name: "x" }));
    assert.ok(!files.some((f) => f.includes("validation")), files.join(", "));
  });

  it("makes one model per entity and validation only where needed", () => {
    const files = Object.keys(generateBackend(richSpec, { name: "x" }));
    assert.ok(files.includes("backend/models/department.model.js"));
    assert.ok(files.includes("backend/models/leaveRequest.model.js"));
    assert.ok(files.includes("backend/validation/leaveRequest.validation.js"));
    assert.ok(!files.includes("backend/validation/department.validation.js"), "departments can't be created or edited");
  });

  it("is deterministic: the same spec gives the same files", () => {
    assert.deepEqual(generateBackend(richSpec, { name: "Leave Desk" }), generateBackend(richSpec, { name: "Leave Desk" }));
  });

  it("produces JavaScript that Node accepts", () => {
    for (const dir of ["edit", "rich"]) {
      for (const file of Object.keys(generateBackend(dir === "edit" ? editDeleteSpec : richSpec, { name: "x" })).filter((f) => f.endsWith(".js"))) {
        const check = spawnSync(process.execPath, ["--check", path.join(OUT, dir, file)], { encoding: "utf8" });
        assert.equal(check.status, 0, `${file}: ${check.stderr}`);
      }
    }
  });
});

describe("package.json and .env.example", () => {
  const files = generateBackend(editDeleteSpec, { name: "Employee Directory" });
  const pkg = JSON.parse(files["package.json"]);

  it("names the app, uses ES modules, and depends on exactly express and mongoose", () => {
    assert.equal(pkg.name, "employee-directory");
    assert.equal(pkg.type, "module");
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["express", "mongoose"]);
    assert.equal(pkg.devDependencies, undefined);
  });

  it("has start and test scripts", () => {
    assert.match(pkg.scripts.start, /backend\/server\.js/);
    assert.match(pkg.scripts.test, /node --test/);
  });

  it("lists MONGODB_URI and PORT, and no JWT_SECRET when there is no login screen", () => {
    assert.match(files[".env.example"], /^MONGODB_URI=mongodb:\/\/127\.0\.0\.1:27017\/employee_directory$/m);
    assert.match(files[".env.example"], /^PORT=3000$/m);
    assert.doesNotMatch(files[".env.example"], /JWT/);
  });
});

describe("generated model", () => {
  it("maps field types, required, enum options and relations", async () => {
    const { LeaveRequest } = await load("rich", "backend/models/leaveRequest.model.js");
    const paths = LeaveRequest.schema.paths;
    assert.equal(paths.department.instance, "ObjectId");
    assert.equal(paths.department.options.ref, "Department");
    assert.equal(paths.from.instance, "Date");
    assert.deepEqual(paths.status.options.enum, ["Pending", "Approved"]);
    assert.equal(paths.paid.instance, "Boolean");
    assert.equal(paths.department.isRequired, true);
    assert.equal(LeaveRequest.collection.collectionName, "leaveRequests");
  });

  it("adds deletedAt only when the screen shows soft delete", async () => {
    const { LeaveRequest } = await load("rich", "backend/models/leaveRequest.model.js");
    const { Employee } = await load("edit", "backend/models/employee.model.js");
    assert.ok(LeaveRequest.schema.paths.deletedAt);
    assert.equal(Employee.schema.paths.deletedAt, undefined);
  });

  it("rejects records that break the schema, without a database", async () => {
    const { Employee } = await load("edit", "backend/models/employee.model.js");
    const { errors } = await new Employee({ email: "NOT-LOWER@x.com" }).validate().catch((err) => err);
    assert.ok(errors.fullName, "fullName is required");
    assert.equal(new Employee({ fullName: "Ann", email: "ANN@X.COM" }).email, "ann@x.com", "emails stored lowercase");
  });

  it("returns id instead of _id in JSON", async () => {
    const { Employee } = await load("edit", "backend/models/employee.model.js");
    const json = new Employee({ fullName: "Ann", email: "a@x.com" }).toJSON();
    assert.equal(typeof json.id, "string");
    assert.equal(json._id, undefined);
    assert.equal(json.__v, undefined);
  });

  it("explains in a comment which screenshot element each field comes from", () => {
    assert.match(generateBackend(editDeleteSpec, { name: "x" })["backend/models/employee.model.js"], /s1: column 'Full Name'/);
  });
});

describe("generated validation", () => {
  it("requires required fields on create, but not on a partial update", async () => {
    const { validateEmployee } = await load("edit", "backend/validation/employee.validation.js");
    assert.deepEqual(validateEmployee({}).errors, { fullName: "is required", email: "is required" });
    assert.equal(validateEmployee({ salary: "100" }, { partial: true }).ok, true);
  });

  it("converts form strings to the right types and trims text", async () => {
    const { validateEmployee } = await load("edit", "backend/validation/employee.validation.js");
    const { ok, value } = validateEmployee({ fullName: "  Ann Lee ", email: "Ann@Corp.com", salary: "52000" });
    assert.equal(ok, true);
    assert.deepEqual(value, { fullName: "Ann Lee", email: "ann@corp.com", salary: 52000 });
  });

  it("rejects wrong emails, numbers, enum values, dates and relation ids", async () => {
    const { validateEmployee } = await load("edit", "backend/validation/employee.validation.js");
    const { validateLeaveRequest } = await load("rich", "backend/validation/leaveRequest.validation.js");
    assert.equal(validateEmployee({ fullName: "A", email: "nope", salary: "abc" }).errors.email, "must be an email address");
    assert.equal(validateEmployee({ fullName: "A", email: "a@x.com", salary: "abc" }).errors.salary, "must be a number");
    const bad = validateLeaveRequest({ department: "123", from: "not a date", status: "Lost", paid: "maybe" }).errors;
    assert.deepEqual(Object.keys(bad).sort(), ["department", "from", "paid", "status"]);
  });

  it("accepts valid enum, boolean, date and relation values", async () => {
    const { validateLeaveRequest } = await load("rich", "backend/validation/leaveRequest.validation.js");
    const { ok, value } = validateLeaveRequest({ department: "a".repeat(24), from: "2026-11-02", status: "Approved", paid: "true" });
    assert.equal(ok, true);
    assert.equal(value.paid, true);
    assert.ok(value.from instanceof Date);
  });

  it("ignores fields that are not in the spec", async () => {
    const { validateEmployee } = await load("edit", "backend/validation/employee.validation.js");
    const { value } = validateEmployee({ fullName: "A", email: "a@x.com", isAdmin: true });
    assert.equal(value.isAdmin, undefined);
  });
});

describe("generated server", () => {
  it("starts and answers GET /health without needing a database", async () => {
    const { app } = await load("edit", "backend/server.js");
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
    } finally {
      server.close();
    }
  });
});

// Found by reading generated code: a formatting step added spaces after commas INSIDE enum values.
describe("generated validation: values are copied exactly", () => {
  it("keeps an enum option that contains a comma unchanged", async () => {
    const spec = {
      ...editDeleteSpec,
      entities: [
        {
          ...editDeleteSpec.entities[0],
          fields: [{ name: "region", label: "Region", type: "enum", options: ["Sales, EMEA", "HR"], required: true, evidence: ev("column 'Region'") }],
        },
      ],
    };
    await writeBackend(path.join(OUT, "comma"), generateBackend(spec, { name: "x" }));
    const { validateEmployee } = await load("comma", "backend/validation/employee.validation.js");
    assert.equal(validateEmployee({ region: "Sales, EMEA" }).ok, true);
  });
});
