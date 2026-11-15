// Step 34a: runs live previews asked for through MongoDB (preview-queue.js). Used by the preview service
// (ROLE=preview) and, with ROLE=all, inside the Builder API itself. Each request carries the app's files and
// starting rows: they are unpacked into a folder of its own, started in a box (a sandbox with SANDBOX=docker),
// and given a secret token for its address. It keeps MongoDB up to date (running, stopped, failed, still
// alive) and stops a preview that was asked to stop or was replaced by a newer request.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claimPreview, heartbeat, markFailed, markRunning, markStopped, previewsOf } from "./preview-queue.js";
import { databaseUri } from "./verify/index.js";
import { startPreview, stopPreview } from "./verify/preview.js";
import { untarTo } from "./verify/tar.js";

const PICKUP_MS = Number(process.env.PICKUP_MS ?? 1000);
const HEARTBEAT_MS = 15_000;

/** Starts the loop; returns { wake() } to look for work at once (ROLE=all, right after a request). */
export function startPreviewWorker({ worker, mongodbUri, log = console }) {
  const held = new Map(); // projectId -> { token, dir }
  let wakeUp = null;
  let lastBeat = 0;

  async function ended(projectId, token, dir) {
    if (held.get(projectId)?.token === token) held.delete(projectId);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await markStopped({ projectId, worker, token }).catch(() => {});
  }

  async function start(request) {
    const { projectId, hash } = request;
    const dir = await mkdtemp(path.join(os.tmpdir(), "andarkacode-preview-"));
    const token = randomBytes(24).toString("base64url"); // 32 characters
    try {
      await untarTo(Buffer.from(request.files.buffer ?? request.files), dir);
      const preview = await startPreview({
        projectId,
        hash: `${hash}:${token}`, // a new request is always a new start
        appDir: dir,
        auth: request.auth,
        mongoUri: databaseUri(mongodbUri, `preview_${projectId}`),
        seed: async () => request.seed ?? {},
        token,
        onEnd: () => ended(projectId, token, dir),
      });
      held.set(projectId, { token, dir });
      if (!(await markRunning({ projectId, hash, worker, token, credentials: preview.credentials }))) await stopPreview(projectId); // replaced meanwhile
    } catch (err) {
      log.error(`preview of ${projectId}: ${err.message}`);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      await markFailed({ projectId, hash, worker, error: `The live preview could not start: ${err.message}` });
    }
  }

  // Stops what MongoDB no longer wants from this worker: asked to stop, replaced, or taken by another.
  async function reconcile() {
    if (!held.size) return;
    const docs = new Map((await previewsOf([...held.keys()])).map((d) => [d.projectId, d]));
    for (const [projectId, { token }] of held) {
      const doc = docs.get(projectId);
      const wanted = doc && doc.worker === worker && doc.status === "running" && doc.token === token && !doc.stopRequested;
      if (!wanted && doc?.status !== "starting") await stopPreview(projectId).catch(() => {});
    }
  }

  async function tick() {
    await reconcile();
    if (Date.now() - lastBeat > HEARTBEAT_MS) {
      lastBeat = Date.now();
      await heartbeat({ worker, projectIds: [...held.keys()] });
    }
    for (let request; (request = await claimPreview({ worker })); ) start(request); // each starts on its own
  }

  (async () => {
    for (;;) {
      await tick().catch((err) => log.error(`previews: ${err.message}`));
      await new Promise((resolve) => {
        wakeUp = resolve;
        setTimeout(resolve, PICKUP_MS).unref?.();
      });
    }
  })();

  return { wake: () => wakeUp?.() };
}
