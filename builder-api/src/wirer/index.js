// Wirer (Step 15): App Spec -> api-map.json (which marker on which page calls which endpoint) and
// the pages with one <script> line for the binder (templates/frontend/app.js). No AI; the pages keep
// their look: nothing in them changes except that line.
import { readFileSync } from "node:fs";
import { operationRoute } from "../generator/index.js";
import { camelCase } from "../spec/derive.js";

export const BINDER = readFileSync(new URL("../../../templates/frontend/app.js", import.meta.url), "utf8");
const SCRIPT = '<script src="app.js"></script>';

const pageFile = (page) => `page-${page.screenshot}.html`;

// What the binder needs to read and write a field (no evidence: that stays in the spec and README).
function fieldInfo(f) {
  return {
    name: f.name,
    label: f.label,
    type: f.type,
    ...(f.type === "enum" && { options: f.options }),
    ...(f.type === "ref" && { ref: f.ref }),
  };
}

function entityInfo(entity, spec) {
  const url = `/api/${entity.plural}`;
  const { list, get, create, update, delete: remove } = entity.endpoints;
  const actions = {};
  for (const op of spec.operations.filter((o) => o.entity === entity.name)) {
    const route = operationRoute(op, entity.name);
    actions[op.name] = {
      button: op.button,
      kind: op.kind,
      method: route.method.toUpperCase(),
      url: `${url}${route.path}`,
      row: route.row,
      available: op.kind !== "custom", // written by the AI layer (Step 13); until then the backend answers 501
    };
  }
  return {
    url,
    sample: entity.sampleConst, // the page's sample-data array: shows how each sample value was drawn
    labelField: (entity.fields.find((f) => f.type === "string" || f.type === "email") ?? entity.fields[0])?.name ?? null,
    fields: entity.fields.map(fieldInfo),
    list: list ? { search: Boolean(list.search), filters: list.filters ?? [], pagination: Boolean(list.pagination) } : null,
    get: Boolean(get),
    create: Boolean(create),
    update: Boolean(update),
    delete: Boolean(remove),
    actions,
  };
}

/** The binder's phone book: pure, same spec -> same map. */
export function apiMap(spec) {
  const pages = {};
  for (const page of spec.pages) pages[pageFile(page)] = { kind: page.kind, ...(page.entity && { entity: page.entity }) };
  if (spec.pages.length) pages["index.html"] = pages[pageFile(spec.pages[0])];

  const loginPage = spec.pages.find((p) => p.kind === "login");
  const home = spec.pages.find((p) => p.kind !== "login");
  const auth = spec.auth
    ? {
        login: "/api/auth/login",
        register: spec.auth.signup ? "/api/auth/register" : null,
        me: spec.auth.me ? "/api/auth/me" : null,
        logout: spec.auth.me ? "/api/auth/logout" : null,
        loginPage: loginPage ? pageFile(loginPage) : null,
      }
    : null;

  return {
    version: 1,
    home: home ? pageFile(home) : null,
    pages,
    auth,
    entities: Object.fromEntries(spec.entities.map((e) => [e.name, entityInfo(e, spec)])),
    stats: spec.stats.length ? { url: "/api/stats", keys: spec.stats.map((s) => camelCase(s.label)) } : null,
  };
}

/** The page with the binder's <script> line before its last </body>; everything else unchanged. */
export function wirePage(html) {
  const text = String(html);
  if (text.includes(SCRIPT)) return text;
  const at = text.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? `${text}\n${SCRIPT}\n` : text.slice(0, at) + SCRIPT + text.slice(at);
}

/** The frontend folder of the downloaded app: { "frontend/<file>": contents }. pages: [{ screenshot, html }]. */
export function wireApp({ spec, pages }) {
  const files = {
    "frontend/app.js": BINDER,
    "frontend/api-map.json": JSON.stringify(apiMap(spec), null, 2) + "\n",
  };
  for (const page of spec.pages) {
    const built = pages.find((p) => p.screenshot === page.screenshot);
    if (!built) continue;
    files[`frontend/${pageFile(page)}`] = wirePage(built.html);
    if (page === spec.pages[0]) files["frontend/index.html"] = files[`frontend/${pageFile(page)}`];
  }
  return files;
}
