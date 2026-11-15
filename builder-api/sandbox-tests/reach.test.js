// Step 33c: SANDBOX_REACH=network. The verifier service runs in a container itself (Compose), where the
// door's ports on this computer's loopback are out of reach. Instead it joins each sandbox's network for as
// long as the sandbox lives, and reaches the app and its database by the sandbox's name; there is no door.
// Here a small container plays the verifier. Needs Docker.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { buildSandboxImage, openSandbox, SANDBOX_IMAGE } from "../src/verify/sandbox.js";
import { wireApp } from "../src/wirer/index.js";
import { editDeleteSpec } from "../test/fixtures/specs.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "sandbox-reach");
const JOINER = `reach-test-${process.pid}`;

const docker = (args) =>
  new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.once("close", (code) => resolve({ code, out: out.trim() }));
  });
// From inside the joiner container: what an HTTP GET to url answers, or why it failed.
const fromJoiner = async (url) => (await docker(["exec", JOINER, "node", "-e", `fetch(${JSON.stringify(url)}).then(async (r) => console.log(r.status, await r.text()), (e) => console.log("failed", e.cause?.code ?? e.message))`])).out;

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await buildSandboxImage();
  await docker(["rm", "-f", JOINER]);
  assert.equal((await docker(["run", "-d", "--rm", "--name", JOINER, SANDBOX_IMAGE, "node", "-e", "setTimeout(() => {}, 600000)"])).code, 0);
});
after(async () => {
  await docker(["rm", "-f", JOINER]);
  await rm(OUT, { recursive: true, force: true });
});

describe("SANDBOX_REACH=network: the verifier joins the sandbox's network", () => {
  it("reaches the app by the sandbox's name, with no door; leaves the network when the sandbox stops", async () => {
    const appDir = path.join(OUT, "app");
    await writeBackend(appDir, { ...generateBackend(editDeleteSpec, { name: "reach" }), ...wireApp({ spec: editDeleteSpec, pages: [{ screenshot: 1, html: "<h1>Employees</h1>" }] }) });
    const box = await openSandbox({ appDir, reach: "network", join: JOINER });
    try {
      assert.equal(box.url, `http://${box.name}:3000`);
      assert.equal(box.dbUri("app"), `mongodb://${box.name}:27017/app?directConnection=true`);
      assert.equal((await docker(["inspect", `${box.name}-door`])).code, 1, "no door container");
      const app = await box.startApp();
      assert.equal(app.url, box.url);
      assert.match(await fromJoiner(`${box.url}/health`), /^200 \{"ok":true,"db":true\}/);
    } finally {
      await box.stop();
    }
    assert.match(await fromJoiner(`http://${box.name}:3000/health`), /^failed/);
    const { out } = await docker(["inspect", "-f", "{{json .NetworkSettings.Networks}}", JOINER]);
    assert.ok(!out.includes(box.name), "the joiner has left the sandbox's network");
    assert.equal((await docker(["network", "inspect", box.name])).code, 1, "the network is gone");
  });

  it("refuses network reach without a container to join", async () => {
    await assert.rejects(openSandbox({ appDir: OUT, reach: "network", join: "" }), /SANDBOX_REACH=network needs the container to join/);
  });
});
