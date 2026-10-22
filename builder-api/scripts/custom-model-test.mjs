// Step 13 model test: which coding AI writes custom button code that is safe AND right?
// 5 example buttons, each with our own hidden check. Every answer goes through the safety check, then
// runs inside a real generated app (the Step 13 runtime, via the Step 16 app runner) on a throwaway
// database, and the database is compared with the right result. One repair try per button.
//
//   node scripts/custom-model-test.mjs --provider local [--model qwen2.5-coder:7b]
//   node scripts/custom-model-test.mjs --provider cloud
// Needs TEST_MONGODB_URI (throwaway databases are made next to it and dropped); OLLAMA_URL or GEMINI_API_KEY.
import { rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { checkCustomCode } from "../src/custom/safety.js";
import { codeModelName, codeProviders } from "../src/custom/model.js";
import { customPrompt, extractCode, repairPrompt } from "../src/custom/prompt.js";
import { generateBackend, operationRoute, writeBackend } from "../src/generator/index.js";
import { startApp, stopAll } from "../src/verify/app-runner.js";
import { databaseUri } from "../src/verify/index.js";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const provider = option("provider", "local");
const model = option("model", codeModelName[provider]);
const BASE = process.env.TEST_MONGODB_URI;
if (!BASE) throw new Error("Set TEST_MONGODB_URI (throwaway databases are made next to it)");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "model-test");

const field = (name, label, type, extra = {}) => ({ name, label, type, required: false, evidence: "s1: example", ...extra });
const table = (name, plural, label, fields) => ({
  name,
  plural,
  label,
  sampleConst: `SAMPLE_${plural.toUpperCase()}`,
  fields,
  endpoints: { list: { search: false, filters: [], pagination: false, evidence: "s1: example table" } },
});
const example = (entity, button, scope, opName) => ({
  spec: { entities: [entity], operations: [{ name: opName, entity: entity.name, kind: "custom", scope, button, evidence: `s1: button '${button}'` }], stats: [], auth: null, pages: [{ screenshot: 1, kind: "list", entity: entity.name }], openQuestions: [] },
  op: { name: opName, entity: entity.name, kind: "custom", scope, button, evidence: `s1: button '${button}'` },
});

const employees = table("employee", "employees", "Employees", [field("fullName", "Full Name", "string", { required: true }), field("salary", "Salary", "number")]);
const products = table("product", "products", "Products", [field("name", "Name", "string", { required: true }), field("price", "Price", "number"), field("inStock", "In Stock", "boolean")]);
const invoices = table("invoice", "invoices", "Invoices", [field("customer", "Customer", "string"), field("amount", "Amount", "number"), field("status", "Status", "enum", { options: ["Paid", "Unpaid"] })]);
const leave = table("leaveRequest", "leaveRequests", "Leave Requests", [field("employee", "Employee", "string"), field("from", "From", "date"), field("to", "To", "date"), field("days", "Days", "number")]);

// Each: the button, rows to put in, which row to press (row buttons), and the hidden check (null = right).
const EXAMPLES = [
  {
    ...example(employees, "Give 10% raise", "row", "giveRaiseEmployee"),
    seed: [{ fullName: "Ann Lee", salary: 50000 }, { fullName: "Raj Patel", salary: 40000 }],
    press: 0,
    check: (docs) => (docs[0].salary === 55000 && docs[1].salary === 40000 ? null : `salaries are ${docs.map((d) => d.salary).join(", ")}; expected 55000 and 40000 (only the pressed row)`),
  },
  {
    ...example(products, "Duplicate", "row", "duplicateProduct"),
    seed: [{ name: "Blue Pen", price: 20, inStock: true }],
    press: 0,
    // A copy may keep the name or get "(copy)": both are what a person would accept.
    check: (docs) =>
      docs.length === 2 && docs.every((d) => /blue pen/i.test(d.name) && d.price === 20)
        ? null
        : `after pressing there are ${docs.length} products: ${docs.map((d) => `${d.name} (${d.price})`).join(", ")}; expected the original and one copy with the same price`,
  },
  {
    ...example(invoices, "Mark all paid", "page", "markAllPaidInvoice"),
    seed: [{ customer: "A", amount: 10, status: "Unpaid" }, { customer: "B", amount: 20, status: "Unpaid" }, { customer: "C", amount: 30, status: "Paid" }],
    check: (docs) => (docs.every((d) => d.status === "Paid") && docs.length === 3 ? null : `statuses are ${docs.map((d) => d.status).join(", ")}; expected all Paid`),
  },
  {
    ...example(leave, "Recalculate days", "row", "recalculateDaysLeaveRequest"),
    seed: [{ employee: "Isha", from: new Date("2026-01-10T00:00:00Z"), to: new Date("2026-01-12T00:00:00Z"), days: 0 }],
    press: 0,
    check: (docs) => (docs[0].days === 3 ? null : `days is ${docs[0].days}; from 10 to 12 January is 3 days`),
  },
  {
    ...example(products, "Restock", "page", "restockProduct"),
    seed: [{ name: "Pen", price: 2, inStock: false }, { name: "Ink", price: 4, inStock: false }, { name: "Cap", price: 1, inStock: true }],
    check: (docs) => (docs.every((d) => d.inStock === true) ? null : `in stock: ${docs.map((d) => `${d.name} ${d.inStock}`).join(", ")}; expected all true`),
  },
];

