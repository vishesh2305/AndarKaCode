// Step 23b: Laptop B's job queue. Pages are drawn by a page builder ("single": one model call, the
// default since Step 18.6; "s2c": Screenshot-to-Code, kept as an option), several at the same time:
// the local GPU one at a time, the cloud model several at once. A failed page is tried once more, then
// on the other model. The builders here are fakes: no model, no Screenshot-to-Code.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attemptPlan, createJobQueue } from "../src/jobs.js";

const IMAGE = "data:image/png;base64,aW1n";
const hash = (n) => String(n).padStart(64, "0");
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

async function finished(queue, job) {
  for (let i = 0; i < 200; i++) {
    if (["done", "failed"].includes(job.status)) return queue.view(job);
    await tick(5);
  }
  assert.fail(`job still ${job.status}`);
}

// A fake builder that records calls and how many ran at once per provider.
function fakeBuilder({ ms = 20, fail = () => false } = {}) {
  const calls = [];
  const running = { local: 0, cloud: 0 };
  const most = { local: 0, cloud: 0 };
  const build = async ({ provider, instructions }) => {
    calls.push({ provider, instructions });
    most[provider] = Math.max(most[provider], ++running[provider]);
    await tick(ms);
    running[provider]--;
    if (fail(provider, calls.length)) throw new Error(`${provider} broke`);
    return { html: `<html>${instructions}</html>`, early: false };
  };
  return { build, calls, most };
}

describe("attemptPlan: one retry, then the other model (Step 18.6)", () => {
  it("local: local twice, then cloud when a cloud key is set", () => {
    assert.deepEqual(attemptPlan("local", { hasCloud: true }), ["local", "local", "cloud"]);
    assert.deepEqual(attemptPlan("local", { hasCloud: false }), ["local", "local"]);
  });

  it("cloud: cloud twice, then the local model", () => {
    assert.deepEqual(attemptPlan("cloud", { hasCloud: true }), ["cloud", "cloud", "local"]);
  });

  it("auto: local first, then cloud (or local again without a cloud key)", () => {
    assert.deepEqual(attemptPlan("auto", { hasCloud: true }), ["local", "cloud"]);
    assert.deepEqual(attemptPlan("auto", { hasCloud: false }), ["local", "local"]);
  });
});

describe("createJobQueue: which page builder", () => {
  it("draws with the single call by default, and says so", async () => {
    const single = fakeBuilder();
    const s2c = fakeBuilder();
    const queue = createJobQueue({ builders: { single: single.build, s2c: s2c.build }, hasCloud: true });
    const { job } = queue.submit({ image: IMAGE, instructions: "Data: employee", contractHash: hash(1), mode: "cloud" });
    const view = await finished(queue, job);
    assert.equal(view.status, "done");
    assert.equal(view.html, "<html>Data: employee</html>");
    assert.equal(view.builder, "single");
    assert.equal(view.provider, "cloud");
    assert.equal(s2c.calls.length, 0);
  });

  it("uses Screenshot-to-Code when the request asks for it", async () => {
    const single = fakeBuilder();
    const s2c = fakeBuilder();
    const queue = createJobQueue({ builders: { single: single.build, s2c: s2c.build }, hasCloud: true });
    const { job } = queue.submit({ image: IMAGE, instructions: "x", contractHash: hash(2), mode: "local", builder: "s2c" });
    assert.equal((await finished(queue, job)).builder, "s2c");
    assert.equal(s2c.calls.length, 1);
    assert.equal(single.calls.length, 0);
  });

  it("never shows the input image", async () => {
    const queue = createJobQueue({ builders: { single: fakeBuilder().build }, hasCloud: true });
    const { job } = queue.submit({ image: IMAGE, instructions: "x", contractHash: hash(3), mode: "cloud" });
    assert.doesNotMatch(JSON.stringify(await finished(queue, job)), /aW1n/);
  });
});

