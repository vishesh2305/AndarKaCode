// Step 33b: where a generated app runs, the same way for every caller (the Verifier, the button tester, the
// live preview). SANDBOX=docker: a sandbox of its own (sandbox.js, Step 33a), with its database inside.
// SANDBOX=process (development): a process on this computer (app-runner.js) on throwaway databases of ours.
// A box: startApp({ db, env }) -> { url, stop }, dbUri(name) to fill or read a database from outside,
// insideDbUri(name) for the app's own tests, exec(args, { env, timeoutMs }) -> { code, output }, stop().
import { spawn } from "node:child_process";
import { appEnv, linkPackages, startApp } from "./app-runner.js";
import { openSandbox } from "./sandbox.js";

/** Another database on the same MongoDB server as uri: "mongodb://h/verify_x" + "tests" -> ".../verify_x_tests". */
function sibling(uri, suffix) {
  const url = new URL(uri);
  url.pathname = `${url.pathname}_${suffix}`;
  return url.toString();
}

async function dropDatabase(uri) {
  const { default: mongoose } = await import("mongoose");
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    await conn.dropDatabase();
  } finally {
    await conn.close();
  }
}

/** A process box: the app in appDir on mongoUri ("app") and named siblings of it; they are dropped at stop(). */
function processBox({ appDir, mongoUri, databases = {} }) {
  const apps = new Set();
  const used = new Set();
  let stopped = false;
  const dbUri = (db) => {
    const uri = db === "app" ? mongoUri : (databases[db] ?? sibling(mongoUri, db));
    used.add(uri);
    return uri;
  };
  return {
    dbUri,
    insideDbUri: dbUri,
    async startApp({ db = "app", env = {}, timeoutMs } = {}) {
      const app = await startApp({ appDir, mongoUri: dbUri(db), env, ...(timeoutMs && { timeoutMs }) });
      apps.add(app);
      return app;
    },
    async exec([command, ...args], { env = {}, timeoutMs = 90_000 } = {}) {
      await linkPackages(appDir);
      const child = spawn(command === "node" ? process.execPath : command, args, { cwd: appDir, env: appEnv(env), stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      let outOfTime = false;
      const timer = setTimeout(() => ((outOfTime = true), child.kill()), timeoutMs);
      const code = await new Promise((resolve) => child.once("close", resolve));
      clearTimeout(timer);
      return { code: outOfTime ? null : code, output };
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await Promise.all([...apps].map((app) => app.stop().catch(() => {})));
      await Promise.all([...used].map((uri) => dropDatabase(uri).catch(() => {})));
    },
  };
}

/**
 * Opens a box for the app in appDir. mongoUri (and databases: { tests: uri }) name the throwaway databases a
 * process box uses; a sandbox has its own database inside and ignores them. maxMs: the sandbox's time limit.
 */
export function openBox({ appDir, mongoUri, databases, maxMs }) {
  if (process.env.SANDBOX === "docker") return openSandbox({ appDir, ...(maxMs && { maxMs }) });
  return Promise.resolve(processBox({ appDir, mongoUri, databases }));
}
