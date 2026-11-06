// Integration, Step 31b: a workspace's own AI keys (BYOK). A key is checked with its provider before it is
// saved, kept only encrypted, shown only by its last 4 characters, never in an answer or the log, and only
// to its own workspace. Two slots, frontend (reading and pages) and backend (code), each take a saved key
// and a model from the verified list.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { ApiKey } from "../src/models/api-key.js";
import { jsonServer, startSignedInApi, urlOf } from "./helpers/signed-in-api.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");

// Made up at every run: no key-like text in the repository.
const GOOD_OPENAI = `sk-${randomBytes(20).toString("hex")}`;
const GOOD_ANTHROPIC = `sk-ant-${randomBytes(20).toString("hex")}`;
const BAD = `sk-${randomBytes(20).toString("hex")}`;
const ALL_KEYS = [GOOD_OPENAI, GOOD_ANTHROPIC, BAD];

// Fake providers: a key is good when it is the one they know; a bad one is repeated back, as OpenAI does.
const fakeOpenAI = await jsonServer(async (req) =>
  req.headers.authorization === `Bearer ${GOOD_OPENAI}` ? { json: { data: [] } } : { status: 401, json: { error: { message: `Incorrect API key provided: ${req.headers.authorization?.slice(7)}` } } }
);
const fakeAnthropic = await jsonServer(async (req) => (req.headers["x-api-key"] === GOOD_ANTHROPIC ? { json: { data: [] } } : { status: 401, json: { error: { message: "invalid x-api-key" } } }));

