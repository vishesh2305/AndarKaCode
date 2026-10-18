# TDD evidence: Step 11, template layer (App Spec → working backend, no AI)

**Source plan:** no `*.plan.md`; journeys from [ARCHITECTURE.md](../../ARCHITECTURE.md) v3.1 §7 ("no evidence, no code") and [plan.md](../../plan.md) Step 11.
**Branch:** `step11-templates` · **Runners:** `npm test` (unit), `npm run test:integration` (real MongoDB), Node v22.21.1 on Laptop B.
**Code:** `builder-api/src/generator/index.js` + templates in `templates/backend/` (`package-json`, `env-example`, `server`, `model`, `validation`, `controller`, `routes`, `stats-routes`, `api-tests`).

## User journeys

1. A spec becomes a backend with **exactly** the files and routes its screenshots need: Edit/Delete only → no create route; no stat cards → no stats route; no Add/Edit → no validation file.
2. The generated backend works against a real database: list (search, filter, paging only when shown), get, create, update, hard or soft delete, relation checks, status buttons, CSV export, stats; bad input gets field-by-field reasons.
3. Every generated app ships with its own tests (one per visible endpoint/button/stat card) and they pass.
4. The pipeline's backend job uses the generator, so `SYNCED` means real pages plus a real backend.

## Task report

| Stage | Command | Result |
|---|---|---|
| 11.1 RED | `npm test` | `ERR_MODULE_NOT_FOUND src/generator/index.js`; 73 pass. `10c90d8` |
| 11.1 GREEN + bug RED | `npm test` | 92 pass; reading the generated code showed enum option `"Sales, EMEA"` written as `"Sales,  EMEA"`: reproducer fails. `95fb64e` |
| 11.1 bug GREEN | `npm test` | rule text built value by value; `templates/package.json` (ES modules). 93/93. `8edbfd4` |
| 11.2 RED | `npm test`; integration | unit 7 fail; integration 12 fail (no routes; Express's HTML 404). `e17a72f` |
| 11.2 GREEN | both | unit 100/100, integration 17/17 (incl. pipeline 5). `ac27038` |
| 11.3 RED | both | unit 6 fail; integration 4 fail. `6d16bbd` |
| 11.3 GREEN | both | unit 107/107, integration 21/21. Two **test** bugs fixed on the way: `` `\b` `` in a template string is a backspace, not a word boundary; two generated apps defining `LeaveRequest` shared one Mongoose registry in the test process (now reset per app). `d07605c` |
| 11.4 RED | both | unit 6 fail; integration 5 fail. `d8a8ab7` |
| 11.4 GREEN | both | unit 113/113, integration 26/26. Test-setup fixes: generated apps written outside `test/` and `integration/` (their own `*.test.js` were being picked up); generated apps' runner started without the inherited `NODE_TEST_CONTEXT` (it reported silently). Mongoose 9 `returnDocument: "after"`. `5a8f6bb` |
| Real-model specs | generate + run each app's own tests | First run: the **login-only** app had a test file with no tests and its cleanup hung (20–60 s). |
| Bug RED | both | unit 2 fail; integration login app times out at 60 s. `71e0bd6` |
| Bug GREEN | both | every app tests `GET /health`; cleanup closes only what was opened. unit **115/115**, integration **27/27**. `1d790f7` |
| Real-model specs, rerun | generate + run each app's own tests | **6/6 apps pass, 29 tests, 0 fail** (m1 5, m2 9, m3 3, m4 1, m5 7, m6 4) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Exactly the needed files; validation only with create/update; deterministic output; valid JavaScript | `generator-core.test.js` | unit | PASS |
| 2 | package.json has only express + mongoose; `.env.example` has no login settings without a login screen | `generator-core.test.js` | unit | PASS |
| 3 | Models: types, required, enum, relations (`ref`), `deletedAt` only with soft delete, lowercase email, `id` not `_id`, evidence comments | `generator-core.test.js` | unit | PASS |
| 4 | Validation: required (not on partial update), type conversion, rejects bad email/number/enum/date/relation id, ignores unknown fields, enum values copied exactly | `generator-core.test.js` | unit | PASS |
| 5 | Route tables match the screen exactly (Edit/Delete → no POST; Add only → no PUT/DELETE; list-only → GET /) | `generator-routes.test.js` | unit | PASS |
| 6 | Search/filter/paging code only when shown; routes mounted at `/api/<plural>`; evidence above each route | `generator-routes.test.js` | unit | PASS |
| 7 | One route per button; `/export.csv` before `/:id`; custom buttons 501; stats route only with stat cards, keys = `data-stat` names | `generator-ops.test.js` | unit | PASS |
| 8 | Generated tests: one per visible endpoint/button/stat, named after evidence, `GET /health` always, `MONGODB_URI_TEST` only, safe cleanup | `generator-tests.test.js` | unit | PASS |
| 9 | Generated backend on MongoDB: list `{items,total}`, get/404, update + 400 details, hard delete, no create route → JSON 404 | `generated-backend.test.js` | integration | PASS |
| 10 | Create + 400, plain-text search (`.*` is text), filter, paging | `generated-backend.test.js` | integration | PASS |
| 11 | Relation must exist; related record returned populated; soft delete hides but keeps | `generated-backend.test.js` | integration | PASS |
| 12 | Approve sets the status; CSV escaped + formula-safe; custom 501; stats exact | `generated-backend.test.js` | integration | PASS |
| 13 | 5 generated apps (incl. login-only) pass their own tests | `generated-tests.test.js` | integration | PASS |
| 14 | Pipeline writes a real backend stamped with the spec hash | `pipeline.test.js` | integration | PASS |

## Known gaps

- Login/roles code is Step 12; a login-only app currently has only `/health`.
- Custom buttons and custom stats are placeholders (501 / `null`) until Step 13.
- Filters on relation or number fields get a smoke test (200) only; enum/boolean filters are fully tested.
- Generated apps need `npm install` before running outside this repo (inside it they reuse builder-api's packages).

## Merge evidence

RED/GREEN pairs: `10c90d8`→`95fb64e`/`8edbfd4`, `e17a72f`→`ac27038`, `6d16bbd`→`d07605c`, `d8a8ab7`→`5a8f6bb`, `71e0bd6`→`1d790f7`.
