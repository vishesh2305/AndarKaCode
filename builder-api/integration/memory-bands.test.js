// Step 28 (memory plan M3): near-duplicate search at scale. With 100,000 remembered pages for the same page
// instructions, a copy of a screenshot (a few bits away) still finds its page quickly, through the bands
// index, instead of loading and comparing every row. Rows remembered before the bands are still found.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { bands } from "../src/memory/dhash.js";
import { recallSimilarPage } from "../src/memory/index.js";
import { instructionsHash } from "../src/memory/keys.js";
import { Memory } from "../src/models/memory.js";
import { databaseUri } from "../src/verify/index.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");

const INSTRUCTIONS = "Data: employee (Full Name, Department)";
const random = () => [...Array(16)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const flip = (hex, ...bits) => bits.reduce((h, bit) => (BigInt(`0x${h}`) ^ (1n << BigInt(bit))).toString(16).padStart(16, "0"), hex);
const row = (dHash, n, withBands = true) => ({
  kind: "page",
  key: `page-${n}`,
  payload: `<html>page ${n}</html>`,
  dHash,
  ...(withBands && { dHashBands: bands(dHash) }),
  instructionsHash: instructionsHash(INSTRUCTIONS),
  createdAt: new Date(),
  updatedAt: new Date(),
});

before(async () => {
  await mongoose.connect(databaseUri(MONGODB_URI, "memory_bands_test"));
  await mongoose.connection.dropDatabase();
  await Memory.syncIndexes();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("recallSimilarPage among 100,000 remembered pages (Step 28, M3)", () => {
  const original = "5a5a0f0f33cc96e1";

  it("finds the copy a few bits away, in under half a second", async () => {
    const rows = [row(original, "original")];
    for (let n = 0; n < 100_000; n++) rows.push(row(random(), n));
    for (let i = 0; i < rows.length; i += 10_000) await Memory.collection.insertMany(rows.slice(i, i + 10_000), { ordered: false });

    const copy = flip(original, 3, 17, 40, 61); // 4 bits away, like a re-saved screenshot
    const started = performance.now();
    const found = await recallSimilarPage(copy, INSTRUCTIONS);
    const ms = performance.now() - started;
    assert.equal(found?.memory.key, "page-original");
    assert.equal(found.distance, 4);
    assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
  });

  it("a page remembered before the bands existed is still found", async () => {
    const old = "0f0f0f0f0f0f0f0f";
    await Memory.collection.insertOne(row(old, "before-bands", false));
    assert.equal((await recallSimilarPage(flip(old, 5, 9), INSTRUCTIONS))?.memory.key, "page-before-bands");
  });
});
