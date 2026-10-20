// createZip: a small zip writer (no extra package) for "Download app". Checked by extracting the
// result with the operating system's own tar (Windows tar.exe and macOS tar both read zip files).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createZip } from "../src/zip.js";

const systemTar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

async function extract(zip) {
  const dir = await mkdtemp(path.join(tmpdir(), "zip-test-"));
  const file = path.join(dir, "app.zip");
  await writeFile(file, zip);
  const out = path.join(dir, "out");
  await import("node:fs/promises").then((fs) => fs.mkdir(out));
  const run = spawnSync(systemTar, ["-xf", file, "-C", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return { out, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("createZip", () => {
  it("makes a zip the operating system can open, with every file and folder intact", async () => {
    const binary = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const zip = createZip([
      { name: "package.json", data: '{ "name": "app" }\n' },
      { name: "backend/routes/employee.routes.js", data: "export const x = 1;\n".repeat(200) },
      { name: "frontend/screenshot-1.png", data: binary },
      { name: "README.md", data: "Stáff Diréctory · अंदर का कोड\n" },
      { name: "empty.txt", data: "" },
    ]);
    const { out, cleanup } = await extract(zip);
    try {
      assert.equal(await readFile(path.join(out, "package.json"), "utf8"), '{ "name": "app" }\n');
      assert.equal(await readFile(path.join(out, "backend/routes/employee.routes.js"), "utf8"), "export const x = 1;\n".repeat(200));
      assert.deepEqual(await readFile(path.join(out, "frontend/screenshot-1.png")), binary);
      assert.equal(await readFile(path.join(out, "README.md"), "utf8"), "Stáff Diréctory · अंदर का कोड\n");
      assert.equal(await readFile(path.join(out, "empty.txt"), "utf8"), "");
    } finally {
      await cleanup();
    }
  });

  it("compresses repetitive text", () => {
    const text = "export const x = 1;\n".repeat(500);
    assert.ok(createZip([{ name: "a.js", data: text }]).length < text.length / 5);
  });

  it("refuses names that could escape the folder they are extracted into", () => {
    for (const name of ["../evil.js", "/etc/passwd", "C:\\x.js", "a/../../b.js", ""]) {
      assert.throws(() => createZip([{ name, data: "x" }]), /unsafe file name/i, name);
    }
  });
});
