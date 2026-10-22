// Step 13: what the coding AI is asked for one custom button, and how its code is taken from the answer.
// The rules here are the ones the safety check (safety.js) enforces, so a careful answer passes it.
import { operationRoute } from "../generator/index.js";

const TYPE_WORDS = {
  string: () => "text",
  email: () => "an email address",
  number: () => "number",
  boolean: () => "true or false",
  date: () => 'date (sent and stored like "2026-01-15T00:00:00.000Z")',
  enum: (f) => `one of ${f.options.map((o) => JSON.stringify(o)).join(", ")}`,
  ref: (f) => `the id of a ${f.ref} record`,
};

const SHAPE = `export default async function ({ record, input, helpers }) {
  // ...
  return { message: "What happened, in a few words" };
}`;

function request(spec, op) {
  const entity = spec.entities.find((e) => e.name === op.entity);
  const row = operationRoute(op, op.entity).row;
  const fields = entity.fields.map((f) => `- ${f.name}: ${TYPE_WORDS[f.type]?.(f) ?? f.type}${f.required ? ", required" : ""}`);
  return [
    "You write the code for one button of a web app's backend (Node.js).",
    "",
    row
      ? `The button: "${op.button}", on each row of the "${entity.label}" table.`
      : `The button: "${op.button}", a button on the "${entity.label}" page (not on a row).`,
    `Do what a person expects when they press "${op.button}" there.`,
    "",
    `The table "${entity.plural}" has these fields (each record also has an id):`,
    ...fields,
    "",
    "Write exactly one JavaScript function, in this shape:",
    "",
    SHAPE,
    "",
    row ? "record: the row the button was pressed on (with its id and fields)." : "record: null (a page button has no row).",
    "input: anything the page sent with the press (usually empty).",
    "helpers: the only way to read or change data (each returns a promise):",
    "- helpers.get(id): one record, or null",
    `- helpers.list(filter): the records whose fields equal the filter's values (at most 500), e.g. helpers.list({ ${entity.fields[0]?.name ?? "field"}: ... })`,
    "- helpers.create(values): the new record",
    "- helpers.update(id, changes): the changed record",
    "- helpers.updateMany(filter, changes): how many records changed",
    "- helpers.remove(id)",
    "- helpers.fail(message): stops and shows the message to the person (use it to refuse)",
    "",
    "Rules (code that breaks one is refused):",
    "- no import or require; nothing but the helpers above (no process, fetch, timers, eval, Function, this, classes);",
    "- loops: only for ... of over a list (no while, no for (;;), no for ... in);",
    "- dot notation for fields (record.salary), not record[name];",
    "- change only this table's fields; to calculate with dates, make Date objects first.",
    "",
    "Answer with the function only, in one ```js block.",
  ].join("\n");
}

/** The request for a new function. */
export const customPrompt = (spec, op) => request(spec, op);

/** The same request, plus the earlier code and what went wrong with it. */
export const repairPrompt = (spec, op, code, problem) =>
  [
    request(spec, op),
    "",
    "Your earlier answer was:",
    "```js",
    code,
    "```",
    "",
    `It did not work: ${problem}`,
    "Answer with the whole corrected function, in one ```js block.",
  ].join("\n");

/** The function from the model's answer: the first ```js block, or an answer that is only the code. */
export function extractCode(answer) {
  const text = String(answer ?? "");
  const block = text.match(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/i);
  if (block) return block[1].trim();
  const plain = text.trim();
  return /^export\s+default\b/.test(plain) ? plain : null;
}
