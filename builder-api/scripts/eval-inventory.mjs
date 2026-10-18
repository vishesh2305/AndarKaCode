// Accuracy check with the REAL vision model: mock screenshot -> inventory -> spec -> expected facts.
// Usage (builder-api/): npm run eval:inventory -- [local|cloud|auto] [caseName]
// Not part of `npm test`: model output varies and a run takes minutes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkSpec } from "../src/spec/check.js";
import { deriveSpec } from "../src/spec/derive.js";
import { pageInstructions } from "../src/spec/instructions.js";
import { readInventory } from "../src/spec/inventory.js";
import { REPO_ROOT } from "../src/storage.js";

const MOCKS = path.join(REPO_ROOT, "samples/mocks");
const mode = process.argv[2] ?? "local";
const only = process.argv[3];

const first = (spec) => spec.entities[0] ?? { fields: [], endpoints: {} };
const endpoints = (e) => Object.keys(e.endpoints).sort().join(",");
const fieldType = (e, name) => e.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.type;

// [what is checked, test] — "must not" checks enforce "nothing unnecessary".
const CASES = {
  "m1-edit-delete": {
    screens: ["m1-edit-delete"],
    checks: [
      ["one entity", (s) => s.entities.length === 1],
      ["endpoints exactly delete,get,list,update", (s) => endpoints(first(s)) === "delete,get,list,update"],
      ["email field is email", (s) => fieldType(first(s), "email") === "email"],
      ["salary field is number", (s) => fieldType(first(s), "salary") === "number"],
      ["must not: create, search, pagination, auth", (s) => !first(s).endpoints.create && !first(s).endpoints.list?.search && !first(s).endpoints.list?.pagination && s.auth === null],
    ],
  },
  "m2-add-search-page": {
    screens: ["m2-add-search-page"],
    checks: [
      ["create from '+ Add Product'", (s) => Boolean(first(s).endpoints.create)],
      ["search", (s) => first(s).endpoints.list?.search === true],
      ["pagination", (s) => first(s).endpoints.list?.pagination === true],
      ["a category filter", (s) => (first(s).endpoints.list?.filters ?? []).some((f) => /categor/i.test(f))],
      ["price is number", (s) => fieldType(first(s), "price") === "number"],
      ["in stock is boolean", (s) => fieldType(first(s), "inStock") === "boolean"],
      ["must not: auth, stats", (s) => s.auth === null && s.stats.length === 0],
    ],
  },
  "m3-dashboard": {
    screens: ["m3-dashboard"],
    checks: [
      ["3 stats, one per card", (s) => s.stats.length === 3],
      ["'Total Orders' is a count", (s) => s.stats.some((x) => /total orders/i.test(x.label) && x.metric === "count" && !x.where)],
      ["'Pending' counts by status", (s) => s.stats.some((x) => /pending/i.test(x.label) && x.where)],
      ["status is an enum", (s) => fieldType(first(s), "status") === "enum"],
      ["must not: create, update, delete, auth", (s) => !first(s).endpoints.create && !first(s).endpoints.update && !first(s).endpoints.delete && s.auth === null],
    ],
  },
  "m4-login": {
    screens: ["m4-login"],
    checks: [
      ["login", (s) => Boolean(s.auth?.login)],
      ["sign-up (link visible)", (s) => Boolean(s.auth?.signup)],
      ["must not: entities, roles", (s) => s.entities.length === 0 && !s.auth?.roles],
    ],
  },
  "m5-relation": {
    screens: ["m5a-employees-dept", "m5b-departments"],
    checks: [
      ["two entities", (s) => s.entities.length === 2],
      ["employee.department is a relation", (s) => s.entities.some((e) => e.fields.some((f) => /department/i.test(f.name) && f.type === "ref"))],
      ["departments: list + delete only", (s) => s.entities.some((e) => /department/i.test(e.name) && endpoints(e) === "delete,list")],
    ],
  },
  "m6-approve": {
    screens: ["m6-approve"],
    checks: [
      ["Approve is a setStatus", (s) => s.operations.some((o) => o.button === "Approve" && o.kind === "setStatus")],
      ["Reject is a setStatus", (s) => s.operations.some((o) => o.button === "Reject" && o.kind === "setStatus")],
      ["from/to are dates", (s) => fieldType(first(s), "from") === "date" && fieldType(first(s), "to") === "date"],
      ["must not: update, delete, create", (s) => !first(s).endpoints.update && !first(s).endpoints.delete && !first(s).endpoints.create],
    ],
  },
};

await mkdir(path.join(MOCKS, "results"), { recursive: true });
let passed = 0;
let total = 0;
for (const [name, testCase] of Object.entries(CASES)) {
  if (only && name !== only) continue;
  const started = Date.now();
  const inventories = [];
  const providers = [];
  try {
    for (const screen of testCase.screens) {
      const image = (await readFile(path.join(MOCKS, `${screen}.png`))).toString("base64");
      const { inventory, provider } = await readInventory(image, { mode });
      inventories.push(inventory);
      providers.push(provider);
    }
  } catch (err) {
    console.log(`\n${name}: FAILED to read: ${err.message.slice(0, 200)}`);
    total += testCase.checks.length + 2;
    continue;
  }
  const spec = deriveSpec(inventories);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  await writeFile(path.join(MOCKS, "results", `${name}.${mode}.json`), JSON.stringify({ inventories, spec }, null, 2) + "\n");

  console.log(`\n${name}  (${providers.join("+")}, ${seconds} s)`);
  // Every case must also produce a buildable spec with instructions for each page.
  const checks = [
    ...testCase.checks,
    ["spec passes checkSpec", (s) => checkSpec(s).length === 0],
    ["instructions for every page", (s) => s.pages.every((p) => pageInstructions(s, p.screenshot).length > 0)],
  ];
  const problems = checkSpec(spec);
  if (problems.length) console.log(`  spec problems: ${problems.join(" | ")}`);
  for (const [label, check] of checks) {
    let ok = false;
    try {
      ok = check(spec);
    } catch {}
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    total += 1;
    passed += ok ? 1 : 0;
  }
}
console.log(`\n${passed}/${total} checks passed (mode: ${mode})`);
