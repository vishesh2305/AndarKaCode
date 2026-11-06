// Integration, Step 31c: a build runs on a workspace's own two keys. The frontend slot (an Anthropic key)
// reads the screenshot and draws the page; the backend slot (a Gemini key) writes the custom button's code.
// No server model is reachable here (no Ollama, no Gateway), so every model call had to use those keys.
// The keys never reach the project, its jobs, an answer or the log; and user keys never go to Laptop B.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { fakePage } from "./helpers/fake-s2c.js";
import { jsonServer, startSignedInApi, urlOf } from "./helpers/signed-in-api.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const MOCKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../samples/mocks");

// Made up at every run: no key-like text in the repository.
const FRONTEND_KEY = `sk-ant-${randomBytes(20).toString("hex")}`;
const BACKEND_KEY = `AIza${randomBytes(18).toString("hex")}`;
const KEYS = [FRONTEND_KEY, BACKEND_KEY];

const screen = {
  title: "Employees",
  kind: "list",
  tables: [
    {
      entityHint: { singular: "employee", plural: "employees" },
      columns: [
        { label: "Full Name", values: ["Ann Lee"], badge: false },
        { label: "Department", values: ["HR", "Sales"], badge: false },
      ],
      rowActions: ["Edit", "Delete", "Give Raise"],
    },
  ],
  forms: [],
  buttons: [],
  search: false,
  filters: [],
  pagination: false,
  statCards: [],
  auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
};

// ---- the two providers, as the workspace's keys reach them ----
const calls = { anthropic: [], gemini: [] };
const fakeAnthropic = await jsonServer(async (req, body) => {
  if (req.headers["x-api-key"] !== FRONTEND_KEY) return { status: 401, json: { error: { message: "invalid x-api-key" } } };
  if (req.method === "GET") return { json: { data: [] } }; // the key check
  const { model, messages } = JSON.parse(body);
  const prompt = messages[0].content.find((c) => c.type === "text").text;
  const page = prompt.startsWith("Build a web page that looks exactly like the screenshot");
  calls.anthropic.push({ model, purpose: page ? "page" : "read" });
  const text = page ? "```html\n" + fakePage(prompt) + "\n```" : JSON.stringify(screen);
  return { json: { content: [{ type: "text", text }], usage: { input_tokens: 1200, output_tokens: 300 } } };
});
const fakeGemini = await jsonServer(async (req) => {
  if (req.headers["x-goog-api-key"] !== BACKEND_KEY) return { status: 400, json: { error: { message: "API key not valid" } } };
  if (req.method === "GET") return { json: { models: [] } };
  calls.gemini.push({ url: req.url });
  const code = 'export default async function ({ record, input, helpers }) {\n  return { message: "Raise noted for " + record.fullName };\n}';
  return { json: { candidates: [{ content: { parts: [{ text: "```js\n" + code + "\n```" }] } }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 60 } } };
});

let api;
let me;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  api = await startSignedInApi({
    ROLE: "all", // builds, as one process
    MONGODB_URI,
    KEY_VAULT_SECRET: randomBytes(32).toString("hex"),
    ANTHROPIC_BASE_URL: urlOf(fakeAnthropic),
    GEMINI_BASE_URL: `${urlOf(fakeGemini)}/v1beta`,
    OLLAMA_URL: "http://127.0.0.1:9", // nothing listens: a server model would fail
    DEFAULT_MODE: "local",
    PREVIEW_IDLE_MS: "2500",
  });
  me = await api.signIn("byok@example.com");
});
after(async () => {
  api?.stop();
  fakeAnthropic.close();
  fakeGemini.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const json = (method, p, body) => api.get(p, me, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
const noKeyIn = (text, what) => {
  for (const key of KEYS) assert.ok(!text.includes(key) && !text.includes(key.slice(4, 16)), `${what} holds a key`);
};

async function upload() {
  const form = new FormData();
  form.append("fresh", "true");
  form.append("image", new Blob([await readFile(path.join(MOCKS, "m7-custom-buttons.png"))], { type: "image/png" }), "m7.png");
  const res = await api.get("/api/projects", me, { method: "POST", body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}
async function settled(id) {
  for (let i = 0; i < 200; i++) {
    const project = await (await api.get(`/api/projects/${id}`, me)).json();
    if (["READY", "NEEDS_ATTENTION"].includes(project.state)) return project;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.fail(`Timed out\n${api.log().slice(-2000)}`);
}

let keys;
describe("Step 31c: a build on the workspace's own two keys", () => {
  let project;
  before(async () => {
    const add = async (provider, apiKey) => (await json("POST", "/api/keys", { provider, apiKey })).json();
    keys = { frontend: await add("anthropic", FRONTEND_KEY), backend: await add("gemini", BACKEND_KEY) };
    const slots = await json("PUT", "/api/keys/slots", { frontend: { keyId: keys.frontend.id, model: "claude-sonnet-5-5" }, backend: { keyId: keys.backend.id, model: "gemini-3.5-flash" } });
    assert.equal(slots.status, 200, await slots.clone().text());
    const created = await upload();
    project = await settled(created.id);
  });

  it("reaches READY", () => {
    assert.equal(project.state, "READY", project.error);
  });

  it("the project says which key and model each slot used, never the key", () => {
    assert.deepEqual(
      { frontend: { provider: project.keys.frontend.provider, model: project.keys.frontend.model }, backend: { provider: project.keys.backend.provider, model: project.keys.backend.model } },
      { frontend: { provider: "anthropic", model: "claude-sonnet-5-5" }, backend: { provider: "gemini", model: "gemini-3.5-flash" } }
    );
    assert.equal(project.keys.frontend.keyId, keys.frontend.id);
  });

  it("the frontend key read the screenshot and drew the page; the backend key wrote the button's code", () => {
    assert.deepEqual(calls.anthropic.map((c) => c.purpose).sort(), ["page", "read"]);
    assert.ok(calls.anthropic.every((c) => c.model === "claude-sonnet-5-5"));
    assert.equal(calls.gemini.length, 1);
    assert.match(calls.gemini[0].url, /gemini-3\.5-flash:generateContent/);
  });

  it("each job names the provider it used, and its usage is metered", () => {
    const current = project.jobs.filter((j) => !j.contractHash || j.contractHash === project.contract.hash);
    const reading = current.find((j) => j.kind === "contract");
    const page = current.find((j) => j.kind === "frontend");
    const backend = current.find((j) => j.kind === "backend");
    assert.equal(reading.provider, "anthropic");
    assert.equal(page.provider, "anthropic");
    assert.equal(backend.custom.find((c) => c.operation === "giveRaiseEmployee").provider, "gemini");
    assert.deepEqual([reading.usage[0].provider, reading.usage[0].inputTokens], ["anthropic", 1200]);
  });

  it("the keys are in no answer and not in the log", async () => {
    noKeyIn(await (await api.get(`/api/projects/${project.id}`, me)).text(), "the project");
    noKeyIn(await (await api.get("/api/projects", me)).text(), "the project list");
    noKeyIn(api.log(), "the API's log");
  });
});
