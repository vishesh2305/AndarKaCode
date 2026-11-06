// Step 31b: the key vault. A user's AI key is kept encrypted (AES-256-GCM) with KEY_VAULT_SECRET, bound to its
// workspace and its own id, so a copy of the database, or a key moved to another workspace, opens nothing.
// Only the last 4 characters are ever shown. Plus the verified-models list each slot chooses from.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { MODELS, modelFor } from "../../shared/models.mjs";
import { PROVIDERS } from "../../shared/providers.mjs";
import { checkConfig } from "../src/config.js";
import { createVault, lastFour } from "../src/keys/vault.js";

const SECRET = randomBytes(32).toString("hex");
const KEY = `sk-${randomBytes(20).toString("hex")}`; // made up at every run
const at = { workspaceId: "64b000000000000000000001", keyId: "64b000000000000000000002" };

describe("the vault", () => {
  const vault = createVault(SECRET);

  it("seals a key into ciphertext that doesn't contain it, and opens it back", () => {
    const sealed = vault.seal(KEY, at);
    assert.deepEqual(Object.keys(sealed).sort(), ["ciphertext", "iv", "tag"]);
    assert.ok(!JSON.stringify(sealed).includes(KEY));
    assert.equal(vault.open(sealed, at), KEY);
  });

  it("seals the same key differently every time (a fresh IV)", () => {
    assert.notEqual(vault.seal(KEY, at).ciphertext, vault.seal(KEY, at).ciphertext);
  });

  it("won't open a key for another workspace or another key id, or with another secret", () => {
    const sealed = vault.seal(KEY, at);
    assert.throws(() => vault.open(sealed, { ...at, workspaceId: "64b000000000000000000009" }));
    assert.throws(() => vault.open(sealed, { ...at, keyId: "64b000000000000000000009" }));
    assert.throws(() => createVault(randomBytes(32).toString("hex")).open(sealed, at));
  });

  it("won't open a changed ciphertext", () => {
    const sealed = vault.seal(KEY, at);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] ^= 1;
    assert.throws(() => vault.open({ ...sealed, ciphertext: flipped.toString("base64") }, at));
  });

  it("needs a 32-byte secret", () => {
    assert.throws(() => createVault("abc"), /KEY_VAULT_SECRET/);
  });

  it("shows only the last 4 characters", () => {
    assert.equal(lastFour(KEY), KEY.slice(-4));
  });
});

describe("KEY_VAULT_SECRET in the settings", () => {
  it("is optional: without it, nobody can save keys", () => {
    assert.equal(checkConfig({}).config.keyVaultSecret, null);
  });

  it("must be 64 hex characters (32 bytes), and is never printed", () => {
    assert.equal(checkConfig({ KEY_VAULT_SECRET: SECRET }).config.keyVaultSecret, SECRET);
    const wrong = randomBytes(10).toString("hex");
    const { problems } = checkConfig({ KEY_VAULT_SECRET: wrong });
    assert.match(problems[0], /KEY_VAULT_SECRET in builder-api\/\.env must be 64 hex characters.*openssl rand -hex 32/);
    assert.ok(!problems.join().includes(wrong));
  });
});

describe("the verified-models list", () => {
  it("every model belongs to a known provider and is for the frontend slot, the backend slot, or both", () => {
    for (const m of MODELS) {
      assert.ok(PROVIDERS.includes(m.provider), m.model);
      assert.ok(m.slots.length && m.slots.every((s) => ["frontend", "backend"].includes(s)), m.model);
      assert.ok(m.verified === null || /^\d{4}-\d{2}-\d{2}/.test(m.verified), m.model);
    }
  });

  it("Gemini 3.5 Flash is verified for both slots (our page and code exams)", () => {
    const flash = modelFor("gemini", "gemini-3.5-flash", "frontend");
    assert.ok(flash?.verified);
    assert.ok(modelFor("gemini", "gemini-3.5-flash", "backend"));
  });

  it("modelFor finds a model only for its own provider and slot", () => {
    assert.equal(modelFor("openai", "gemini-3.5-flash", "frontend"), null);
    assert.equal(modelFor("gemini", "no-such-model", "frontend"), null);
  });
});
