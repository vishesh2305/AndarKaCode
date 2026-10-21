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

  const state = { map: null, page: null, view: null };
  const setStatus = (status) => (root.dataset.andarkacode = status);
  const say = (message) => window.alert(message);
  setStatus("loading");

  // ---------- talking to the backend ----------

  async function api(method, url, body) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Is npm start still running?" } };
    }
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
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

  function stamp(view, item) {
    const row = view.template.cloneNode(true);
    row.dataset.id = item.id;
    for (const cell of [...row.querySelectorAll("[data-field]")]) {
      const field = fieldOf(view.entity, cell.dataset.field);
      if (!field) continue;
      const value = item[field.name];
      const text = display(field, value);
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

  function updatePager(view) {
    if (!view.entity.list.pagination) return;
    for (const prev of document.querySelectorAll('[data-action="prevPage"]')) prev.disabled = view.page <= 1;
    for (const next of document.querySelectorAll('[data-action="nextPage"]')) next.disabled = !view.limit || view.page * view.limit >= view.total;
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

  function turnPage(step) {
    const view = state.view;
    if (!view) return;
    const page = view.page + step;
    if (page < 1 || (step > 0 && view.limit && (page - 1) * view.limit >= view.total)) return;
    view.page = page;
    loadList();
  }

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
          const match = field.options.find((o) => norm(o) === norm(option.value) || norm(o) === norm(option.textContent));
          if (match) option.value = match;
        }
      }
    }
  }

  // ---------- events: caught before the page's own scripts ----------

  function onClick(event) {
    const el = event.target.closest && event.target.closest("[data-action], [data-filter]");
    if (!el || el.tagName === "SELECT" || el.closest("select")) return;
    const action = el.dataset.action;
    if (el.matches(CONTROLS) && el.type !== "button" && el.type !== "submit") return; // clicking into a box or a checkbox
    const handled = el.dataset.filter !== undefined || ["prevPage", "nextPage", "search"].includes(action);
    if (!state.map) {
      if (handled) (event.preventDefault(), event.stopImmediatePropagation());
      return;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (el.dataset.filter !== undefined) return applyFilter(el);
    if (action === "prevPage") return turnPage(-1);
    if (action === "nextPage") return turnPage(1);
    if (action === "search" && !el.matches(CONTROLS)) {
      const box = el.parentElement && el.parentElement.querySelector("input");
      return search(box ? box.value : "", true);
    }
  }

  function onInput(event) {
    const el = event.target;
    if (!el.matches || !el.matches('input[data-action="search"], textarea[data-action="search"]')) return;
    event.stopImmediatePropagation();
    search(el.value, false);
  }

  function onChange(event) {
    const el = event.target;
    if (!el.matches || !el.matches("select[data-filter], input[data-filter]")) return;
    event.stopImmediatePropagation();
    applyFilter(el);
  }

  window.addEventListener("click", onClick, true);
  window.addEventListener("input", onInput, true);
  window.addEventListener("change", onChange, true);

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

    const entity = state.page.entity && map.entities[state.page.entity];
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
