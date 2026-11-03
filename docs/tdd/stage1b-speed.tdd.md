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
| 23b | The single call in the real app, with pages at the same time | ✅ |
| 23c | Custom buttons written at the same time | ✅ |
| 23d | A timer per stage, and "built in N s" | ✅ |

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

## Step 23b: The single call in the real app, with pages at the same time

- **`shared/page.mjs`:** the single-call builder moved here from `builder-api/src/ai/page.js`, which now only re-exports it. The page exam and the Gateway run the same code.
- **`gateway/src/jobs.js`:**
  - **Page builders:** `single` (the default, `PAGE_BUILDER` in `gateway/.env`) or `s2c`; a request may also name one.
  - **Lanes:** the local GPU draws `LOCAL_PARALLEL` pages at once (default 1), the cloud model `CLOUD_PARALLEL` (default 4), and a cloud page never waits behind a local one.
  - **Retries (`attemptPlan`, decision 18.6):** the job's model, once more, then the other model.
  - **Dedup:** the same (image, spec, builder) gives the same job.
- **`gateway/src/server.js`:** wires in the real builders. `/v1/health` now reports `pageBuilder` and `parallel`.
- **`web/src/gateway-light.js`:** Laptop B's light is green with the single call even when Screenshot-to-Code isn't running. S2C is needed only when it is the page builder, or for an older Gateway with no `pageBuilder`.
- The Gateway had no tests before this step; it now has `npm test` (14 tests).

### Tests

RED:
- `68452e5`: `gateway npm test` gives `does not provide an export named 'attemptPlan'`;
- `d21fcab`: `web node --test test/gateway-light.test.js` gives `Cannot find module '.../src/gateway-light.js'`.

GREEN, all on Laptop B: Builder API unit **375/375**, integration **118/118**, web **24/24**, Gateway **14/14**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Retry order: local → local, local, then cloud (with a key); cloud → cloud, cloud, local; auto → local, then cloud | `gateway/test/jobs.test.js: attemptPlan…` | PASS |
| 2 | The single call is the default builder, and the job says so | `draws with the single call by default…` | PASS |
| 3 | S2C draws the page when the request asks for it | `uses Screenshot-to-Code when the request asks…` | PASS |
| 4 | The input image is never shown | `never shows the input image` | PASS |
| 5 | Cloud pages run several at once, up to the limit | `runs cloud pages several at once…` | PASS |
| 6 | Local pages run one at a time | `runs local pages one at a time` | PASS |
| 7 | A cloud page doesn't wait behind a local one | `does not make a cloud page wait behind a local one` | PASS |
| 8 | The queue length counts waiting plus running | `counts the queue…` | PASS |
| 9 | A failed page is tried once more | `is tried once more…` | PASS |
| 10 | After the retry the other model draws it, and the job names that model | `goes to the other model after the retry…` | PASS |
| 11 | When every try fails, the job fails with the last error and can be asked for again | `fails with the last error…` | PASS |
| 12 | The same request gets the same job; another builder gets its own | `hands back the same job…` | PASS |
| 13 | Laptop B's light: grey while checking; green with the single call without S2C; S2C required for `s2c` and for an older Gateway; red without the GPU model or the Gateway | `web/test/gateway-light.test.js` (5 tests) | PASS |
| 14 | The page exam and the page model tests still pass on the moved builder | `builder-api: page-model, gemini-default, eval-pages` | PASS |

### Real build on Laptop B, 3 Nov 2026

The whole chain ran on Laptop B: Builder API, MongoDB, the new Gateway (`pageBuilder: single`, local 1, cloud 4, S2C **not running**) and Ollama. m5 (2 screenshots), local model, fresh (no memory):

| Stage | From → to | Took |
|---|---|---|
| Read 2 screenshots | 0 → 30.5 s | 30.5 s |
| Backend (templates) | 30.5 → 30.5 s | instant |
| Page 1 | 30.5 → 74.9 s | 44.4 s |
| Page 2 (sent at the same time; waited for the GPU) | 30.5 → 105.0 s | 74.5 s |
| Check | 105.1 → 107.7 s | 2.7 s |

- **READY 109 s after the upload.**
- Both pages were sent at once. The local lane drew them one after the other, as designed (one GPU). On cloud they would overlap.
- For the same two pages, S2C took 112.6 s on 1 Nov (18.3), against about 75 s here.

## Step 23c: Custom buttons written at the same time

