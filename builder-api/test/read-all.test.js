// Step 23: every screenshot is read at the same time, so reading 3 takes about as long as reading 1.
// The readings keep the screenshots' order (the spec numbers its pages by it), memory is still reused,
// and the job still says "cloud" when any screenshot needed the cloud model.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readScreenshots } from "../src/spec/read-all.js";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = (n) => Array.from({ length: n }, (_, i) => ({ path: `s${i + 1}.png`, sha256: `sha${i + 1}` }));
const noMemory = async () => null;

describe("readScreenshots: all screenshots at the same time", () => {
  it("starts every reading before the first one finishes", async () => {
    let running = 0;
    let most = 0;
    const read = async (shot) => {
      most = Math.max(most, ++running);
      await tick(20);
      running--;
      return { inventory: { title: shot.path }, provider: "local" };
    };
    await readScreenshots(shots(3), { read, recall: noMemory });
    assert.equal(most, 3);
  });

  it("never reads more than `limit` at once", async () => {
    let running = 0;
    let most = 0;
    const read = async () => (most = Math.max(most, ++running), await tick(10), running--, { inventory: {}, provider: "local" });
    await readScreenshots(shots(5), { read, recall: noMemory, limit: 2 });
    assert.equal(most, 2);
  });

  it("keeps the screenshots' order, whichever reading finishes first", async () => {
    const delays = { "s1.png": 30, "s2.png": 5, "s3.png": 15 };
    const read = async (shot) => (await tick(delays[shot.path]), { inventory: { title: shot.path }, provider: "local" });
    const { inventories } = await readScreenshots(shots(3), { read, recall: noMemory });
    assert.deepEqual(inventories.map((inv) => inv.title), ["s1.png", "s2.png", "s3.png"]);
  });

  it("takes a screenshot read before from memory, without asking the vision model", async () => {
    const asked = [];
    const read = async (shot) => (asked.push(shot.path), { inventory: { title: "read now" }, provider: "local" });
    const recall = async (shot) => (shot.sha256 === "sha2" ? { payload: { title: "remembered" }, provider: "cloud", seconds: 12 } : null);
    const { inventories, reused } = await readScreenshots(shots(3), { read, recall });
    assert.deepEqual(asked, ["s1.png", "s3.png"]);
    assert.deepEqual(inventories.map((inv) => inv.title), ["read now", "remembered", "read now"]);
    assert.equal(reused.length, 1);
    assert.equal(reused[0].seconds, 12);
  });

  it("says cloud when any screenshot needed the cloud model, local when none did", async () => {
    const readBy = (providers) => async (shot) => ({ inventory: {}, provider: providers[shot.path] });
    const mixed = await readScreenshots(shots(3), { read: readBy({ "s1.png": "local", "s2.png": "cloud", "s3.png": "local" }), recall: noMemory });
    assert.equal(mixed.provider, "cloud");
    const allLocal = await readScreenshots(shots(2), { read: readBy({ "s1.png": "local", "s2.png": "local" }), recall: noMemory });
    assert.equal(allLocal.provider, "local");
  });

  it("fails with the reading's own error when a screenshot can't be read", async () => {
    const read = async (shot) => {
      if (shot.path === "s2.png") throw new Error("local: Ollama 500: out of memory");
      return { inventory: {}, provider: "local" };
    };
    await assert.rejects(readScreenshots(shots(3), { read, recall: noMemory }), /Ollama 500: out of memory/);
  });
});
