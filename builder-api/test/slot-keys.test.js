// Step 31c: opening a project's slot key for a model call. The project keeps which key and model each slot
// used (never the key); the key is opened from the vault only at the moment of the call.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { createVault } from "../src/keys/vault.js";
import { openSlotKey } from "../src/keys/slots.js";
import { ApiKey } from "../src/models/api-key.js";

const SECRET = randomBytes(32).toString("hex");
const KEY = `sk-ant-${randomBytes(20).toString("hex")}`; // made up at every run
const workspaceId = new mongoose.Types.ObjectId();
const keyId = new mongoose.Types.ObjectId();
const project = { workspaceId, keys: { frontend: { keyId, provider: "anthropic", model: "claude-sonnet-5-5", lastFour: KEY.slice(-4) }, backend: null } };
const row = { _id: keyId, workspaceId, provider: "anthropic", sealed: createVault(SECRET).seal(KEY, { workspaceId: String(workspaceId), keyId: String(keyId) }) };

describe("openSlotKey", () => {
  it("opens the slot's key for the call: { provider, model, apiKey }", async (t) => {
    t.mock.method(ApiKey, "findOne", (query) => ({ lean: async () => (String(query._id) === String(keyId) && String(query.workspaceId) === String(workspaceId) ? row : null) }));
    assert.deepEqual(await openSlotKey(project, "frontend", { secret: SECRET }), { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: KEY });
  });

  it("an empty slot is null: the server's own models are used", async () => {
    assert.equal(await openSlotKey(project, "backend", { secret: SECRET }), null);
    assert.equal(await openSlotKey({ workspaceId }, "frontend", { secret: SECRET }), null);
  });

  it("a key deleted since the project started stops the build with a plain reason (no fallback to other models)", async (t) => {
    t.mock.method(ApiKey, "findOne", () => ({ lean: async () => null }));
    await assert.rejects(openSlotKey(project, "frontend", { secret: SECRET }), /Your frontend key \(anthropic …\w{4}\) was deleted/);
  });

  it("without the vault's secret on this server, says which setting is missing", async () => {
    await assert.rejects(openSlotKey(project, "frontend", { secret: null }), /KEY_VAULT_SECRET/);
  });
});
