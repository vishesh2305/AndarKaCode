# TDD evidence: Stage 1b, speed now

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 1b (decided 2 Nov 2026, after Step 18.6).

**Goal:** the two lanes already start together (`Promise.all` in `orchestrator.js`), but three places inside them still work one at a time. Remove those, then time every stage.

**Branch:** `step18-page-spike` (Stage 1b continues on it).

**Suites, all on Laptop B** (MongoDB 8.2.7 is installed there, so the integration suite no longer needs the Mac):
- `builder-api`: `npm test`, and `TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test node --test --test-concurrency=1 "integration/**/*.test.js"`
- `web`: `npm test`

| Step | What | Status |
|---|---|---|
| 23 | Screenshots read at the same time | ✅ |
| 23b | The single call in the real app, with pages at the same time | to do |
| 23c | Custom buttons written at the same time | to do |
| 23d | A timer per stage, and "built in N s" | to do |

## Step 23: Screenshots read at the same time

`src/spec/read-all.js` adds `readScreenshots(shots, { read, recall, limit })`:
- every screenshot is read at the same time, at most `READ_PARALLEL` at once (default 6);
- a screenshot read before comes from memory (Step 14), without asking the vision model;
- the readings come back in the screenshots' order, which the spec uses to number its pages;
- `provider` is `"cloud"` when any screenshot needed the cloud model.

`contractStage` in `orchestrator.js` now calls it instead of its `for` loop. `runPool` moved from `src/eval/pages.js` to `src/pool.js`, so the app and the page exam share it; `pages.js` still exports it.

**Integration test change:** the fake Ollama in `integration/pipeline.test.js` used to hand out prepared inventories in the order requests arrived. Readings now run at the same time, so that order isn't fixed. Each inventory now waits under the image the vision model is sent: the upload shrunk with the same `shrinkScreenshot` the Builder API uses, as base64.

### Tests

RED (`91bde80`): `node --test test/read-all.test.js` gives `Cannot find module '.../src/spec/read-all.js'`.

GREEN, all on Laptop B:
- `node --test test/read-all.test.js test/eval-pages.test.js`: pass 35, fail 0;
- unit: **375/375**;
- integration: **118/118** (the first run of this suite on Laptop B);
- web: **19/19**.

| # | What is guaranteed | Test (`test/read-all.test.js`) | Result |
|---|---|---|---|
| 1 | Every reading starts before the first one finishes | `starts every reading before the first one finishes` | PASS |
| 2 | Never more than `limit` readings at once | `never reads more than limit at once` | PASS |
| 3 | The readings keep the screenshots' order, whichever finishes first | `keeps the screenshots' order…` | PASS |
| 4 | A screenshot read before comes from memory, without asking the vision model; it is listed as reused, with its seconds | `takes a screenshot read before from memory…` | PASS |
| 5 | `cloud` when any screenshot needed the cloud model, `local` when none did | `says cloud when any screenshot needed…` | PASS |
| 6 | A screenshot that can't be read fails the step with its own error | `fails with the reading's own error…` | PASS |
| 7 | The whole pipeline still works: specs from 2 screenshots in the right order, memory repeats ask no model, READY | `integration/pipeline.test.js` (all) | PASS |

### Not measured yet

The real time for "3 screenshots take about as long as 1" needs the cloud model. The Gemini free key was at its daily limit on 3 Nov (`429 … limit: 20`). Laptop B's local Ollama answers one request at a time, so it shows no gain there. The stage timer (23d) will measure it in every real build.
