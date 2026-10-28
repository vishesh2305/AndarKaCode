// Verifier check 1 (Step 16): does each page carry the markers its part of the spec needs?
// The same "is it on this page" rule as the page instructions (evidence "sN: ..."), so we check exactly
// what Laptop B was asked for. Missing markers are named the way a person sees them.
import { JSDOM, VirtualConsole } from "jsdom";
import { camelCase } from "../spec/derive.js";
import { BINDER, wirePage } from "../wirer/index.js";

const SCRIPT = '<script src="app.js"></script>';

const onPage = (item, n) => new RegExp(`(^|; )s${n}: `).test(item?.evidence ?? "");
// "s1: button 'Add Employee'; s2: ..." -> "Add Employee" (the text on THIS page's element).
const shownAs = (item, n, fallback) => new RegExp(`(?:^|; )s${n}: [^;']*'([^']+)'`).exec(item?.evidence ?? "")?.[1] ?? fallback;

/** What the spec asks of page n: { kind, entity, fields, actions, filters, stats }. */
export function expectedMarkers(spec, n) {
  const page = spec.pages.find((p) => p.screenshot === n);
  if (!page) throw new Error(`The spec has no page for screenshot ${n}`);
  if (page.kind === "login") {
    return {
      kind: "login",
      entity: null,
      fields: [
        { name: "email", label: "Email" },
        { name: "password", label: "Password" },
      ],
      actions: [{ name: "login", label: "Sign in" }, ...(spec.auth?.signup ? [{ name: "signup", label: "Sign up" }] : [])],
      filters: [],
      stats: [],
    };
  }

  const entity = spec.entities.find((e) => e.name === page.entity);
  const expected = { kind: page.kind, entity: entity?.name ?? null, fields: [], actions: [], filters: [], stats: [] };
  if (entity) {
    const shown = entity.fields.filter((f) => onPage(f, n));
    expected.fields = (shown.length ? shown : entity.fields).map((f) => ({ name: f.name, label: f.label }));
    const has = (key) => entity.endpoints[key] && onPage(entity.endpoints[key], n);
    if (has("create")) expected.actions.push({ name: "create", label: shownAs(entity.endpoints.create, n, "Add") });
    if (has("update")) expected.actions.push({ name: "update", label: shownAs(entity.endpoints.update, n, "Edit") });
    if (has("delete")) expected.actions.push({ name: "delete", label: shownAs(entity.endpoints.delete, n, "Delete") });
    const list = has("list") ? entity.endpoints.list : null;
    if (list?.search) expected.actions.push({ name: "search", label: "the search box" });
    if (list?.pagination) expected.actions.push({ name: "prevPage", label: "the previous-page button" }, { name: "nextPage", label: "the next-page button" });
    expected.filters = list?.filters ?? [];
    for (const o of spec.operations.filter((op) => op.entity === entity.name && onPage(op, n))) expected.actions.push({ name: o.name, label: o.button });
  }
  expected.stats = spec.stats.filter((s) => onPage(s, n)).map((s) => camelCase(s.label));
  return expected;
}

const unique = (values) => [...new Set(values)];

/**
 * The markers a page really has once its own scripts ran (no network). With { map, file }, the binder
 * runs too, in markers-only mode: markers it can add from the page (labels, headers, button text)
 * count, and found.repaired lists them.
 */
