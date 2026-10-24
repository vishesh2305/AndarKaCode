import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import {
  findOperationMemory,
  findScreenshotMemory,
  findSpecMemory,
  rememberVerifiedProject,
} from "../src/memory/index.js";
import { MEMORY_KINDS, Memory } from "../src/models/memory.js";
import { Project } from "../src/models/project.js";
import { Job } from "../src/models/job.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/builder_test_memory";
const TEMP_RUNS = path.join(__dirname, "../.tmp-test-memory");

describe("Memory Model: schema & validation", () => {
  it("defines allowed memory kinds: screenshot, spec, operation", () => {
    assert.deepEqual(MEMORY_KINDS, ["screenshot", "spec", "operation"]);
  });

  it("validates a complete Memory document", async () => {
    const mem = new Memory({
      kind: "screenshot",
      key: "a".repeat(64),
      dHash: "0123456789abcdef",
      verified: true,
      embedding: [0.1, 0.2, 0.3],
      payload: { inventory: { screen: { title: "Test" } } },
    });
    await mem.validate();
    assert.equal(mem.verified, true);
  });

  it("rejects invalid kind and missing required fields", async () => {
    const mem = new Memory({ kind: "invalid-kind" });
    await assert.rejects(() => mem.validate(), (err) => {
      assert.ok(err.errors.kind);
      assert.ok(err.errors.key);
      return true;
    });
  });

  it("defaults verified to true", () => {
    const mem = new Memory({ kind: "spec", key: "hash123" });
    assert.equal(mem.verified, true);
  });

  it("Project model accepts dHash on screenshots and imageDHash on project", async () => {
    const proj = new Project({
      name: "Test Project",
      imageHash: "hash123",
      imageDHash: "0123456789abcdef",
      screenshots: [
        {
          path: "runs/1/screenshot-1.png",
          sha256: "hash123",
          dHash: "0123456789abcdef",
          width: 800,
          height: 600,
        },
      ],
    });
    await proj.validate();
    assert.equal(proj.imageDHash, "0123456789abcdef");
    assert.equal(proj.screenshots[0].dHash, "0123456789abcdef");
  });

  it("Job model accepts 'memory' as provider", async () => {
    const job = new Job({
      projectId: new mongoose.Types.ObjectId(),
      kind: "contract",
      provider: "memory",
    });
    await job.validate();
    assert.equal(job.provider, "memory");
  });
});

