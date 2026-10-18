// Screenshot -> UI inventory: a plain list of what is VISIBLE, for the Spec Deriver (ARCHITECTURE.md v3.1 §4.1).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { visionProviders } from "../ai/vision.js";
import { REPO_ROOT } from "../storage.js";

const schema = JSON.parse(await readFile(path.join(REPO_ROOT, "shared/inventory.schema.json"), "utf8"));
delete schema.$comment;

export const INVENTORY_PROMPT = `List the user-interface elements in this screenshot as JSON. Report only what is visible; never invent elements.

- title: the page heading. kind: "list" (a table of records), "form", "dashboard" (number tiles/charts), "login", "detail" or "other".
- tables: for each table, entityHint = the singular and plural English noun for what one row is (e.g. "employee"/"employees");
  columns = each column header, with up to 5 cell values copied exactly as shown, and badge = true if the values are coloured pills/tags;
  rowActions = the buttons or icons repeated on every row (pencil = "Edit", trash = "Delete", eye = "View"; otherwise the text shown). Skip the checkbox and row-number columns.
- forms: each form's inputs (label, kind, required = true if marked with * or "required", options for dropdowns) and its submit button text.
- buttons: buttons outside the table rows (e.g. "Add Employee", "Export"), scope "page".
- search: true only if there is a search box. filters: dropdowns that filter the table, with their options.
- pagination: true only if page numbers or "Showing 1-10 of 42" are visible.
- statCards: number tiles such as "Total Employees 42".
- auth: loginForm = a username/email + password form; signupLink = a "Sign up"/"Register" link; userMenu = an avatar, "Logout" or profile menu; roleIndicators = role words shown, like "Admin".`;

const KINDS = new Set(["list", "form", "dashboard", "login", "detail", "other"]);
const INPUT_KINDS = new Set(["text", "textarea", "email", "number", "date", "select", "checkbox", "password"]);
const MAX_TEXT = 80; // screenshot text reaches later prompts; keep it short
const MAX_VALUES = 5;
const ALL_OPTION = /^all\b/i;

const text = (value) => String(value ?? "").trim().slice(0, MAX_TEXT);
const texts = (list) => (Array.isArray(list) ? list : []).map(text).filter(Boolean);
const unique = (list) => [...new Set(list)];
const arrayOf = (list, map) => (Array.isArray(list) ? list : []).map(map).filter(Boolean);

function normalizeTable(raw) {
  const table = {
    columns: arrayOf(raw?.columns, (c) => {
      const label = text(c?.label);
      return label && { label, values: texts(c?.values).slice(0, MAX_VALUES), badge: c?.badge === true };
    }),
    rowActions: unique(texts(raw?.rowActions)),
  };
  if (raw?.entityHint?.singular) table.entityHint = { singular: text(raw.entityHint.singular), plural: text(raw.entityHint.plural) };
  return table;
}

function normalizeInput(raw) {
  const label = text(raw?.label);
  if (!label) return null;
  const kind = INPUT_KINDS.has(raw?.kind) ? raw.kind : "text";
  const input = { label, kind, required: raw?.required === true };
  if (kind === "select" && Array.isArray(raw?.options)) input.options = texts(raw.options);
  return input;
}

function inferKind(inv) {
  if (inv.auth.loginForm) return "login";
  if (inv.statCards.length) return "dashboard";
  if (inv.tables.length) return "list";
  if (inv.forms.length) return "form";
  return "other";
}

/** Whatever the model returned -> complete, trimmed, de-duplicated inventory. Never throws. */
export function normalizeInventory(raw = {}) {
  const inv = {
    title: text(raw.title),
    kind: "other",
    tables: arrayOf(raw.tables, normalizeTable),
    forms: arrayOf(raw.forms, (f) => ({
      inputs: arrayOf(f?.inputs, normalizeInput),
      ...(f?.submitLabel && { submitLabel: text(f.submitLabel) }),
    })),
    buttons: [],
    search: raw.search === true,
    filters: arrayOf(raw.filters, (f) => {
      const label = text(f?.label);
      return label && { label, options: texts(f?.options).filter((o) => !ALL_OPTION.test(o)) };
    }),
    pagination: raw.pagination === true,
    statCards: arrayOf(raw.statCards, (c) => {
      const label = text(c?.label);
      return label && { label, value: text(c?.value) };
    }),
    auth: {
      loginForm: raw.auth?.loginForm === true,
      signupLink: raw.auth?.signupLink === true,
      userMenu: raw.auth?.userMenu === true,
      roleIndicators: unique(texts(raw.auth?.roleIndicators)),
    },
  };

  // Row buttons belong to the table's row actions; with no table they are page buttons.
  const seen = new Set();
  for (const b of Array.isArray(raw.buttons) ? raw.buttons : []) {
    const label = text(b?.label);
    if (!label) continue;
    if (b.scope === "row" && inv.tables.length) {
      if (!inv.tables[0].rowActions.includes(label)) inv.tables[0].rowActions.push(label);
    } else if (!seen.has(label)) {
      seen.add(label);
      inv.buttons.push({ label, scope: "page" });
    }
  }

  inv.kind = KINDS.has(raw.kind) ? raw.kind : inferKind(inv);
  return inv;
}

/**
 * mode: "local" | "cloud" | "auto" (local, then cloud). providers is injectable for tests.
 * Resolves with { inventory, provider }; rejects listing every provider's error.
 */
export async function readInventory(imageB64, { mode, providers = visionProviders }) {
  const order = mode === "auto" ? ["local", "cloud"] : [mode];
  const errors = [];
  for (const provider of order) {
    try {
      const raw = JSON.parse(await providers[provider]({ prompt: INVENTORY_PROMPT, schema, imageB64 }));
      return { inventory: normalizeInventory(raw), provider };
    } catch (err) {
      errors.push(`${provider}: ${err.message}`);
    }
  }
  throw new Error(errors.join("; "));
}
