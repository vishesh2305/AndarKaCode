// Step 23c: every custom button gets its code at the same time, each tried on its own throwaway database
// (pressing one button empties its database, so two buttons can't share one).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buttonDatabase, writeButtons } from "../src/custom/all.js";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const PROJECT = "6ae8d8648b054f300337ecdb";

describe("buttonDatabase: one throwaway database per button", () => {
  it("is different for every button of a project, and for every project", () => {
    assert.notEqual(buttonDatabase(PROJECT, 0), buttonDatabase(PROJECT, 1));
    assert.notEqual(buttonDatabase(PROJECT, 0), buttonDatabase("aaaaaaaaaaaaaaaaaaaaaaaa", 0));
  });

  it("fits MongoDB's name limit (63 characters) and starts with custom_", () => {
    const name = buttonDatabase(PROJECT, 99);
    assert.ok(name.length <= 63, name);
    assert.match(name, /^custom_/);
  });
});

describe("writeButtons: every button at the same time", () => {
  it("starts writing every button before the first one is done", async () => {
    let running = 0;
    let most = 0;
    await writeButtons(["raise", "duplicate", "markPaid"], {
      writeOne: async () => (most = Math.max(most, ++running), await tick(20), running--, { ok: true }),
    });
    assert.equal(most, 3);
  });

  it("never writes more than `limit` at once", async () => {
    let running = 0;
    let most = 0;
    await writeButtons([1, 2, 3, 4, 5], { limit: 2, writeOne: async () => (most = Math.max(most, ++running), await tick(10), running--, {}) });
    assert.equal(most, 2);
  });

  it("gives each button its index, and keeps the buttons' order in the results", async () => {
    const delays = { raise: 30, duplicate: 5, markPaid: 15 };
    const results = await writeButtons(["raise", "duplicate", "markPaid"], {
      writeOne: async (op, i) => (await tick(delays[op]), `${i}:${op}`),
    });
    assert.deepEqual(results, ["0:raise", "1:duplicate", "2:markPaid"]);
  });

  it("one button that can't be written does not stop the others", async () => {
    const results = await writeButtons(["good", "bad", "good2"], {
      writeOne: async (op) => (op === "bad" ? { ok: false, problem: "never passes" } : { ok: true }),
    });
    assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  });
});
