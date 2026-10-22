// AndarKaCode binder: connects a generated page's markers (data-field, data-action, data-filter,
// data-stat) to the generated backend, using api-map.json. Same file for every app; no packages.
// The page keeps its look: rows are copies of the page's own sample rows, messages use the browser's
// own boxes. Clicks, typing and submits on markers are caught before the page's own (sample-only)
// scripts see them. <html data-andarkacode="loading|ready|error"> tells tests and the Verifier when
// the page is wired.
(function () {
  "use strict";

  const root = document.documentElement;
  const hooks = window.andarkacodeTestHooks || {}; // tests replace navigation (their browser can't navigate)
  const navigate = hooks.navigate || ((to) => window.location.assign(to));
  const CONTROLS = "input, select, textarea";
  const SEARCH_DELAY_MS = 300;

  const state = { map: null, page: null, entity: null, view: null, editing: null, adding: null };
  const setStatus = (status) => (root.dataset.andarkacode = status);
  const say = (message) => window.alert(message);
  setStatus("loading");

  // ---------- login (only when a screenshot showed a login screen) ----------

  const TOKEN_KEY = "andarkacode.token";
  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null; // storage blocked: behave as signed out
    }
  }
  function writeToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // storage blocked: the login lasts until the page closes
    }
  }
  const goToLogin = () => navigate(state.map.auth.loginPage || "index.html");

  // ---------- talking to the backend ----------

  async function api(method, url, body) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = state.map && state.map.auth ? readToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Is npm start still running?" } };
    }
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
    // An expired or missing login on a data page: back to the login page, no pop-up.
    if (res.status === 401 && state.map && state.map.auth && state.page.kind !== "login") {
      writeToken(null);
      goToLogin();
    }
    return { ok: res.ok, status: res.status, data, res };
  }

  const problem = (answer) => (answer.data && answer.data.error) || `The server answered ${answer.status}.`;

  const withQuery = (url, params) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined)).toString();
    return query ? `${url}?${query}` : url;
  };

  // ---------- showing values in the page's own elements ----------

  const norm = (text) => String(text).replace(/\s+/g, " ").trim().toLowerCase();
  const fieldOf = (entity, name) => entity.fields.find((f) => f.name === name);

  function display(field, value) {
    if (value === null || value === undefined || value === "") return "";
    if (field.type === "boolean") return value ? "Yes" : "No";
    if (field.type === "date") return String(value).slice(0, 10);
    if (field.type === "ref" && typeof value === "object") {
      const ref = state.map.entities[field.ref];
      const key = ref && ref.labelField;
      return String((key && value[key]) ?? value.name ?? value.id ?? "");
    }
    return String(value);
  }

  // Puts text into an element without touching its look: the first piece of text inside it changes.
  function setText(el, text) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) parts.push(walker.currentNode);
    if (!parts.length) {
      el.textContent = text;
      return;
    }
    parts[0].nodeValue = text;
    for (const extra of parts.slice(1)) extra.nodeValue = "";
  }

  // The page's sample-data array (const SAMPLE_X = [...]), if it has one: tells which value each sample row shows.
  function sampleData(name) {
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    try {
      const data = new Function(`return typeof ${name} === "undefined" ? undefined : ${name};`)();
      return Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  }

  // ---------- the list: real records, stamped from the page's own sample row ----------

  const displayCells = (entity, scope) =>
    [...scope.querySelectorAll("[data-field]")].filter(
      (el) => fieldOf(entity, el.dataset.field) && !el.matches(CONTROLS) && !el.closest("form") && !el.querySelector(CONTROLS)
    );

  // A row is the element that repeats: its neighbours of the same kind show the same field.
  function rowOf(cell) {
    const selector = `[data-field="${cell.dataset.field}"]`;
    for (let el = cell.parentElement; el && el !== document.body; el = el.parentElement) {
      const parent = el.parentElement;
      if (parent && [...parent.children].some((other) => other !== el && other.tagName === el.tagName && other.querySelector(selector))) return el;
    }
    return cell.closest("tr, li, article") || cell.parentElement;
  }

  function findRows(entity) {
    const cells = displayCells(entity, document);
    if (!cells.length) return [];
    const first = rowOf(cells[0]);
    const rows = [];
    for (const cell of cells) {
      const row = rowOf(cell);
      if (row.parentElement === first.parentElement && row.tagName === first.tagName && !rows.includes(row)) rows.push(row);
    }
    return rows;
  }

  // For each field, how the page drew each sample value (a green "Approved" badge, a red "Out of Stock").
  function learnLooks(entity, rows) {
    const looks = {};
    const sample = sampleData(entity.sample);
    const aligned = sample && sample.length === rows.length;
    rows.forEach((row, i) => {
      for (const cell of row.querySelectorAll("[data-field]")) {
        const field = fieldOf(entity, cell.dataset.field);
        if (!field) continue;
        const known = (looks[field.name] = looks[field.name] || new Map());
        const remember = (key) => known.has(key) || known.set(key, cell.cloneNode(true));
        if (aligned && sample[i] && sample[i][field.name] !== undefined) remember(`value:${String(sample[i][field.name])}`);
        remember(`text:${norm(cell.textContent)}`);
      }
    });
    return looks;
  }

  // How the sample rows wrote numbers ("$2.50", "₹1,200", "3 days"), so real numbers look the same.
  function learnNumbers(entity, rows) {
    const formats = {};
    for (const field of entity.fields.filter((f) => f.type === "number")) {
      const cell = rows.map((row) => row.querySelector(`[data-field="${field.name}"]`)).find(Boolean);
      const match = cell && cell.textContent.trim().match(/^(\D*?)(-?\d[\d,]*(?:\.(\d+))?)(\D*)$/);
      if (match) formats[field.name] = { before: match[1], after: match[4], decimals: match[3] ? match[3].length : 0, grouping: match[2].includes(",") };
    }
    return formats;
  }

  function formatNumber(format, value) {
    if (!format || typeof value !== "number") return null;
    const digits = format.decimals ? { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals } : { maximumFractionDigits: 20 };
    return format.before + value.toLocaleString("en-US", { ...digits, useGrouping: format.grouping }) + format.after;
  }

  function stamp(view, item) {
    const row = view.template.cloneNode(true);
    row.dataset.id = item.id;
    for (const cell of [...row.querySelectorAll("[data-field]")]) {
      const field = fieldOf(view.entity, cell.dataset.field);
      if (!field) continue;
      const value = item[field.name];
      const text = formatNumber(view.numbers[field.name], value) ?? display(field, value);
      const known = view.looks[field.name];
      // Same value (or same text) as a sample row: use that sample's element as it was drawn.
      const valueKey = value !== null && typeof value === "object" ? null : `value:${String(value)}`;
      const look = known && ((valueKey && known.get(valueKey)) || known.get(`text:${norm(text)}`));
      if (look) cell.replaceWith(look.cloneNode(true));
      else setText(cell, text);
    }
    return row;
  }

  function render(view, items) {
    for (const row of view.shown) row.remove();
    view.items = new Map(items.map((item) => [item.id, item]));
    view.shown = items.map((item) => stamp(view, item));
    const anchor = view.anchor && view.anchor.parentNode === view.container ? view.anchor : null;
    for (const row of view.shown) view.container.insertBefore(row, anchor);
  }

  async function loadList() {
    const view = state.view;
    if (!view || !view.entity.list) return;
    const list = view.entity.list;
    const ticket = ++view.ticket;
    const params = {};
    if (list.search) params.q = view.q;
    for (const [name, value] of Object.entries(view.filters)) params[name] = value;
    if (list.pagination) params.page = String(view.page);
    const answer = await api("GET", withQuery(view.entity.url, params));
    if (ticket !== view.ticket) return; // a newer search/filter/page already asked
    if (!answer.ok || !answer.data) {
      if (answer.status !== 401) say(problem(answer));
      return;
    }
    const { items = [], total = items.length, page, limit } = answer.data;
    view.total = total;
    view.page = page || view.page;
    view.limit = limit || view.limit;
    render(view, items);
    updatePager(view);
  }

  const pageNumberOf = (button) => (/^\d+$/.test(button.textContent.trim()) ? Number(button.textContent.trim()) : null);

  function updatePager(view) {
    const shown = view.shown.length;
    const first = shown ? (view.page - 1) * (view.limit || shown) + 1 : 0;
    const last = shown ? first + shown - 1 : 0;
    const pages = Math.max(1, Math.ceil(view.total / (view.limit || view.total || 1)));
    for (const { node, kind } of view.counters) {
      node.nodeValue =
        kind === "showing"
          ? node.nodeValue.replace(SHOWING, (_, showing, _from, dash, _to, of) => `${showing}${first}${dash}${last}${of}${view.total}`)
          : node.nodeValue.replace(PAGE_OF, (_, page, _now, of) => `${page}${view.page}${of}${pages}`);
    }
    if (!view.entity.list.pagination) return;
    // Numbered page buttons stay on; only the arrows switch off at the ends.
    for (const prev of document.querySelectorAll('[data-action="prevPage"]')) if (pageNumberOf(prev) === null) prev.disabled = view.page <= 1;
    for (const next of document.querySelectorAll('[data-action="nextPage"]')) if (pageNumberOf(next) === null) next.disabled = !view.limit || view.page * view.limit >= view.total;
  }

  // "Showing 1-3 of 24" and "Page 1 of 13" outside the rows: kept true.
  const SHOWING = /(showing\s+)(\d+)(\s*[-–]\s*)(\d+)(\s+of\s+)(\d+)/i;
  const PAGE_OF = /(page\s+)(\d+)(\s+of\s+)(\d+)/i;
  function findCounters(view) {
    const counters = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (view.container.contains(node) || node.parentElement.closest("script, style")) continue;
      if (SHOWING.test(node.nodeValue)) counters.push({ node, kind: "showing" });
      else if (PAGE_OF.test(node.nodeValue)) counters.push({ node, kind: "page" });
    }
    return counters;
  }

  async function setupList(entity) {
    let rows = findRows(entity);
    // Some pages draw their sample rows a moment after loading.
    for (let tries = 0; !rows.length && tries < 10; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      rows = findRows(entity);
    }
    if (!rows.length) return null;
    const view = {
      entity,
      container: rows[0].parentElement,
      anchor: rows[rows.length - 1].nextSibling,
      template: rows[0].cloneNode(true),
      looks: learnLooks(entity, rows),
      numbers: learnNumbers(entity, rows),
      counters: [],
      shown: rows,
      items: new Map(),
      q: "",
      filters: {},
      page: 1,
      limit: 0,
      total: 0,
      ticket: 0,
    };
    for (const row of rows) delete row.dataset.id;
    view.counters = findCounters(view);
    return view;
  }

  // ---------- search, filters, previous/next ----------

  function filterValue(field, el) {
    const option = el.tagName === "SELECT" ? el.selectedOptions[0] : null;
    const candidates = [el.value, option ? option.textContent : el.dataset.value || el.textContent].map((t) => String(t || "").trim());
    if (!field) return candidates[0];
    if (field.type === "enum") return field.options.find((o) => candidates.some((c) => norm(c) === norm(o))) || "";
    if (field.type === "ref") return /^[a-f0-9]{24}$/i.test(candidates[0]) ? candidates[0] : "";
    if (field.type === "boolean") {
      if (candidates.some((c) => /^(yes|true)$/i.test(c))) return "true";
      if (candidates.some((c) => /^(no|false)$/i.test(c))) return "false";
      return "";
    }
    return candidates.some((c) => /^all\b/i.test(c)) ? "" : candidates[0] || candidates[1];
  }

  function applyFilter(el) {
    const view = state.view;
    if (!view) return;
    const name = el.dataset.filter;
    view.filters[name] = filterValue(fieldOf(view.entity, name), el);
    view.page = 1;
    loadList();
  }

  let searchTimer;
  function search(text, now) {
    const view = state.view;
    if (!view) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      view.q = text.trim();
      view.page = 1;
      loadList();
    }, now ? 0 : SEARCH_DELAY_MS);
  }

  function goToPage(page) {
    const view = state.view;
    if (!view || page < 1 || page === view.page || (view.limit && (page - 1) * view.limit >= view.total)) return;
    view.page = page;
    loadList();
  }

  // A prev/next button showing a number ("1", "2", "8") goes to that page.
  const turnPage = (button, step) => state.view && goToPage(pageNumberOf(button) ?? state.view.page + step);

  // ---------- stat cards and dropdowns ----------

  async function loadStats() {
    const cards = [...document.querySelectorAll("[data-stat]")];
    if (!cards.length || !state.map.stats) return;
    const answer = await api("GET", state.map.stats.url);
    if (!answer.ok || !answer.data) return;
    for (const card of cards) {
      const key = card.dataset.stat;
      if (!(key in answer.data)) continue;
      const value = answer.data[key];
      if (value === null || value === undefined) {
        setText(card, "—");
        continue;
      }
      // Keep what the sample number had around it ("₹1,200", "342 days").
      const [, before = "", after = ""] = card.textContent.trim().match(/^([^\d-]*)-?[\d.,]+(.*)$/) || [];
      setText(card, before + (typeof value === "number" ? value.toLocaleString("en-US") : String(value)) + after);
    }
  }

  const formControls = (name) => [...document.querySelectorAll(`[data-field="${name}"]`)].filter((el) => el.matches(CONTROLS));

  // Relation dropdowns: the real records (id as value, name as text); the placeholder option stays.
  async function fillRelationDropdowns(entity) {
    for (const field of entity.fields.filter((f) => f.type === "ref")) {
      const selects = formControls(field.name).filter((el) => el.tagName === "SELECT");
      const ref = state.map.entities[field.ref];
      if (!selects.length || !ref || !ref.list) continue;
      const answer = await api("GET", withQuery(ref.url, ref.list.pagination ? { limit: "100" } : {}));
      if (!answer.ok || !answer.data) continue;
      for (const select of selects) {
        for (const option of [...select.options]) if (option.value !== "") option.remove();
        for (const item of answer.data.items || []) {
          const option = document.createElement("option");
          option.value = item.id;
          option.textContent = String(item[ref.labelField] ?? item.id);
          select.appendChild(option);
        }
      }
    }
  }

  // Enum dropdowns in forms send the spec's exact value, whatever the page wrote as option values.
  function alignEnumDropdowns(entity) {
    for (const field of entity.fields.filter((f) => f.type === "enum")) {
      for (const select of formControls(field.name).filter((el) => el.tagName === "SELECT")) {
        for (const option of select.options) {
          if (option.hasAttribute("value") && option.value === "") continue; // the "Select …" prompt: no choice
          const match = field.options.find((o) => norm(o) === norm(option.value) || norm(o) === norm(option.textContent));
          if (match) option.value = match;
        }
      }
    }
  }

  const refresh = () => Promise.all([loadList(), loadStats()]);

  // ---------- the form: Add and Edit ----------

  const controlIn = (scope, name) => scope.querySelector(`[data-field="${name}"]:is(${CONTROLS})`) || scope.querySelector(`[name="${name}"]:is(${CONTROLS})`);

  // The element holding the entity's inputs: the <form>, or the smallest element around all of them.
  function editorOf(entity) {
    const controls = entity.fields.map((f) => formControls(f.name)[0]).filter(Boolean);
    if (!controls.length) return null;
    const form = controls[0].closest("form");
    if (form) return form;
    let scope = controls[0].parentElement;
    while (scope && !controls.every((c) => scope.contains(c))) scope = scope.parentElement;
    return scope;
  }

  const saveButtonOf = (scope) =>
    scope.querySelector('[data-action="create"]') || scope.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');

  function readValue(field, raw) {
    const text = String(raw).trim();
    if (text === "") return undefined;
    if (field.type === "number") {
      const number = Number(text.replace(/[\s,]/g, "").replace(/^[^\d.-]+/, "").replace(/[^\d.]+$/, "")); // "$12.50", "3 days"
      return Number.isFinite(number) ? number : text; // the backend explains what is wrong
    }
    if (field.type === "boolean") {
      if (/^(true|yes|on|1)$/i.test(text)) return true;
      return /^(false|no|off|0)$/i.test(text) ? false : text;
    }
    if (field.type === "enum") return field.options.find((o) => norm(o) === norm(text)) || text;
    if (field.type === "date") return text.slice(0, 10);
    return text;
  }

  function readForm(entity, scope) {
    const body = {};
    for (const field of entity.fields) {
      const el = controlIn(scope, field.name);
      if (!el) continue;
      const value = el.type === "checkbox" ? el.checked : readValue(field, el.value);
      if (value !== undefined) body[field.name] = value;
    }
    return body;
  }

  function fillForm(entity, scope, item) {
    for (const field of entity.fields) {
      const el = controlIn(scope, field.name);
      if (!el) continue;
      const value = item[field.name];
      if (el.type === "checkbox") el.checked = Boolean(value);
      else if (field.type === "ref") el.value = value && typeof value === "object" ? value.id : value ?? "";
      else if (field.type === "date") el.value = value ? String(value).slice(0, 10) : "";
      else el.value = value ?? "";
    }
  }

  function clearForm(scope) {
    if (scope.tagName === "FORM") return scope.reset();
    for (const el of scope.querySelectorAll(CONTROLS)) {
      if (el.type === "checkbox" || el.type === "radio") el.checked = el.defaultChecked;
      else if (el.tagName === "SELECT") el.selectedIndex = 0;
      else el.value = el.defaultValue;
    }
  }

  function startEditing(scope, item) {
    stopEditing();
    fillForm(state.entity, scope, item);
    const button = saveButtonOf(scope);
    state.editing = { id: item.id, scope, button, label: button && button.innerHTML };
    if (button) setText(button, "Save changes");
    if (scope.scrollIntoView) scope.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function stopEditing() {
    const editing = state.editing;
    state.editing = null;
    if (editing && editing.button) editing.button.innerHTML = editing.label;
  }

  function validates(scope) {
    if (scope.tagName === "FORM") return scope.checkValidity() || (scope.reportValidity(), false);
    const invalid = [...scope.querySelectorAll(CONTROLS)].find((el) => !el.checkValidity());
    return invalid ? (invalid.reportValidity(), false) : true;
  }

  // The backend's field problems as the browser's own bubbles; they clear when the field changes.
  function showProblems(entity, scope, details) {
    const loose = [];
    let first = null;
    for (const [name, message] of Object.entries(details)) {
      const el = scope && controlIn(scope, name);
      if (!el) {
        const field = fieldOf(entity, name);
        loose.push(`${field ? field.label : name}: ${message}`);
        continue;
      }
      el.setCustomValidity(message);
      first = first || el;
    }
    if (first) first.reportValidity();
    if (loose.length) say(loose.join("\n"));
  }

  const saving = new WeakSet(); // forms with a save on its way: a second click sends nothing

  async function save(scope) {
    const entity = state.entity;
    const editing = state.editing && state.editing.scope === scope ? state.editing : null;
    if (!entity || saving.has(scope) || (!editing && !entity.create) || !validates(scope)) return;
    const body = readForm(entity, scope);
    saving.add(scope);
    const answer = await (editing ? api("PUT", `${entity.url}/${editing.id}`, body) : api("POST", entity.url, body)).finally(() => saving.delete(scope));
    if (answer.status === 400 && answer.data && answer.data.details) return showProblems(entity, scope, answer.data.details);
    if (!answer.ok) return answer.status === 401 || say(problem(answer));
    stopEditing();
    clearForm(scope);
    await refresh();
  }

  // ---------- Edit inside the row, when the page has no form ----------

  const INLINE_TYPES = ["string", "email", "number", "date", "enum", "boolean"];
  const inlineCells = (row) =>
    [...row.querySelectorAll("[data-field]")].filter((cell) => {
      const field = fieldOf(state.entity, cell.dataset.field);
      return field && INLINE_TYPES.includes(field.type);
    });

  function startRowEdit(row, button) {
    row.dataset.editing = "true";
    for (const cell of inlineCells(row)) cell.setAttribute("contenteditable", "true");
    setText(button, "Save");
    const first = inlineCells(row)[0];
    if (first && first.focus) first.focus();
  }

  async function saveRow(row) {
    const entity = state.entity;
    const body = {};
    for (const cell of inlineCells(row)) {
      const value = readValue(fieldOf(entity, cell.dataset.field), cell.textContent);
      if (value !== undefined) body[cell.dataset.field] = value;
    }
    const answer = await api("PUT", `${entity.url}/${row.dataset.id}`, body);
    if (answer.status === 400 && answer.data && answer.data.details) return showProblems(entity, null, answer.data.details);
    if (!answer.ok) return answer.status === 401 || say(problem(answer));
    await refresh();
  }

  const cancelRowEdit = () => state.view && render(state.view, [...state.view.items.values()]);

  // ---------- Add through a new row, when the page has an Add button but no form ----------

  function startNewRow(button) {
    const view = state.view;
    const row = view.template.cloneNode(true);
    delete row.dataset.id;
    row.dataset.editing = "new";
    for (const cell of inlineCells(row)) {
      setText(cell, "");
      cell.setAttribute("contenteditable", "true");
    }
    view.container.insertBefore(row, view.shown[0] || (view.anchor && view.anchor.parentNode === view.container ? view.anchor : null));
    state.adding = { row, button, label: button.innerHTML };
    setText(button, "Save");
    const first = inlineCells(row)[0];
    if (first && first.focus) first.focus();
  }

  function stopAdding() {
    const adding = state.adding;
    state.adding = null;
    if (!adding) return;
    adding.row.remove();
    adding.button.innerHTML = adding.label;
  }

  async function saveNewRow() {
    const { row } = state.adding;
    const entity = state.entity;
    if (saving.has(row)) return;
    const body = {};
    for (const cell of inlineCells(row)) {
      const value = readValue(fieldOf(entity, cell.dataset.field), cell.textContent);
      if (value !== undefined) body[cell.dataset.field] = value;
    }
    saving.add(row);
    const answer = await api("POST", entity.url, body).finally(() => saving.delete(row));
    if (answer.status === 400 && answer.data && answer.data.details) return showProblems(entity, null, answer.data.details);
    if (!answer.ok) return answer.status === 401 || say(problem(answer));
    stopAdding();
    await refresh();
  }

  // ---------- row and page buttons ----------

  function buttonAction(name) {
    for (const entity of Object.values(state.map.entities)) if (entity.actions[name]) return { entity, action: entity.actions[name] };
    return null;
  }

  async function download(url, fallbackName) {
    const answer = await api("GET", url);
    if (!answer.ok || !answer.res) return answer.status === 401 || say(problem(answer));
    const disposition = answer.res.headers.get("content-disposition") || "";
    const named = disposition.match(/filename="?([^";]+)"?/);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await answer.res.blob());
    link.download = named ? named[1] : fallbackName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  async function runButton(el, name) {
    const { entity, action } = buttonAction(name);
    if (!action.available) return say(`"${action.button}" is not available yet.`);
    if (action.kind === "export") return download(action.url, `${entity.url.split("/").pop()}.csv`);
    let url = action.url;
    if (action.row) {
      const row = el.closest("[data-id]");
      if (!row) return;
      url = url.replace(":id", encodeURIComponent(row.dataset.id));
    }
    const answer = await api(action.method, url);
    if (!answer.ok) return answer.status === 401 || say(problem(answer));
    await refresh();
  }

  async function removeRow(row) {
    const entity = state.entity;
    const one = entity.url.split("/").pop().replace(/s$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    if (!window.confirm(`Delete this ${one}?`)) return;
    const answer = await api("DELETE", `${entity.url}/${row.dataset.id}`);
    if (!answer.ok) return answer.status === 401 || say(problem(answer));
    await refresh();
  }

  function editRow(row, button) {
    const item = state.view && state.view.items.get(row.dataset.id);
    if (!item) return;
    const scope = state.entity.update && editorOf(state.entity);
    if (scope && !scope.contains(row)) return startEditing(scope, item);
    if (row.dataset.editing) return saveRow(row);
    startRowEdit(row, button);
  }

  // ---------- sign in, sign up, log out ----------

  const credential = (scope, name) => controlIn(scope, name) || scope.querySelector(`input[type="${name}"]`);

  async function signIn(scope, register) {
    const auth = state.map.auth;
    const url = register ? auth.register : auth.login;
    const email = credential(scope, "email");
    const password = credential(scope, "password");
    if (!url || !email || !password) return;
    if (scope.tagName === "FORM" && !validates(scope)) return;
    const empty = [email, password].find((el) => !el.value.trim());
    if (empty) return empty.focus();
    const answer = await api("POST", url, { email: email.value.trim(), password: password.value });
    if (answer.ok && answer.data && answer.data.token) {
      writeToken(answer.data.token);
      return state.map.home ? navigate(state.map.home) : say("You are signed in.");
    }
    if (answer.status === 400 && answer.data && answer.data.details) return showProblems({ fields: [] }, scope, answer.data.details);
    const field = answer.status === 409 ? email : password; // 409: that email already has an account
    field.setCustomValidity(problem(answer));
    field.reportValidity();
  }

  async function logOut() {
    if (state.map.auth.logout && readToken()) await api("POST", state.map.auth.logout);
    writeToken(null);
    goToLogin();
  }

  // ---------- events: caught before the page's own scripts ----------

  const BUILT_IN = ["create", "update", "delete", "prevPage", "nextPage", "search", "login", "signup", "logout"];
  const report = (err) => console.error("AndarKaCode binder:", err);
  const entityControlsIn = (scope) => state.entity.fields.some((f) => controlIn(scope, f.name));

  function onClick(event) {
    const el = event.target.closest && event.target.closest("[data-action], [data-filter]");
    if (!el || el.tagName === "SELECT" || el.closest("select")) return;
    if (el.matches(CONTROLS) && el.type !== "button" && el.type !== "submit") return; // clicking into a box or a checkbox
    const action = el.dataset.action;
    const isFilter = el.dataset.filter !== undefined;
    if (!state.map) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!isFilter && !BUILT_IN.includes(action) && !buttonAction(action)) return; // not a marker we know: the page keeps it
    event.stopImmediatePropagation();
    // A submit button in a form: the browser checks the form first, then fires submit (caught below).
    if (el.form && el.type === "submit" && (action === "create" || action === "login")) return;
    event.preventDefault();
    const auth = state.map.auth;
    if (["login", "signup", "logout"].includes(action) && !auth) return;

    if (isFilter) return applyFilter(el);
    const row = el.closest("[data-id]");
    const run = {
      prevPage: () => turnPage(el, -1),
      nextPage: () => turnPage(el, 1),
      search: () => {
        const box = el.parentElement && el.parentElement.querySelector("input");
        search(box ? box.value : "", true);
      },
      create: () => {
        const scope = state.entity && editorOf(state.entity);
        if (scope) return save(scope);
        // An Add button and no form on the page: add through a new row instead.
        if (state.adding) return saveNewRow();
        if (state.view && state.entity.create) startNewRow(el);
      },
      update: () => row && editRow(row, el),
      delete: () => row && removeRow(row),
      login: () => signIn(el.closest("form") || document, false),
      signup: () => signIn(el.closest("form") || document, true),
      logout: () => logOut(),
    }[action];
    Promise.resolve(run ? run() : runButton(el, action)).catch(report);
  }

  function onSubmit(event) {
    const form = event.target;
    if (!state.map) return;
    if (state.map.auth && (state.page.kind === "login" || form.querySelector('[data-action="login"]'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return signIn(form, false).catch(report);
    }
    const entityForm = state.entity && entityControlsIn(form);
    const searchBox = !entityForm && form.querySelector('[data-action="search"]');
    if (!entityForm && !searchBox) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (searchBox) return search(searchBox.value || "", true);
    save(form).catch(report);
  }

  function onInput(event) {
    const el = event.target;
    if (el.validity && el.validity.customError) el.setCustomValidity(""); // the user is fixing it
    if (!el.matches || !el.matches('input[data-action="search"], textarea[data-action="search"]')) return;
    event.stopImmediatePropagation();
    search(el.value, false);
  }

  function onChange(event) {
    const el = event.target;
    if (el.validity && el.validity.customError) el.setCustomValidity("");
    if (!el.matches || !el.matches("select[data-filter], input[data-filter]")) return;
    event.stopImmediatePropagation();
    applyFilter(el);
  }

  function onKeydown(event) {
    const row = event.target.closest && event.target.closest("[data-editing]");
    if (!row || (event.key !== "Escape" && event.key !== "Enter")) return;
    event.preventDefault();
    const isNew = row.dataset.editing === "new";
    if (event.key === "Escape") isNew ? stopAdding() : cancelRowEdit();
    else (isNew ? saveNewRow() : saveRow(row)).catch(report);
  }

  function onReset(event) {
    if (state.editing && state.editing.scope === event.target) stopEditing();
  }

  window.addEventListener("click", onClick, true);
  window.addEventListener("submit", onSubmit, true);
  window.addEventListener("input", onInput, true);
  window.addEventListener("change", onChange, true);
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("reset", onReset, true);

  // ---------- start ----------

  async function start() {
    if (window.location.protocol === "file:") {
      say("This page needs its server. In the app folder run npm start, then open http://localhost:3000");
      return setStatus("error");
    }
    const answer = await api("GET", "api-map.json");
    if (!answer.ok || !answer.data) return setStatus("error");
    const map = (state.map = answer.data);
    const file = decodeURIComponent(window.location.pathname.split("/").pop() || "") || "index.html";
    state.page = map.pages[file] || map.pages["index.html"] || { kind: "unknown" };
    if (map.auth && state.page.kind !== "login" && !readToken()) {
      goToLogin();
      return setStatus("ready");
    }

    const entity = (state.entity = (state.page.entity && map.entities[state.page.entity]) || null);
    if (entity) {
      alignEnumDropdowns(entity);
      if (entity.list) state.view = await setupList(entity);
      await Promise.all([state.view ? loadList() : null, fillRelationDropdowns(entity)]);
    }
    await loadStats();
    setStatus("ready");
  }

  const begin = () =>
    setTimeout(() =>
      start().catch((err) => {
        setStatus("error");
        console.error("AndarKaCode binder:", err);
      })
    );
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin);
  else begin();
})();
