// Step 13: tries a custom button's code by pressing the button once in the real generated app: the code is
// saved in backend/custom/, the app runs in its own process on a throwaway database with one sample row
// (signed in first when it has a login), and the button is pressed on that row (or on the page).
// There is no right answer to compare with here, so "works" means it answers: 200, or 400 when the code
// refuses with a message. 500 (an error, or too long) and 501 (no code) are problems for the repair request.
// Step 33b: the app runs in a box (verify/box.js): its own sandbox with SANDBOX=docker, else a process here.
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { operationRoute } from "../generator/index.js";
import { openBox } from "../verify/box.js";
import { sampleRecord } from "../verify/index.js";

const PRESS_TIMEOUT_MS = 40_000; // the app stops a press after 30 s itself
const PRESS_MAX_MS = 5 * 60_000; // the sandbox's time limit for one press

/** Saves the code and presses its button once. Resolves with null when it answers, else the problem (text).
 * mongoUri: the throwaway database of a process box (a sandbox has its own inside). */
export async function pressOnce({ spec, op, appDir, mongoUri, code }) {
  const file = path.join(appDir, "backend", "custom", `${op.name}.js`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);

  const entity = spec.entities.find((e) => e.name === op.entity);
  const route = operationRoute(op, entity.name);
  const credentials = { email: "custom@example.com", password: randomBytes(12).toString("base64url") };
  let box = null;
  let db = null;
  try {
    box = await openBox({ appDir, mongoUri, maxMs: PRESS_MAX_MS }); // after the code is saved: a sandbox copies the app in
    db = await mongoose.createConnection(box.dbUri("app")).asPromise();
    await db.dropDatabase();
    const collection = db.collection(entity.plural);
    // Two rows: the button is pressed on the first; a row button must leave the other one as it was.
    const { insertedIds } = await collection.insertMany([sampleRecord(entity.name, spec), sampleRecord(entity.name, spec)]);
    const [insertedId, otherId] = [insertedIds[0], insertedIds[1]];
    const other = await collection.findOne({ _id: otherId });
    const app = await box.startApp({ env: spec.auth ? { ADMIN_EMAIL: credentials.email, ADMIN_PASSWORD: credentials.password } : {} });

    const headers = { "Content-Type": "application/json" };
    if (spec.auth) {
      const login = await fetch(`${app.url}/api/auth/login`, { method: "POST", headers, body: JSON.stringify(credentials) });
      const { token } = await login.json();
      if (!token) return `signing in to press "${op.button}" answered ${login.status}`;
      headers.Authorization = `Bearer ${token}`;
    }
    const url = `${app.url}/api/${entity.plural}${route.path.replace(":id", String(insertedId))}`;
    const res = await fetch(url, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(PRESS_TIMEOUT_MS) });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200 && res.status !== 400) return `pressing "${op.button}" answered ${res.status}: ${body.error ?? JSON.stringify(body)}`;
    if (route.row) {
      const fields = (doc) => JSON.stringify(entity.fields.map((f) => doc?.[f.name] ?? null).concat(doc?.deletedAt ?? null));
      const after = await collection.findOne({ _id: otherId });
      if (fields(after) !== fields(other)) return `pressing "${op.button}" on one row also changed another row: a row button may change only its own row (use helpers.update(record.id, changes))`;
    }
    return null;
  } catch (err) {
    // fetch says only "fetch failed"; the reason (a refused or reset connection) is in its cause.
    const cause = err.cause?.code ?? err.cause?.message;
    return `pressing "${op.button}" failed: ${err.message}${cause ? ` (${cause})` : ""}`;
  } finally {
    await db?.close().catch(() => {});
    await box?.stop().catch(() => {}); // the app, and (a process box) its database
  }
}
