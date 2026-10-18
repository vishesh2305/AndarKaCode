# TDD evidence: Step 10, pipeline (screenshots → App Spec → one page per screenshot → SYNCED)

**Source plan:** no `*.plan.md`; journeys from [ARCHITECTURE.md](../../ARCHITECTURE.md) v3.1 §3–§4 and [plan.md](../../plan.md) Step 10.
**Branch:** `step10-pipeline` · **Runners:** `npm test` (unit, `test/`), `npm run test:integration` (real Builder API + MongoDB, fake Ollama + fake Gateway, `integration/`), Node v22.21.1 on Laptop B.

## User journeys

1. Uploading one or more screenshots builds one App Spec and **one page per screenshot**; the Barrier waits for every page.
2. Each page is built with **its own** instructions: only its fields, buttons and markers (login pages: login markers; stat cards: `data-stat`).
3. A spec that can't be built (nothing on screen, broken relation, missing evidence) stops with a clear reason, both after derivation and when a user edits the spec.
4. Editing the spec makes a new version and rebuilds the pages.

## Task report

| Stage | Command | Result |
|---|---|---|
| RED (A+B) | `npm test` | `ERR_MODULE_NOT_FOUND` for `src/spec/check.js` and `src/spec/instructions.js`; 55 pass. Commit `8040aff`. |
| GREEN (A+B) | `npm test` | `# pass 70`. Cross-check: all 6 real-model specs from the eval pass `checkSpec`, and every page gets instructions. Commit `f5bf0f7`. |
| Bug found | instructions for the real-model specs | `page title "list"`: the model copied the page kind into the title on 4 of 6 screens. |
| RED (bug) | `npm test` | 2 reproducers fail; 71 pass. Commit `fa266cc`. While fixing, a third case surfaced: `camelCase("leaveRequests")` returned `leaverequests`; its assertion was added and failed before the fix. |
| GREEN (bug) | `npm test` + `npm run eval:inventory -- local` | Kind words are not titles; labels fall back to the plural name; `camelCase` keeps humps; clearer prompt. `# pass 73`; real-model eval **41/41**, with the real headings now reported. Commit `c9311cf`. |
| RED (C) | `npm run test:integration` | 5 fail for the intended reasons: `"Too many files"` (single upload), old extractor can't read an inventory (`reading 'plural'`), no Contract to edit. Commit `cca8f2d`. Before that, a test-setup bug (port read after `close()`) made the run hang silently; fixed in the test. |
| GREEN (C) | `npm test`; `npm run test:integration` | unit 73/73; integration **5/5** in ~2 s. Old single-table extractor and `shared/instructions.mjs` removed. Commit `96caacd`. |
| Real end-to-end (Laptop B) | upload `m5a-employees-dept.png` + `m5b-departments.png`, real Ollama vision + real Gateway/Screenshot-to-Code | `UPLOADED` → `BUILDING` (55 s) → page 1 done (111 s) → **`SYNCED` (151 s)**. Spec: `employee[fullName, department:ref]` (list, get, update, delete), `department[name, headCount:number]` (list, delete). Page 1 markers: `fullName, department` + `update, delete`; page 2: `name, headCount` + `delete` — exactly each page's own controls. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A valid spec passes; nothing to build fails; a login-only spec passes | `spec-check.test.js` (3) | unit | PASS |
| 2 | Not-camelCase / duplicate names, unknown types, enums without options, relations to missing entities are rejected | `spec-check.test.js` (2) | unit | PASS |
| 3 | Unknown endpoints and entities without endpoints are rejected | `spec-check.test.js` | unit | PASS |
| 4 | Items without evidence are rejected (no evidence, no code) | `spec-check.test.js` | unit | PASS |
| 5 | Operations/stats pointing at missing values/fields, and pages pointing at missing entities, are rejected | `spec-check.test.js` (2) | unit | PASS |
| 6 | A list page's instructions contain only its fields and the markers of its controls (create, update, search, filter, paging, operations, export, stats, `SAMPLE_*`) | `instructions.test.js` (3) | unit | PASS |
| 7 | Another page gets only its own field and buttons; a login page gets only login markers; an unknown page throws | `instructions.test.js` (3) | unit | PASS |
| 8 | Titles that are only a kind word count as no title; labels fall back to the plural name; `camelCase` keeps existing humps | `inventory.test.js`, `derive.test.js` | unit (reproducers) | PASS |
| 9 | Two screenshots → 2 entities with a relation, 2 page jobs (pages 1, 2) with their own instructions, `SYNCED`, page 2 served | `pipeline.test.js` | integration | PASS |
| 10 | Login + list screenshots → auth in the spec, login markers sent for the login page | `pipeline.test.js` | integration | PASS |
| 11 | A screenshot with nothing to build → `NEEDS_ATTENTION`, "Nothing to build" | `pipeline.test.js` | integration | PASS |
| 12 | Invalid edit → 400 with the checker's problems; valid edit → v2 → pages rebuilt → `SYNCED` | `pipeline.test.js` (2) | integration | PASS |

## Coverage and known gaps

- Integration tests use fakes for Ollama and the Gateway, so model accuracy and Screenshot-to-Code are covered by the eval (`npm run eval:inventory`) and the real end-to-end run, not by `npm test`.
- Restart/resume with several pages is covered by the code path from Step 9 (resume per page job) but has no automated test yet.
- Projects created before this change (single-table Contract) can't be edited with the new spec checker; their screenshots still work for new uploads.

## Merge evidence

A+B RED `8040aff` → GREEN `f5bf0f7` → title bug RED `fa266cc` → GREEN `c9311cf` → C RED `cca8f2d` → GREEN `96caacd` → real end-to-end + this report.
