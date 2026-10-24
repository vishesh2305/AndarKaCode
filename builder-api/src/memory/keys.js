// Step 14: the fingerprints memory is kept under (ARCHITECTURE.md §9). Same work -> same key. Anything that
// could change the result is part of the key, so memory goes out of date by itself, never by mistake:
//   reading - the screenshot (SHA-256) and the reading prompt + schema (READING_VERSION)
//   page    - the screenshot and that page's instructions (an edit to another page keeps this one)
//   custom  - the button, row or page, its table's fields, and the custom-code runtime
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as customRuntime from "../../../templates/backend/custom-runtime.js";
import { operationRoute } from "../generator/index.js";
import { INVENTORY_PROMPT } from "../spec/inventory.js";
import { REPO_ROOT } from "../storage.js";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const norm = (text) => String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const READING_VERSION = hash(INVENTORY_PROMPT + readFileSync(path.join(REPO_ROOT, "shared/inventory.schema.json"), "utf8")).slice(0, 16);
const RUNTIME_VERSION = hash(customRuntime.runFile() + customRuntime.workerFile()).slice(0, 16);

/** What the vision AI read on one screenshot. */
export const inventoryKey = (screenshotSha, version = READING_VERSION) => hash(`inventory|${version}|${screenshotSha}`);

/** A page's instructions, as a hash. */
export const instructionsHash = (instructions) => hash(instructions);

/** One page Laptop B drew from this screenshot with these instructions. */
export const pageKey = (screenshotSha, instructions) => hash(`page|${screenshotSha}|${instructionsHash(instructions)}`);

/** A custom button as the library finds it: its text and whether it sits on a row (piece 3). */
export const buttonShape = (op) => ({ button: norm(op.button), row: operationRoute(op, op.entity).row });

/** One custom button's code: the same button on the same kind of table (its name doesn't matter). */
export function customKey(spec, op) {
  const entity = spec.entities.find((e) => e.name === op.entity);
  const shape = {
    ...buttonShape(op),
    fields: entity.fields.map((f) => [f.name, f.type, f.options ?? null, f.ref ?? null, Boolean(f.required)]),
    runtime: RUNTIME_VERSION,
  };
  return hash(`custom|${JSON.stringify(shape)}`);
}
