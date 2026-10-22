// Step 13: the safety check for AI-written button code, before it is ever run. The code is read as a
// structure (acorn): one async function as the default export, using only its helpers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCustomCode } from "../src/custom/safety.js";
import { GOOD } from "./fixtures/custom-code.js";

const problems = (code) => checkCustomCode(code).problems.join("\n");

describe("checkCustomCode: what passes", () => {
  for (const [name, code] of Object.entries(GOOD)) {
    it(`a good function passes: ${name}`, () => {
      assert.deepEqual(checkCustomCode(code), { ok: true, problems: [] });
    });
  }
});

describe("checkCustomCode: what is refused, in plain words with the line", () => {
  const wrap = (body) => `export default async function ({ record, input, helpers }) {\n  ${body}\n}`;
  const cases = [
    ["an import", `import fs from "node:fs";\n${wrap("return {};")}`, /import/],
    ["require", wrap('const fs = require("fs"); return {};'), /"require" is not allowed/],
    ["a dynamic import", wrap('const m = await import("fs"); return {};'), /import/],
    ["process", wrap("return { message: process.env.SECRET };"), /"process" is not allowed/],
    ["globalThis", wrap("return { message: String(globalThis) };"), /"globalThis" is not allowed/],
    ["eval", wrap('return eval("1");'), /"eval" is not allowed/],
    ["new Function", wrap('return new Function("return 1")();'), /"Function" is not allowed/],
    ["a .constructor escape", wrap('return helpers.update.constructor("return process")();'), /"constructor" is not allowed/],
    ["a ['constructor'] escape", wrap('return helpers["constructor"];'), /"constructor" is not allowed/],
    ["a computed property with a name", wrap("const k = 'constructor'; return helpers[k];"), /dot notation/],
    ["__proto__", wrap("return { a: record.__proto__ };"), /"__proto__" is not allowed/],
    ["Reflect", wrap("return Reflect.ownKeys(helpers);"), /"Reflect" is not allowed/],
    ["a timer", wrap("setTimeout(() => {}, 10); return {};"), /"setTimeout" is not allowed/],
    ["fetch", wrap('await fetch("http://example.com"); return {};'), /"fetch" is not allowed/],
    ["a while loop", wrap("while (true) {} return {};"), /while/],
    ["a classic for loop", wrap("for (;;) {} return {};"), /for \(;;\)/],
    ["for...in", wrap("for (const k in record) {} return {};"), /for \.\.\. in/],
    ["this", wrap("return { a: this };"), /"this" is not allowed/],
    ["code outside the function", `const x = 1;\n${wrap("return {};")}`, /only one thing: export default async function/],
    ["a named export", "export async function run() { return {}; }", /only one thing: export default async function/],
    ["a function that is not async", "export default function ({ helpers }) { return {}; }", /async/],
  ];
  for (const [name, code, pattern] of cases) {
    it(`refuses ${name}`, () => {
      const result = checkCustomCode(code);
      assert.equal(result.ok, false);
      assert.match(problems(code), pattern);
    });
  }

  it("says which line, and explains a syntax error", () => {
    assert.match(problems(wrap("const fs = require('fs'); return {};")), /^line 2: /);
    assert.match(problems("export default async function ({ helpers }) { return {; }"), /could not be read: .*line 1/);
  });

  it("refuses code that is too long", () => {
    assert.match(problems(wrap(`return { message: "${"x".repeat(9000)}" };`)), /too long/);
  });
});
