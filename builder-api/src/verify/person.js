// Verifier (Step 16): uses each page of a running app the way a person would, through the page itself
// (jsdom + the binder): Add, reload, Edit, Search, filters, page buttons, row/page buttons, stat cards,
// Delete, sign-in. Every check says what happened, and which layer to blame when it fails:
//   page    - the page did not send anything, or lacks an input the backend needs
//   spec    - the backend's rules (made from the spec) refused a value the page offers
//   backend - the server answered with an error
import { openLive } from "./browser.js";

const norm = (text) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const PROMPT = /^(select|choose|pick|all)\b|^-+/i; // "Select Department", "All categories", "-- Select --"
const CONTROLS = "input, select, textarea";
const singular = (entity) => entity.url.split("/").pop().replace(/s$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** What a person would type or choose for a field. */
function valueFor(field, control, tag) {
  if (control?.tagName === "SELECT") {
    const option = [...control.options].find((o) => o.value !== "" && !PROMPT.test(o.textContent.trim()));
    return option ? option.value : null;
  }
  if (control?.type === "checkbox") return true;
  switch (field.type) {
    case "email":
      return `${tag.toLowerCase().replace(/\W+/g, ".")}@example.com`;
    case "number":
      return "42";
    case "date":
      return "2026-01-15";
    case "boolean":
      return "Yes";
    case "enum":
      return field.options[0];
    case "ref":
      return null;
    default:
      return tag;
  }
}

function fill(el, value) {
  if (value === null || value === undefined) return;
  if (el.type === "checkbox") el.checked = Boolean(value);
  else if ("value" in el && el.matches(CONTROLS)) el.value = value;
  else el.textContent = value;
}

// The text that identifies our record in the list: the first plain text field.
const tagField = (entity) => entity.fields.find((f) => f.type === "string") ?? entity.fields.find((f) => f.type === "email");

const lastRequest = (p, method, path) => [...p.requests].reverse().find((r) => r.method === method && (path instanceof RegExp ? path.test(r.path) : r.path === path));

/** Turns a refused or missing request into a check result with the layer to blame. */
// submitted: a form was sent, so a browser message on a field explains why nothing went out. (An empty
// required field always has such a message; it only matters when a form was submitted.)
function failure(p, entity, request, scope, what, { submitted = false } = {}) {
  if (!request) {
    const bubble = submitted && [...(scope ?? p.document).querySelectorAll(CONTROLS)].find((el) => el.validationMessage);
    const why = bubble ? ` The browser stopped it: "${bubble.validationMessage}" on ${bubble.name || bubble.dataset.field || "a field"}.` : "";
    return { status: "fail", layer: "page", detail: `Nothing reached the backend when ${what}.${why}${p.errors.length ? ` Page errors: ${p.errors.join("; ")}` : ""}` };
  }
  const details = request.body?.details;
  if (request.status === 400 && details) {
    const label = (name) => entity.fields.find((f) => f.name === name)?.label ?? name;
    const problems = Object.entries(details).map(([name, message]) => `${label(name)}: ${message}`).join("; ");
    const missingOnPage = Object.keys(details).filter((name) => !p.$(`[data-field="${name}"], [name="${name}"]`));
    return missingOnPage.length
      ? { status: "fail", layer: "page", detail: `The backend refused it (${problems}). The page has no input for ${missingOnPage.map(label).join(", ")}.` }
      : { status: "fail", layer: "spec", detail: `The backend refused what the page sent (${problems}). The backend's rules come from the spec, so the spec does not match what the page offers.` };
  }
  return { status: "fail", layer: "backend", detail: `The backend answered ${request.status}: ${request.body?.error ?? "no message"}.` };
}

/** Signs in on a login page; returns { checks, token }. */
export async function runLoginPage({ base, map, n, file, credentials }) {
  const id = `login:p${n}`;
  const title = "Sign in with the first account";
  const p = await openLive(base, file);
  try {
    const field = (name) => p.$(`[data-field="${name}"]`) ?? p.$(`input[type="${name}"]`);
    if (!field("email") || !field("password")) return { checks: [{ id, page: n, title, status: "fail", layer: "page", detail: "The page has no email or password input." }], token: null };
    fill(field("email"), credentials.email);
    fill(field("password"), credentials.password);
    (p.$('[data-action="login"]') ?? field("password").form?.querySelector('button:not([type=button]), input[type="submit"]'))?.click();
    await p.settled();
    const request = lastRequest(p, "POST", map.auth.login);
    const token = p.token();
    if (request?.status === 200 && token) {
      const where = map.home ? ` and opened ${p.navigations[0] ?? "nothing"}` : "";
      const ok = !map.home || p.navigations[0] === map.home;
      return {
        checks: [{ id, page: n, title, status: ok ? "pass" : "fail", layer: ok ? undefined : "page", detail: `Signed in${where}.` }],
        token,
      };
    }
    return { checks: [{ id, page: n, title, ...failure(p, { fields: [] }, request, null, "signing in", { submitted: true }) }], token: null };
  } finally {
    p.close();
  }
}

/** Uses a data page; returns its checks. `ensureRecord(entity)` puts one record in when the page has no Add. */
export async function runDataPage({ base, map, spec, n, file, expected, token, ensureRecord }) {
  const entity = map.entities[expected.entity];
  const checks = [];
  const add = (id, title, result) => checks.push({ id: `${id}:p${n}`, page: n, title, ...result });
  const has = (name) => expected.actions.some((a) => a.name === name);
  const label = (name) => expected.actions.find((a) => a.name === name)?.label ?? name;
  const open = () => openLive(base, file, { token });
  const tag = `Check ${Math.random().toString(36).slice(2, 7)}`;
  const tf = tagField(entity);
  // A field with a filter on this page gets one of the filter's own choices, as a person would type.
  const choose = (p, field, control) => {
    const filter = expected.filters.includes(field.name) && p.$(`select[data-filter="${field.name}"]`);
    const option = filter && [...filter.options].find((o) => !PROMPT.test(o.textContent.trim()) && o.textContent.trim());
    if (option && control?.tagName !== "SELECT") return option.textContent.trim();
    return valueFor(field, control, field.name === tf?.name ? tag : `${tag} ${field.label}`);
  };
  let record = null; // the record this run works with
  let text = tag; // the text that shows our record in the list

  // A visitor without a login goes to the sign-in page.
  if (map.auth) {
    const p = await openLive(base, file);
    const ok = p.navigations.includes(map.auth.loginPage);
    add("login-required", "A visitor without a login is sent to the sign-in page", ok ? { status: "pass", detail: `Sent to ${map.auth.loginPage}.` } : { status: "fail", layer: "page", detail: "The data page opened without a login." });
    p.close();
  }

  // ---- Add ----
  if (has("create")) {
    const p = await open();
    try {
      const controls = expected.fields.map((f) => [f, p.$(`[data-field="${f.name}"]:is(${CONTROLS})`) ?? p.$(`[name="${f.name}"]:is(${CONTROLS})`)]).filter(([, el]) => el);
      const button = p.$('[data-action="create"]');
      let scope = null;
      if (controls.length) {
        for (const [field, el] of controls) fill(el, choose(p, entity.fields.find((f) => f.name === field.name) ?? field, el));
        scope = controls[0][1].form ?? null;
        (button ?? scope?.querySelector('button:not([type=button]):not([type=reset]), input[type="submit"]'))?.click();
      } else if (button) {
        button.click(); // no form on the page: the binder opens a new row
        await p.settled();
        for (const cell of p.$$('[data-editing="new"] [contenteditable][data-field]')) {
          const field = entity.fields.find((f) => f.name === cell.dataset.field);
          if (field) fill(cell, choose(p, field, null));
        }
        button.click();
      }
      await p.settled();
      const request = lastRequest(p, "POST", entity.url);
      if (request?.status === 201) {
        record = request.body;
        const shown = p.$(`[data-id="${record.id}"]`);
        add("add", `Add: "${label("create")}" saves a new ${singular(entity)}`, shown ? { status: "pass", detail: "Saved in the database and shown in the list." } : { status: "fail", layer: "page", detail: "Saved in the database, but the new row did not appear on the page." });
      } else {
        add("add", `Add: "${label("create")}" saves a new ${singular(entity)}`, failure(p, entity, request, scope, `"${label("create")}" was clicked`, { submitted: true }));
      }
    } finally {
      p.close();
    }
    if (record) {
      const p = await open();
      const row = p.$(`[data-id="${record.id}"]`);
      add("reload", "The new record is still there after a reload", row && norm(row.textContent).includes(norm(tag)) ? { status: "pass", detail: "Found again after reloading the page." } : { status: "fail", layer: "page", detail: "After a reload the record is not in the list." });
      p.close();
    }
  }

  // Pages without Add: one record is put in first, so Edit, Delete and the buttons can be tried.
  if (!record && entity.list && (has("update") || has("delete") || expected.actions.some((a) => entity.actions[a.name]))) {
    record = await ensureRecord(expected.entity);
    if (record && tf) text = String(record[tf.name] ?? "");
  }

  // ---- Edit ----
  if (has("update") && record) {
    const p = await open();
    try {
      const row = p.$(`[data-id="${record.id}"]`);
      const edited = `${tag} edited`;
      row?.querySelector('[data-action="update"]')?.click();
      await p.settled();
      const formControl = tf && (p.$(`[data-field="${tf.name}"]:is(input, textarea)`) ?? p.$(`[name="${tf.name}"]:is(input, textarea)`));
      const editable = p.$(`[data-editing] [data-field="${tf?.name}"][contenteditable]`);
      if (formControl && formControl.value) {
        formControl.value = edited;
        (p.$('[data-action="create"]') ?? formControl.form?.querySelector('button:not([type=button]):not([type=reset]), input[type="submit"]'))?.click();
      } else if (editable) {
        editable.textContent = edited;
        p.$(`[data-id="${record.id}"] [data-action="update"]`)?.click();
      }
      await p.settled();
      const request = lastRequest(p, "PUT", `${entity.url}/${record.id}`);
      if (request?.status === 200) {
        text = edited;
        add("edit", `Edit: "${label("update")}" saves a change`, { status: "pass", detail: formControl?.value !== undefined && !editable ? "Changed through the page's form." : "Changed inside the row." });
      } else {
        add("edit", `Edit: "${label("update")}" saves a change`, row ? failure(p, entity, request, null, `"${label("update")}" was used`, { submitted: true }) : { status: "fail", layer: "page", detail: "The record's row is not on the page." });
      }
    } finally {
      p.close();
    }
  }

  // ---- Search ----
  if (has("search") && record && text) {
    const p = await open();
    try {
      const box = p.$('input[data-action="search"], textarea[data-action="search"]') ?? p.$('[data-action="search"]')?.parentElement?.querySelector("input");
      if (box) {
        box.value = text;
        box.dispatchEvent(new p.window.Event("input", { bubbles: true }));
        p.$('[data-action="search"]:not(input):not(textarea)')?.click();
      }
      await p.settled(450);
      const request = [...p.requests].reverse().find((r) => r.method === "GET" && r.path === entity.url && r.query.q);
      const rows = p.$$("[data-id]");
      const ok = request?.status === 200 && rows.length > 0 && rows.every((r) => norm(r.textContent).includes(norm(text)));
      add("search", "Search asks the backend and finds the record", ok ? { status: "pass", detail: `Searching "${text}" showed only matching rows.` } : request ? { status: "fail", layer: request.status === 200 ? "page" : "backend", detail: `Searching "${text}" showed ${rows.length} row(s).` } : failure(p, entity, null, null, "typing in the search box"));
    } finally {
      p.close();
    }
  }

  // ---- Filters ----
  for (const name of expected.filters) {
    const field = entity.fields.find((f) => f.name === name);
    const value = record?.[name];
    const p = await open();
    try {
      const control = p.$(`[data-filter="${name}"]`);
      const option = control?.tagName === "SELECT" ? [...control.options].find((o) => norm(o.value) === norm(value) || norm(o.textContent) === norm(value)) : null;
      if (!record) {
        add(`filter:${name}`, `Filter by ${field?.label ?? name}`, { status: "skip", detail: "No record to filter for." });
        continue;
      }
      if (!option) {
        add(`filter:${name}`, `Filter by ${field?.label ?? name}`, { status: "fail", layer: "page", detail: `The filter offers no choice for "${value}", so a person cannot filter by it.` });
        continue;
      }
      control.value = option.value;
      control.dispatchEvent(new p.window.Event("change", { bubbles: true }));
      await p.settled();
      const request = [...p.requests].reverse().find((r) => r.method === "GET" && r.path === entity.url && r.query[name] !== undefined);
      const ok = request?.status === 200 && p.$(`[data-id="${record.id}"]`);
      add(`filter:${name}`, `Filter by ${field?.label ?? name}`, ok ? { status: "pass", detail: `Choosing "${option.textContent.trim()}" asked the backend and kept the record.` } : request ? { status: "fail", layer: "backend", detail: `Choosing "${option.textContent.trim()}" lost the record.` } : failure(p, entity, null, null, "choosing a filter"));
    } finally {
      p.close();
    }
  }

  // ---- Previous / next page ----
  if (has("prevPage") || has("nextPage")) {
    const p = await open();
    const first = p.requests.find((r) => r.method === "GET" && r.path === entity.url);
    add("pages", "The list asks the backend one page at a time", first?.query.page ? { status: "pass", detail: `Asked for page ${first.query.page}.` } : { status: "fail", layer: "page", detail: "The list did not ask for a page number." });
    p.close();
  }

  // ---- Row and page buttons ----
  for (const op of spec.operations.filter((o) => expected.actions.some((a) => a.name === o.name))) {
    const action = entity.actions[op.name];
    const id = `action:${op.name}`;
    const title = `"${op.button}" button`;
    const p = await open();
    try {
      const button = action.row ? p.$(`[data-id="${record?.id}"] [data-action="${op.name}"]`) : p.$(`[data-action="${op.name}"]`);
      if (!button) {
        add(id, title, { status: action.row && !record ? "skip" : "fail", layer: "page", detail: action.row && !record ? "No record to try it on." : "The button is not on the page." });
        continue;
      }
      button.click();
      await p.settled();
      if (!action.available) {
        add(id, title, { status: "note", detail: p.alerts.some((a) => /not available yet/.test(a)) ? `Says "not available yet": its code is written by the AI layer (Step 13).` : "Not built yet (Step 13)." });
      } else if (op.kind === "export") {
        const request = lastRequest(p, "GET", action.url);
        add(id, title, request?.status === 200 && /csv/.test(request.type) && p.downloads.length ? { status: "pass", detail: "Downloaded a CSV file." } : failure(p, entity, request, null, `"${op.button}" was clicked`));
      } else {
        const request = lastRequest(p, action.method, new RegExp(`^${action.url.replace(":id", "[^/]+")}$`));
        const changed = request?.status === 200 && Object.entries(op.set ?? {}).every(([k, v]) => request.body?.[k] === v);
        add(id, title, changed ? { status: "pass", detail: `The record changed: ${Object.entries(op.set ?? {}).map(([k, v]) => `${k} = ${v}`).join(", ")}.` } : failure(p, entity, request, null, `"${op.button}" was clicked`));
      }
    } finally {
      p.close();
    }
  }

  // ---- Stat cards ----
  if (expected.stats.length) {
    const p = await open();
    try {
      const request = lastRequest(p, "GET", map.stats.url);
      if (request?.status !== 200) add("stats", "Stat cards show the backend's numbers", failure(p, entity, request, null, "the page opened"));
      else {
        const wrong = expected.stats.filter((key) => {
          const card = p.$(`[data-stat="${key}"]`);
          const value = request.body?.[key];
          if (!card || !(key in (request.body ?? {}))) return false;
          return !norm(card.textContent).includes(value === null ? "—" : norm(typeof value === "number" ? value.toLocaleString("en-US") : value));
        });
        add("stats", "Stat cards show the backend's numbers", wrong.length ? { status: "fail", layer: "page", detail: `These cards do not show the backend's number: ${wrong.join(", ")}.` } : { status: "pass", detail: "Every card shows the number from the backend." });
      }
    } finally {
      p.close();
    }
  }

  // ---- Delete ----
  if (has("delete") && record) {
    const p = await open();
    let request;
    try {
      p.$(`[data-id="${record.id}"] [data-action="delete"]`)?.click();
      await p.settled();
      request = lastRequest(p, "DELETE", `${entity.url}/${record.id}`);
      if (request?.status !== 204) add("delete", `Delete: "${label("delete")}" removes the record`, failure(p, entity, request, null, `"${label("delete")}" was clicked`));
    } finally {
      p.close();
    }
    if (request?.status === 204) {
      const again = await open();
      add("delete", `Delete: "${label("delete")}" removes the record`, again.$(`[data-id="${record.id}"]`) ? { status: "fail", layer: "backend", detail: "After a reload the record is still there." } : { status: "pass", detail: "Removed, and gone after a reload." });
      again.close();
    }
  }
  return checks;
}
