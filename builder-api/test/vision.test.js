// Vision client: the exact requests sent to Ollama and Gemini, and how errors/retries behave.
// fetch is replaced by a fake, so no model or network is needed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.OLLAMA_URL = "http://ollama.test";
process.env.OLLAMA_MODEL = "test-vision";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-gemini";
const { visionProviders } = await import("../src/ai/vision.js");

const request = { prompt: "List the UI", schema: { type: "object" }, imageB64: "aW1n" };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe("vision: local (Ollama)", () => {
  it("sends the model, prompt, image and schema, with thinking off and temperature 0", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => reply(200, { message: { content: '{"a":1}' } }));
    assert.equal(await visionProviders.local(request), '{"a":1}');

    const [url, init] = fetch.mock.calls[0].arguments;
    const body = JSON.parse(init.body);
    assert.equal(url, "http://ollama.test/api/chat");
    assert.equal(body.model, "test-vision");
    assert.deepEqual(body.messages[0], { role: "user", content: "List the UI", images: ["aW1n"] });
    assert.deepEqual(body.format, { type: "object" });
    assert.equal(body.think, false);
    assert.equal(body.options.temperature, 0);
  });

  it("uses `thinking` when a thinking model leaves `content` empty", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(200, { message: { content: "", thinking: '{"b":2}' } }));
    assert.equal(await visionProviders.local(request), '{"b":2}');
  });

  it("throws Ollama's error message on a failed request", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(404, { error: "model not found" }));
    await assert.rejects(visionProviders.local(request), /Ollama 404: model not found/);
  });
});

describe("vision: cloud (Gemini)", () => {
  const ok = reply(200, { candidates: [{ content: { parts: [{ text: '{"c":3}' }] } }] });

  it("sends the key in a header, the image inline and the schema as responseJsonSchema", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => ok);
    assert.equal(await visionProviders.cloud(request), '{"c":3}');

    const [url, init] = fetch.mock.calls[0].arguments;
    const body = JSON.parse(init.body);
    assert.match(url, /models\/test-gemini:generateContent$/);
    assert.equal(init.headers["x-goog-api-key"], "test-key");
    assert.doesNotMatch(url, /test-key/, "the key is never put in the URL");
    assert.deepEqual(body.contents[0].parts[1], { inline_data: { mime_type: "image/png", data: "aW1n" } });
    assert.deepEqual(body.generationConfig.responseJsonSchema, { type: "object" });
  });

  it("retries a temporary 503 and then succeeds", async (t) => {
    const replies = [reply(503, { error: { message: "high demand" } }), ok];
    const fetch = t.mock.method(globalThis, "fetch", async () => replies.shift());
    assert.equal(await visionProviders.cloud(request), '{"c":3}');
    assert.equal(fetch.mock.callCount(), 2);
  });

  it("does not retry a quota error (429)", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => reply(429, { error: { message: "quota" } }));
    await assert.rejects(visionProviders.cloud(request), /Gemini 429: quota/);
    assert.equal(fetch.mock.callCount(), 1);
  });
});
