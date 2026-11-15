// Step 33a: the sandbox a generated app runs in. These are the settings each container gets; the attack
// tests (sandbox-tests/, with Docker) show they hold.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { doorArgs, sandboxArgs } from "../src/verify/sandbox.js";
import { tarOf, untarTo } from "../src/verify/tar.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

// The value after a flag ("--memory" -> "768m"), or every value of a repeated flag.
const valueOf = (args, flag) => args[args.indexOf(flag) + 1];
const valuesOf = (args, flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

describe("sandboxArgs: the container a generated app runs in", () => {
  const args = sandboxArgs({ name: "sb-abc", image: "andarkacode/sandbox", maxMs: 60_000 });

  it("is on its own network, which has no way out (the network is made --internal)", () => {
    assert.equal(valueOf(args, "--network"), "sb-abc");
    assert.ok(!args.some((a) => a === "-p" || a.startsWith("--publish")), "nothing of the app is published");
  });

  it("runs as a plain user with no capabilities and no way to gain any", () => {
    assert.equal(valueOf(args, "--user"), "1000:1000");
    assert.equal(valueOf(args, "--cap-drop"), "ALL");
    assert.equal(valueOf(args, "--security-opt"), "no-new-privileges");
  });

  it("has a read-only image; only small scratch spaces in memory are writable", () => {
    assert.ok(args.includes("--read-only"));
    const tmpfs = valuesOf(args, "--tmpfs");
    assert.deepEqual(tmpfs.map((t) => t.split(":")[0]).sort(), ["/app", "/data/db", "/tmp"]);
    for (const t of tmpfs) assert.match(t, /size=\d+m/, `${t} has a size`);
  });

  it("has limits: memory (no swap), CPU, processes, and time", () => {
    assert.equal(valueOf(args, "--memory"), "768m");
    assert.equal(valueOf(args, "--memory-swap"), "768m");
    assert.equal(valueOf(args, "--cpus"), "1");
    assert.equal(valueOf(args, "--pids-limit"), "256");
    assert.ok(valuesOf(args, "-e").includes("SANDBOX_MAX_MS=60000"));
  });

  it("sees none of our folders and none of our settings", () => {
    assert.ok(!args.some((a) => a === "-v" || a.startsWith("--volume") || a.startsWith("--mount")));
    assert.deepEqual(valuesOf(args, "-e"), ["SANDBOX_MAX_MS=60000"]);
    assert.ok(!args.includes("--env-file"));
  });

  it("reaps its processes (--init), is removed when it stops, and is labelled for clean-up", () => {
    assert.ok(args.includes("--init"));
    assert.ok(args.includes("--rm"));
    assert.ok(valuesOf(args, "--label").includes("andarkacode.sandbox=app"));
  });

  it("uses gVisor when SANDBOX_RUNTIME=runsc, and Docker's default runtime otherwise", () => {
    assert.ok(!args.includes("--runtime"));
    const gvisor = sandboxArgs({ name: "sb-abc", image: "andarkacode/sandbox", maxMs: 60_000, runtime: "runsc" });
    assert.equal(valueOf(gvisor, "--runtime"), "runsc");
  });

  it("the limits can be changed", () => {
    const big = sandboxArgs({ name: "sb-x", image: "i", maxMs: 1, memory: "1g", cpus: 2, pids: 512 });
    assert.equal(valueOf(big, "--memory"), "1g");
    assert.equal(valueOf(big, "--memory-swap"), "1g");
    assert.equal(valueOf(big, "--cpus"), "2");
    assert.equal(valueOf(big, "--pids-limit"), "512");
  });
});

describe("doorArgs: our small forwarder into the sandbox", () => {
  const args = doorArgs({ name: "sb-abc", image: "andarkacode/sandbox", maxMs: 60_000 });

  it("publishes the app and its database on this computer's loopback only, on ports Docker picks", () => {
    assert.deepEqual(valuesOf(args, "-p").sort(), ["127.0.0.1::27017", "127.0.0.1::3000"]);
  });

  it("runs our forwarder, not the app, as a plain user with no capabilities, read-only, with a time limit", () => {
    assert.deepEqual(args.slice(-4), ["node", "/runner/door.mjs", "sb-abc", "60000"]);
    assert.equal(valueOf(args, "--user"), "1000:1000");
    assert.equal(valueOf(args, "--cap-drop"), "ALL");
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("--rm"));
    assert.ok(valuesOf(args, "--label").includes("andarkacode.sandbox=door"));
  });
});

