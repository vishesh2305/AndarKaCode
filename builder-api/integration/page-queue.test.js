// Step 26: the page queue in MongoDB (PAGE_LANE=queue). The orchestrator submits a page job and asks how it
// is going, exactly as it does with Laptop B's Gateway; ui-worker services claim the jobs with a lease,
// draw them and hand them back. The screenshot and the finished page travel as blobs (Step 21).
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { claimPageJob, failPageJob, finishPageJob, getPage, renewPageJob, submitPage } from "../src/page-queue.js";
import { databaseUri } from "../src/verify/index.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped)");

before(async () => {
  await mongoose.connect(databaseUri(MONGODB_URI, "page_queue_test"));
  await mongoose.connection.dropDatabase();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const T = new Date("2026-11-03T10:00:00Z").getTime();
let n = 0;
const request = () => ({ imageDataUrl: `data:image/png;base64,${Buffer.from(`screenshot ${++n}`).toString("base64")}`, instructions: "Data: employee", contractHash: "c".repeat(64), mode: "cloud" });

describe("submitPage and getPage: the same two calls as the Gateway", () => {
  it("queues a page job and says it is waiting", async () => {
    const { jobId, status } = await submitPage(request());
    assert.match(jobId, /^[0-9a-f]{24}$/);
    assert.equal(status, "queued");
    assert.equal((await getPage(jobId)).status, "queued");
  });

  it("hands back the same job for the same screenshot and spec (no page drawn twice)", async () => {
    const r = request();
    assert.equal((await submitPage(r)).jobId, (await submitPage(r)).jobId);
  });

  it("knows no such job, like the Gateway after a restart (404)", async () => {
    await assert.rejects(getPage("0".repeat(24)), (err) => err.status === 404);
  });
});

describe("claimPageJob: one ui-worker per page", () => {
  it("gives a waiting job to exactly one of five workers asking at once, with its screenshot and instructions", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    const { jobId } = await submitPage(request());
    const claims = await Promise.all(["w1", "w2", "w3", "w4", "w5"].map((worker) => claimPageJob({ worker, now: T, ms: 60_000 })));
    const won = claims.filter(Boolean);
    assert.equal(won.length, 1);
    assert.equal(won[0].id, jobId);
    assert.equal(won[0].instructions, "Data: employee");
    assert.equal(won[0].mode, "cloud");
    assert.match(won[0].image.toString("utf8"), /^screenshot \d+$/);
    assert.equal((await getPage(jobId)).status, "running");
  });

  it("gives nothing when no job waits", async () => {
    assert.equal(await claimPageJob({ worker: "w1", now: T, ms: 60_000 }), null);
  });

  it("gives a job back to the queue when its worker died (the lease ran out), and only then", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    await submitPage(request());
    await claimPageJob({ worker: "dead", now: T, ms: 60_000 });
    assert.equal(await claimPageJob({ worker: "w2", now: T + 30_000, ms: 60_000 }), null, "still held");
    assert.ok(await claimPageJob({ worker: "w2", now: T + 61_000, ms: 60_000 }), "taken over");
  });

  it("renews a lease for its holder only", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    await submitPage(request());
    const job = await claimPageJob({ worker: "w1", now: T, ms: 60_000 });
    assert.equal(await renewPageJob(job.id, { worker: "w1", now: T + 20_000, ms: 60_000 }), true);
    assert.equal(await renewPageJob(job.id, { worker: "w2", now: T + 20_000, ms: 60_000 }), false);
  });
});

describe("finishPageJob and failPageJob: the result", () => {
  it("a drawn page is handed back with its provider and usage, as the Gateway does", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    const r = request();
    const { jobId } = await submitPage(r);
    await claimPageJob({ worker: "w1", now: T, ms: 60_000 });
    const usage = [{ purpose: "page", provider: "cloud", model: "m", inputTokens: 900, outputTokens: 1400, thinkingTokens: 0, seconds: 21 }];
    assert.equal(await finishPageJob(jobId, { worker: "w1", html: "<html>page</html>", provider: "cloud", usage }), true);
    const page = await getPage(jobId);
    assert.deepEqual(
      { status: page.status, html: page.html, provider: page.provider, usage: page.usage, contractHash: page.contractHash },
      { status: "done", html: "<html>page</html>", provider: "cloud", usage, contractHash: r.contractHash }
    );
  });

  it("a worker that lost its lease can't hand back a result", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    const { jobId } = await submitPage(request());
    await claimPageJob({ worker: "old", now: T, ms: 60_000 });
    await claimPageJob({ worker: "new", now: T + 61_000, ms: 60_000 });
    assert.equal(await finishPageJob(jobId, { worker: "old", html: "<html>late</html>", provider: "cloud", usage: [] }), false);
    assert.equal((await getPage(jobId)).status, "running");
  });

  it("the screenshot and the page travel inside the job, so a ui-worker on another server needs no shared disk (Step 28)", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    const r = request();
    const { jobId } = await submitPage(r);
    const queued = await mongoose.connection.collection("pagejobs").findOne({});
    assert.equal(Buffer.from(queued.image.buffer).toString("utf8"), `screenshot ${n}`);
    await claimPageJob({ worker: "w1", now: T, ms: 60_000 });
    await finishPageJob(jobId, { worker: "w1", html: "<html>here</html>", provider: "local", usage: [] });
    const done = await mongoose.connection.collection("pagejobs").findOne({});
    assert.equal(done.html, "<html>here</html>");
    assert.equal(done.image, undefined, "the screenshot is dropped once the page is drawn");
    assert.equal((await getPage(jobId)).html, "<html>here</html>");
  });

  it("a failed page says why, and the same request then makes a new job", async () => {
    await mongoose.connection.collection("pagejobs").deleteMany({});
    const r = request();
    const { jobId } = await submitPage(r);
    await claimPageJob({ worker: "w1", now: T, ms: 60_000 });
    await failPageJob(jobId, { worker: "w1", error: "cloud: Gemini 429: quota" });
    const failed = await getPage(jobId);
    assert.deepEqual([failed.status, failed.error], ["failed", "cloud: Gemini 429: quota"]);
    assert.notEqual((await submitPage(r)).jobId, jobId);
  });
});
