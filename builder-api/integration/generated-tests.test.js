// Integration: generate an app per spec and run ITS OWN tests (npm test inside the generated app).
// Needs TEST_MONGODB_URI; each app gets its own throwaway database next to it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { authSpec, catalogSpec, editDeleteSpec, loginOnlySpec, opsSpec, relationSpec } from "../test/fixtures/specs.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "apps"); // outside integration/: generated apps contain their own *.test.js
after(() => rm(OUT, { recursive: true, force: true }));
const withoutTestContext = ({ NODE_TEST_CONTEXT, ...env }) => env;

describe("generated apps pass their own tests", () => {
  for (const [name, spec] of Object.entries({ edit: editDeleteSpec, catalog: catalogSpec, relation: relationSpec, ops: opsSpec, login: loginOnlySpec, auth: authSpec })) {
    it(`${name}: the generated app's own tests pass`, async () => {
      const dir = path.join(OUT, name);
      await writeBackend(dir, generateBackend(spec, { name }));
      // TAP explicitly: the default output format differs between Node versions (Node 26 prints "ℹ fail 0").
      const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "tests/**/*.test.js"], {
        cwd: dir,
        encoding: "utf8",
        // Without NODE_TEST_CONTEXT: inherited from this runner, it makes the app's runner report to us silently.
        env: { ...withoutTestContext(process.env), MONGODB_URI_TEST: MONGODB_URI.replace(/\/[^/]*$/, `/apptest_${name}`) },
        timeout: 60_000,
      });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`.slice(-4000));
      assert.match(run.stdout, /# fail 0/);
    });
  }
});
