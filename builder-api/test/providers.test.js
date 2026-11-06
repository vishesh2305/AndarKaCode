// Step 31a: one adapter per AI provider a user can bring a key for (BYOK): Gemini, OpenAI, Anthropic, Groq
// and OpenRouter. One call for every purpose: read a screenshot (image + JSON), draw a page (image + HTML),
// write code (text). Each records its usage like the local and Gemini calls (Step 25), checks a key with a
// cheap request, and never lets the key into an error message. fetch is replaced by a fake: no network.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { withUsage } from "../../shared/meter.mjs";
import { callModel, checkKey, PROVIDERS, redactKey, retry } from "../../shared/providers.mjs";

retry.delays = [0]; // one quick retry in tests
// Made up at every run: no key-like text in the repository.
const KEY = `sk-${randomBytes(18).toString("hex")}`;
const IMAGE = "aW1hZ2U="; // base64 of "image"
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

/** Calls callModel with fetch faked by answer(url, init, body); returns { text, calls, usage }. */
async function run(t, request, answer) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), init, body });
    return answer(String(url), init, body, calls.length);
  });
  const usage = [];
  const text = await withUsage(usage, () => callModel({ apiKey: KEY, prompt: "Read this", ...request }));
  return { text, calls, usage };
}

const openaiAnswer = (content) => reply(200, { choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 40 } } });

describe("the providers a key can be brought for", () => {
  it("are Gemini, OpenAI, Anthropic, Groq and OpenRouter", () => {
    assert.deepEqual(PROVIDERS, ["gemini", "openai", "anthropic", "groq", "openrouter"]);
  });
});

describe("OpenAI, and the OpenAI-style Groq and OpenRouter", () => {
  it("sends the prompt and the screenshot as a data URL, with the key as a Bearer token, and asks for JSON when told", async (t) => {
    const { text, calls, usage } = await run(t, { provider: "openai", model: "gpt-x", imageB64: IMAGE, json: true, purpose: "read" }, () => openaiAnswer('{"ok":true}'));
    assert.equal(text, '{"ok":true}');
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].body.model, "gpt-x");
    const [textPart, imagePart] = calls[0].body.messages[0].content;
    assert.deepEqual(textPart, { type: "text", text: "Read this" });
    assert.equal(imagePart.image_url.url, `data:image/png;base64,${IMAGE}`);
    assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
    assert.deepEqual(usage, [{ purpose: "read", provider: "openai", model: "gpt-x", inputTokens: 900, outputTokens: 120, thinkingTokens: 40, seconds: usage[0].seconds }]);
  });

  it("Groq and OpenRouter use the same request at their own addresses", async (t) => {
    const urls = [];
    for (const provider of ["groq", "openrouter"]) {
      const { calls } = await run(t, { provider, model: "m", purpose: "code" }, () => openaiAnswer("x"));
      urls.push(calls[0].url);
      t.mock.restoreAll();
    }
    assert.deepEqual(urls, ["https://api.groq.com/openai/v1/chat/completions", "https://openrouter.ai/api/v1/chat/completions"]);
  });

  it("a text-only call (code) sends the prompt as plain text, without asking for JSON", async (t) => {
    const { calls } = await run(t, { provider: "openai", model: "gpt-x", purpose: "code" }, () => openaiAnswer("code"));
    assert.equal(calls[0].body.messages[0].content, "Read this");
    assert.equal(calls[0].body.response_format, undefined);
  });
});

describe("Anthropic", () => {
  it("sends the screenshot as a base64 image block, the key in x-api-key, the API version, and a token limit", async (t) => {
    const { text, calls, usage } = await run(t, { provider: "anthropic", model: "claude-x", imageB64: IMAGE, purpose: "page" }, () =>
      reply(200, { content: [{ type: "text", text: "<html>" }, { type: "text", text: "</html>" }], usage: { input_tokens: 1500, output_tokens: 800 } })
    );
    assert.equal(text, "<html></html>");
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].init.headers["x-api-key"], KEY);
    assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
    assert.ok(calls[0].body.max_tokens >= 8000);
    const [image, prompt] = calls[0].body.messages[0].content;
    assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE } });
    assert.deepEqual(prompt, { type: "text", text: "Read this" });
    assert.deepEqual([usage[0].provider, usage[0].inputTokens, usage[0].outputTokens], ["anthropic", 1500, 800]);
  });

  it("with no JSON mode, a JSON answer wrapped in prose or a code fence comes back as the JSON alone", async (t) => {
    const { text } = await run(t, { provider: "anthropic", model: "claude-x", imageB64: IMAGE, json: true, purpose: "read" }, () =>
      reply(200, { content: [{ type: "text", text: 'Here it is:\n```json\n{"tables": []}\n```' }], usage: {} })
    );
    assert.deepEqual(JSON.parse(text), { tables: [] });
  });
});

