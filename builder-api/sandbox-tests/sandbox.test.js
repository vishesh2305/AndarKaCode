// Step 33a: a generated app in its sandbox, with Docker. The app works as before (its API, its pages, its
// own tests, on a database inside the sandbox), and the attacks a hostile app could try are blocked: the
// internet, our computer and our MongoDB, other sandboxes, our settings, its own code, our files, and
// running away with memory, processes or time. Each attack runs as the app's own user, inside its sandbox,
// as if the app's code had got past the safety check (custom/safety.js) that comes first.
// Needs Docker. Builds the andarkacode/sandbox image first (cached after the first time).
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { buildSandboxImage, openSandbox } from "../src/verify/sandbox.js";
import { wireApp } from "../src/wirer/index.js";
import { editDeleteSpec } from "../test/fixtures/specs.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "sandbox");
const page = (title) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const SECRET = `test-secret-${Math.random().toString(36).slice(2)}`;

async function writeApp(name) {
  const dir = path.join(OUT, name);
  await writeBackend(dir, { ...generateBackend(editDeleteSpec, { name }), ...wireApp({ spec: editDeleteSpec, pages: [{ screenshot: 1, html: page("Employees") }] }) });
  return dir;
}

// Runs a piece of Node in the sandbox as the app's user; resolves to what it printed.
const attack = async (box, code, options) => {
  const { code: exit, output } = await box.exec(["node", "-e", code], options);
  return { exit, output: output.trim() };
};

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await buildSandboxImage();
});
after(() => rm(OUT, { recursive: true, force: true }));

