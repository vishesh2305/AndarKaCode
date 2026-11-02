// The cloud model when .env names none. Google retires model names (gemini-2.5-flash: 404 for new users on
// 1 Nov 2026), so every cloud call uses one stable default, checked to answer on that day.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

for (const name of ["GEMINI_MODEL", "GEMINI_PAGE_MODEL", "GEMINI_CODE_MODEL"]) delete process.env[name];
const { modelName } = await import("../src/ai/vision.js");
const { pageModelName } = await import("../src/ai/page.js");
const { codeModelName } = await import("../src/custom/model.js");

describe("the default Gemini model, when .env names none", () => {
  it("is gemini-3.5-flash for reading screenshots, building pages and writing custom buttons", () => {
    assert.equal(modelName.cloud, "gemini-3.5-flash");
    assert.equal(pageModelName.cloud, "gemini-3.5-flash");
    assert.equal(codeModelName.cloud, "gemini-3.5-flash");
  });
});
