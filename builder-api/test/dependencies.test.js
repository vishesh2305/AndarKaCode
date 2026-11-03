// Step 24: in a container the Builder API is installed without development packages (npm ci --omit=dev).
// Every package the running code imports must therefore be a real dependency; jsdom was only a
// development package although the Check (src/verify) uses it, so every Check would have crashed there.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(API_DIR, "package.json"), "utf8"));

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (/\.(m?js)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// The packages a file imports: bare names (not "./x", not "node:x"), scope kept (@scope/name).
function packagesIn(code) {
  const names = new Set();
  for (const [, spec] of code.matchAll(/(?:^|\s)(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm)) {
    if (!spec || spec.startsWith(".") || spec.startsWith("node:") || spec.startsWith("/")) continue;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (!builtinModules.includes(name)) names.add(name);
  }
  return names;
}

describe("dependencies: what the running Builder API needs is installed in production", () => {
  it("every package imported under src/ (and shared/) is in dependencies, not only devDependencies", async () => {
    const files = [...(await sourceFiles(path.join(API_DIR, "src"))), ...(await sourceFiles(path.join(API_DIR, "../shared")))];
    const missing = [];
    for (const file of files) {
      for (const name of packagesIn(await readFile(file, "utf8"))) {
        if (!pkg.dependencies?.[name]) missing.push(`${path.relative(API_DIR, file)} imports "${name}"`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
