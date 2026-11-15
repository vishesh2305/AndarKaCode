// Step 33a: a generated app in a sandbox. Each sandbox is a container (gVisor with SANDBOX_RUNTIME=runsc):
//   - on its own Docker network made --internal: no internet, not this computer, not other sandboxes;
//   - a plain user with no capabilities, a read-only image, small scratch spaces in memory;
//   - memory (no swap), CPU, process and time limits;
//   - none of our folders or settings: the app's files are copied in, read-only for the app;
//   - its own MongoDB inside (keeper.mjs), so the app needs no network at all.
// Our door (door.mjs, a second small container) forwards our connections to the app and its database,
// published on this computer's loopback only. The Verifier, the button tester and the live preview use the
// app through it as before: box.startApp() -> { url }, box.dbUri(name) to fill or read its database.
// Step 33c: SANDBOX_REACH=network, for a verifier that runs in a container itself (Compose): no door; the
// verifier's container (SANDBOX_JOIN, by default its hostname) joins the sandbox's network while it lives.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appEnv } from "./app-runner.js";
import { tarOf } from "./tar.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SANDBOX_IMAGE = "andarkacode/sandbox";
const APP_PORT = 3000;
const DB_PORT = 27017;
const START_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_MS = 30 * 60_000;
// Stops the app inside when it did not stop on its own (the image has no pkill): finds it in /proc.
const KILL_APP = `const fs = require("node:fs"); for (const p of fs.readdirSync("/proc")) { try { if (Number(p) !== process.pid && fs.readFileSync("/proc/" + p + "/cmdline", "utf8").split("\\0")[1] === "/runner/run-app.mjs") process.kill(Number(p)); } catch {} }`;

// What both containers get: removed when they stop, an init that reaps processes, a read-only image,
// no capabilities and no way to gain any, a plain user.
const LOCKED = ["--rm", "--init", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "1000:1000"];

/** `docker run` arguments for the app's container. */
export function sandboxArgs({ name, image, maxMs, runtime = null, memory = "768m", cpus = 1, pids = 256 }) {
  return [
    "run", "-d", "--name", name, "--network", name, "--label", "andarkacode.sandbox=app", ...LOCKED,
    "--tmpfs", "/app:rw,size=64m,mode=755", // the app's files: written by root once, read-only for the app
    "--tmpfs", "/data/db:rw,size=512m,uid=1000,gid=1000,mode=700", // its database
    "--tmpfs", "/tmp:rw,size=64m,mode=1777",
    "--memory", memory, "--memory-swap", memory, "--cpus", String(cpus), "--pids-limit", String(pids),
    ...(runtime ? ["--runtime", runtime] : []),
    "-e", `SANDBOX_MAX_MS=${maxMs}`,
    image,
  ];
}

/** `docker run` arguments for the door: on Docker's normal network, published on loopback only. */
export function doorArgs({ name, image, maxMs }) {
  return [
    "run", "-d", "--name", `${name}-door`, "--label", "andarkacode.sandbox=door", ...LOCKED,
    "--memory", "64m", "--pids-limit", "32",
    "-p", `127.0.0.1::${APP_PORT}`, "-p", `127.0.0.1::${DB_PORT}`,
    image, "node", "/runner/door.mjs", name, String(maxMs),
  ];
}

/** Runs docker; resolves { code, stdout, stderr } (code null when it took longer than timeoutMs). */
function docker(args, { input = null, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), child.kill()), timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new Error("Docker is not installed: the sandbox (SANDBOX=docker) needs it") : err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr });
    });
    if (input) child.stdin.on("error", () => {}).end(input);
  });
}

async function must(args, options) {
  const { code, stdout, stderr } = await docker(args, options);
  if (code === 0) return stdout.trim();
  const why = (stderr || stdout).trim().split("\n").filter(Boolean).pop() ?? `exit code ${code}`;
  if (/Cannot connect to the Docker daemon|dockerDesktopLinuxEngine|error during connect/i.test(why)) throw new Error("Docker is not running: start Docker (the sandbox, SANDBOX=docker, needs it)");
  throw new Error(`docker ${args[0]}: ${why}`);
}

/** Builds the sandbox image from deploy/sandbox/Dockerfile (Docker's cache makes a second build quick). */
// SANDBOX_CONTEXT: in the Builder API's own image (Compose), just the files the sandbox image needs.
export async function buildSandboxImage({ image = SANDBOX_IMAGE, context = process.env.SANDBOX_CONTEXT || ROOT } = {}) {
  await must(["build", "-q", "-t", image, "-f", path.join(context, "deploy", "sandbox", "Dockerfile"), context], { timeoutMs: 20 * 60_000 });
}

const open = new Set();
export const openSandboxes = () => [...open];

// If the Builder API stops, its sandboxes go too.
process.once("exit", () => {
  for (const box of open) {
    spawnSync("docker", ["rm", "-f", box.name, `${box.name}-door`], { stdio: "ignore" });
    spawnSync("docker", ["network", "rm", box.name], { stdio: "ignore" });
  }
});

const hostPort = async (container, port) => (await must(["port", container, `${port}/tcp`])).split("\n")[0].trim(); // "127.0.0.1:49153"

/**
 * Opens a sandbox with the app in appDir copied in. Resolves to the box:
 *   url, dbUri(name), insideDbUri(name), startApp({ db, env }), exec(args, { env, timeoutMs }), running(), stop().
 */
