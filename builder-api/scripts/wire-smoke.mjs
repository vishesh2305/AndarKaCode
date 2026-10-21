// Step 15 real check: drives real headless Chrome against a RUNNING generated app (unzipped, npm start)
// and uses its wired page like a person: log in (if the app has a login), add a record, reload, search,
// delete. Takes screenshots before and after. Reads api-map.json to know what the page can do.
//
//   node scripts/wire-smoke.mjs http://localhost:3000 [--email admin@example.com --password ...] [--out dir]
//
// Chrome: found in the usual places on Windows and macOS, or set CHROME=/path/to/chrome.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--") && /^https?:/.test(a)) ?? "http://localhost:3000").replace(/\/$/, "");
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const email = option("email", process.env.ADMIN_EMAIL ?? "admin@example.com");
const password = option("password", process.env.ADMIN_PASSWORD ?? "change-me-please");
const outDir = option("out", path.join(os.tmpdir(), "wire-smoke"));

const CHROMES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const chromePath = CHROMES.find((p) => existsSync(p));
if (!chromePath) throw new Error("Chrome not found: set CHROME=/path/to/chrome");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  return ok;
};

const map = await fetch(`${base}/api-map.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!map) throw new Error(`No api-map.json at ${base}: is the app running (npm start), and is it a wired app?`);

const profile = await mkdtemp(path.join(os.tmpdir(), "wire-smoke-chrome-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1280,1000", "about:blank"]);

try {
  await mkdir(outDir, { recursive: true });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const dialogs = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) (pending.get(msg.id)(msg), pending.delete(msg.id));
    // The page's alert/confirm boxes: note them and press OK.
    if (msg.method === "Page.javascriptDialogOpening") {
      dialogs.push(msg.params.message);
      send("Page.handleJavaScriptDialog", { accept: true });
    }
  });
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  const evaluate = async (expression) => {
    const { result } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "page script failed");
    return result?.result?.value;
  };
  const shot = async (name) => {
    const { result } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(outDir, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const ready = () =>
    evaluate(`new Promise((resolve) => {
      const t = Date.now();
      (function wait() {
        const s = document.documentElement.dataset.andarkacode;
        if (document.readyState === "complete" && s && s !== "loading") return setTimeout(() => resolve(s), 400);
        if (Date.now() - t > 15000) return resolve("timeout");
        setTimeout(wait, 100);
      })();
    })`);
  const open = async (file) => {
    await send("Page.navigate", { url: `${base}/${file}` });
    await sleep(500);
    return ready();
  };
  await send("Page.enable");
  await send("Runtime.enable");

  // 1. Login, when the app has one.
  const home = map.home ?? "index.html";
  if (map.auth) {
    check("a data page without a login goes to the login page", (await open(home), await evaluate("location.pathname")).endsWith(map.auth.loginPage));
    await open(map.auth.loginPage);
    await shot("1-login");
    await evaluate(`(() => {
      const set = (name, value) => { const el = document.querySelector('[data-field="' + name + '"]') || document.querySelector('input[type="' + name + '"]'); el.value = value; };
      set("email", ${JSON.stringify(email)}); set("password", ${JSON.stringify(password)});
      document.querySelector('[data-action="login"]').click();
    })()`);
    await sleep(1500);
    await ready();
    check("logging in opens the first data page", (await evaluate("location.pathname")).endsWith(home), await evaluate("location.pathname"));
  }

  // 2. The data page: real rows instead of the sample rows.
  const state = await open(home);
  check("the page is wired (binder ready)", state === "ready", state);
  await shot("2-before");
  const page = map.pages[home];
  const entity = page?.entity && map.entities[page.entity];
  if (!entity) {
    console.log("(this page shows no data table; nothing more to try)");
  } else {
    const rows = () => evaluate(`document.querySelectorAll("[data-id]").length`);
    const before = await rows();
    const inDatabase = await evaluate(`(() => {
      const token = localStorage.getItem("andarkacode.token");
      return fetch(${JSON.stringify(entity.url)}, { headers: token ? { Authorization: "Bearer " + token } : {} }).then((r) => r.json()).then((d) => d.items.length);
    })()`);
    check("the rows on the page are the database's rows (not the samples)", before === inDatabase, `${before} on the page, ${inDatabase} in the first page of the API`);

    const unique = `Smoke ${Date.now() % 100000}`;
    const visible = async (text) => (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) === true;
    const sample = (f, text) => ({ string: text, email: `smoke${Date.now() % 100000}@example.com`, number: "42", date: "2026-12-01", boolean: "Yes" })[f.type] ?? null;
    let target = null; // a record this run can find again

    // 3. Add: through the page's own form, or (no form on the page) through the new row the binder opens.
    if (entity.create) {
      const values = Object.fromEntries(entity.fields.map((f) => [f.name, sample(f, unique)]));
      const usedForm = await evaluate(`(() => {
        const values = ${JSON.stringify(values)};
        const controls = document.querySelectorAll("[data-field]:is(input, select, textarea)");
        for (const el of controls) {
          const v = values[el.dataset.field];
          if (el.type === "checkbox") el.checked = true;
          else if (el.tagName === "SELECT") { const o = [...el.options].find((o) => o.value !== ""); if (o) el.value = o.value; }
          else if (v !== null && v !== undefined) el.value = v;
        }
        const form = controls[0]?.closest("form");
        const button = document.querySelector('[data-action="create"]') || form?.querySelector('button[type="submit"], button:not([type])');
        if (button) button.click();
        else form?.requestSubmit();
        return controls.length > 0;
      })()`);
      if (!usedForm) {
        await sleep(300);
        await evaluate(`(() => {
          const values = ${JSON.stringify(values)};
          for (const cell of document.querySelectorAll('[data-editing="new"] [contenteditable][data-field]')) {
            const v = values[cell.dataset.field];
            if (v !== null && v !== undefined) cell.textContent = v;
          }
          document.querySelector('[data-action="create"]').click();
        })()`);
      }
      await sleep(1500);
      await shot("3-after-add");
      if (check(`Add shows the new record (${usedForm ? "the page's form" : "a new row, the page has no form"})`, await visible(unique))) {
        await open(home);
        if (check("the new record is still there after a reload (saved in MongoDB)", await visible(unique))) target = unique;
      }
    }

    // 4. Edit: the new record, or (no Add on this page) the first row.
    if (entity.update) {
      const find = target ? `[...document.querySelectorAll("[data-id]")].find((r) => r.innerText.includes(${JSON.stringify(target)}))` : `document.querySelector("[data-id]")`;
      const field = entity.fields.find((f) => f.type === "string");
      const edited = `Edited ${Date.now() % 100000}`;
      const how = field && (await evaluate(`(() => {
        const row = ${find};
        if (!row) return null;
        row.querySelector('[data-action="update"]').click();
        const input = document.querySelector('[data-field="${field.name}"]:is(input, textarea)');
        if (input && input.value) {
          input.value = ${JSON.stringify(edited)};
          const save = input.closest("form")?.querySelector('[data-action="create"], button[type="submit"], button:not([type])') || document.querySelector('[data-action="create"]');
          save.click();
          return "the page's form";
        }
        const cell = row.querySelector('[data-field="${field.name}"][contenteditable]');
        if (!cell) return null;
        cell.textContent = ${JSON.stringify(edited)};
        row.querySelector('[data-action="update"]').click();
        return "editing inside the row";
      })()`));
      if (!how) console.log("(no row to edit: add one first)");
      else {
        await sleep(1500);
        await open(home);
        if (check(`Edit is saved (${how}; still there after a reload)`, await visible(edited))) target = edited;
      }
    }

    // 5. Search for it.
    if (target && entity.list?.search && (await evaluate(`!!document.querySelector('input[data-action="search"]')`))) {
      await evaluate(`(() => { const box = document.querySelector('input[data-action="search"]'); box.value = ${JSON.stringify(target)}; box.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(1200);
      check("search asks the backend and finds only that record", (await rows()) === 1, `${await rows()} rows`);
      await open(home);
    }

    // 6. Delete it.
    if (target && entity.delete) {
      await evaluate(`[...document.querySelectorAll("[data-id]")].find((r) => r.innerText.includes(${JSON.stringify(target)}))?.querySelector('[data-action="delete"]')?.click()`);
      await sleep(1500);
      await open(home);
      check("Delete removes it (gone after a reload)", !(await visible(target)));
    }
    await shot("4-end");
  }
  if (dialogs.length) console.log(`browser boxes shown: ${dialogs.map((d) => JSON.stringify(d)).join(", ")}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; screenshots in ${outDir}`);
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
