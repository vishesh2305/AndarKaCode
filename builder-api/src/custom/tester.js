// Step 13: tries a custom button's code by pressing the button once in the real generated app: the code is
// saved in backend/custom/, the app runs in its own process on a throwaway database with one sample row
// (signed in first when it has a login), and the button is pressed on that row (or on the page).
// There is no right answer to compare with here, so "works" means it answers: 200, or 400 when the code
// refuses with a message. 500 (an error, or too long) and 501 (no code) are problems for the repair request.
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { operationRoute } from "../generator/index.js";
import { startApp } from "../verify/app-runner.js";
import { sampleRecord } from "../verify/index.js";

const PRESS_TIMEOUT_MS = 40_000; // the app stops a press after 30 s itself

/** Saves the code and presses its button once. Resolves with null when it answers, else the problem (text). */
export async function pressOnce({ spec, op, appDir, mongoUri, code }) {
  const file = path.join(appDir, "backend", "custom", `${op.name}.js`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);

  const entity = spec.entities.find((e) => e.name === op.entity);
  const route = operationRoute(op, entity.name);
  const credentials = { email: "custom@example.com", password: randomBytes(12).toString("base64url") };
  let db = null;
  let app = null;
  try {
    db = await mongoose.createConnection(mongoUri).asPromise();
    await db.dropDatabase();
    const collection = db.collection(entity.plural);
    // Two rows: the button is pressed on the first; a row button must leave the other one as it was.
    const { insertedIds } = await collection.insertMany([sampleRecord(entity.name, spec), sampleRecord(entity.name, spec)]);
    const [insertedId, otherId] = [insertedIds[0], insertedIds[1]];
    const other = await collection.findOne({ _id: otherId });
    app = await startApp({ appDir, mongoUri, env: spec.auth ? { ADMIN_EMAIL: credentials.email, ADMIN_PASSWORD: credentials.password } : {} });

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
    return `pressing "${op.button}" failed: ${err.message}`;
  } finally {
    await app?.stop().catch(() => {});
    await db?.dropDatabase().catch(() => {});
    await db?.close();
  }
}
