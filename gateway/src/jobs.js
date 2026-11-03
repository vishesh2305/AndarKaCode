import { createHash, randomUUID } from "node:crypto";
import { withUsage } from "../../shared/meter.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

import { attemptPlan } from "../../shared/attempts.mjs";

export { attemptPlan }; // one retry, then the other model (shared with the ui-worker, Step 26)

/**
 * Jobs live in memory: Laptop A owns the real state and resubmits if the Gateway restarts.
 * builders: { single, s2c }, each ({ provider, image, instructions, onProgress }) -> { html, early }.
 * limits: how many pages at once per lane. The local GPU draws one page at a time; the cloud model
 * draws several (Step 23b). A job's lane is the model it starts on.
 */
export function createJobQueue({ builders, defaultBuilder = "single", limits = { local: 1, cloud: 4 }, hasCloud = false }) {
  const jobs = new Map(); // jobId -> job
  const jobIdByKey = new Map(); // same (image, contractHash, builder) -> same job
  const waiting = []; // jobIds, oldest first
  const running = { local: 0, cloud: 0 };
  const laneOf = (job) => (job.mode === "cloud" ? "cloud" : "local");

  function submit({ image, instructions, contractHash, mode, builder = defaultBuilder }) {
    const key = sha256(`${sha256(image)}|${contractHash}|create|${builder}`);
    const existing = jobs.get(jobIdByKey.get(key));
    if (existing && existing.status !== "failed") return { job: existing, created: false };

    const job = {
      id: randomUUID(),
      status: "queued",
      progress: "Waiting for a free model",
      chars: 0,
      mode,
      builder,
      provider: null,
      contractHash,
      html: null,
      finishedEarly: false,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      usage: [], // every model call this job made (Step 25), handed back with the page
      input: { image, instructions }, // dropped once the job finishes
    };
    jobs.set(job.id, job);
    jobIdByKey.set(key, job.id);
    waiting.push(job.id);
    runNext();
    return { job, created: true };
  }

  // Starts every waiting job whose lane has room, oldest first.
  function runNext() {
    for (let i = 0; i < waiting.length; ) {
      const job = jobs.get(waiting[i]);
      const lane = laneOf(job);
      if (running[lane] >= (limits[lane] ?? 1)) {
        i++;
        continue;
      }
      waiting.splice(i, 1);
      running[lane]++;
      run(job).finally(() => {
        running[lane]--;
        runNext();
      });
    }
  }

  async function run(job) {
    job.status = "running";
    job.progress = job.builder === "s2c" ? "Starting Screenshot-to-Code" : "Drawing the page";
    job.startedAt = Date.now();
    for (const provider of attemptPlan(job.mode, { hasCloud })) {
      job.provider = provider;
      try {
        const { html, early = false } = await withUsage(job.usage, () => builders[job.builder]({
          provider,
          image: job.input.image,
          instructions: job.input.instructions,
          onProgress: ({ status, chars }) => {
            job.progress = status;
            job.chars = chars;
          },
        }));
        job.html = html;
        job.finishedEarly = early;
        job.error = null;
        break;
      } catch (err) {
        job.error = `${provider}: ${err.message}`.slice(0, 500);
        console.error(`Job ${job.id} ${job.error}`);
      }
    }
    job.status = job.html ? "done" : "failed";
    job.progress = job.html ? "Done" : "Failed";
    job.finishedAt = Date.now();
    delete job.input;
  }

  // What callers may see: never the input image, and the HTML only once it is done.
  function view(job) {
    const end = job.finishedAt ?? Date.now();
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      chars: job.chars,
      queuePosition: job.status === "queued" ? waiting.indexOf(job.id) + 1 : 0,
      seconds: job.startedAt ? Math.round((end - job.startedAt) / 1000) : 0,
      mode: job.mode,
      builder: job.builder,
      provider: job.provider,
      contractHash: job.contractHash,
      ...(job.status === "done" && { finishedEarly: job.finishedEarly, html: job.html, usage: job.usage }),
      ...(job.status === "failed" && { error: job.error }),
    };
  }

  return {
    submit,
    get: (id) => jobs.get(id),
    view,
    queueLength: () => waiting.length + running.local + running.cloud,
  };
}
