// Step 25: every model call is metered. Each call records what it was for (read, page, code), the provider,
// the model, its tokens and its seconds, on the job it belongs to: the cost per build comes from these
// (docs/economics.md, credit prices). fetch is replaced by a fake: no model or network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.OLLAMA_URL = "http://ollama.test";
process.env.OLLAMA_MODEL = "test-vision";
process.env.OLLAMA_CODE_MODEL = "test-coder";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-gemini";
delete process.env.GEMINI_PAGE_MODEL;
delete process.env.GEMINI_CODE_MODEL;
const { geminiUsage, ollamaUsage, recordUsage, withUsage } = await import("../../shared/meter.mjs");
const { visionProviders } = await import("../src/ai/vision.js");
const { pageProviders } = await import("../src/ai/page.js");
const { codeProviders } = await import("../src/custom/model.js");

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const ollamaAnswer = (content) => reply(200, { message: { content }, prompt_eval_count: 812, eval_count: 95 });
const geminiAnswer = (text) =>
  reply(200, { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1290, candidatesTokenCount: 410, thoughtsTokenCount: 230, totalTokenCount: 1930 } });

describe("withUsage and recordUsage: the meter", () => {
  it("collects what is recorded while the work runs, in order", async () => {
    const usage = [];
    await withUsage(usage, async () => {
      recordUsage({ purpose: "read", provider: "local", inputTokens: 1 });
      await new Promise((r) => setTimeout(r, 5));
      recordUsage({ purpose: "page", provider: "cloud", inputTokens: 2 });
    });
    assert.deepEqual(usage.map((u) => u.purpose), ["read", "page"]);
  });

  it("records nothing outside a metered piece of work (and does not fail)", () => {
    assert.doesNotThrow(() => recordUsage({ purpose: "read" }));
  });

  it("keeps two pieces of work running at the same time apart", async () => {
    const a = [];
    const b = [];
    const work = (list, purpose, ms) => withUsage(list, async () => (await new Promise((r) => setTimeout(r, ms)), recordUsage({ purpose })));
    await Promise.all([work(a, "a", 20), work(b, "b", 5)]);
    assert.deepEqual([a.map((u) => u.purpose), b.map((u) => u.purpose)], [["a"], ["b"]]);
  });
});

describe("ollamaUsage and geminiUsage: tokens out of each provider's answer", () => {
  it("reads Ollama's prompt and answer token counts", () => {
    assert.deepEqual(ollamaUsage({ prompt_eval_count: 812, eval_count: 95 }), { inputTokens: 812, outputTokens: 95, thinkingTokens: 0 });
  });

  it("reads Gemini's usage, with its thinking tokens apart", () => {
    const data = { usageMetadata: { promptTokenCount: 1290, candidatesTokenCount: 410, thoughtsTokenCount: 230 } };
    assert.deepEqual(geminiUsage(data), { inputTokens: 1290, outputTokens: 410, thinkingTokens: 230 });
  });

  it("gives zeros when an answer has no usage", () => {
    assert.deepEqual(ollamaUsage({}), { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
    assert.deepEqual(geminiUsage({}), { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
  });
});

describe("every model call records its usage", () => {
  const metered = async (fn) => {
    const usage = [];
    await withUsage(usage, fn);
    return usage;
  };

  it("reading a screenshot, locally and on Gemini", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => (String(url).includes("ollama") ? ollamaAnswer("{}") : geminiAnswer("{}")));
    const request = { prompt: "List", schema: { type: "object" }, imageB64: "aW1n" };
    const [local] = await metered(() => visionProviders.local(request));
    assert.deepEqual({ ...local, seconds: undefined }, { purpose: "read", provider: "local", model: "test-vision", inputTokens: 812, outputTokens: 95, thinkingTokens: 0, seconds: undefined });
    assert.ok(local.seconds >= 0);
    const [cloud] = await metered(() => visionProviders.cloud(request));
    assert.deepEqual([cloud.purpose, cloud.provider, cloud.model, cloud.inputTokens, cloud.thinkingTokens], ["read", "cloud", "test-gemini", 1290, 230]);
  });

  it("drawing a page, locally and on Gemini", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => (String(url).includes("ollama") ? ollamaAnswer("<html></html>") : geminiAnswer("<html></html>")));
    const request = { prompt: "Build", imageB64: "aW1n" };
    const usage = await metered(async () => {
      await pageProviders.local(request);
      await pageProviders.cloud(request);
    });
    assert.deepEqual(usage.map((u) => [u.purpose, u.provider, u.model]), [["page", "local", "test-vision"], ["page", "cloud", "test-gemini"]]);
  });

  it("writing a custom button's code, locally and on Gemini", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => (String(url).includes("ollama") ? ollamaAnswer("x") : geminiAnswer("x")));
    const usage = await metered(async () => {
      await codeProviders.local("Write it");
      await codeProviders.cloud("Write it");
    });
    assert.deepEqual(usage.map((u) => [u.purpose, u.provider, u.model]), [["code", "local", "test-coder"], ["code", "cloud", "test-gemini"]]);
  });

  it("a call the provider refuses records nothing (no answer, no tokens)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(404, { error: "model not found" }));
    const usage = await metered(() => visionProviders.local({ prompt: "x", schema: {}, imageB64: "aW1n" }).catch(() => {}));
    assert.deepEqual(usage, []);
  });
});
