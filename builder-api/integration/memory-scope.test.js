// Step 30 (memory plan M2): memory per workspace, plus a shared library. What one workspace's projects leave
// behind is reused only by that workspace's projects; another workspace never finds it, even for the very
// same screenshot. Reuse between workspaces happens only through the library (promotion comes in Step 39).
// With sign-in off there is one local scope, and memory from before Step 30 stays in it.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { blobs } from "../src/blobs.js";
import { bands } from "../src/memory/dhash.js";
import { forgetAll, memoryCounts, memoryScope, recall, recallLibrary, recallSimilarPage, rememberProject } from "../src/memory/index.js";
import { instructionsHash, inventoryKey } from "../src/memory/keys.js";
import { Memory } from "../src/models/memory.js";
import { databaseUri } from "../src/verify/index.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");

const id = () => new mongoose.Types.ObjectId();
const A = { workspaceId: id() };
const B = { workspaceId: id() };
const LOCAL = {}; // sign-in off: no workspace
const SHA = "a".repeat(64);
const contract = { hash: "c".repeat(64), body: { entities: [], operations: [], pages: [] } };
// A project that reached READY with one screenshot read: rememberProject keeps its reading.
const project = (owner, inventory) => ({ _id: id(), name: `project of ${owner.workspaceId ?? "local"}`, ...owner, screenshots: [{ sha256: SHA, inventory }] });

before(async () => {
  await mongoose.connect(databaseUri(MONGODB_URI, "memory_scope_test"));
  await mongoose.connection.dropDatabase();
  await Memory.syncIndexes();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("memoryScope: whose memory a project or a person uses", () => {
  it("a workspace's own scope; the local scope without one", () => {
    assert.equal(memoryScope(A), `ws:${A.workspaceId}`);
    assert.equal(memoryScope(LOCAL), "local");
  });

  it("has to be told: a lookup without a project or person fails instead of searching everyone's memory", async () => {
    assert.throws(() => memoryScope(undefined), /scope/);
    await assert.rejects(recall("inventory", inventoryKey(SHA)), /scope/);
  });
});

describe("Step 30: workspace B never reuses workspace A's work", () => {
  it("the same screenshot read in A is not found from B, and B keeps its own reading", async () => {
    await rememberProject(project(A, { from: "A" }), contract);
    assert.deepEqual((await recall("inventory", inventoryKey(SHA), A)).payload, { from: "A" });
    assert.equal(await recall("inventory", inventoryKey(SHA), B), null);

    await rememberProject(project(B, { from: "B" }), contract);
    assert.deepEqual((await recall("inventory", inventoryKey(SHA), B)).payload, { from: "B" });
    assert.deepEqual((await recall("inventory", inventoryKey(SHA), A)).payload, { from: "A" }, "A's stays A's");
  });

  it("a near copy of A's screenshot finds A's page from A only", async () => {
    const dHash = "5a5a0f0f33cc96e1";
    const instructions = "Data: employee (Full Name)";
    await Memory.create({
      scope: memoryScope(A),
      kind: "page",
      key: "page-a",
      payloadKey: await blobs.putJson("<html>A</html>"),
      dHash,
      dHashBands: bands(dHash),
      instructionsHash: instructionsHash(instructions),
    });
    assert.equal((await recallSimilarPage(dHash, instructions, A)).memory.payload, "<html>A</html>");
    assert.equal(await recallSimilarPage(dHash, instructions, B), null);
  });

  it("A's verified button code is not offered to B", async () => {
    const fields = [{ name: "status", type: "string" }];
    await Memory.create({ scope: memoryScope(A), kind: "custom", key: "custom-a", payloadKey: await blobs.putJson("record.status = 'done';"), button: "mark done", row: true, fields });
    const spec = { entities: [{ name: "task", fields }] };
    const op = { name: "markDone", entity: "task", button: "Mark done", kind: "custom", scope: "row" };
    const offered = async (owner) => (await recallLibrary(spec, op, owner)).map((m) => m.key);
    assert.deepEqual(await offered(A), ["custom-a"]);
    assert.deepEqual(await offered(B), []);
  });

  it("counting and forgetting touch only the asking workspace", async () => {
    assert.ok((await memoryCounts(A)).inventory >= 1);
    const before = await Memory.countDocuments({ scope: memoryScope(A) });
    await forgetAll(B);
    assert.equal(await Memory.countDocuments({ scope: memoryScope(A) }), before);
    assert.equal((await memoryCounts(B)).inventory, 0);
  });
});

describe("the library: shared work every workspace may reuse", () => {
  it("a library piece is found from any workspace, and a workspace's own piece comes first", async () => {
    const key = inventoryKey("b".repeat(64));
    await Memory.create({ scope: "library", kind: "inventory", key, payloadKey: await blobs.putJson({ from: "library" }) });
    assert.deepEqual((await recall("inventory", key, B)).payload, { from: "library" });
    await Memory.create({ scope: memoryScope(A), kind: "inventory", key, payloadKey: await blobs.putJson({ from: "A" }) });
    assert.deepEqual((await recall("inventory", key, A)).payload, { from: "A" });
  });

  it("forgetting a workspace's memory leaves the library", async () => {
    await forgetAll(A);
    assert.ok((await Memory.countDocuments({ scope: "library" })) >= 1);
  });
});

describe("sign-in off: one local scope, as before", () => {
  it("memory from before Step 30 (no scope) is still found locally, and never from a workspace", async () => {
    const key = inventoryKey("d".repeat(64));
    await Memory.collection.insertOne({ kind: "inventory", key, payloadKey: await blobs.putJson({ from: "old" }), createdAt: new Date(), updatedAt: new Date() });
    assert.deepEqual((await recall("inventory", key, LOCAL)).payload, { from: "old" });
    assert.equal(await recall("inventory", key, A), null);
  });
});
