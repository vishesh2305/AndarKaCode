// Verifier (Step 16), check 1: does each page carry the markers its part of the spec needs?
// expectedMarkers = what the spec asks of a page; pageMarkers = what the page (with its own scripts) has.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectedMarkers, markerCheck, pageMarkers } from "../src/verify/markers.js";
import { apiMap } from "../src/wirer/index.js";
import { dashboardSpec, employeesSpec } from "./fixtures/page-specs.js";
import { authSpec, editDeleteSpec } from "./fixtures/specs.js";
import { page } from "./helpers/page.js";

describe("expectedMarkers: what the spec asks of one page", () => {
  it("a list page with a form: its fields, Add, Edit, Delete and the search box, with the labels a person sees", () => {
    const expected = expectedMarkers(employeesSpec, 1);
    assert.deepEqual(expected.fields.map((f) => f.name), ["fullName", "email", "department", "salary"]);
    assert.deepEqual(expected.actions.map((a) => [a.name, a.label]), [
      ["create", "Add Employee"],
      ["update", "Edit"],
      ["delete", "Delete"],
      ["search", "the search box"],
    ]);
    assert.equal(expected.entity, "employee");
  });

  it("a dashboard: stat cards, filter, previous/next, and its row and page buttons", () => {
    const expected = expectedMarkers(dashboardSpec, 1);
    assert.deepEqual(expected.stats, ["totalRequests", "pending", "totalDays", "happinessIndex"]);
    assert.deepEqual(expected.filters, ["status"]);
    assert.deepEqual(
      expected.actions.map((a) => a.name),
      ["prevPage", "nextPage", "approveLeaveRequest", "rejectLeaveRequest", "exportLeaveRequests", "recalculateLeaveRequest", "syncPayrollLeaveRequest"]
    );
  });

  it("a login page: email, password, Sign in, and Sign up only when shown", () => {
    assert.deepEqual(expectedMarkers(authSpec, 1), {
      kind: "login",
      entity: null,
      fields: [
        { name: "email", label: "Email" },
        { name: "password", label: "Password" },
      ],
      actions: [
        { name: "login", label: "Sign in" },
        { name: "signup", label: "Sign up" },
      ],
      filters: [],
      stats: [],
    });
  });

  it("only what is on THAT page (evidence sN), not the other pages' parts", () => {
    const expected = expectedMarkers(authSpec, 2);
    assert.deepEqual(expected.actions.map((a) => a.name), ["delete"]);
    assert.deepEqual(expected.fields.map((f) => f.name), ["fullName"]);
  });
});

describe("pageMarkers: what the page really has, after its own scripts ran", () => {
  it("reads markers set in the HTML and by the page's scripts (rows drawn on DOMContentLoaded)", async () => {
    const found = await pageMarkers(page("leave-dashboard.html"));
    assert.ok(found.fields.includes("status"), "a cell drawn by the page's script");
    assert.ok(found.actions.includes("approveLeaveRequest"));
    assert.deepEqual(found.filters, ["status"]);
    assert.deepEqual(found.stats.sort(), ["pending", "totalDays", "totalRequests"]);
  });

  it("knows whether a form with inputs and a submit button exists (Add works without a data-action)", async () => {
    assert.equal((await pageMarkers(page("employees-real.html"))).submitForm, true);
    assert.equal((await pageMarkers(page("leave-dashboard.html"))).submitForm, false);
  });
});

describe("markerCheck: pass, or say what is missing in a person's words", () => {
  it("passes the real Laptop B employees page (Add through its form)", async () => {
    const check = markerCheck(expectedMarkers(employeesSpec, 1), await pageMarkers(page("employees-real.html")));
    assert.equal(check.status, "pass", check.detail);
  });

  it("fails with the field's label and blames the page when a marker is missing", async () => {
    const html = page("employees-real.html").replaceAll('data-field="salary"', ""); // in the form and in the rows
    const check = markerCheck(expectedMarkers(employeesSpec, 1), await pageMarkers(html));
    assert.equal(check.status, "fail");
    assert.equal(check.layer, "page");
    assert.match(check.detail, /Salary/);
  });

  it("warns about a button on the page that the spec does not know (it would do nothing)", async () => {
    const html = page("employees-real.html").replace("<h1", '<button data-action="archiveAll">Archive all</button><h1');
    const check = markerCheck(expectedMarkers(employeesSpec, 1), await pageMarkers(html));
    assert.equal(check.status, "pass");
    assert.match(check.warnings.join(" "), /archiveAll/);
  });

  it("counts a marker the binder could add from the page (a label, a header) as there, and lists the repair", async () => {
    const html = page("employees-real.html").replaceAll('data-field="salary"', "");
    const found = await pageMarkers(html, { map: apiMap(employeesSpec), file: "page-1.html" });
    assert.ok(found.fields.includes("salary"));
    const check = markerCheck(expectedMarkers(employeesSpec, 1), found);
    assert.equal(check.status, "pass");
    assert.match(check.warnings.join(" "), /added by AndarKaCode.*salary/i);
  });

  it("still fails when nothing on the page shows where the marker belongs", async () => {
    const html = page("employees-real.html")
      .replaceAll('data-field="salary"', "")
      .replace('id="salary" name="salary"', 'id="pay" name="pay"')
      .replace(/>Salary</g, ">Pay<");
    const found = await pageMarkers(html, { map: apiMap(employeesSpec), file: "page-1.html" });
    const check = markerCheck(expectedMarkers(employeesSpec, 1), found);
    assert.equal(check.status, "fail");
    assert.match(check.detail, /Salary/);
  });

  it("a missing Edit/Delete button in the sample rows is a page problem too", async () => {
    const html = page("employees-real.html").replace(/<button data-action="delete"[^>]*>Delete<\/button>/, "");
    const check = markerCheck(expectedMarkers(editDeleteSpec, 1), await pageMarkers(html));
    assert.equal(check.status, "fail");
    assert.match(check.detail, /Delete/);
  });
});
