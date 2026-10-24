// Step 14 piece 3: the verified-code library. A custom button's remembered code may be tried on another table
// with the same button when every field of the old table the code really uses (found by parsing the code,
// never running it) is in the new table with the same type. A missing field would be dropped by the checks
// without a word, and the button would quietly do nothing; so such code is not offered.
import { parse } from "acorn";

// Every name the code uses: identifiers (record.salary, { salary }, salary: …) and quoted keys ({ "status": … }).
function namesIn(node, names) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "Identifier") names.add(node.name);
  if (node.type === "Property" && node.key.type === "Literal") names.add(String(node.key.value));
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) if (child && typeof child === "object") namesIn(child, names);
  }
}

/** The names of `fields` the code uses (text inside strings doesn't count), or null if it doesn't parse. */
export function fieldsUsed(code, fields) {
  let program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return null;
  }
  const names = new Set();
  namesIn(program, names);
  return fields.filter((f) => names.has(f.name)).map((f) => f.name);
}

const sameField = (a, b) =>
  Boolean(b) && a.type === b.type && JSON.stringify(a.options ?? null) === JSON.stringify(b.options ?? null) && (a.ref ?? null) === (b.ref ?? null);

/** May code written for a table with oldFields be tried on a table with newFields? */
export function fitsTable(code, oldFields, newFields) {
  const used = fieldsUsed(code, oldFields);
  return used !== null && used.every((name) => sameField(oldFields.find((f) => f.name === name), newFields.find((f) => f.name === name)));
}
