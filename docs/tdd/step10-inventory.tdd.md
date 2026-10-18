# TDD evidence: Step 10, UI inventory (screenshot → list of visible elements)

**Source plan:** no `*.plan.md`; journeys from [ARCHITECTURE.md](../../ARCHITECTURE.md) v3.1 §4.1 and [plan.md](../../plan.md) Step 10.
**Branch:** `step10-inventory` · **Runner:** `node:test` (`npm test`), Node v22.21.1 on Laptop B.
**Scope:** `shared/inventory.schema.json`, `builder-api/src/ai/vision.js`, `builder-api/src/spec/inventory.js`, the accuracy eval `builder-api/scripts/eval-inventory.mjs` with 7 mock screenshots in `samples/mocks/`, and two deriver bugs that the eval found. Connecting this to the orchestrator is the next piece.

## User journeys

1. Whatever the vision model returns, the deriver gets a complete, clean inventory (no missing parts, no long text, no duplicates).
2. Row buttons end up as row actions; "All …" filter options are dropped; a missing or invalid screen kind is worked out.
3. The reader tries local first and falls back to cloud in auto mode, reports every error, and never uses cloud in local mode.
4. On real screenshots, the model + deriver build exactly what each screen shows and nothing more.

## Task report

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | `ERR_MODULE_NOT_FOUND ... src/spec/inventory.js`; existing 28 pass. Commit `a839e58`. |
| GREEN | `npm test` | `# tests 45` · `# pass 45`. Commit `9d748b7`. |
| Vision client tests | `npm run test:coverage` | 6 tests with a fake `fetch`, written **after** the code (characterization): `# pass 51`; `vision.js` 34 % → 100 % lines. Commit `f787974`. |
| Real-model eval #1 | `npm run eval:inventory -- local` | **26/27**. Fail: "+ Add Product" became a `custom` operation instead of `create`. Inspection also showed the filter named `allCategories` instead of `category` (the check matched loosely, so it passed). **The model read both correctly; both were deriver bugs.** |
| RED (bugs) | `npm test` | 2 reproducer tests fail, 51 pass. Commit `132180c` (with mocks + eval). |
| GREEN (bugs) | `npm test` | `CREATE` regex no longer needs a word boundary after `+`; filter names drop "All " and become singular; `singular()` handles `-es`. `# pass 53`. Real-model m2: 7/7. Commit `9583e47`. |
| Real-model eval #2 | `npm run eval:inventory -- local` | **27/27**, 9–22 s per screenshot (warm model) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every missing part (top level, tables, columns, inputs) gets an empty default | `inventory.test.js` completeness (2) | unit | PASS |
| 2 | Labels trimmed, empty ones dropped; text capped at 80 chars (screenshot text reaches later prompts); ≤ 5 sample values as strings | cleaning (3) | unit | PASS |
| 3 | Duplicate row actions/buttons removed; "All …" filter options dropped; unknown input kinds/scopes → safe defaults | cleaning (3) | unit | PASS |
| 4 | Row-scoped buttons move into the first table's row actions, or stay page buttons without a table | row buttons (2) | unit | PASS |
| 5 | Valid kind kept; otherwise login / dashboard / list / form / other worked out | screen kind (2) | unit | PASS |
| 6 | Reader sends image, prompt ("only what is visible") and schema; returns normalized inventory and provider | `readInventory` | unit (fake model) | PASS |
| 7 | Auto: falls back to cloud on a local error or broken JSON; all errors reported; local mode never calls cloud | `readInventory` (4) | unit (fake model) | PASS |
| 8 | Exact Ollama request (model, image, schema as `format`, `think: false`, temperature 0); `thinking` fallback; error message | `vision.test.js` (3) | unit (fake fetch, after code) | PASS |
| 9 | Gemini key in a header (never in the URL), inline image, `responseJsonSchema`; retries 503; no retry on 429 | `vision.test.js` (3) | unit (fake fetch, after code) | PASS |
| 10 | "+ Add Product" → `create`, not an AI operation | `derive.test.js` bugs found with real screenshots | unit (reproducer) | PASS |
| 11 | "All categories" filter → `category` | same | unit (reproducer) | PASS |
| 12 | 6 mock screens (7 screenshots) → spec with exactly the expected parts, including 9 "must not" checks | `npm run eval:inventory -- local` | eval, real model | 27/27 |

## Coverage and known gaps

- `npm run test:coverage`: 53/53; `vision.js` 100 % lines / 73 % branches; `derive.js` 100 % / 87 %; `inventory.js` 100 % / 88 %; all files 98 % / 91 %.
- The eval used mock screenshots made by us (clean, simple). Real screenshots (icons without text, crowded dashboards, dark themes) are the next accuracy test; add them to `samples/` with a case in `eval-inventory.mjs`.
- Cloud eval (`-- cloud`) not run, to save the free Gemini quota.
- On the Mac, the same eval should be run once: `npm run eval:inventory -- local`.

## Merge evidence

RED `a839e58` → GREEN `9d748b7` → vision tests `f787974` → bug RED `132180c` → bug GREEN `9583e47` → eval 27/27 + this report (next commit).
