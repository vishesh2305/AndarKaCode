// The live preview (Step 16): a project's wired app running on its own test database, reached through
// the Builder API at /preview/<project>/ (one address, nothing new opened to the network). One preview per
// project; it stops by itself after PREVIEW_IDLE_MS without a request, and its test data is deleted.
// It starts with the rows the screenshots show (sample-rows.js), so every row button can be tried at once.
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { startApp } from "./app-runner.js";

const IDLE_MS = Number(process.env.PREVIEW_IDLE_MS ?? 15 * 60_000);
const previews = new Map(); // projectId -> { hash, app, credentials, timer } or a pending start

export const previewOf = (projectId) => {
  const preview = previews.get(projectId);
  return preview?.app ? preview : null;
};

function arm(projectId, preview) {
  clearTimeout(preview.timer);
  preview.timer = setTimeout(() => stopPreview(projectId).catch(() => {}), IDLE_MS);
  preview.timer.unref?.();
}

/** Every request through /preview/<project>/ keeps it running a while longer. */
export function touchPreview(projectId) {
  const preview = previewOf(projectId);
  if (preview) arm(projectId, preview);
}

// A fresh test database with the starting rows ({ collection: records }), before the app opens it.
async function fillDatabase(mongoUri, records) {
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  try {
    await conn.dropDatabase();
    for (const [collection, docs] of Object.entries(records ?? {})) {
      if (docs.length) await conn.collection(collection).insertMany(docs, { ordered: false }).catch(() => {});
    }
  } finally {
    await conn.close();
  }
}

/** Starts (or reuses) the preview for the current spec version. seed() -> the starting rows, for a new start. */
export async function startPreview({ projectId, hash, appDir, auth, mongoUri, seed }) {
  const existing = previews.get(projectId);
  if (existing?.hash === hash) {
    const ready = existing.app ? existing : await existing.pending;
    arm(projectId, ready);
    return ready;
  }
  if (existing) await stopPreview(projectId);

  const credentials = auth ? { email: "preview@example.com", password: randomBytes(9).toString("base64url") } : null;
  const entry = { hash, credentials, app: null, timer: null };
  const env = credentials ? { ADMIN_EMAIL: credentials.email, ADMIN_PASSWORD: credentials.password } : {};
  entry.pending = (async () => {
    if (seed) await fillDatabase(mongoUri, await seed());
    return startApp({ appDir, mongoUri, env });
  })().then(
    (app) => {
      entry.app = app;
      arm(projectId, entry);
      return entry;
    },
    (err) => {
      previews.delete(projectId);
      throw err;
    }
  );
  previews.set(projectId, entry);
  return entry.pending;
}

/** Stops the preview and deletes its test data. */
export async function stopPreview(projectId) {
  const preview = previews.get(projectId);
  if (!preview) return;
  previews.delete(projectId);
  clearTimeout(preview.timer);
  const app = preview.app ?? (await preview.pending.catch(() => null))?.app;
  await app?.stop({ dropDatabase: true }).catch(() => {});
}