// A tar reader for the test: [{ name, size, body }].
function untar(buffer) {
  const files = [];
  for (let at = 0; at + 512 <= buffer.length; ) {
    const header = buffer.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const text = (from, length) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    const size = parseInt(text(124, 12).trim() || "0", 8);
    const sum = header.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
    assert.equal(parseInt(text(148, 8).trim(), 8), sum, `${name}: checksum`);
    assert.equal(text(257, 6), "ustar");
    files.push({ name, type: text(156, 1), size, body: buffer.subarray(at + 512, at + 512 + size).toString("utf8") });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

describe("tarOf: the app's files, packed to copy into the sandbox", () => {
  let dir;
  after(() => dir && rm(dir, { recursive: true, force: true }));

  it("packs every file with its folders, leaves out node_modules, and handles long names", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tar-"));
    const long = `backend/${"a".repeat(60)}/${"b".repeat(60)}.js`;
    await mkdir(path.join(dir, "backend/custom"), { recursive: true });
    await mkdir(path.join(dir, path.dirname(long)), { recursive: true });
    await mkdir(path.join(dir, "node_modules/express"), { recursive: true });
    await writeFile(path.join(dir, "package.json"), '{"name":"x"}');
    await writeFile(path.join(dir, "backend/custom/raise.js"), "export default async function () {}\n");
    await writeFile(path.join(dir, long), "x".repeat(1300));
    await writeFile(path.join(dir, "node_modules/express/index.js"), "nope");

    const files = untar(await tarOf(dir));
    const byName = Object.fromEntries(files.map((f) => [f.name, f]));
    assert.equal(byName["package.json"].body, '{"name":"x"}');
    assert.equal(byName["backend/custom/raise.js"].body, "export default async function () {}\n");
    assert.equal(byName[long].size, 1300);
    assert.equal(byName[long].body, "x".repeat(1300));
    assert.equal(byName["backend/"].type, "5", "folders come first, as folders");
    assert.ok(files.findIndex((f) => f.name === "backend/") < files.findIndex((f) => f.name === "backend/custom/raise.js"));
    assert.ok(!files.some((f) => f.name.startsWith("node_modules")));
  });

  it("untarTo unpacks it again (the preview service gets the app's files only this way, Step 34a)", async () => {
    const copy = await mkdtemp(path.join(tmpdir(), "untar-"));
    try {
      await untarTo(await tarOf(dir), copy);
      assert.equal(await readFile(path.join(copy, "package.json"), "utf8"), '{"name":"x"}');
      assert.equal(await readFile(path.join(copy, "backend/custom/raise.js"), "utf8"), "export default async function () {}\n");
      assert.equal((await readFile(path.join(copy, `backend/${"a".repeat(60)}/${"b".repeat(60)}.js`), "utf8")).length, 1300);
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });

  it("untarTo refuses a name that would leave its folder", async () => {
    const evil = Buffer.concat([await tarOf(dir)]);
    evil.write("../escape.js".padEnd(100, "\0"), 0, 100, "utf8"); // the first entry's name
    // the header's checksum no longer matches: refused for that, or for the name
    await assert.rejects(untarTo(evil, path.join(tmpdir(), "untar-evil")), /outside|checksum/);
  });
});

describe("the sandbox image's packages", () => {
  it("are exactly the versions the Builder API runs generated apps with (Express, Mongoose)", async () => {
    const pins = JSON.parse(await readFile(path.join(ROOT, "deploy/sandbox/package.json"), "utf8")).dependencies;
    const lock = JSON.parse(await readFile(path.join(ROOT, "builder-api/package-lock.json"), "utf8")).packages;
    assert.deepEqual(Object.keys(pins).sort(), ["express", "mongoose"]);
    for (const [name, version] of Object.entries(pins)) assert.equal(version, lock[`node_modules/${name}`].version, name);
  });
});
