// UI inventory: whatever the vision model returns -> a clean, complete inventory the Spec Deriver can trust.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInventory, readInventory } from "../src/spec/inventory.js";

describe("normalizeInventory: completeness", () => {
  it("fills every missing part with an empty default", () => {
    const inv = normalizeInventory({ title: "Employees" });
    assert.deepEqual(inv, {
      title: "Employees",
      kind: "other",
      tables: [],
      forms: [],
      buttons: [],
      search: false,
      filters: [],
      pagination: false,
      statCards: [],
      auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
    });
  });

  it("fills missing parts inside tables, columns and forms", () => {
    const inv = normalizeInventory({
      tables: [{ columns: [{ label: "Name" }] }],
      forms: [{ inputs: [{ label: "Name" }] }],
    });
    assert.deepEqual(inv.tables[0].columns[0], { label: "Name", values: [], badge: false });
    assert.deepEqual(inv.tables[0].rowActions, []);
    assert.deepEqual(inv.forms[0].inputs[0], { label: "Name", kind: "text", required: false });
  });
});

describe("normalizeInventory: cleaning", () => {
  it("trims labels and drops empty ones", () => {
    const inv = normalizeInventory({
      tables: [{ columns: [{ label: "  Full Name " }, { label: "   " }], rowActions: [" Edit", ""] }],
      buttons: [{ label: "", scope: "page" }, { label: " Add Employee ", scope: "page" }],
    });
    assert.deepEqual(inv.tables[0].columns.map((c) => c.label), ["Full Name"]);
    assert.deepEqual(inv.tables[0].rowActions, ["Edit"]);
    assert.deepEqual(inv.buttons, [{ label: "Add Employee", scope: "page" }]);
  });

  it("shortens long text, so screenshot text can't smuggle long instructions into later prompts", () => {
    const inv = normalizeInventory({ title: "x".repeat(500), tables: [{ columns: [{ label: "A", values: ["y".repeat(500)] }] }] });
    assert.equal(inv.title.length, 80);
    assert.equal(inv.tables[0].columns[0].values[0].length, 80);
  });

  it("keeps at most 5 sample values per column, as strings", () => {
    const inv = normalizeInventory({ tables: [{ columns: [{ label: "Age", values: [1, 2, 3, 4, 5, 6, 7] }] }] });
    assert.deepEqual(inv.tables[0].columns[0].values, ["1", "2", "3", "4", "5"]);
  });

  it("removes duplicate row actions and buttons", () => {
    const inv = normalizeInventory({
      tables: [{ columns: [{ label: "Name" }], rowActions: ["Edit", "Delete", "Edit"] }],
      buttons: [{ label: "Export", scope: "page" }, { label: "Export", scope: "page" }],
    });
    assert.deepEqual(inv.tables[0].rowActions, ["Edit", "Delete"]);
    assert.equal(inv.buttons.length, 1);
  });

  it("drops the 'All' option from filters", () => {
    const inv = normalizeInventory({ filters: [{ label: "Department", options: ["All", "HR", "All departments", "IT"] }] });
    assert.deepEqual(inv.filters[0].options, ["HR", "IT"]);
  });

  it("replaces unknown input kinds and button scopes with safe defaults", () => {
    const inv = normalizeInventory({
      forms: [{ inputs: [{ label: "Name", kind: "fancy-picker" }] }],
      buttons: [{ label: "Save", scope: "somewhere" }],
    });
    assert.equal(inv.forms[0].inputs[0].kind, "text");
    assert.equal(inv.buttons[0].scope, "page");
  });
});

describe("normalizeInventory: row buttons", () => {
  it("moves buttons reported with scope 'row' into the first table's row actions", () => {
    const inv = normalizeInventory({
      tables: [{ columns: [{ label: "Name" }], rowActions: ["Edit"] }],
      buttons: [{ label: "Approve", scope: "row" }, { label: "Add", scope: "page" }],
    });
    assert.deepEqual(inv.tables[0].rowActions, ["Edit", "Approve"]);
    assert.deepEqual(inv.buttons, [{ label: "Add", scope: "page" }]);
  });

  it("keeps a row button as a page button when there is no table to put it in", () => {
    const inv = normalizeInventory({ buttons: [{ label: "Approve", scope: "row" }] });
    assert.deepEqual(inv.buttons, [{ label: "Approve", scope: "page" }]);
  });
});

describe("normalizeInventory: screen kind", () => {
  it("keeps a valid kind from the model", () => {
    assert.equal(normalizeInventory({ kind: "dashboard" }).kind, "dashboard");
  });

  it("works out the kind when the model gave none or an invalid one", () => {
    assert.equal(normalizeInventory({ auth: { loginForm: true } }).kind, "login");
    assert.equal(normalizeInventory({ kind: "weird", statCards: [{ label: "Total", value: "4" }] }).kind, "dashboard");
    assert.equal(normalizeInventory({ tables: [{ columns: [{ label: "A" }] }] }).kind, "list");
    assert.equal(normalizeInventory({ forms: [{ inputs: [{ label: "A" }] }] }).kind, "form");
  });
});

describe("readInventory", () => {
  const image = Buffer.from("fake png").toString("base64");
  const okJson = JSON.stringify({ title: "Employees", kind: "list", tables: [{ columns: [{ label: "Name" }] }] });

  it("sends the image, the prompt and the schema to the model, and returns a normalized inventory", async () => {
    let seen;
    const providers = { local: async (req) => ((seen = req), okJson) };
    const { inventory, provider } = await readInventory(image, { mode: "local", providers });

    assert.equal(provider, "local");
    assert.equal(inventory.tables[0].columns[0].label, "Name");
    assert.equal(inventory.auth.loginForm, false, "normalized");
    assert.equal(seen.imageB64, image);
    assert.match(seen.prompt, /only what is visible/i);
    assert.equal(seen.schema.type, "object");
  });

  it("in auto mode, falls back to cloud when local fails", async () => {
    const providers = {
      local: async () => {
        throw new Error("Ollama down");
      },
      cloud: async () => okJson,
    };
    const { provider } = await readInventory(image, { mode: "auto", providers });
    assert.equal(provider, "cloud");
  });

  it("in auto mode, falls back to cloud when local returns broken JSON", async () => {
    const providers = { local: async () => "{ not json", cloud: async () => okJson };
    const { provider } = await readInventory(image, { mode: "auto", providers });
    assert.equal(provider, "cloud");
  });

  it("reports every provider's error when all fail", async () => {
    const providers = {
      local: async () => {
        throw new Error("Ollama down");
      },
      cloud: async () => {
        throw new Error("Gemini 429");
      },
    };
    await assert.rejects(readInventory(image, { mode: "auto", providers }), /local: Ollama down.*cloud: Gemini 429/s);
  });

  it("does not try cloud in local mode", async () => {
    let cloudCalled = false;
    const providers = {
      local: async () => {
        throw new Error("Ollama down");
      },
      cloud: async () => ((cloudCalled = true), okJson),
    };
    await assert.rejects(readInventory(image, { mode: "local", providers }), /Ollama down/);
    assert.equal(cloudCalled, false);
  });
});
