// Evaluation plan A5: is everything a demo needs up? One result per service, each with how to fix it.
// Pure apart from what is passed in (fetch, a MongoDB connect, a file check), so it is tested on its own.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist", "index.html");
const TIMEOUT_MS = 5000;
const WARM_FOR = "60m";

const reason = (err) => err?.cause?.code ?? err?.message ?? String(err);
const pass = (name, detail) => ({ name, ok: true, detail });
const fail = (name, detail) => ({ name, ok: false, detail });

async function getJson(fetch, url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function checkMongo(env, mongo) {
  const uri = env.MONGODB_URI || "mongodb://127.0.0.1:27017/andarkacode";
  const where = uri.replace(/\/\/[^@/]*@/, "//"); // no user or password in what is printed
  try {
    await mongo(uri);
    return pass("MongoDB", `connected (${where})`);
  } catch (err) {
    return fail("MongoDB", `not reachable at ${where}: ${reason(err)}. Start MongoDB, or check MONGODB_URI`);
  }
}

async function checkApi(env, fetch) {
  const url = `http://${env.HOST || "127.0.0.1"}:${env.PORT || 4000}`;
  try {
    const { status } = await getJson(fetch, `${url}/api/projects`);
    return status < 500 ? pass("Builder API", `answering at ${url}`) : fail("Builder API", `answers ${status} at ${url}: look at its window`);
  } catch (err) {
    return fail("Builder API", `not reachable at ${url} (${reason(err)}). Start it: cd builder-api && npm start`);
  }
}

function checkWeb(exists) {
  return exists(WEB_INDEX) ? pass("Web app", "built (web/dist)") : fail("Web app", "not built. Build it: cd web && npm run build");
}

async function checkOllama(env, fetch, warm) {
  const url = (env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
  const needed = [env.OLLAMA_MODEL || "qwen3-vl:8b-instruct", env.OLLAMA_CODE_MODEL || "qwen2.5-coder:7b"];
  let names;
  try {
    names = ((await getJson(fetch, `${url}/api/tags`)).body?.models ?? []).map((m) => m.name);
  } catch (err) {
    return fail("Ollama", `not reachable at ${url} (${reason(err)}). Start Ollama`);
  }
  const missing = needed.filter((m) => !names.includes(m));
  if (missing.length) return fail("Ollama", `missing ${missing.join(", ")}. Run: ${missing.map((m) => `ollama pull ${m}`).join(" && ")}`);
  if (!warm) return pass("Ollama", `has ${needed.join(" and ")}`);
  // An empty request loads a model; keep_alive keeps it in memory, so the first build doesn't wait for it.
  const loads = await Promise.allSettled(
    needed.map((model) => fetch(`${url}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, keep_alive: WARM_FOR }) }))
  );
  const failed = needed.filter((_, i) => loads[i].status === "rejected" || !loads[i].value.ok);
  return failed.length ? fail("Ollama", `could not load ${failed.join(", ")}`) : pass("Ollama", `${needed.join(" and ")} loaded for an hour`);
}

async function checkGateway(env, fetch) {
  const name = "Gateway (Laptop B)";
  if (!env.GATEWAY_URL) return pass(name, "not used (pages go through the page queue)");
  const url = env.GATEWAY_URL.replace(/\/$/, "");
  try {
    const { status, body } = await getJson(fetch, `${url}/v1/health`, { headers: { "X-API-Key": env.GATEWAY_API_KEY ?? "" } });
    if (status === 401) return fail(name, `refuses the key at ${url}: GATEWAY_API_KEY must match the Gateway's API_KEY`);
    if (status !== 200 || !body) return fail(name, `answers ${status} at ${url}`);
    if (!body.s2cUp) return fail(name, "is up, but Screenshot-to-Code is down on Laptop B: start it (port 7002)");
    if (!body.ollamaUp) return fail(name, "is up, but Ollama is down on Laptop B: start Ollama there");
    const loaded = body.models?.length ? `, loaded: ${body.models.map((m) => (m.gpu ? `${m.name} (${m.gpu})` : m.name ?? m)).join(", ")}` : "";
    return pass(name, `Screenshot-to-Code up${loaded}`);
  } catch (err) {
    return fail(name, `not reachable at ${url} (${reason(err)}). Start the Gateway on Laptop B, and check both laptops are on the same network`);
  }
}

/** [{ name, ok, detail }], in the order a demo needs them. warm: also load the local models. */
export async function demoCheck({ env = process.env, fetch = globalThis.fetch, mongo, exists = existsSync, warm = false } = {}) {
  return Promise.all([checkMongo(env, mongo), checkApi(env, fetch), checkWeb(exists), checkOllama(env, fetch, warm), checkGateway(env, fetch)]);
}

/** One line per service, then whether the demo can run. */
export function formatCheck(results) {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name.padEnd(width)}  ${r.detail}`);
  const problems = results.filter((r) => !r.ok).length;
  lines.push("", problems ? `not ready: ${problems} problem${problems === 1 ? "" : "s"} above` : "ready for the demo");
  return lines.join("\n");
}
