# TDD evidence: Step 10, Spec Deriver

**Source plan:** no `*.plan.md`; journeys derived from [ARCHITECTURE.md](../../ARCHITECTURE.md) v3.1 §0 ("no evidence, no code") and §4.2 (derivation rules), and [plan.md](../../plan.md) Step 10.
**Branch:** `step10-spec-deriver` · **Runner:** Node built-in `node:test` (`npm test` = `node --test`), Node v22.21.1 on Laptop B.
**Scope:** the deterministic part of Step 10 (`builder-api/src/spec/derive.js`). The vision pass that produces the UI inventory, and wiring the deriver into the orchestrator, are the next pieces and are not covered here.

## User journeys

1. A table showing only Edit/Delete gives list, update, delete, and nothing else.
2. Add, search, filter and pagination give exactly those list features plus create.
3. A login form gives auth; without one there is no auth at all; sign-up and roles only when visible.
4. Stat cards give exactly those numbers.
5. A column naming another page's entity gives a relation; a dropdown with no page behind it gives a fixed list and a question.
6. A button matching a status value gives a template operation; an unknown button goes to the AI layer.
7. Every spec item records the screenshot element that requires it.

## Task report

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | `not ok 1 - test\derive.test.js` · `ERR_MODULE_NOT_FOUND ... src/spec/derive.js` · `# fail 1` (the intended missing implementation; the runner and test file loaded correctly). Commit `af43e9d`. |
| GREEN | `npm test` | `# tests 26` · `# pass 26` · `# fail 0`. Commit `ad471cd`. |
| Refactor | `npm test` | Moved `getEntityForForm` out of the loop callback (no reliance on hoisting); `# pass 26` · `# fail 0`. |
| Coverage | `npm run test:coverage` | `derive.js` lines 99.25 %, branches 84.78 %, functions 100 % |

## Test specification

| # | What is guaranteed | Test (`builder-api/test/derive.test.js`) | Type | Result |
|---|---|---|---|---|
| 1 | Labels become camelCase field names ("Salary ($)" → `salary`) | `camelCase` | unit | PASS |
| 2 | Types inferred from sample values: email, number (incl. `$`, `,`), date (3 formats), boolean, string | `inferType` (2 tests) | unit | PASS |
| 3 | Edit/Delete only → `list`, `get`, `update`, `delete`; no `create` | `a table with only Edit and Delete` | unit | PASS |
| 4 | Hard delete unless an archive/restore control is visible | same group + `archive control` | unit | PASS |
| 5 | No search, filters, pagination, stats, operations or auth unless visible | same group | unit | PASS |
| 6 | Every field and endpoint has evidence `sN: ...` | same group | unit | PASS |
| 7 | "Add Employee" → `create`; search/filter/pagination exactly as shown | `Add, search, filter and pagination` | unit | PASS |
| 8 | Required only for form inputs marked required; table-only fields optional | same group | unit | PASS |
| 9 | A select with no page behind it → `enum` + an open question (default `enum`) | same group | unit | PASS |
| 10 | Auth only with a login form; the login form is not an entity; sign-up/me/roles only if visible | `login screen` (2 tests) | unit | PASS |
| 11 | One stat per card: count, count by status, sum of a number field; unknown → `custom` + question | `stat cards` (3 tests) | unit | PASS |
| 12 | A column naming another page's entity → `ref` with evidence from both screenshots; one page per screenshot | `two related pages` (2 tests) | unit | PASS |
| 13 | "Approve"/"Reject" next to a Status badge → `setStatus`; "Export CSV" → `export`; unknown → `custom` | `row buttons beyond edit and delete` (4 tests) | unit | PASS |
| 14 | Entity name from the screen title when no hint; Actions/ID/# columns skipped | `naming` (2 tests) | unit | PASS |

## Coverage and known gaps

- `derive.js` uncovered lines 172 and 190: guard clauses for a table or button on a screen where no entity name can be derived at all (empty title, no hint). Behaviour: skipped, no spec item. Worth a test once real inventories show whether it happens.
- Charts (§4.2 "group-by aggregate") and sortable headers (`?sort=`) are in the architecture but not yet in the deriver or its tests; to be added with the inventory schema.
- The UI inventory itself comes from a vision model; its accuracy is tested separately with real and mock screenshots (next piece of Step 10).

## Merge evidence

RED `af43e9d` → GREEN `ad471cd` → refactor (this commit). If these are squashed, keep this file.