describe("a generated app in its sandbox works as before", () => {
  let box;
  let app;
  before(async () => {
    process.env.GEMINI_API_KEY = SECRET; // a setting of ours that must not reach the sandbox
    box = await openSandbox({ appDir: await writeApp("works") });
    app = await box.startApp({ env: { ADMIN_EMAIL: "a@example.com", ADMIN_PASSWORD: "throwaway-1", GEMINI_API_KEY: SECRET } });
  });
  after(async () => {
    delete process.env.GEMINI_API_KEY;
    await box?.stop();
  });

  it("answers through the door on this computer's loopback, with its database inside the sandbox", async () => {
    assert.equal(new URL(app.url).hostname, "127.0.0.1");
    assert.deepEqual(await (await fetch(`${app.url}/health`)).json(), { ok: true, db: true });
    assert.deepEqual((await (await fetch(`${app.url}/api/employees`)).json()).items, []);
    assert.match(await (await fetch(`${app.url}/page-1.html`)).text(), /<script src="app\.js"><\/script>/);
  });

  it("its database can be filled and read from outside, through the door (the Verifier and the preview do)", async () => {
    const conn = await mongoose.createConnection(box.dbUri("app")).asPromise();
    try {
      await conn.collection("employees").insertOne({ name: "Asha", createdAt: new Date(), updatedAt: new Date() });
    } finally {
      await conn.close();
    }
    const { items } = await (await fetch(`${app.url}/api/employees`)).json();
    assert.deepEqual(items.map((e) => e.name), ["Asha"]);
  });

  it("the app's own tests pass inside the sandbox, on another database there", async () => {
    await app.stop();
    const { code, output } = await box.exec(["node", "--test", "--test-reporter=tap", "tests/**/*.test.js"], { env: { MONGODB_URI_TEST: box.insideDbUri("tests") }, timeoutMs: 120_000 });
    assert.equal(code, 0, output.slice(-1500));
    assert.match(output, /^# pass [1-9]/m);
  });

  it("can be started again after it stopped (the port inside is free again)", async () => {
    app = await box.startApp();
    assert.equal((await fetch(`${app.url}/health`)).status, 200);
  });
});

describe("attacks from inside the sandbox are blocked", () => {
  let box;
  let other;
  before(async () => {
    process.env.GEMINI_API_KEY = SECRET;
    [box, other] = await Promise.all([openSandbox({ appDir: await writeApp("attacker") }), openSandbox({ appDir: await writeApp("victim") })]);
    await other.startApp();
  });
  after(async () => {
    delete process.env.GEMINI_API_KEY;
    await Promise.all([box?.stop(), other?.stop()]);
  });

  it("no internet: no address answers, and no name is looked up", async () => {
    const { output } = await attack(box, `
      const net = require("node:net"), dns = require("node:dns");
      const tryConnect = (port, host) => new Promise((r) => net.connect({ port, host, timeout: 3000 }).on("connect", () => r("REACHED " + host)).on("error", (e) => r("blocked " + e.code)).on("timeout", () => r("blocked timeout")));
      Promise.all([tryConnect(443, "1.1.1.1"), tryConnect(53, "8.8.8.8"), new Promise((r) => dns.lookup("example.com", (e) => r(e ? "blocked " + e.code : "RESOLVED")))]).then((rs) => console.log(rs.join("\\n")));`);
    assert.doesNotMatch(output, /REACHED|RESOLVED/, output);
    assert.equal(output.split("\n").length, 3);
  });

  it("can't reach this computer, Docker's gateway or our MongoDB", async () => {
    const { output } = await attack(box, `
      const net = require("node:net"), fs = require("node:fs");
      const gateway = fs.readFileSync("/proc/net/route", "utf8").split("\\n").slice(1).map((l) => l.split("\\t")).find((c) => c[1] === "00000000");
      const hosts = ["host.docker.internal", "gateway.docker.internal", "172.17.0.1", "192.168.65.254"];
      if (gateway) hosts.push(gateway[2].match(/../g).reverse().map((h) => parseInt(h, 16)).join("."));
      const tryConnect = (port, host) => new Promise((r) => net.connect({ port, host, timeout: 3000 }).on("connect", () => r("REACHED " + host + ":" + port)).on("error", (e) => r("blocked " + e.code)).on("timeout", () => r("blocked timeout")));
      Promise.all(hosts.flatMap((h) => [tryConnect(27017, h), tryConnect(4000, h), tryConnect(8787, h)])).then((rs) => console.log(rs.join("\\n")));`);
    assert.doesNotMatch(output, /REACHED/, output);
  });

  it("can't reach another app's sandbox", async () => {
    const { output } = await attack(box, `
      const net = require("node:net");
      const tryConnect = (port, host) => new Promise((r) => net.connect({ port, host, timeout: 3000 }).on("connect", () => r("REACHED")).on("error", (e) => r("blocked " + e.code)).on("timeout", () => r("blocked timeout")));
      Promise.all([tryConnect(3000, ${JSON.stringify(other.name)}), tryConnect(27017, ${JSON.stringify(other.name)}), tryConnect(3000, ${JSON.stringify(other.name + "-door")})]).then((rs) => console.log(rs.join("\\n")));`);
    assert.doesNotMatch(output, /REACHED/, output);
  });

  it("none of our settings or keys are inside", async () => {
    const { output } = await attack(box, `console.log(JSON.stringify(process.env))`);
    const env = JSON.parse(output);
    assert.ok(!Object.values(env).includes(SECRET), "our key is not there");
    for (const name of Object.keys(env)) assert.doesNotMatch(name, /KEY|SECRET|TOKEN|PASSWORD|MONGODB|GATEWAY|AUTH/i, name);
  });

  it("runs as a plain user with no capabilities", async () => {
    const { output } = await attack(box, `console.log(process.getuid(), require("node:fs").readFileSync("/proc/self/status", "utf8").match(/^CapEff:\\s*(\\w+)/m)[1])`);
    assert.equal(output, "1000 0000000000000000");
  });

  it("can't change its own code or the image; only its scratch space takes writes", async () => {
    const { output } = await attack(box, `
      const fs = require("node:fs");
      const tryWrite = (file) => { try { fs.writeFileSync(file, "x"); return "WROTE " + file; } catch (e) { return "blocked " + e.code; } };
      console.log([tryWrite("/app/backend/server.js"), tryWrite("/app/new.js"), tryWrite("/usr/local/bin/node"), tryWrite("/etc/x"), tryWrite("/node_modules/express/index.js"), tryWrite("/tmp/ok") === "WROTE /tmp/ok" ? "tmp ok" : "TMP FAILED"].join("\\n"));`);
    assert.doesNotMatch(output, /WROTE|TMP FAILED/, output);
    assert.match(output, /tmp ok/);
  });

  it("sees only its own app: none of our folders are mounted", async () => {
    const { output } = await attack(box, `
      const fs = require("node:fs");
      console.log(JSON.stringify({ app: fs.readdirSync("/app").sort(), mounts: fs.readFileSync("/proc/mounts", "utf8") }));`);
    const { app, mounts } = JSON.parse(output);
    assert.ok(app.includes("backend") && app.includes("package.json"), app.join(", "));
    assert.ok(!app.includes("node_modules"), "the packages come from the image, not from us");
    assert.doesNotMatch(mounts, /\b(9p|virtiofs|grpcfuse|fakeowner|fuse\.)\b|\/run\/desktop\/mnt\/host|\/Users\/|[A-Za-z]:\\\\/, "no folder of this computer is mounted");
  });

  it("can't start hundreds of processes", async () => {
    const { output } = await attack(
      box,
      `
      const { spawn } = require("node:child_process");
      let started = 0, refused = 0;
      for (let i = 0; i < 400; i++) { try { const c = spawn("sleep", ["20"]); c.on("error", () => refused++); started++; } catch { refused++; } }
      setTimeout(() => { console.log(refused > 0 ? "limited" : "ALL " + started + " STARTED"); process.exit(0); }, 3000);`,
      { timeoutMs: 30_000 }
    );
    assert.equal(output, "limited");
  });

  it("can't take more memory than its limit: the process is stopped, the sandbox carries on", async () => {
    const { exit, output } = await attack(box, `const keep = []; for (let i = 0; i < 40; i++) { keep.push(Buffer.alloc(64 * 1024 * 1024, 1)); } console.log("GOT 2.5 GB");`, { timeoutMs: 60_000 });
    assert.doesNotMatch(output, /GOT/);
    assert.notEqual(exit, 0);
    const { output: still } = await attack(box, `console.log("still here")`);
    assert.equal(still, "still here");
  });

  it("uses gVisor when SANDBOX_RUNTIME=runsc", { skip: process.env.SANDBOX_RUNTIME !== "runsc" && "SANDBOX_RUNTIME is not runsc on this computer" }, async () => {
    const { output } = await box.exec(["dmesg"]);
    assert.match(output, /gVisor/);
  });
});

describe("the sandbox ends", () => {
  it("by itself at its time limit: the app stops answering and its containers are gone", async () => {
    const box = await openSandbox({ appDir: await writeApp("timed"), maxMs: 6000 });
    try {
      const app = await box.startApp();
      assert.equal((await fetch(`${app.url}/health`)).status, 200);
      await new Promise((r) => setTimeout(r, 9000));
      await assert.rejects(fetch(`${app.url}/health`, { signal: AbortSignal.timeout(3000) }));
      assert.equal(await box.running(), false);
    } finally {
      await box.stop();
    }
  });

  it("when stopped: its containers and its network are removed", async () => {
    const box = await openSandbox({ appDir: await writeApp("stopped") });
    const app = await box.startApp();
    await box.stop();
    await assert.rejects(fetch(`${app.url}/health`, { signal: AbortSignal.timeout(3000) }));
    assert.equal(await box.running(), false);
    await box.stop(); // a second time is fine
  });
});
