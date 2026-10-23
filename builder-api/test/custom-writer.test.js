// Step 13: the writer asks the coding AI for one custom button's code, checks it, tests it, and repairs it.
// The AI and the one-press test are fakes here; integration/custom-writer.test.js uses a real generated app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { providerOrder, writeCustomCode } from "../src/custom/writer.js";
import { opsSpec } from "./fixtures/specs.js";

const op = opsSpec.operations.find((o) => o.name === "recalculateLeaveRequest");
const fn = (body) => "```js\nexport default async function ({ record, input, helpers }) {\n" + body + "\n}\n```";
const GOOD = fn("  await helpers.update(record.id, { days: 1 });\n  return { message: \"Done\" };");
const UNSAFE = fn("  process.exit(1);");

// A fake AI: answers from a list per provider, and remembers every prompt it got.
function fakeAI(answers) {
  const prompts = [];
  const providers = {};
  for (const [name, list] of Object.entries(answers)) {
    providers[name] = async (prompt) => {
      prompts.push({ provider: name, prompt });
      const next = list.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`${name} has no more answers`);
      return next;
    };
  }
  return { providers, prompts };
}

// A fake press: the code works when it contains "days: 1", otherwise it answers 500.
const fakeTest = (calls = []) => async (code) => {
  calls.push(code);
  return code.includes("days: 1") ? null : 'pressing "Recalculate" answered 500: custom code failed: boom';
};

describe("providerOrder: which coding AI is asked, from the project's mode", () => {
  it("local -> only the local model; cloud -> only Gemini; auto -> Gemini first, local as backup", () => {
    assert.deepEqual(providerOrder("local"), ["local"]);
    assert.deepEqual(providerOrder("cloud"), ["cloud"]);
    assert.deepEqual(providerOrder("auto"), ["cloud", "local"]);
  });
});

describe("writeCustomCode", () => {
  it("keeps the first answer when it is safe and the press works", async () => {
    const ai = fakeAI({ local: [GOOD] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "local", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "local");
    assert.equal(result.answers, 1);
    assert.match(result.code, /^export default async function/);
    assert.doesNotMatch(result.code, /```/);
  });

  it("never presses unsafe code: the safety problem goes into the repair request", async () => {
    const ai = fakeAI({ local: [UNSAFE, GOOD] });
    const pressed = [];
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "local", providers: ai.providers, test: fakeTest(pressed) });
    assert.equal(result.ok, true);
    assert.equal(result.answers, 2);
    assert.equal(pressed.length, 1, "only the safe answer was pressed");
    assert.match(ai.prompts[1].prompt, /the safety check refused it: .*process/);
    assert.match(ai.prompts[1].prompt, /process\.exit\(1\)/, "the repair request shows the earlier code");
  });

  it("puts what went wrong when pressing into the repair request", async () => {
    const ai = fakeAI({ local: [fn("  throw new Error('boom');"), GOOD] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "local", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, true);
    assert.match(ai.prompts[1].prompt, /answered 500: custom code failed: boom/);
  });

  it("says so when an answer has no code", async () => {
    const ai = fakeAI({ local: ["Sorry, I can't.", GOOD] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "local", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, true);
    assert.match(ai.prompts[1].prompt, /the answer had no code/);
  });

  it("gives up after the first answer and 3 repairs, with the last problem", async () => {
    const ai = fakeAI({ local: [UNSAFE, UNSAFE, UNSAFE, UNSAFE, GOOD] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "local", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, false);
    assert.equal(result.answers, 4);
    assert.match(result.problem, /safety check refused it/);
    assert.equal(result.code, undefined);
  });

  it("auto: uses the local model when Gemini is busy, and remembers why", async () => {
    const ai = fakeAI({ cloud: [new Error("Gemini 503: high demand")], local: [GOOD] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "auto", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "local");
    assert.deepEqual(result.unavailable, ["cloud: Gemini 503: high demand"]);
  });

  it("auto: tries the local model when none of Gemini's answers work", async () => {
    const ai = fakeAI({ cloud: [UNSAFE, UNSAFE, UNSAFE, UNSAFE], local: [GOOD] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "auto", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "local");
    assert.equal(result.answers, 5);
  });

  it("a model that stops answering midway ends that model's tries", async () => {
    const ai = fakeAI({ local: [UNSAFE, new Error("Ollama 500: out of memory")] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "local", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, false);
    assert.equal(result.answers, 1);
    assert.match(result.problem, /safety check refused it/);
    assert.deepEqual(result.unavailable, ["local: Ollama 500: out of memory"]);
  });

  it("when no model answers at all, the problem says why", async () => {
    const ai = fakeAI({ cloud: [new Error("The cloud coding model needs GEMINI_API_KEY")] });
    const result = await writeCustomCode({ spec: opsSpec, op, mode: "cloud", providers: ai.providers, test: fakeTest() });
    assert.equal(result.ok, false);
    assert.equal(result.answers, 0);
    assert.match(result.problem, /no coding AI answered: cloud: The cloud coding model needs GEMINI_API_KEY/);
  });
});