describe("Memory Manager: database operations", () => {
  let isConnected = false;

  before(async () => {
    try {
      await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 2000 });
      isConnected = mongoose.connection.readyState === 1;
      if (isConnected) {
        await Memory.deleteMany({});
      }
    } catch (err) {
      console.warn("MongoDB connection skipped in test:", err.message);
    }
    await mkdir(TEMP_RUNS, { recursive: true });
  });

  beforeEach(async () => {
    if (isConnected) {
      await Memory.deleteMany({});
    }
  });

  after(async () => {
    if (isConnected) {
      await Memory.deleteMany({});
      await mongoose.disconnect();
    }
    await rm(TEMP_RUNS, { recursive: true, force: true });
  });

  it("findScreenshotMemory Level 1: exact SHA-256 match", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    const sha = "1111111111111111111111111111111111111111111111111111111111111111";
    await Memory.create({
      kind: "screenshot",
      key: sha,
      dHash: "0000000000000000",
      verified: true,
      payload: { inventory: { screen: { title: "Exact Match Screen" } } },
    });

    const found = await findScreenshotMemory({ sha256: sha, dHash: "ffffffffffffffff" });
    assert.ok(found);
    assert.equal(found.key, sha);
    assert.equal(found.payload.inventory.screen.title, "Exact Match Screen");
  });

  it("findScreenshotMemory Level 2: dHash match with distance <= 6", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    // Base dHash: 0000000000000000
    // Query dHash: 0000000000000003 (differ by 2 bits, <= 6)
    const baseHash = "0000000000000000";
    const nearHash = "0000000000000003";

    await Memory.create({
      kind: "screenshot",
      key: "2222222222222222222222222222222222222222222222222222222222222222",
      dHash: baseHash,
      verified: true,
      payload: { inventory: { screen: { title: "Near Duplicate Screen" } } },
    });

    // Provide a different sha256 so Level 1 does not match
    const found = await findScreenshotMemory({
      sha256: "3333333333333333333333333333333333333333333333333333333333333333",
      dHash: nearHash,
    });

    assert.ok(found);
    assert.equal(found.payload.inventory.screen.title, "Near Duplicate Screen");
  });

  it("findScreenshotMemory Level 2: picks minimal Hamming distance when multiple candidates <= 6", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    const queryDHash = "0000000000000000";
    // Candidate 1: 4 bits differing (000f)
    await Memory.create({
      kind: "screenshot",
      key: "candidate_4bits",
      dHash: "000000000000000f",
      verified: true,
      payload: { inventory: { screen: { title: "4 Bits Screen" } } },
    });

    // Candidate 2: 1 bit differing (0001)
    await Memory.create({
      kind: "screenshot",
      key: "candidate_1bit",
      dHash: "0000000000000001",
      verified: true,
      payload: { inventory: { screen: { title: "1 Bit Screen" } } },
    });

    const found = await findScreenshotMemory({
      sha256: "nonexistent_sha",
      dHash: queryDHash,
    });

    assert.ok(found);
    assert.equal(found.payload.inventory.screen.title, "1 Bit Screen");
  });

  it("findScreenshotMemory: does not match when distance > 6", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    const queryDHash = "ffffffff00000000"; // 32 bits differing from 0000000000000000
    const found = await findScreenshotMemory({
      sha256: "nonexistent_sha",
      dHash: queryDHash,
    });

    assert.equal(found, null);
  });

  it("findScreenshotMemory: ignores unverified records", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    const unverifiedSha = "unverified_sha_12345";
    await Memory.create({
      kind: "screenshot",
      key: unverifiedSha,
      dHash: "aaaaaaaaaaaaaaaa",
      verified: false,
      payload: { inventory: { screen: { title: "Unverified" } } },
    });

    const foundExact = await findScreenshotMemory({ sha256: unverifiedSha });
    assert.equal(foundExact, null);

    const foundDHash = await findScreenshotMemory({ dHash: "aaaaaaaaaaaaaaaa" });
    assert.equal(foundDHash, null);
  });

  it("rememberVerifiedProject: saves screenshots, spec, and custom operations", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    const projectId = new mongoose.Types.ObjectId();
    const project = {
      _id: projectId,
      id: projectId.toString(),
      screenshots: [
        {
          sha256: "saved_shot_sha_1",
          dHash: "1111222233334444",
          inventory: { screen: { title: "Saved Screen" } },
        },
      ],
    };

    const contract = {
      hash: "spec_hash_xyz",
      version: 1,
      body: {
        entities: [{ name: "employee" }],
        operations: [
          {
            name: "recalculateLeave",
            entity: "employee",
            kind: "custom",
            button: "Recalculate",
          },
        ],
      },
    };

    // Write the custom code file in the mock app dir
    const opFile = path.join(TEMP_RUNS, "runs", projectId.toString(), "app", "v1", "backend", "custom", "recalculateLeave.js");
    await mkdir(path.dirname(opFile), { recursive: true });
    const code = "export default async function ({ record }) { return { ok: true }; }";
    await writeFile(opFile, code);

    await rememberVerifiedProject(project, contract, TEMP_RUNS);

    // 1. Verify screenshot memory
    const shotMem = await findScreenshotMemory({ sha256: "saved_shot_sha_1" });
    assert.ok(shotMem);
    assert.equal(shotMem.payload.inventory.screen.title, "Saved Screen");
    assert.equal(shotMem.dHash, "1111222233334444");

    // 2. Verify spec memory
    const specMem = await findSpecMemory("spec_hash_xyz");
    assert.ok(specMem);
    assert.equal(specMem.payload.entities[0].name, "employee");

    // 3. Verify operation memory
    const opMem = await findOperationMemory("employee", "recalculateLeave");
    assert.ok(opMem);
    assert.equal(opMem.payload.code, code);
    assert.equal(opMem.payload.operation.button, "Recalculate");
  });

  it("findOperationMemory: returns null when operation is not found", async (t) => {
    if (!isConnected) return t.skip("MongoDB not running");

    const missing = await findOperationMemory("missingEntity", "missingOp");
    assert.equal(missing, null);
  });
});
