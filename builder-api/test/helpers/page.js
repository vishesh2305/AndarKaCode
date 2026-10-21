// Opens a generated page with the binder in jsdom (a browser without a screen), against a fake
// backend that records every request. jsdom runs the page's scripts in the same order a browser does:
// the page's own scripts, then the binder, then DOMContentLoaded.
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { wirePage } from "../../src/wirer/index.js";

export const BINDER = readFileSync(new URL("../../../templates/frontend/app.js", import.meta.url), "utf8");
export const TOKEN_KEY = "andarkacode.token";

export const page = (name) => readFileSync(new URL(`../fixtures/pages/${name}`, import.meta.url), "utf8");

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * html: the page as Laptop B built it. map: api-map.json. api(req) -> { status, body } | Response | undefined (404).
 * req = { method, path, query, body, auth }.
 */
export async function openPage({ html, map, api = () => undefined, url = "http://localhost:3000/page-1.html", token, confirmAnswer = true }) {
  const calls = [];
  const alerts = [];
  const confirms = [];
  const navigations = [];
  const downloads = [];
  const errors = [];
  let pending = 0;

  // The binder inline instead of from app.js (jsdom loads no files), at the same place in the page.
  const wired = wirePage(html).replace('<script src="app.js"></script>', () => `<script>${BINDER}</script>`);

  const console = new VirtualConsole();
  console.on("jsdomError", (err) => {
    if (!/Not implemented: navigation/.test(err.message)) errors.push(err.message);
  });
  console.on("error", (...args) => errors.push(args.map(String).join(" ")));

  async function fakeFetch(input, init = {}) {
    const target = new URL(String(input), dom.window.location.href);
    if (target.pathname.endsWith("/api-map.json")) return map ? json(200, map) : json(404, { error: "Not found" });
    const headers = new Headers(init.headers ?? {});
    const req = {
      method: (init.method ?? "GET").toUpperCase(),
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      body: init.body ? JSON.parse(init.body) : undefined,
      auth: headers.get("authorization"),
    };
    calls.push(req);
    pending++;
    try {
      await new Promise((r) => setTimeout(r, 1)); // like a network: never answers in the same tick
      const answer = await api(req);
      if (answer instanceof Response) return answer;
      return answer ? json(answer.status ?? 200, answer.body) : json(404, { error: "Not found" });
    } finally {
      pending--;
    }
  }

  const dom = new JSDOM(wired, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(w) {
      w.fetch = fakeFetch;
      w.alert = (message) => alerts.push(String(message));
      w.confirm = (message) => (confirms.push(String(message)), confirmAnswer);
      w.andarkacodeTestHooks = { navigate: (to) => navigations.push(String(to)) };
      w.URL.createObjectURL = (blob) => (downloads.push(blob), "blob:test");
      w.URL.revokeObjectURL = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      if (token) w.localStorage.setItem(TOKEN_KEY, token);
    },
  });
  const { window } = dom;
  const { document } = window;

  /** Waits until the binder has started and no request is in flight (plus ms for debounced typing). */
  async function settle(ms = 0) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 3000;
    let quiet = 0;
    while (quiet < 3) {
      if (Date.now() > deadline) throw new Error(`page did not settle (state: ${document.documentElement.dataset.andarkacode})`);
      await new Promise((r) => setTimeout(r, 5));
      quiet = pending === 0 && document.documentElement.dataset.andarkacode !== "loading" && document.readyState === "complete" ? quiet + 1 : 0;
    }
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const click = async (el) => (el.click(), settle());
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const choose = (el, value) => {
    el.value = value;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  await settle();
  return { window, document, $, $$, calls, alerts, confirms, navigations, downloads, errors, settle, click, type, choose, close: () => window.close() };
}

/** A tiny in-memory list API: GET/POST/PUT/DELETE on url, like the generated backend. */
export function memoryApi(url, items, { pageSize = 10 } = {}) {
  let next = 1;
  const id = () => (next++).toString(16).padStart(24, "0");
  const rows = items.map((item) => ({ id: id(), ...item }));
  const handler = (req) => {
    if (req.path === url && req.method === "GET") {
      const page = Number(req.query.page ?? 1);
      return { body: { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, limit: pageSize } };
    }
    if (req.path === url && req.method === "POST") {
      const row = { id: id(), ...req.body };
      rows.unshift(row);
      return { status: 201, body: row };
    }
    const match = req.path.startsWith(`${url}/`) && req.path.slice(url.length + 1);
    if (match && !match.includes("/")) {
      const at = rows.findIndex((r) => r.id === match);
      if (at === -1) return { status: 404, body: { error: "Not found" } };
      if (req.method === "PUT") return { body: Object.assign(rows[at], req.body) };
      if (req.method === "DELETE") return (rows.splice(at, 1), { status: 204 });
      if (req.method === "GET") return { body: rows[at] };
    }
    return undefined;
  };
  handler.rows = rows;
  return handler;
}
