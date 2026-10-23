// The rows the live preview starts with: the ones the screenshot shows, so every row (and its buttons) can
// be tried at once. They come from the page's sample array (const SAMPLE_X = [...]), read as data with a
// parser: the page's code never runs here, and anything that would need running code is left out. When the
// page has no such array, the screenshot's table (as the vision model read it) is used instead.
import { parse } from "acorn";

const MAX_ROWS = 50;
const SKIP = Symbol("not plain data");
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// A literal value written in the code: strings, numbers, true/false/null, and arrays/objects of them.
function literal(node) {
  switch (node?.type) {
    case "Literal":
      return node.regex ? SKIP : node.value;
    case "UnaryExpression":
      return (node.operator === "-" || node.operator === "+") && node.argument.type === "Literal" && typeof node.argument.value === "number"
        ? (node.operator === "-" ? -node.argument.value : node.argument.value)
        : SKIP;
    case "TemplateLiteral":
      return node.expressions.length ? SKIP : node.quasis[0].value.cooked;
    case "ArrayExpression":
      return node.elements.map(literal).filter((v) => v !== SKIP);
    case "ObjectExpression": {
      const object = {};
      for (const p of node.properties) {
        if (p.type !== "Property" || p.computed || p.kind !== "init" || p.method) continue;
        const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : null;
        const value = literal(p.value);
        if (key !== null && value !== SKIP) object[key] = value;
      }
      return object;
    }
    default:
      return SKIP;
  }
}

// The array assigned to `name` anywhere in the program: const/let/var name = [...] or window.name = [...].
function findArray(node, name) {
  if (!node || typeof node.type !== "string") return null;
  if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.id.name === name && node.init?.type === "ArrayExpression") return node.init;
  if (node.type === "AssignmentExpression" && node.right.type === "ArrayExpression") {
    const left = node.left;
    const named = left.type === "Identifier" ? left.name : left.type === "MemberExpression" && !left.computed ? left.property.name : null;
    if (named === name) return node.right;
  }
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === "object") {
        const found = findArray(child, name);
        if (found) return found;
      }
    }
  }
  return null;
}

/** The page's sample rows (plain objects), or null when the page has no array of that name. */
export function sampleArray(html, name) {
  if (!name || !IDENTIFIER.test(name)) return null;
  for (const [, attrs, code] of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attrs) || !code.includes(name)) continue;
    let program = null;
    for (const sourceType of ["script", "module"]) {
      try {
        program = parse(code, { ecmaVersion: "latest", sourceType });
        break;
      } catch {
        // not this kind of script, or not JavaScript at all
      }
    }
    const array = program && findArray(program, name);
    if (array) return literal(array).filter((row) => row && typeof row === "object" && !Array.isArray(row));
  }
  return null;
}

const YES = /^(yes|y|true|1|✓|✔)$/i;
const NO = /^(no|n|false|0|✗|✘)$/i;

// One sample value -> the field's type, or undefined when it doesn't fit.
function typed(field, value) {
  if (value === null || value === undefined || typeof value === "object") return undefined;
  const text = String(value).trim();
  switch (field.type) {
    case "number": {
      if (typeof value === "number") return value;
      const digits = text.replace(/[^\d.-]/g, ""); // "$52,000" -> 52000, "3 days" -> 3
      return /\d/.test(digits) && Number.isFinite(Number(digits)) ? Number(digits) : undefined;
    }
    case "date": {
      const date = new Date(text);
      return text && !Number.isNaN(date.getTime()) ? date : undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? value : YES.test(text) ? true : NO.test(text) ? false : undefined;
    case "enum":
      return field.options?.find((o) => o.toLowerCase() === text.toLowerCase());
    case "ref":
      return undefined; // a name on screen is not a record id
    default:
      return text || undefined;
  }
}

/** Sample rows -> records for the database: the spec's fields only, typed; the first row is the newest. */
export function sampleDocs(spec, entityName, rows) {
  const entity = spec.entities.find((e) => e.name === entityName);
  if (!entity) return [];
  const now = Date.now();
  const docs = [];
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object" || Array.isArray(row) || docs.length >= MAX_ROWS) continue;
    const doc = {};
    for (const field of entity.fields) {
      const value = field.name in row ? typed(field, row[field.name]) : undefined;
      if (value !== undefined) doc[field.name] = value;
    }
    if (!Object.keys(doc).length) continue;
    const at = new Date(now - docs.length * 1000);
    docs.push({ ...doc, createdAt: at, updatedAt: at, ...(entity.endpoints.delete?.soft && { deletedAt: null }) });
  }
  return docs;
}

/** The screenshot's table as rows ({ field: shown text }), lined up column by column. */
export function screenshotRows(spec, entityName, inventory) {
  const entity = spec.entities.find((e) => e.name === entityName);
  let best = [];
  for (const table of inventory?.tables ?? []) {
    const matched = (table.columns ?? [])
      .map((column) => ({ field: entity?.fields.find((f) => norm(f.label) === norm(column.label)), values: column.values ?? [] }))
      .filter((m) => m.field);
    if (matched.length > best.length) best = matched;
  }
  const count = Math.max(0, ...best.map((m) => m.values.length));
  return Array.from({ length: Math.min(count, MAX_ROWS) }, (_, i) =>
    Object.fromEntries(best.filter((m) => m.values[i] !== undefined).map((m) => [m.field.name, m.values[i]]))
  );
}

/**
 * The records the preview starts with, as { collection: records }. pages: [{ screenshot, html }] (as built);
 * inventories: what the vision model read on each screenshot (index = screenshot - 1).
 */
export function previewSeed({ spec, pages, inventories }) {
  const seed = {};
  for (const page of spec.pages) {
    const entity = page.kind !== "login" && spec.entities.find((e) => e.name === page.entity);
    if (!entity || seed[entity.plural]) continue;
    const html = pages.find((p) => p.screenshot === page.screenshot)?.html ?? "";
    const fromPage = sampleArray(html, entity.sampleConst);
    const rows = fromPage?.length ? fromPage : screenshotRows(spec, entity.name, inventories?.[page.screenshot - 1]);
    const docs = sampleDocs(spec, entity.name, rows);
    if (docs.length) seed[entity.plural] = docs;
  }
  return seed;
}
