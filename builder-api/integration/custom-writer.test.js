// Integration (Step 13): a custom button's code is tried by pressing the button once in the real generated
// app (its own process, a throwaway database with sample rows, signed in when the app has a login).
// The writer keeps code that answers, and repairs code that doesn't. Needs TEST_MONGODB_URI.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { pressOnce } from "../src/custom/tester.js";
import { writeCustomCode } from "../src/custom/writer.js";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { stopAll } from "../src/verify/app-runner.js";
import { databaseUri } from "../src/verify/index.js";
import { loginOnlySpec, opsSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "custom-writer");
const mongoUri = databaseUri(MONGODB_URI, "custom_writer_itest");

const op = (name) => opsSpec.operations.find((o) => o.name === name);
const wrap = (body) => `export default async function ({ record, input, helpers }) {\n${body}\n}`;
const saved = (dir, name) => readFile(path.join(dir, "backend", "custom", `${name}.js`), "utf8").catch(() => null);
const appDir = path.join(OUT, "ops");
const press = (name, code, extra = {}) => pressOnce({ spec: opsSpec, op: op(name), appDir, mongoUri, code, ...extra });

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await writeBackend(appDir, generateBackend(opsSpec, { name: "custom writer" }));
});
after(async () => {
  await stopAll();
  await rm(OUT, { recursive: true, force: true });
});

describe("pressOnce: the button pressed once in the generated app", () => {
  it("working row code: no problem, and the code is saved in backend/custom/", async () => {
    const code = wrap("  const updated = await helpers.update(record.id, { days: (record.days ?? 0) + 1 });\n  return { message: `Now ${updated.days}` };");
    assert.equal(await press("recalculateLeaveRequest", code), null);
    assert.equal(await saved(appDir, "recalculateLeaveRequest"), code);
  });

  it("working page code (no row): no problem", async () => {
    assert.equal(await press("syncPayrollLeaveRequest", wrap("  const all = await helpers.list({});\n  return { message: all.length + ' requests' };")), null);
  });

  it("a refusal (helpers.fail) is an answer too: no problem", async () => {
    assert.equal(await press("recalculateLeaveRequest", wrap('  helpers.fail("Nothing to recalculate");')), null);
  });

  it("code that throws: the problem says what the button answered", async () => {
    const problem = await press("recalculateLeaveRequest", wrap("  return record.nothing.here;"));
    assert.match(problem, /pressing "Recalculate" answered 500: custom code failed/);
  });

  it("a row button that also changes other rows: the problem says so", async () => {
    const problem = await press("recalculateLeaveRequest", wrap("  await helpers.updateMany({}, { days: 42 });\n  return { message: 'Recalculated' };"));
    assert.match(problem, /pressing "Recalculate" on one row also changed another row/);
  });

  it("a row button may add a new row (Duplicate) without that counting as changing others", async () => {
    assert.equal(await press("recalculateLeaveRequest", wrap("  await helpers.create({ employee: record.employee, days: record.days });\n  return { message: 'Copied' };")), null);
  });

  it("a stuck loop: the problem says it took too long", async () => {
    const problem = await press("recalculateLeaveRequest", wrap("  for (const x of [1]) { while (true) {} }"));
    assert.match(problem, /took too long/);
  });

  it("leaves no app running and no database behind", async () => {
    const conn = await mongoose.createConnection(mongoUri).asPromise();
    try {
      assert.deepEqual(await conn.db.listCollections().toArray(), []);
    } finally {
      await conn.close();
    }
  });

  it("signs in first when the app has a login", async () => {
    const spec = { ...opsSpec, auth: loginOnlySpec.auth, pages: [{ screenshot: 1, kind: "login" }, { screenshot: 2, kind: "dashboard", entity: "leaveRequest" }] };
    const dir = path.join(OUT, "login");
    await writeBackend(dir, generateBackend(spec, { name: "custom writer login" }));
    const problem = await pressOnce({ spec, op: op("recalculateLeaveRequest"), appDir: dir, mongoUri, code: wrap("  return { message: record.employee };") });
    assert.equal(problem, null);
  });
});

describe("writeCustomCode with the real press: broken code is repaired", () => {
  it("the first answer fails when pressed, the repaired one is kept", async () => {
    const answers = [wrap("  return record.nothing.here;"), wrap("  await helpers.update(record.id, { status: \"Pending\" });\n  return { message: \"Reset\" };")];
    const prompts = [];
    const result = await writeCustomCode({
      spec: opsSpec,
      op: op("recalculateLeaveRequest"),
      mode: "local",
      providers: { local: async (prompt) => (prompts.push(prompt), "```js\n" + answers.shift() + "\n```") },
      test: (code) => press("recalculateLeaveRequest", code),
    });
    assert.equal(result.ok, true, result.problem);
    assert.equal(result.answers, 2);
    assert.match(prompts[1], /answered 500: custom code failed/);
    assert.match(await saved(appDir, "recalculateLeaveRequest"), /Reset/);
  });
});