let api;
let a;
let b;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  api = await startSignedInApi({
    MONGODB_URI,
    KEY_VAULT_SECRET: randomBytes(32).toString("hex"),
    OPENAI_BASE_URL: urlOf(fakeOpenAI),
    ANTHROPIC_BASE_URL: urlOf(fakeAnthropic),
  });
  [a, b] = [await api.signIn("keys-a@example.com"), await api.signIn("keys-b@example.com")];
});
after(async () => {
  api?.stop();
  fakeOpenAI.close();
  fakeAnthropic.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const send = (method, path, session, body) => api.get(path, session, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
const noKeyIn = (text, what) => {
  for (const key of ALL_KEYS) assert.ok(!text.includes(key) && !text.includes(key.slice(3, 15)), `${what} holds a key`);
};

let openaiKey;
let anthropicKey;

describe("Step 31b: a workspace's own keys", () => {
  it("none at first; empty slots; the verified-models list comes along", async () => {
    const res = await send("GET", "/api/keys", a);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.keys, []);
    assert.deepEqual(body.slots, { frontend: null, backend: null });
    assert.ok(body.models.some((m) => m.provider === "gemini" && m.model === "gemini-3.5-flash" && m.verified));
  });

  it("a good key is checked with its provider, saved, and answered with its last 4 characters only", async () => {
    const res = await send("POST", "/api/keys", a, { provider: "openai", apiKey: GOOD_OPENAI, label: "My OpenAI" });
    const text = await res.text();
    assert.equal(res.status, 201, text);
    noKeyIn(text, "the answer");
    openaiKey = JSON.parse(text);
    assert.deepEqual([openaiKey.provider, openaiKey.label, openaiKey.lastFour], ["openai", "My OpenAI", GOOD_OPENAI.slice(-4)]);
    anthropicKey = await (await send("POST", "/api/keys", a, { provider: "anthropic", apiKey: GOOD_ANTHROPIC })).json();
    assert.equal(anthropicKey.provider, "anthropic");
  });

  it("the database holds it only encrypted", async () => {
    const rows = await ApiKey.find().lean();
    assert.equal(rows.length, 2);
    noKeyIn(JSON.stringify(rows), "the database");
  });

  it("a key its provider refuses is not saved, and the reason hides the key", async () => {
    const res = await send("POST", "/api/keys", a, { provider: "openai", apiKey: BAD });
    const text = await res.text();
    assert.equal(res.status, 400);
    noKeyIn(text, "the refusal");
    assert.match(JSON.parse(text).error, /OpenAI refused this key: OpenAI 401: Incorrect API key provided: \[key hidden\]/);
    assert.equal(await ApiKey.countDocuments(), 2);
  });

  it("an unknown provider or an empty key is refused before asking anyone", async () => {
    assert.equal((await send("POST", "/api/keys", a, { provider: "nope", apiKey: GOOD_OPENAI })).status, 400);
    assert.equal((await send("POST", "/api/keys", a, { provider: "openai", apiKey: "" })).status, 400);
  });

  it("the list shows the keys by provider, label and last 4 characters, never the key", async () => {
    const text = await (await send("GET", "/api/keys", a)).text();
    noKeyIn(text, "the list");
    assert.deepEqual(
      JSON.parse(text).keys.map((k) => [k.provider, k.lastFour]),
      [
        ["openai", GOOD_OPENAI.slice(-4)],
        ["anthropic", GOOD_ANTHROPIC.slice(-4)],
      ]
    );
  });
});

describe("Step 31b: the two slots", () => {
  it("a slot takes a saved key and a verified model of that provider for that slot", async () => {
    const res = await send("PUT", "/api/keys/slots", a, { frontend: { keyId: anthropicKey.id, model: "claude-sonnet-5-5" }, backend: { keyId: anthropicKey.id, model: "claude-sonnet-5-5" } });
    assert.equal(res.status, 200, await res.clone().text());
    const { slots } = await (await send("GET", "/api/keys", a)).json();
    assert.deepEqual(slots.frontend, { keyId: anthropicKey.id, provider: "anthropic", model: "claude-sonnet-5-5", lastFour: GOOD_ANTHROPIC.slice(-4) });
  });

  it("refuses a model of another provider, or one not on the list", async () => {
    const other = await send("PUT", "/api/keys/slots", a, { frontend: { keyId: openaiKey.id, model: "claude-sonnet-5-5" } });
    assert.equal(other.status, 400);
    assert.match((await other.json()).error, /not on the verified list for openai/);
    assert.equal((await send("PUT", "/api/keys/slots", a, { backend: { keyId: anthropicKey.id, model: "made-up-model" } })).status, 400);
  });

  it("a slot can be emptied", async () => {
    await send("PUT", "/api/keys/slots", a, { backend: null });
    const { slots } = await (await send("GET", "/api/keys", a)).json();
    assert.equal(slots.backend, null);
    assert.equal(slots.frontend.provider, "anthropic", "the other slot stays");
  });

  it("deleting a key empties the slots that used it", async () => {
    assert.equal((await send("DELETE", `/api/keys/${anthropicKey.id}`, a)).status, 204);
    const { keys, slots } = await (await send("GET", "/api/keys", a)).json();
    assert.deepEqual(keys.map((k) => k.provider), ["openai"]);
    assert.equal(slots.frontend, null);
  });
});

describe("Step 31b: a key stays in its workspace", () => {
  it("B doesn't see A's keys, can't delete them, and can't put them in its own slots", async () => {
    assert.deepEqual((await (await send("GET", "/api/keys", b)).json()).keys, []);
    assert.equal((await send("DELETE", `/api/keys/${openaiKey.id}`, b)).status, 404);
    const slot = await send("PUT", "/api/keys/slots", b, { frontend: { keyId: openaiKey.id, model: "gemini-3.5-flash" } });
    assert.equal(slot.status, 400);
    assert.match((await slot.json()).error, /No such key in this workspace/);
    assert.equal(await ApiKey.countDocuments({ _id: openaiKey.id }), 1);
  });
});

describe("Step 31b: a key never reaches the log", () => {
  it("not even when it arrives in a request the API can't read (bad JSON)", async () => {
    const res = await api.get("/api/keys", a, { method: "POST", headers: { "Content-Type": "application/json" }, body: `{"provider":"openai","apiKey":"${GOOD_OPENAI}"` });
    assert.equal(res.status, 400);
    noKeyIn(await res.text(), "the bad-JSON answer");
    await new Promise((r) => setTimeout(r, 200));
    noKeyIn(api.log(), "the API's log");
  });
});
