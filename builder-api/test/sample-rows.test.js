// The live preview starts with the rows the screenshot shows, so every row button can be tried at once.
// The rows come from the page's sample array (const SAMPLE_X = [...]), read as data without running the
// page; when the page has none, from the screenshot's table as the vision model read it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewSeed, sampleArray, sampleDocs, screenshotRows } from "../src/verify/sample-rows.js";
import { editDeleteSpec, opsSpec } from "./fixtures/specs.js";

const pageWith = (script) => `<!doctype html><html><body><table><tbody id="rows"></tbody></table>
<script src="https://cdn.tailwindcss.com"></script>
<script>${script}</script></body></html>`;

const M7 = pageWith(`
  const SAMPLE_EMPLOYEES = [
    { fullName: "Ann Lee", department: "HR", salary: 52000 },
    { "fullName": 'Raj Patel', department: \`Sales\`, salary: 48500 },
  ];
  SAMPLE_EMPLOYEES.forEach((e) => document.getElementById("rows").insertAdjacentHTML("beforeend", "<tr></tr>"));`);

describe("sampleArray: the page's sample rows, read as data (nothing on the page runs)", () => {
  it("reads const SAMPLE_X = [...] with plain values", () => {
    assert.deepEqual(sampleArray(M7, "SAMPLE_EMPLOYEES"), [
      { fullName: "Ann Lee", department: "HR", salary: 52000 },
      { fullName: "Raj Patel", department: "Sales", salary: 48500 },
    ]);
  });

  it("also reads let, var and window.SAMPLE_X = [...], negative numbers, true/false/null and nested arrays", () => {
    assert.deepEqual(sampleArray(pageWith("let SAMPLE_A = [{ n: -3, ok: true, no: null, tags: ['x'] }];"), "SAMPLE_A"), [{ n: -3, ok: true, no: null, tags: ["x"] }]);
    assert.deepEqual(sampleArray(pageWith("var SAMPLE_A = [{ n: 1 }];"), "SAMPLE_A"), [{ n: 1 }]);
    assert.deepEqual(sampleArray(pageWith("window.SAMPLE_A = [{ n: 2 }];"), "SAMPLE_A"), [{ n: 2 }]);
  });

  it("leaves out anything that would need running code (calls, variables, spreads, templates with ${})", () => {
    const rows = sampleArray(pageWith("const x = 1; const SAMPLE_A = [{ a: 'kept', b: new Date(), c: x, d: `t${x}`, ...extra }, makeRow(), 'not a row'];"), "SAMPLE_A");
    assert.deepEqual(rows, [{ a: "kept" }]);
  });

  it("returns null when the page has no such array, and skips scripts that don't parse", () => {
    assert.equal(sampleArray(pageWith("const OTHER = [];"), "SAMPLE_A"), null);
    assert.equal(sampleArray("<html><body>no scripts</body></html>", "SAMPLE_A"), null);
    assert.deepEqual(sampleArray(`<script>this is not ( js</script>${pageWith("const SAMPLE_A = [{ n: 1 }];")}`, "SAMPLE_A"), [{ n: 1 }]);
  });

  it("ignores a name that is not a plain identifier", () => {
    assert.equal(sampleArray(M7, "SAMPLE_EMPLOYEES; alert(1)"), null);
  });
});

const employees = {
  ...editDeleteSpec,
  entities: [
    {
      ...editDeleteSpec.entities[0],
      fields: [
        { name: "fullName", label: "Full Name", type: "string", required: true },
        { name: "salary", label: "Salary", type: "number" },
        { name: "joined", label: "Joined", type: "date" },
        { name: "active", label: "Active", type: "boolean" },
        { name: "status", label: "Status", type: "enum", options: ["Active", "On Leave"] },
        { name: "manager", label: "Manager", type: "ref", ref: "employee" },
      ],
    },
  ],
};