describe("Gemini with a user's key", () => {
  it("sends the key in x-goog-api-key and asks for JSON (with the schema when given)", async (t) => {
    const schema = { type: "object" };
    const { text, calls, usage } = await run(t, { provider: "gemini", model: "gemini-x", imageB64: IMAGE, json: true, schema, purpose: "read" }, () =>
      reply(200, { candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 1 } })
    );
    assert.equal(text, "{}");
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    assert.equal(calls[0].init.headers["x-goog-api-key"], KEY);
    assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(calls[0].body.generationConfig.responseJsonSchema, schema);
    assert.deepEqual([usage[0].provider, usage[0].thinkingTokens], ["gemini", 1]);
  });
});

describe("failures", () => {
  it("a busy provider (429 or 5xx) is tried again; a refusal (401) is not", async (t) => {
    const { text, calls } = await run(t, { provider: "openai", model: "m", purpose: "code" }, (_u, _i, _b, n) => (n === 1 ? reply(503, { error: { message: "overloaded" } }) : openaiAnswer("ok")));
    assert.equal(text, "ok");
    assert.equal(calls.length, 2);
    t.mock.restoreAll();
    let tries = 0;
    t.mock.method(globalThis, "fetch", async () => (tries++, reply(401, { error: { message: "bad key" } })));
    await assert.rejects(callModel({ provider: "openai", apiKey: KEY, model: "m", prompt: "x" }), /OpenAI 401: bad key/);
    assert.equal(tries, 1);
  });

  it("never puts the key in an error, even when the provider repeats it back", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(401, { error: { message: `Incorrect API key provided: ${KEY}. Also ${KEY.slice(0, 12)}...${KEY.slice(-4)}` } }));
    await assert.rejects(callModel({ provider: "openai", apiKey: KEY, model: "m", prompt: "x" }), (err) => {
      assert.ok(!err.message.includes(KEY), err.message);
      assert.ok(!err.message.includes(KEY.slice(3, 15)), err.message);
      assert.match(err.message, /\[key hidden\]/);
      return true;
    });
  });

  it("an unknown provider, or no key, fails at once", async () => {
    await assert.rejects(callModel({ provider: "nope", apiKey: KEY, model: "m", prompt: "x" }), /Unknown provider "nope"/);
    await assert.rejects(callModel({ provider: "openai", apiKey: "", model: "m", prompt: "x" }), /needs a key/);
  });
});

describe("redactKey", () => {
  it("hides the key, and any sk-/AIza-style key, in a message", () => {
    const other = `AIza${randomBytes(16).toString("hex")}`;
    const out = redactKey(`a ${KEY} b ${other} c`, KEY);
    assert.ok(!out.includes(KEY) && !out.includes(other), out);
    assert.equal(out.match(/\[key hidden\]/g).length, 2);
  });
});

describe("checkKey: is this key good, before it is saved?", () => {
  const cases = {
    openai: ["https://api.openai.com/v1/models", "Authorization", `Bearer ${KEY}`],
    groq: ["https://api.groq.com/openai/v1/models", "Authorization", `Bearer ${KEY}`],
    openrouter: ["https://openrouter.ai/api/v1/key", "Authorization", `Bearer ${KEY}`],
    anthropic: ["https://api.anthropic.com/v1/models", "x-api-key", KEY],
    gemini: ["https://generativelanguage.googleapis.com/v1beta/models", "x-goog-api-key", KEY],
  };
  for (const [provider, [url, header, value]] of Object.entries(cases)) {
    it(`${provider}: one cheap request that needs the key`, async (t) => {
      const calls = [];
      t.mock.method(globalThis, "fetch", async (u, init) => (calls.push({ u: String(u), init }), reply(200, { data: [] })));
      assert.deepEqual(await checkKey({ provider, apiKey: KEY }), { ok: true });
      assert.equal(calls[0].u, url);
      assert.equal(calls[0].init.headers[header], value);
    });
  }

  it("a refused key gives the provider's reason, without the key", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(401, { error: { message: `invalid x-api-key ${KEY}` } }));
    const result = await checkKey({ provider: "anthropic", apiKey: KEY });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Anthropic 401: invalid x-api-key \[key hidden\]/);
  });
});