describe("createJobQueue: pages at the same time", () => {
  it("runs cloud pages several at once, up to the cloud limit", async () => {
    const single = fakeBuilder({ ms: 30 });
    const queue = createJobQueue({ builders: { single: single.build }, hasCloud: true, limits: { local: 1, cloud: 3 } });
    const jobs = [1, 2, 3, 4, 5].map((n) => queue.submit({ image: IMAGE, instructions: `p${n}`, contractHash: hash(10 + n), mode: "cloud" }).job);
    for (const job of jobs) assert.equal((await finished(queue, job)).status, "done");
    assert.equal(single.most.cloud, 3);
  });

  it("runs local pages one at a time (one GPU)", async () => {
    const single = fakeBuilder({ ms: 10 });
    const queue = createJobQueue({ builders: { single: single.build }, hasCloud: true, limits: { local: 1, cloud: 3 } });
    const jobs = [1, 2, 3].map((n) => queue.submit({ image: IMAGE, instructions: `p${n}`, contractHash: hash(20 + n), mode: "local" }).job);
    for (const job of jobs) await finished(queue, job);
    assert.equal(single.most.local, 1);
  });

  it("does not make a cloud page wait behind a local one", async () => {
    const single = fakeBuilder({ ms: 40 });
    const queue = createJobQueue({ builders: { single: single.build }, hasCloud: true, limits: { local: 1, cloud: 3 } });
    const local = queue.submit({ image: IMAGE, instructions: "slow local", contractHash: hash(31), mode: "local" }).job;
    const cloud = queue.submit({ image: IMAGE, instructions: "cloud", contractHash: hash(32), mode: "cloud" }).job;
    await tick(5);
    assert.equal(local.status, "running");
    assert.equal(cloud.status, "running");
    await finished(queue, local);
    await finished(queue, cloud);
  });

  it("counts the queue: waiting plus running", () => {
    const queue = createJobQueue({ builders: { single: fakeBuilder({ ms: 50 }).build }, hasCloud: true, limits: { local: 1, cloud: 1 } });
    for (const n of [1, 2, 3]) queue.submit({ image: IMAGE, instructions: `p${n}`, contractHash: hash(40 + n), mode: "local" });
    assert.equal(queue.queueLength(), 3);
  });
});

describe("createJobQueue: a page that fails", () => {
  it("is tried once more, and the second try's page is kept", async () => {
    const single = fakeBuilder({ fail: (_p, call) => call === 1 });
    const queue = createJobQueue({ builders: { single: single.build }, hasCloud: true });
    const { job } = queue.submit({ image: IMAGE, instructions: "x", contractHash: hash(51), mode: "cloud" });
    const view = await finished(queue, job);
    assert.equal(view.status, "done");
    assert.deepEqual(single.calls.map((c) => c.provider), ["cloud", "cloud"]);
  });

  it("goes to the other model after the retry, and says which one drew it", async () => {
    const single = fakeBuilder({ fail: (provider) => provider === "cloud" });
    const queue = createJobQueue({ builders: { single: single.build }, hasCloud: true });
    const { job } = queue.submit({ image: IMAGE, instructions: "x", contractHash: hash(52), mode: "cloud" });
    const view = await finished(queue, job);
    assert.equal(view.status, "done");
    assert.equal(view.provider, "local");
    assert.deepEqual(single.calls.map((c) => c.provider), ["cloud", "cloud", "local"]);
  });

  it("fails with the last error when every try fails, and can then be asked again", async () => {
    const single = fakeBuilder({ fail: () => true });
    const queue = createJobQueue({ builders: { single: single.build }, hasCloud: false });
    const request = { image: IMAGE, instructions: "x", contractHash: hash(53), mode: "local" };
    const first = queue.submit(request).job;
    const view = await finished(queue, first);
    assert.equal(view.status, "failed");
    assert.match(view.error, /local: local broke/);
    const again = queue.submit(request);
    assert.equal(again.created, true, "a failed job is not handed back");
  });
});

describe("createJobQueue: the same request twice", () => {
  it("hands back the same job (the same image, spec and builder)", () => {
    const queue = createJobQueue({ builders: { single: fakeBuilder().build, s2c: fakeBuilder().build }, hasCloud: true });
    const request = { image: IMAGE, instructions: "x", contractHash: hash(61), mode: "cloud" };
    const first = queue.submit(request);
    const second = queue.submit(request);
    assert.equal(second.created, false);
    assert.equal(second.job.id, first.job.id);
    assert.equal(queue.submit({ ...request, builder: "s2c" }).created, true, "another builder draws its own page");
  });
});