describe("sampleDocs: sample rows -> database records with the spec's types", () => {
  it("keeps only the spec's fields, typed: $52,000 -> 52000, dates, Yes/No, enum spelling; no relations", () => {
    const [doc] = sampleDocs(employees, "employee", [
      { fullName: "Ann Lee", salary: "$52,000", joined: "2026-01-15", active: "Yes", status: "on leave", manager: "Raj", avatar: "a.png" },
    ]);
    const { createdAt, updatedAt, ...fields } = doc;
    assert.deepEqual(fields, { fullName: "Ann Lee", salary: 52000, joined: new Date("2026-01-15"), active: true, status: "On Leave" });
    assert.ok(createdAt instanceof Date && updatedAt instanceof Date);
  });

  it("leaves out values that don't fit (not a number, not a choice, not a date)", () => {
    const [doc] = sampleDocs(employees, "employee", [{ fullName: "Ann", salary: "lots", status: "Fired", joined: "someday" }]);
    assert.deepEqual(Object.keys(doc).filter((k) => !k.endsWith("At")), ["fullName"]);
  });

  it("keeps the page's order: the first sample row is the newest record (lists show newest first)", () => {
    const docs = sampleDocs(employees, "employee", [{ fullName: "First" }, { fullName: "Second" }]);
    assert.ok(docs[0].createdAt > docs[1].createdAt);
  });

  it("skips rows with none of the spec's fields, and marks rows not deleted when Delete only archives", () => {
    assert.equal(sampleDocs(employees, "employee", [{ photo: "x.png" }, null, "text"]).length, 0);
    const soft = { ...employees, entities: [{ ...employees.entities[0], endpoints: { ...employees.entities[0].endpoints, delete: { soft: true } } }] };
    assert.equal(sampleDocs(soft, "employee", [{ fullName: "Ann" }])[0].deletedAt, null);
  });
});

describe("screenshotRows: the screenshot's table when the page has no sample array", () => {
  it("lines up each column's values into rows, by the field labels", () => {
    const inventory = {
      tables: [
        {
          columns: [
            { label: "Full Name", values: ["Ann Lee", "Raj Patel"] },
            { label: "Salary", values: ["$52,000", "$48,500"] },
            { label: "Photo", values: ["a", "b"] },
          ],
        },
      ],
    };
    assert.deepEqual(screenshotRows(employees, "employee", inventory), [
      { fullName: "Ann Lee", salary: "$52,000" },
      { fullName: "Raj Patel", salary: "$48,500" },
    ]);
  });

  it("returns [] when no table matches the entity", () => {
    assert.deepEqual(screenshotRows(employees, "employee", { tables: [{ columns: [{ label: "City", values: ["Pune"] }] }] }), []);
    assert.deepEqual(screenshotRows(employees, "employee", null), []);
  });
});

describe("previewSeed: the records the preview starts with, per collection", () => {
  it("uses each data page's sample array, else its screenshot's table; one set per entity", () => {
    const page = pageWith('const SAMPLE_LEAVEREQUESTS = [{ employee: "Isha", days: 2, status: "Pending" }];');
    const seed = previewSeed({ spec: opsSpec, pages: [{ screenshot: 1, html: page }], inventories: [] });
    assert.deepEqual(Object.keys(seed), ["leaveRequests"]);
    assert.equal(seed.leaveRequests.length, 1);
    assert.equal(seed.leaveRequests[0].employee, "Isha");

    const fromShot = previewSeed({
      spec: opsSpec,
      pages: [{ screenshot: 1, html: "<html><body></body></html>" }],
      inventories: [{ tables: [{ columns: [{ label: "Employee", values: ["Kabir"] }, { label: "Days", values: ["5"] }] }] }],
    });
    assert.deepEqual(fromShot.leaveRequests.map((d) => [d.employee, d.days]), [["Kabir", 5]]);
  });

  it("is empty for pages without data (a login page)", () => {
    const spec = { ...opsSpec, pages: [{ screenshot: 1, kind: "login" }] };
    assert.deepEqual(previewSeed({ spec, pages: [{ screenshot: 1, html: "<html></html>" }], inventories: [] }), {});
  });
});
