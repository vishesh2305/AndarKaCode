// Step 31b: what each slot can be set to, from the workspace's saved keys and the verified-models list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slotChoices } from "../src/keys.js";

const models = [
  { provider: "gemini", model: "gemini-3.5-flash", slots: ["frontend", "backend"], verified: "2026-11-01" },
  { provider: "anthropic", model: "claude-sonnet-5-5", slots: ["frontend", "backend"], verified: null },
  { provider: "anthropic", model: "claude-haiku-5-5", slots: ["backend"], verified: null },
];
const keys = [
  { id: "k1", provider: "anthropic", label: "Work", lastFour: "a1b2" },
  { id: "k2", provider: "openai", label: null, lastFour: "zz99" },
];

describe("slotChoices", () => {
  it("offers each saved key with each listed model of its provider for that slot", () => {
    assert.deepEqual(slotChoices(models, keys, "frontend"), [{ value: "k1|claude-sonnet-5-5", label: "Work (…a1b2): claude-sonnet-5-5, not yet verified" }]);
    assert.deepEqual(
      slotChoices(models, keys, "backend").map((c) => c.value),
      ["k1|claude-sonnet-5-5", "k1|claude-haiku-5-5"]
    );
  });

  it("a key whose provider has no listed model offers nothing", () => {
    assert.deepEqual(slotChoices(models, [keys[1]], "frontend"), []);
  });

  it("a verified model says so, and a key without a label shows its provider", () => {
    const [choice] = slotChoices(models, [{ id: "k3", provider: "gemini", label: "", lastFour: "1234" }], "frontend");
    assert.equal(choice.label, "gemini (…1234): gemini-3.5-flash, verified");
  });
});