`backendBranch` in `orchestrator.js` now writes every custom button at the same time, through `writeButtons` in `src/custom/all.js`, at most `CUSTOM_PARALLEL` at once (default 3).
- **Separate test databases.** A button's test press empties its database first, so two buttons can't share one. Each button now gets its own database, `custom_<project>_<n>` (`buttonDatabase`); before this, all buttons used `custom_<project>`.
- **No clash in the app folder.** Each button writes only its own `backend/custom/<name>.js`, and the generated app reads a button's code only when that button is pressed (`custom-runtime.js` reads the file, then runs it in a worker), so one button's broken attempt can't break another's test. Each test app picks its own port.
- The results keep the buttons' order, so the job's `custom` list, the regenerated `tests/api.test.js` and the UI see them as before.

### Tests

RED (`c74182f`): `node --test test/custom-all.test.js` gives `Cannot find module '.../src/custom/all.js'`.

GREEN, on Laptop B: `custom-all` 6/6, unit **381/381**, integration **118/118**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Every button of a project gets its own database, different across projects too | `buttonDatabase: is different…` | PASS |
| 2 | The name fits MongoDB's 63-character limit | `buttonDatabase: fits MongoDB's name limit…` | PASS |
| 3 | Every button starts before the first one is done | `writeButtons: starts writing every button…` | PASS |
| 4 | Never more than `limit` at once | `writeButtons: never writes more than limit…` | PASS |
| 5 | Each button gets its index; the results keep the buttons' order | `writeButtons: gives each button its index…` | PASS |
| 6 | One button that can't be written does not stop the others | `writeButtons: one button that can't be written…` | PASS |
| 7 | In the real pipeline, a written button and a refused one in one project still end as before; memory and library reuse unchanged | `integration/pipeline.test.js` (custom buttons, memory, library) | PASS |

## Step 23d: Build time and the slower lane

Each station already showed its own time (from its job's `startedAt`/`finishedAt`). `pipelineStatus` in `web/src/pipeline.js` now adds to the Ready station:
- **`builtIn`:** the seconds from the upload (`project.createdAt`) to the end of the Check;
- **`lanes`:** each lane's time from the moment the lanes start, and `slower`, the lane the app waited for.

The Ready station lists them as "Built in", "Pages lane", "Backend lane" and "Waited for".

### Tests

RED (`69e2a32`): `web node --test test/pipeline.test.js` gives 5 failing tests.

GREEN: web **29/29**, and the build works.

| # | What is guaranteed | Test (`web/test/pipeline.test.js`) | Result |
|---|---|---|---|
| 1 | Build time = from the upload to the end of the Check | `says how long the build took…` | PASS |
| 2 | The pages lane is named when the app waited for its pages | `names the pages lane…` | PASS |
| 3 | The backend lane is named when custom buttons took longer | `names the backend lane…` | PASS |
| 4 | No total and no lanes before Ready | `has no total and no lanes before the app is Ready` | PASS |
| 5 | The Ready station lists the build time, both lanes and the slower one | `the Ready station lists the build time…` | PASS |

**On the real m5 build (3 Nov, Laptop B, local):** `builtIn: 108`, `lanes: { pages: 75, backend: 0, slower: "pages" }`, shown as "Built in 108 s · Pages lane 75 s · Backend lane 0 s · Waited for: the pages (Laptop B)".

## Stage 1b: where it stands

- **Built:** 23, 23b, 23c and 23d, each test-first and merged into `main`.
- **Measured on Laptop B (local model, one GPU):** m5 (2 screenshots) was READY in **108 s**, and the app waited for the pages lane.
- **Not measured yet:** "a 3-page cloud build is READY in under 2 minutes". The Gemini free key was at its daily limit. It needs the Mac (its own key) or a paid key; the Ready station now shows the number by itself.

## Mac check of Stage 1b (3 Nov 2026)

- After `cd web && npm run build` (the Builder API serves the built `web/dist`, which `git pull` doesn't update), Laptop B's light turned green with Screenshot-to-Code not running.
- A 3-screenshot project (m4-login, m1-edit-delete, m3-dashboard) built on the Mac through Laptop B's Gateway: **READY, "Built in 58 s"**, under the 2-minute first target.
  - Memory may have reused earlier readings or pages, because "Start fresh" wasn't confirmed as ticked. A fresh run would be higher.

**Stage 1b is done.**
