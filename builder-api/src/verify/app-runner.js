// Starts generated apps in their own processes, for the Verifier and the live preview (Step 16).
// Each one: 127.0.0.1 only, a port it picks itself, its own database, the Builder API's installed
// packages through a node_modules link (no npm install), and no keys in its environment.
import { spawn } from "node:child_process";
import { lstat, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "run-app.mjs");
const PACKAGES = path.resolve(HERE, "../../node_modules");
const START_TIMEOUT_MS = 20_000;

// What Node needs to start on Windows and macOS; everything else (our keys, our database) stays out.
const FROM_SYSTEM = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
const FROM_US = new Set(["MONGODB_URI", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SESSION_HOURS"]);

/** The generated app's environment: a few system variables plus the app's own settings. */
export function appEnv(settings, system = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(system)) if (FROM_SYSTEM.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  for (const [key, value] of Object.entries(settings)) if (FROM_US.has(key) && value !== undefined) env[key] = String(value);
  return env;
}

/** Links appDir/node_modules to the Builder API's packages (Express, Mongoose). Safe to call twice. */
export async function linkPackages(appDir) {
  const link = path.join(appDir, "node_modules");
  const exists = await lstat(link).then(() => true, () => false);
  if (!exists) await symlink(PACKAGES, link, process.platform === "win32" ? "junction" : "dir");
}

const running = new Set();
export const runningApps = () => [...running];

async function dropDatabase(uri) {
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    await conn.dropDatabase();
  } finally {
    await conn.close();
  }
}

/**
 * Starts the generated app in appDir. env: ADMIN_EMAIL / ADMIN_PASSWORD for apps with a login.
 * Resolves to { appDir, url, mongoUri, stop({ dropDatabase }) } once the app answers.
 */
export async function startApp({ appDir, mongoUri, env = {}, timeoutMs = START_TIMEOUT_MS }) {
  await linkPackages(appDir);
  const child = spawn(process.execPath, [RUNNER, appDir], {
    cwd: appDir,
    env: appEnv({ ...env, MONGODB_URI: mongoUri }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => (errors = (errors + chunk).slice(-4000)));
  const exited = new Promise((resolve) => child.once("exit", resolve));

  const app = { appDir, mongoUri, url: null, child };
  app.stop = async ({ dropDatabase: drop = false } = {}) => {
    running.delete(app);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    if (drop) await dropDatabase(mongoUri);
  };

  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`The generated app did not start within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const ready = output.match(/READY (\d+)/);
      if (ready) {
        clearTimeout(timer);
        resolve(Number(ready[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      const lines = errors.trim().split("\n");
      const why = lines.find((line) => /^\w*Error\b/.test(line.trim())) || lines.filter((line) => /error/i.test(line)).pop() || `exit code ${code}`;
      reject(new Error(`The generated app did not start: ${why.trim()}`));
    });
  });

  app.url = `http://127.0.0.1:${port}`;
  running.add(app);
  return app;
}

/** Stops every app this process started (the Verifier calls it on errors; tests in after()). */
export const stopAll = () => Promise.all(runningApps().map((app) => app.stop()));

// If the Builder API itself stops, its apps stop too.
process.once("exit", () => {
  for (const app of running) app.child.kill();
});