export async function openSandbox({
  appDir,
  maxMs = DEFAULT_MAX_MS,
  runtime = process.env.SANDBOX_RUNTIME || null,
  reach = process.env.SANDBOX_REACH || "door",
  join = process.env.SANDBOX_JOIN ?? os.hostname(),
  image = SANDBOX_IMAGE,
  limits = {},
}) {
  if (reach === "network" && !join) throw new Error("SANDBOX_REACH=network needs the container to join (SANDBOX_JOIN, by default this container's hostname)");
  const name = `sb-${randomBytes(6).toString("hex")}`;
  const apps = new Set();
  let stopped = false;
  let appAddress = null;
  let dbAddress = null;

  const box = {
    name,
    get url() {
      return `http://${appAddress}`;
    },
    /** The database `name` in the sandbox, as we reach it (through the door). */
    dbUri: (db) => `mongodb://${dbAddress}/${db}?directConnection=true`,
    /** The same database as the app inside reaches it. */
    insideDbUri: (db) => `mongodb://127.0.0.1:${DB_PORT}/${db}`,

    /** Starts the app (one at a time) on database `db`. env: ADMIN_EMAIL / ADMIN_PASSWORD; nothing else of ours. */
    async startApp({ db = "app", env = {}, timeoutMs = START_TIMEOUT_MS } = {}) {
      const vars = { ...appEnv({ ...env, MONGODB_URI: box.insideDbUri(db) }, {}), PORT: String(APP_PORT), HOST: "0.0.0.0", EXIT_ON_STDIN_END: "1" };
      const child = spawn("docker", ["exec", "-i", "-u", "1000:1000", "-w", "/app", ...Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]), name, "node", "/runner/run-app.mjs", "/app"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.on("error", () => {});
      let errors = "";
      child.stderr.on("data", (chunk) => (errors = (errors + chunk).slice(-4000)));
      const exited = new Promise((resolve) => child.once("close", resolve));
      const app = { url: box.url, mongoUri: box.dbUri(db), child };
      app.stop = async () => {
        apps.delete(app);
        child.stdin.end(); // the app stops when its input closes
        const gone = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
        if (!gone) {
          child.kill();
          await docker(["exec", "-u", "1000:1000", name, "node", "-e", KILL_APP], { timeoutMs: 10_000 }).catch(() => {});
        }
      };
      await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => (child.kill(), reject(new Error(`The generated app did not start within ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (/READY \d+/.test(output)) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          const lines = errors.trim().split("\n");
          const why = lines.find((line) => /^\w*Error\b/.test(line.trim())) || lines.filter((line) => /error/i.test(line)).pop() || `exit code ${code}`;
          reject(new Error(`The generated app did not start: ${why.trim()}`));
        });
      });
      apps.add(app);
      return app;
    },

    /** Runs a command in /app as the app's user. Resolves { code, output }; code null when it ran out of time. */
    async exec(args, { env = {}, timeoutMs = 90_000 } = {}) {
      const vars = appEnv(env, {});
      const seconds = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
      // `timeout` inside: the command is stopped in the sandbox too, not only our docker client.
      const started = Date.now();
      const { code, stdout, stderr } = await docker(["exec", "-u", "1000:1000", "-w", "/app", ...Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]), name, "timeout", "-s", "KILL", seconds, ...args], {
        timeoutMs: timeoutMs + 15_000,
      });
      // 137 is a KILL: from `timeout` when the time is up, else from the memory limit.
      const outOfTime = code === null || (code === 137 && Date.now() - started >= timeoutMs - 1000);
      return { code: outOfTime ? null : code, output: stdout + stderr };
    },

    /** Is anything of this sandbox still running? */
    async running() {
      const { stdout } = await docker(["ps", "-q", "--filter", `name=^${name}(-door)?$`]);
      return stdout.trim() !== "";
    },

    /** Stops the app, removes both containers and the network. Safe to call twice. */
    async stop() {
      if (stopped) return;
      stopped = true;
      open.delete(box);
      clearTimeout(timer);
      for (const app of apps) app.child.kill();
      if (reach === "network") await docker(["network", "disconnect", "-f", name, join]).catch(() => {});
      await docker(["rm", "-f", name, `${name}-door`]).catch(() => {});
      await docker(["network", "rm", name]).catch(() => {});
    },
  };

  open.add(box);
  // Past its time limit the containers end themselves; this removes what is left (the network).
  const timer = setTimeout(() => box.stop().catch(() => {}), maxMs + 15_000);
  timer.unref();

  try {
    await must(["network", "create", "--internal", "--label", "andarkacode.sandbox=network", name]);
    await must(sandboxArgs({ name, image, maxMs, runtime, ...limits }));
    if (reach === "network") {
      await must(["network", "connect", name, join]);
    } else {
      await must(doorArgs({ name, image, maxMs }));
      await must(["network", "connect", name, `${name}-door`]);
    }
    if (appDir) await must(["exec", "-i", "-u", "0", name, "tar", "-x", "-f", "-", "-C", "/app", "--no-same-owner", "--no-same-permissions"], { input: await tarOf(appDir) });
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      const { stdout, stderr } = await docker(["logs", name]);
      if (stdout.includes("SANDBOX READY")) break;
      if (Date.now() > deadline || /database stopped/.test(stderr)) throw new Error(`The sandbox's database did not start: ${stderr.trim().split("\n").pop() ?? "no answer"}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    if (reach === "network") [appAddress, dbAddress] = [`${name}:${APP_PORT}`, `${name}:${DB_PORT}`];
    else [appAddress, dbAddress] = await Promise.all([hostPort(`${name}-door`, APP_PORT), hostPort(`${name}-door`, DB_PORT)]);
  } catch (err) {
    await box.stop();
    throw err;
  }
  return box;
}
