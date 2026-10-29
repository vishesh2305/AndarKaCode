// Step 18.2: the single-call page builder. One screenshot + the page instructions -> one model call ->
// one HTML page. No agent steps, no Screenshot-to-Code. fetch is replaced by a fake: no model or network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.OLLAMA_URL = "http://ollama.test";
process.env.OLLAMA_MODEL = "test-vision";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-gemini";
delete process.env.GEMINI_PAGE_MODEL;
const { buildPage, extractHtml, pageModelName, pagePrompt, pageProviders } = await import("../src/ai/page.js");

const PAGE = '<!DOCTYPE html>\n<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><h1>Employees</h1></body></html>';
const request = { prompt: "Build it", imageB64: "aW1n" };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe("pagePrompt: what the model is asked", () => {
  const prompt = pagePrompt('Fields on this page:\n- fullName -> label "Full Name"');

  it("asks for one HTML file that looks exactly like the screenshot, with its exact text, using Tailwind", () => {
    assert.match(prompt, /looks exactly like the screenshot/);
    assert.match(prompt, /exact text/);
    assert.match(prompt, /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/);
    assert.match(prompt, /single HTML file/);
  });

  it("includes our page instructions word for word (the markers the wirer needs)", () => {
    assert.ok(prompt.includes('- fullName -> label "Full Name"'));
  });

  it("asks for the HTML only, so the answer can be read without guessing", () => {
    assert.match(prompt, /only the complete HTML/i);
  });
});

describe("extractHtml: the page inside the model's answer", () => {
  it("takes the page out of a ```html block", () => {
    assert.equal(extractHtml(`Here it is:\n\`\`\`html\n${PAGE}\n\`\`\`\nDone.`), PAGE);
  });

  it("takes the page from <!DOCTYPE to </html> when there is no block, whatever the case", () => {
    assert.equal(extractHtml(`Sure! ${PAGE} Hope this helps.`), PAGE);
    assert.equal(extractHtml(PAGE.replace("<!DOCTYPE html>", "<!doctype html>")), PAGE.replace("<!DOCTYPE html>", "<!doctype html>"));
    assert.equal(extractHtml("<html><body>x</body></html>"), "<html><body>x</body></html>");
  });

  it("says the page was cut off when </html> never came (the answer hit its length limit)", () => {
    assert.throws(() => extractHtml(PAGE.replace("</html>", "")), /cut off/);
  });

  it("says there is no page when the answer has no HTML", () => {
    assert.throws(() => extractHtml("I cannot help with that."), /no HTML page/);
    assert.throws(() => extractHtml(""), /no HTML page/);
  });
});

describe("pageProviders.local (Ollama)", () => {
  it("sends the vision model, the prompt and the image, with no JSON format and thinking off", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => reply(200, { message: { content: PAGE } }));
    assert.equal(await pageProviders.local(request), PAGE);

    const [url, init] = fetch.mock.calls[0].arguments;
    const body = JSON.parse(init.body);
    assert.equal(url, "http://ollama.test/api/chat");
    assert.equal(body.model, "test-vision");
    assert.deepEqual(body.messages[0], { role: "user", content: "Build it", images: ["aW1n"] });
    assert.equal(body.format, undefined, "a page is HTML, not JSON");
    assert.equal(body.think, false);
    assert.ok(body.options.num_ctx >= 16384, "a whole page needs a long answer");
  });

  it("throws Ollama's error message", async (t) => {
    t.mock.method(globalThis, "fetch", async () => reply(404, { error: "model not found" }));
    await assert.rejects(pageProviders.local(request), /Ollama 404: model not found/);
  });
});

describe("pageProviders.cloud (Gemini)", () => {
  const ok = reply(200, { candidates: [{ content: { parts: [{ text: "<!DOCTYPE html><html>" }, { text: "</html>" }] } }] });

  it("sends the key in a header and the image inline, asks for text (not JSON), and joins the answer's parts", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => ok);
    assert.equal(await pageProviders.cloud(request), "<!DOCTYPE html><html></html>");

    const [url, init] = fetch.mock.calls[0].arguments;
    const body = JSON.parse(init.body);
    assert.match(url, /models\/test-gemini:generateContent$/, "GEMINI_MODEL when GEMINI_PAGE_MODEL is not set");
    assert.equal(init.headers["x-goog-api-key"], "test-key");
    assert.doesNotMatch(url, /test-key/);
    assert.deepEqual(body.contents[0].parts[1], { inline_data: { mime_type: "image/png", data: "aW1n" } });
    assert.equal(body.generationConfig.responseMimeType, undefined);
    assert.equal(pageModelName.cloud, "test-gemini");
  });

  it("retries a temporary 503, and does not retry a quota error (429)", async (t) => {
    const replies = [reply(503, { error: { message: "high demand" } }), ok];
    const fetch = t.mock.method(globalThis, "fetch", async () => replies.shift());
    assert.equal(await pageProviders.cloud(request), "<!DOCTYPE html><html></html>");
    assert.equal(fetch.mock.callCount(), 2);

    fetch.mock.mockImplementation(async () => reply(429, { error: { message: "quota" } }));
    await assert.rejects(pageProviders.cloud(request), /Gemini 429: quota/);
  });
});

describe("buildPage: one call per page, by the project's mode", () => {
  const fake = (answers) => {
    const calls = [];
    const providers = Object.fromEntries(
      Object.entries(answers).map(([name, answer]) => [name, async (req) => (calls.push({ name, ...req }), answer instanceof Error ? Promise.reject(answer) : answer)])
    );
    return { providers, calls };
  };

  it("cloud: one call with the screenshot and the prompt built from the instructions", async () => {
    const { providers, calls } = fake({ local: PAGE, cloud: `\`\`\`html\n${PAGE}\n\`\`\`` });
    const result = await buildPage({ imageB64: "aW1n", instructions: "Fields: x", mode: "cloud", providers });
    assert.deepEqual(result, { html: PAGE, provider: "cloud" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageB64, "aW1n");
    assert.equal(calls[0].prompt, pagePrompt("Fields: x"));
  });

  it("auto: local first, then cloud when local fails or answers without a page", async () => {
    const failed = fake({ local: new Error("Ollama down"), cloud: PAGE });
    assert.equal((await buildPage({ imageB64: "aW1n", instructions: "", mode: "auto", providers: failed.providers })).provider, "cloud");
    const noPage = fake({ local: "Sorry.", cloud: PAGE });
    assert.equal((await buildPage({ imageB64: "aW1n", instructions: "", mode: "auto", providers: noPage.providers })).provider, "cloud");
  });

  it("local: no cloud backup, and the error names the provider", async () => {
    const { providers, calls } = fake({ local: new Error("Ollama down"), cloud: PAGE });
    await assert.rejects(buildPage({ imageB64: "aW1n", instructions: "", mode: "local", providers }), /local: Ollama down/);
    assert.deepEqual(calls.map((c) => c.name), ["local"]);
  });
});
