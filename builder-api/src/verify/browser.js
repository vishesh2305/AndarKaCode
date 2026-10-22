// A page of a running generated app in jsdom (a browser without a screen), with the binder, for the
// Verifier. Loads only the app's own files (outside scripts such as the Tailwind CDN get an empty answer),
// records every request with its answer, says OK to "Are you sure?", and notes alerts and navigations.
import { JSDOM, VirtualConsole, requestInterceptor } from "jsdom";

const TOKEN_KEY = "andarkacode.token";
const sameOriginOnly = (origin) => ({
  interceptors: [
    requestInterceptor((request) =>
      request.url.startsWith(origin) ? undefined : new Response("", { headers: { "Content-Type": "application/javascript" } })
    ),
  ],
});

export async function openLive(base, file, { token } = {}) {
  const requests = [];
  const alerts = [];
  const navigations = [];
  const downloads = [];
  const errors = [];
  let pending = 0;

  const console = new VirtualConsole();
  console.on("jsdomError", (err) => /Not implemented: navigation/.test(err.message) || errors.push(err.message));
  console.on("error", (...args) => errors.push(args.map(String).join(" ")));

  const dom = await JSDOM.fromURL(`${base}/${file}`, {
    runScripts: "dangerously",
    resources: sameOriginOnly(base),
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(w) {
      w.fetch = async (input, init = {}) => {
        const url = new URL(String(input), w.location.href);
        const entry = { method: (init.method ?? "GET").toUpperCase(), path: url.pathname, query: Object.fromEntries(url.searchParams), status: null, body: null, type: "" };
        requests.push(entry);
        pending++;
        try {
          const res = await fetch(url, init);
          entry.status = res.status;
          entry.type = res.headers.get("content-type") ?? "";
          if (entry.type.includes("application/json")) entry.body = await res.clone().json().catch(() => null);
          return res;
        } finally {
          pending--;
        }
      };
      w.alert = (message) => alerts.push(String(message));
      w.confirm = () => true;
      w.andarkacodeTestHooks = { navigate: (to) => navigations.push(String(to)) };
      w.URL.createObjectURL = (blob) => (downloads.push(blob), "blob:verify");
      w.URL.revokeObjectURL = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      if (token) w.localStorage.setItem(TOKEN_KEY, token);
    },
  });
  const { window } = dom;
  const { document } = window;

  /** Waits until the binder has started and nothing is on its way (plus ms, for typing). */
  async function settled(ms = 0) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 10_000;
    let quiet = 0;
    while (quiet < 4) {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 15));
      const state = document.documentElement.dataset.andarkacode;
      quiet = pending === 0 && state && state !== "loading" && document.readyState === "complete" ? quiet + 1 : 0;
    }
  }

  await settled();
  return {
    window,
    document,
    $: (s) => document.querySelector(s),
    $$: (s) => [...document.querySelectorAll(s)],
    state: () => document.documentElement.dataset.andarkacode,
    requests,
    alerts,
    navigations,
    downloads,
    errors,
    settled,
    token: () => window.localStorage.getItem(TOKEN_KEY),
    close: () => window.close(),
  };
}
