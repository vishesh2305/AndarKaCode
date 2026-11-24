// Integration: a workspace's own key that fails hands its work to the local models (seen on the Mac: a free
// Gemini key reached its daily limit and the project stopped at NEEDS_ATTENTION). Both slots hold a Gemini
// key that answers "quota exceeded" to every call. The screenshot is still read (Ollama), its page drawn (the
// Gateway, on the local models) and its custom button written (the local coding AI); each job says the key
// failed and why. The key itself still never goes to the Gateway, an answer or the log.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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
const OWN_KEY = `AIza${randomBytes(18).toString("hex")}`;
const GATEWAY_KEY = randomBytes(16).toString("hex");

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

// ---- the workspace's Gemini key: its free tier's daily limit is used up ----
const geminiCalls = [];
const fakeGemini = await jsonServer(async (req) => {
  if (req.headers["x-goog-api-key"] !== OWN_KEY) return { status: 400, json: { error: { message: "API key not valid" } } };
  if (req.method === "GET") return { json: { models: [] } }; // the key check when it is added
  geminiCalls.push(req.url);
  return {
    status: 429,
    json: {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40000s" }],
      },
    },
  };
});

// ---- the local models: Ollama reads the screenshot and writes the button's code ----
const ollamaCalls = { read: 0, code: 0 };
const fakeOllama = await jsonServer(async (req, text) => {
  if (req.method === "GET") return { json: { models: [] } };
  const body = JSON.parse(text);
  if (body.messages[0].images) {
    ollamaCalls.read++;
    return { json: { message: { content: JSON.stringify(screen) }, prompt_eval_count: 700, eval_count: 120 } };
  }
  ollamaCalls.code++;
  const code = 'export default async function ({ record, input, helpers }) {\n  return { message: "Raise noted for " + record.fullName };\n}';
  return { json: { message: { content: "```js\n" + code + "\n```" } } };
});

// ---- Laptop B's Gateway: draws the page on the local models ----
const submissions = [];
const gatewayJobs = new Map();
const fakeGateway = await jsonServer(async (req, text) => {
  if (req.headers["x-api-key"] !== GATEWAY_KEY) return { status: 401, json: { error: "bad key" } };
  if (req.method === "POST" && req.url === "/v1/generations") {
    const body = JSON.parse(text);
    const jobId = randomUUID();
    submissions.push({ raw: text, mode: body.mode });
    gatewayJobs.set(jobId, { jobId, status: "done", provider: "local", contractHash: body.contractHash, html: fakePage(body.instructions) });
    return { status: 202, json: { jobId, status: "running" } };
  }
  const job = gatewayJobs.get(req.url.split("/").pop());
  return job ? { json: job } : { status: 404, json: { error: "no such job" } };
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
    GEMINI_BASE_URL: `${urlOf(fakeGemini)}/v1beta`,
    OLLAMA_URL: urlOf(fakeOllama),
    GATEWAY_URL: urlOf(fakeGateway),
    GATEWAY_API_KEY: GATEWAY_KEY,
    GATEWAY_POLL_MS: "100",
    DEFAULT_MODE: "local",
    PREVIEW_IDLE_MS: "2500",
  });
  me = await api.signIn("fallback@example.com");
});
after(async () => {
  api?.stop();
  fakeGemini.close();
  fakeOllama.close();
  fakeGateway.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const json = (method, p, body) => api.get(p, me, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });

async function settled(id) {
  for (let i = 0; i < 300; i++) {
    const project = await (await api.get(`/api/projects/${id}`, me)).json();
    if (["READY", "NEEDS_ATTENTION"].includes(project.state)) return project;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.fail(`Timed out\n${api.log().slice(-2000)}`);
}

describe("A workspace key that fails: the local models take over", () => {
  let project;
  let current;
  before(async () => {
    const key = await (await json("POST", "/api/keys", { provider: "gemini", apiKey: OWN_KEY })).json();
    const slots = await json("PUT", "/api/keys/slots", { frontend: { keyId: key.id, model: "gemini-3.5-flash" }, backend: { keyId: key.id, model: "gemini-3.5-flash" } });
    assert.equal(slots.status, 200, await slots.clone().text());
    const form = new FormData();
    form.append("fresh", "true");
    form.append("image", new Blob([await readFile(path.join(MOCKS, "m7-custom-buttons.png"))], { type: "image/png" }), "m7.png");
    const res = await api.get("/api/projects", me, { method: "POST", body: form });
    assert.equal(res.status, 201, await res.clone().text());
    project = await settled((await res.json()).id);
    current = project.jobs.filter((j) => !j.contractHash || j.contractHash === project.contract?.hash);
  });

  it("reaches READY although the key answered every call with its daily limit", () => {
    assert.equal(project.state, "READY", `${project.error}\n${api.log().slice(-1500)}`);
    assert.ok(geminiCalls.length >= 3, "the key was tried first, for reading, the page and the button");
  });

  it("the local model read the screenshot, and the reading says the key failed and why", () => {
    const reading = current.find((j) => j.kind === "contract");
    assert.equal(reading.provider, "local");
    assert.ok(ollamaCalls.read >= 1);
    assert.match(reading.fallback, /Gemini key/);
    assert.match(reading.fallback, /limit is reached/);
  });

  it("the page was drawn by the Gateway on the local models, saying why", () => {
    const page = current.find((j) => j.kind === "frontend" && j.status === "done");
    assert.equal(page.provider, "local");
    assert.match(page.fallback, /Gemini key/);
    assert.deepEqual(submissions.map((s) => s.mode), ["local"]);
  });

  it("the custom button was written by the local coding AI, saying why", () => {
    const backend = current.find((j) => j.kind === "backend");
    const raise = backend.custom.find((c) => c.operation === "giveRaiseEmployee");
    assert.equal(raise.ok, true, raise.problem);
    assert.equal(raise.provider, "local");
    assert.match(raise.fallback, /Gemini key/);
    assert.ok(ollamaCalls.code >= 1);
  });

  it("the key never reaches the Gateway, an answer or the log", async () => {
    const hidden = (text) => !text.includes(OWN_KEY) && !text.includes(OWN_KEY.slice(4, 16));
    assert.ok(submissions.every((s) => hidden(s.raw)), "a Gateway request holds the key");
    assert.ok(hidden(await (await api.get(`/api/projects/${project.id}`, me)).text()), "the project holds the key");
    assert.ok(hidden(api.log()), "the log holds the key");
  });
});
