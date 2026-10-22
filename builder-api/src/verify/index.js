// The Verifier (Step 16): proves a generated app works before anyone downloads it.
//   1. markers   - each page has the fields and buttons its part of the spec needs (no app needed)
//   2. health    - the app starts on a throwaway database and answers
//   3. person    - every page is used like a person would (Add, Edit, Search, buttons, Delete, sign-in)
//   4. tests     - the app's own tests pass (on another throwaway database)
// Each check: { id, page?, title, status: pass|fail|warn|note|skip, layer?: page|spec|backend, detail }.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { apiMap } from "../wirer/index.js";
import { appEnv, linkPackages, startApp } from "./app-runner.js";
import { expectedMarkers, markerCheck, pageMarkers } from "./markers.js";
import { runDataPage, runLoginPage } from "./person.js";

const TESTS_TIMEOUT_MS = 90_000;

/** Runs the app's own tests; one check. */
export async function runAppTests(appDir, mongoUri) {
  await linkPackages(appDir);
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", "tests/**/*.test.js"], {
    cwd: appDir,
    env: appEnv({ MONGODB_URI_TEST: mongoUri }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const timer = setTimeout(() => child.kill(), TESTS_TIMEOUT_MS);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  clearTimeout(timer);

  const count = (word) => Number(output.match(new RegExp(`^# ${word} (\\d+)`, "m"))?.[1] ?? 0);
  const failed = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim()).filter((name) => !/^tests[\\/]/.test(name));
  const base = { id: "tests", title: "The app's own tests pass" };
  if (code === 0) return { ...base, status: "pass", detail: `${count("pass")} tests passed.` };
  if (code === null) return { ...base, status: "fail", layer: "backend", detail: `The tests did not finish within ${TESTS_TIMEOUT_MS / 1000} s.` };
  return { ...base, status: "fail", layer: "backend", detail: `${count("fail") || failed.length} failed: ${failed.slice(0, 5).join("; ") || output.trim().split("\n").slice(-3).join(" ")}` };
}

// Typed sample values for a record put in directly (pages without Add), from the page's spec.
function sampleRecord(entity, spec) {
  const fields = spec.entities.find((e) => e.name === entity)?.fields ?? [];
  const doc = { createdAt: new Date(), updatedAt: new Date() };
  for (const f of fields) {
    if (f.type === "ref") continue;
    doc[f.name] = { string: `Sample ${f.label}`, email: "sample@example.com", number: 1, date: new Date("2026-01-15"), boolean: true, enum: f.options?.[0] }[f.type];
  }
  if (spec.entities.find((e) => e.name === entity)?.endpoints.delete?.soft) doc.deletedAt = null;
  return doc;
}

async function drop(uri) {
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    await conn.dropDatabase();
  } finally {
    await conn.close();
  }
}

const summarize = (checks) => Object.fromEntries(["pass", "fail", "warn", "note", "skip"].map((s) => [s, checks.filter((c) => c.status === s).length]));

/** Verifies the wired app in appDir. mongoUri and testsMongoUri are throwaway databases (dropped). */
export async function verifyApp({ spec, appDir, mongoUri, testsMongoUri }) {
  const started = Date.now();
  const map = apiMap(spec);
  const checks = [];

  // 1. Markers, page by page (the page as Laptop B built it, with its own scripts).
  const files = new Map();
  for (const page of spec.pages) {
    const n = page.screenshot;
    const file = `page-${n}.html`;
    const html = await readFile(path.join(appDir, "frontend", file), "utf8").catch(() => null);
    if (html === null) {
      checks.push({ id: `markers:p${n}`, page: n, title: "The page was built", status: "fail", layer: "page", detail: `${file} is missing.` });
      continue;
    }
    files.set(n, file);
    const result = markerCheck(expectedMarkers(spec, n), await pageMarkers(html));
    checks.push({ id: `markers:p${n}`, page: n, title: "Every field and button the spec needs is on the page", status: result.status, layer: result.layer, detail: result.detail });
    result.warnings.forEach((warning, i) => checks.push({ id: `warn:p${n}:${i + 1}`, page: n, title: "Something on the page the spec does not have", status: "warn", detail: warning }));
  }

  // 2 + 3. Start the app and use it like a person.
  const credentials = { email: "verify@example.com", password: randomBytes(12).toString("base64url") };
  let app = null;
  let db = null;
  try {
    app = await startApp({ appDir, mongoUri, env: spec.auth ? { ADMIN_EMAIL: credentials.email, ADMIN_PASSWORD: credentials.password } : {} });
    const health = await fetch(`${app.url}/health`).then((r) => r.json()).catch(() => null);
    checks.push({ id: "health", title: "The app starts and reaches its database", ...(health?.ok && health.db ? { status: "pass", detail: "Started, and /health says the database is connected." } : { status: "fail", layer: "backend", detail: "/health did not report a connected database." }) });

    db = await mongoose.createConnection(mongoUri).asPromise();
    const ensureRecord = async (entityName) => {
      const entity = spec.entities.find((e) => e.name === entityName);
      const collection = db.collection(entity.plural);
      if (!(await collection.countDocuments())) await collection.insertOne(sampleRecord(entityName, spec));
      const doc = await collection.findOne({}, { sort: { createdAt: -1 } });
      return doc && { ...doc, id: doc._id.toString() };
    };

    let token = null;
    const ordered = [...spec.pages].sort((a, b) => (a.kind === "login" ? -1 : 0) - (b.kind === "login" ? -1 : 0));
    for (const page of ordered) {
      const n = page.screenshot;
      const file = files.get(n);
      if (!file) continue;
      const expected = expectedMarkers(spec, n);
      if (page.kind === "login" && map.auth) {
        const login = await runLoginPage({ base: app.url, map, n, file, credentials });
        checks.push(...login.checks);
        token = login.token ?? token;
      } else if (expected.entity) {
        checks.push(...(await runDataPage({ base: app.url, map, spec, n, file, expected, token, ensureRecord })));
      }
    }
  } catch (err) {
    checks.push({ id: "health", title: "The app starts and reaches its database", status: "fail", layer: "backend", detail: err.message });
  } finally {
    await db?.close();
    await app?.stop({ dropDatabase: true }).catch(() => {});
  }

  // 4. The app's own tests.
  checks.push(await runAppTests(appDir, testsMongoUri));
  await drop(testsMongoUri).catch(() => {});

  const summary = summarize(checks);
  return { ok: summary.fail === 0, summary, checks, seconds: Math.round((Date.now() - started) / 100) / 10 };
}