/** Runs one function in a generated app on a throwaway database; null = right, else what went wrong. */
async function tryCode(ex, code, n) {
  const appDir = path.join(OUT, `${n}`);
  const mongoUri = databaseUri(BASE, `modeltest_${n}`);
  await rm(appDir, { recursive: true, force: true });
  await writeBackend(appDir, generateBackend(ex.spec, { name: `modeltest-${n}` }));
  await writeFile(path.join(appDir, "backend", "custom", `${ex.op.name}.js`), code);
  const db = await mongoose.createConnection(mongoUri).asPromise();
  let app;
  try {
    await db.dropDatabase();
    const entity = ex.spec.entities[0];
    const collection = db.collection(entity.plural);
    const now = new Date();
    const { insertedIds } = await collection.insertMany(ex.seed.map((d) => ({ ...d, createdAt: now, updatedAt: now })));
    app = await startApp({ appDir, mongoUri });
    const route = operationRoute(ex.op, entity.name);
    const url = `${app.url}/api/${entity.plural}${route.path.replace(":id", String(insertedIds[ex.press ?? 0]))}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200) return `pressing the button answered ${res.status}: ${body.error ?? JSON.stringify(body)}`;
    const docs = await collection.find({}).sort({ _id: 1 }).toArray();
    return ex.check(docs);
  } finally {
    await app?.stop().catch(() => {});
    await db.dropDatabase().catch(() => {});
    await db.close();
  }
}

const ask = async (prompt) => {
  const started = Date.now();
  const answer = await codeProviders[provider](prompt, model);
  return { code: extractCode(answer), seconds: (Date.now() - started) / 1000 };
};

console.log(`Coding model test: ${provider} ${model}\n`);
const rows = [];
let n = 0;
try {
  for (const ex of EXAMPLES) {
    const row = { button: ex.op.button, safe: "", right: "", tries: 0, seconds: 0, problem: "" };
    let code;
    let seconds;
    try {
      ({ code, seconds } = await ask(customPrompt(ex.spec, ex.op)));
    } catch (err) {
      // The model could not answer (e.g. Gemini "high demand"): count it, and go on with the next button.
      Object.assign(row, { safe: "-", right: "no", problem: `the model did not answer: ${err.message}` });
      rows.push(row);
      console.log(`✗ ${row.button}: ${row.problem}`);
      continue;
    }
    row.seconds += seconds;
    for (let attempt = 1; attempt <= 2; attempt++) {
      row.tries = attempt;
      const safety = code ? checkCustomCode(code) : { ok: false, problems: ["the answer had no code"] };
      let problem = safety.ok ? await tryCode(ex, code, ++n) : `the safety check refused it: ${safety.problems.join("; ")}`;
      if (attempt === 1) row.safe = safety.ok ? "yes" : "no";
      if (!problem) {
        row.right = attempt === 1 ? "yes" : "after repair";
        break;
      }
      row.problem = problem;
      if (attempt === 2) {
        row.right = "no";
        break;
      }
      ({ code, seconds } = await ask(repairPrompt(ex.spec, ex.op, code ?? "(no code)", problem)));
      row.seconds += seconds;
    }
    rows.push(row);
    console.log(`${row.right === "no" ? "✗" : "✓"} ${row.button}: safe first time ${row.safe}, right ${row.right}, ${row.tries} answer(s), ${row.seconds.toFixed(1)} s${row.right === "no" ? `\n    ${row.problem}` : ""}`);
  }
} finally {
  await stopAll();
  await rm(OUT, { recursive: true, force: true });
}
const right = rows.filter((r) => r.right !== "no").length;
const first = rows.filter((r) => r.right === "yes").length;
const seconds = rows.reduce((s, r) => s + r.seconds, 0);
console.log(`\n${provider} ${model}: ${right}/${rows.length} right (${first} first time), ${seconds.toFixed(1)} s of model time`);
process.exitCode = right === rows.length ? 0 : 1;
