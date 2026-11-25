// Evaluation plan A5: `npm run demo:check` says, one line per service, whether everything a demo needs is up,
// and how to fix what isn't. It can also load the local models first, so the first build isn't slow.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { demoCheck, formatCheck } from "../src/demo-check.js";

const KEY = randomBytes(12).toString("hex");
const ENV = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/andarkacode-demo",
  OLLAMA_URL: "http://ollama.test",
  OLLAMA_MODEL: "qwen3-vl:8b-instruct",
  OLLAMA_CODE_MODEL: "qwen2.5-coder:7b",
  GATEWAY_URL: "http://gateway.test",
  GATEWAY_API_KEY: KEY,
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake network: every service up unless `down` names it; records what was asked. */
function network({ down = [], models = ["qwen3-vl:8b-instruct", "qwen2.5-coder:7b"], gateway = {} } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { host, pathname } = new URL(url);
    if (down.includes(host)) throw new TypeError("fetch failed");
    if (host === "127.0.0.1:4000") return json({ error: "sign in" }, 401);
    if (pathname === "/api/tags") return json({ models: models.map((name) => ({ name })) });
    if (pathname === "/api/generate") return json({ done: true });
    if (pathname === "/v1/health") return init.headers?.["X-API-Key"] === KEY ? json({ s2cUp: true, ollamaUp: true, models: [{ name: "qwen3-vl:8b", gpu: "100% GPU" }], ...gateway }) : json({ error: "key" }, 401);
    return json({}, 404);
  };
  return { fetch, calls };
}

const run = (net, extra = {}) =>
  demoCheck({ env: ENV, fetch: net.fetch, mongo: async () => {}, exists: () => true, ...extra });
const byName = (results) => Object.fromEntries(results.map((r) => [r.name, r]));

describe("demo:check", () => {
  it("everything up: one passing line per service", async () => {
    const results = await run(network());
    assert.deepEqual(results.map((r) => r.name), ["MongoDB", "Builder API", "Web app", "Ollama", "Gateway (Laptop B)"]);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.match(byName(results)["Gateway (Laptop B)"].detail, /Screenshot-to-Code up, loaded: qwen3-vl:8b \(100% GPU\)/);
  });

  it("a missing local model says which ollama pull fixes it", async () => {
    const ollama = byName(await run(network({ models: ["qwen3-vl:8b-instruct"] }))).Ollama;
    assert.equal(ollama.ok, false);
    assert.match(ollama.detail, /ollama pull qwen2\.5-coder:7b/);
  });

  it("a service that is down says where it was looked for", async () => {
    const results = byName(await run(network({ down: ["gateway.test", "127.0.0.1:4000"] })));
    assert.equal(results["Gateway (Laptop B)"].ok, false);
    assert.match(results["Gateway (Laptop B)"].detail, /not reachable at http:\/\/gateway\.test/);
    assert.equal(results["Builder API"].ok, false);
    assert.match(results["Builder API"].detail, /npm start/);
  });

  it("the Gateway up but Screenshot-to-Code down is not ready", async () => {
    const gw = byName(await run(network({ gateway: { s2cUp: false } })))["Gateway (Laptop B)"];
    assert.equal(gw.ok, false);
    assert.match(gw.detail, /Screenshot-to-Code is down/);
  });

  it("MongoDB down, or the web app not built, says how to fix it", async () => {
    const results = byName(
      await run(network(), {
        mongo: async () => {
          throw new Error("connect ECONNREFUSED");
        },
        exists: () => false,
      })
    );
    assert.equal(results.MongoDB.ok, false);
    assert.match(results.MongoDB.detail, /ECONNREFUSED/);
    assert.equal(results["Web app"].ok, false);
    assert.match(results["Web app"].detail, /npm run build/);
  });

  it("without GATEWAY_URL the pages go through the page queue: nothing to check there", async () => {
    const gw = byName(await demoCheck({ env: { ...ENV, GATEWAY_URL: "" }, fetch: network().fetch, mongo: async () => {}, exists: () => true }))["Gateway (Laptop B)"];
    assert.equal(gw.ok, true);
    assert.match(gw.detail, /not used/);
  });

  it("warm: loads both local models for an hour, so the first build isn't slow", async () => {
    const net = network();
    const results = await run(net, { warm: true });
    const loads = net.calls.filter((c) => c.url.endsWith("/api/generate")).map((c) => JSON.parse(c.init.body));
    assert.deepEqual(loads.map((b) => b.model).sort(), ["qwen2.5-coder:7b", "qwen3-vl:8b-instruct"]);
    assert.ok(loads.every((b) => b.keep_alive === "60m"));
    assert.match(byName(results).Ollama.detail, /loaded/);
  });

  it("the Gateway key never appears in what is printed", async () => {
    const text = formatCheck(await run(network({ down: ["gateway.test"] })));
    assert.ok(!text.includes(KEY));
    assert.match(text, /^✗ Gateway \(Laptop B\)/m);
    assert.match(text, /^✓ MongoDB/m);
    assert.match(text, /not ready: 1 problem/);
  });
});
