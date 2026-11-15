// Step 32c: adaptive concurrency per key. Each key runs at most `limit` model calls at once. A "too many
// requests" answer halves the limit and pauses that key for as long as the provider asks; calls that go
// through raise it again, one at a time, up to the maximum. So a busy provider slows us down instead of
// making the build fail. A wait longer than a few minutes is a daily limit: that fails at once, plainly.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { createLimiter, limiterFor } from "../../shared/limiter.mjs";
import { callModel, retry } from "../../shared/providers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("createLimiter", () => {
  it("runs at most `max` at once", async () => {
    const limiter = createLimiter({ max: 2 });
    let running = 0;
    let most = 0;
    await Promise.all(Array.from({ length: 6 }, () => limiter.run(async () => ((most = Math.max(most, ++running)), await sleep(10), running--))));
    assert.equal(most, 2);
  });

  it("a throttle halves the limit (never below 1) and pauses for the wait asked", async () => {
    const limiter = createLimiter({ max: 8 });
    limiter.slowDown(60);
    assert.equal(limiter.limit(), 4);
    const started = Date.now();
    await limiter.run(async () => {});
    assert.ok(Date.now() - started >= 50, "waited out the pause");
    for (let i = 0; i < 5; i++) limiter.slowDown(0);
    assert.equal(limiter.limit(), 1);
  });

  it("calls that go through raise the limit again, one step at a time, up to max", async () => {
    const limiter = createLimiter({ max: 4 });
    limiter.slowDown(0);
    limiter.slowDown(0);
    assert.equal(limiter.limit(), 1);
    for (let i = 0; i < 20; i++) await limiter.run(async () => {});
    assert.equal(limiter.limit(), 4);
  });
});

describe("limiterFor: one limiter per key", () => {
  it("the same key gets the same limiter; another key its own; the key itself is not kept", () => {
    const key = `sk-${randomBytes(12).toString("hex")}`;
    assert.equal(limiterFor("openai", key), limiterFor("openai", key));
    assert.notEqual(limiterFor("openai", key), limiterFor("openai", `${key}x`));
    assert.ok(!limiterFor.keys().some((k) => k.includes(key)), "keyed by a hash, not the key");
  });
});

// A provider that takes at most 2 calls at once and answers 429 (with Retry-After) to more.
function busyProvider({ capacity = 2, retryAfter = "0" } = {}) {
  const seen = { calls: 0, throttled: 0, most: 0 };
  let running = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    seen.calls++;
    if (running >= capacity) {
      seen.throttled++;
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": retryAfter }).end(JSON.stringify({ error: { message: "Rate limit reached" } }));
      return;
    }
    running++;
    seen.most = Math.max(seen.most, running);
    await sleep(30);
    running--;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

describe("callModel under a busy provider", () => {
  it("10 calls at once on one key all succeed: the 429s slow that key down instead of failing", async () => {
    retry.delays = [0];
    retry.throttleFloorMs = 20; // tests: a 0 s Retry-After still waits a little
    const { server, seen, url } = await busyProvider();
    process.env.OPENAI_BASE_URL = url;
    const key = `sk-${randomBytes(12).toString("hex")}`;
    try {
      const answers = await Promise.all(Array.from({ length: 10 }, () => callModel({ provider: "openai", apiKey: key, model: "m", prompt: "x", purpose: "code" })));
      assert.deepEqual(answers, Array(10).fill("ok"));
      assert.ok(seen.throttled > 0, "the provider did push back");
      assert.ok(limiterFor("openai", key).slowDowns() > 0, "and the key slowed down (its limit is raised again as calls go through)");
    } finally {
      delete process.env.OPENAI_BASE_URL;
      server.close();
    }
  });

  it("a wait of hours is a daily limit: it fails at once and says when to try again", async () => {
    const { server, url } = await busyProvider({ capacity: 0, retryAfter: String(5 * 3600) });
    process.env.OPENAI_BASE_URL = url;
    try {
      const started = Date.now();
      await assert.rejects(
        callModel({ provider: "openai", apiKey: `sk-${randomBytes(12).toString("hex")}`, model: "m", prompt: "x", purpose: "code" }),
        /OpenAI: this key's limit is reached \(Rate limit reached\); try again in about 5 h/
      );
      assert.ok(Date.now() - started < 2000);
    } finally {
      delete process.env.OPENAI_BASE_URL;
      server.close();
    }
  });
});