export async function pageMarkers(html, { map, file = "page.html" } = {}) {
  const quiet = new VirtualConsole(); // the page's own console stays quiet; its script errors are noted
  const scriptErrors = [];
  quiet.on("jsdomError", (err) => /Not implemented/.test(err.message) || scriptErrors.push(err.message));
  const page = map ? wirePage(html).replace(SCRIPT, () => `<script>${BINDER}</script>`) : String(html).replace(SCRIPT, "");
  const dom = new JSDOM(page, {
    url: `http://127.0.0.1/${file}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: quiet,
    beforeParse(w) {
      w.fetch = async (input) =>
        map && String(input).endsWith("api-map.json")
          ? new Response(JSON.stringify(map), { headers: { "content-type": "application/json" } })
          : Promise.reject(new Error("no network while reading markers"));
      w.alert = w.confirm = () => true;
      w.andarkacodeTestHooks = { markersOnly: true, navigate: () => {} };
    },
  });
  const { window } = dom;
  const root = window.document.documentElement;
  await new Promise((resolve) => (window.document.readyState === "complete" ? resolve() : window.addEventListener("load", resolve)));
  await new Promise((resolve) => setTimeout(resolve, 50)); // rows some pages draw just after loading
  for (let waited = 0; map && root.dataset.andarkacode === "loading" && waited < 3000; waited += 25) await new Promise((r) => setTimeout(r, 25));
  const all = (attr) => unique([...window.document.querySelectorAll(`[${attr}]`)].map((el) => el.getAttribute(attr)));
  const submitForm = [...window.document.querySelectorAll("form")].some(
    (form) => form.querySelector("input:not([type=hidden]), select, textarea") && form.querySelector('button:not([type=button]):not([type=reset]), input[type="submit"]')
  );
  const found = {
    fields: all("data-field"),
    actions: all("data-action"),
    filters: all("data-filter"),
    stats: all("data-stat"),
    submitForm,
    repaired: JSON.parse(root.dataset.andarkacodeRepaired ?? "[]"),
    scriptErrors: unique(scriptErrors),
  };
  window.close();
  return found;
}

const IGNORED_FIELDS = new Set(["actions", "id"]);

/** Each marker the spec asks for that the page lacks, named the way a person sees it. */
export function missingMarkers(expected, found) {
  const missing = [];
  for (const f of expected.fields) if (!found.fields.includes(f.name)) missing.push(`the field "${f.label}" (data-field="${f.name}")`);
  for (const a of expected.actions) {
    const formWorks = (a.name === "create" || a.name === "login") && found.submitForm; // the binder sends the form itself
    if (!found.actions.includes(a.name) && !formWorks) missing.push(`the "${a.label}" button (data-action="${a.name}")`);
  }
  for (const name of expected.filters) if (!found.filters.includes(name)) missing.push(`the filter for ${name} (data-filter="${name}")`);
  for (const key of expected.stats) if (!found.stats.includes(key)) missing.push(`the number in the card ${key} (data-stat="${key}")`);
  return missing;
}

/** Compares; { status: "pass"|"fail", layer, detail, warnings }. */
export function markerCheck(expected, found) {
  const missing = missingMarkers(expected, found);

  // "Uncaught [SyntaxError: missing ) after argument list]" -> "SyntaxError: missing ) after argument list"
  const scriptError = found.scriptErrors?.length ? found.scriptErrors[0].replace(/^Uncaught \[?/, "").replace(/\]$/, "") : null;
  const known = new Set([...expected.actions.map((a) => a.name), "logout"]);
  const warnings = [
    ...(scriptError ? [`the page's own script has an error (${scriptError}), so what it draws itself may be missing`] : []),
    ...(found.repaired ?? []).map((what) => `added by AndarKaCode when the page opens (Laptop B forgot it): ${what}`),
    ...found.actions.filter((a) => !known.has(a)).map((a) => `the page has a button data-action="${a}" the spec does not know: it does nothing`),
    ...found.fields.filter((f) => !IGNORED_FIELDS.has(f) && !expected.fields.some((x) => x.name === f)).map((f) => `the page shows data-field="${f}", which the spec does not have`),
  ];
  const why = scriptError ? `The page's own script has an error (${scriptError}), so its sample rows and anything else it draws never appeared. ` : "";
  return missing.length
    ? { status: "fail", layer: "page", detail: `${why}Missing on this page: ${missing.join(", ")}.`, warnings }
    : { status: "pass", detail: "Every field and button the spec needs is on this page.", warnings };
}
