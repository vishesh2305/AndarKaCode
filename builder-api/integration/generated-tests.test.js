// Integration: generate an app per spec and run ITS OWN tests (npm test inside the generated app).
// Needs TEST_MONGODB_URI; each app gets its own throwaway database next to it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { catalogSpec, editDeleteSpec, opsSpec, relationSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), ".generated", "apps");
after(() => rm(OUT, { recursive: true, force: true }));

describe("generated apps pass their own tests", () => {
  for (const [name, spec] of Object.entries({ edit: editDeleteSpec, catalog: catalogSpec, relation: relationSpec, ops: opsSpec })) {
    it(`${name}: node --test tests/ passes`, async () => {
      const dir = path.join(OUT, name);
      await writeBackend(dir, generateBackend(spec, { name }));
      const run = spawnSync(process.execPath, ["--test", "tests/"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, MONGODB_URI_TEST: MONGODB_URI.replace(/\/[^/]*$/, `/apptest_${name}`) },
        timeout: 60_000,
      });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`.slice(-4000));
      assert.match(run.stdout, /# fail 0/);
    });
  }
});
