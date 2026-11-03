# TDD evidence: Stage 2, foundation

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 2 (Steps 20–22). Still one process; this is what the two production servers will stand on.

**Branch:** `stage2-foundation`, from `main` after Stage 1b.

**Suites, all on Laptop B:**
- Builder API: unit, and integration (`TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test`);
- web;
- Gateway.

| Step | What | Status |
|---|---|---|
| 20 | Config checked at start-up, `/healthz` and `/readyz`, JSON logs | ✅ |
| 21 | Blob store (`local`; `r2` in Step 46); memory content in compressed blobs, rows under 1 KB | ✅ |
| 22 | Project leases in MongoDB (one builder per project, takeover after a crash) | ✅ |

## Step 20: Settings, health checks, logs

- **`src/config.js`, `checkConfig(env)` and `loadConfig(env)`:** every Builder API setting is checked at start.
  - Each problem names the setting and the file, with the wrong value, and every problem is listed at once. A secret is never printed.
  - Refused: a port outside 1–65535 (`PREVIEW_PORT` may be 0, "any free port"); the preview on the API's own port; an unknown `DEFAULT_MODE` (it used to become `local` without a word); `DEFAULT_MODE=cloud` without `GEMINI_API_KEY`; `GATEWAY_URL` without `GATEWAY_API_KEY` or the other way round; a Gateway address that isn't http(s); a Gateway key shorter than the 16 characters the Gateway itself requires; a database address that isn't MongoDB; `READ_PARALLEL` or `CUSTOM_PARALLEL` outside 1–20; `GATEWAY_POLL_MS` under 100; `PREVIEW_IDLE_MS` under 1000.
- **`src/server.js` is now a small entry point.** It checks the settings, then loads the app (`src/app.js`, the former `server.js`).
  - **Why:** on Laptop B, loading the app's modules from OneDrive takes several seconds (the orchestrator alone: 5.8 s). A check inside the app ran only after all of that.
  - A wrong setting now stops the start in **92 ms**, before the database is touched.
- **`/healthz`** answers `{ ok: true }` while the process is alive. **`/readyz`** answers 200 `{ ready: true, db: true }` when the database is connected, else 503. These are what the servers' health checks and the monitoring (Step 47) will call.
- **`src/log.js`:** with `LOG_FORMAT=json`, each log entry is one JSON line (`time`, `level`, `msg`, `project`, …); otherwise plain text, exactly as before (`[project] STATE`). Used for the orchestrator's state changes and the start message.
- **`src/health.js`, `webBuildIsStale`:** at start, when a file in `web/src` changed after `web/dist` was built (which `git pull` doesn't rebuild), the log says to run `npm run build` in `web/`. This is the cause of the red Laptop B light on 3 Nov.

### Tests

RED (`0412ec3`): `node --test test/config.test.js test/startup.test.js` gives `Cannot find module '.../src/config.js'` and `'.../src/log.js'`.

Found while going GREEN:
1. **The settings check ran too late:** the app's imports load first, taking several seconds on OneDrive. Fixed with the small entry point.
2. **The integration suite's own settings were refused.** `PREVIEW_PORT=0` is valid ("any free port"), so the check now allows it, with its own test. The fake Gateway's key `test-key` was shorter than the real Gateway accepts, so the fixture now uses a 29-character key.

GREEN, all on Laptop B: `config` + `startup` **23/23**; integration **119/119** (118 + the health-check test).

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | The defaults: this computer only, port 4000, preview on 4001, the local database, local mode, no Gateway | `config.test.js: the defaults` | PASS |
| 2 | A full valid set of settings is taken as given | `takes a full, valid set…` | PASS |
| 3 | A bad port names the setting, the file and the value | `a port that is not a whole number…` | PASS |
| 4 | `PREVIEW_PORT=0` is allowed; the same port as `PORT` is refused | `allows PREVIEW_PORT=0…`, `the live preview on the same port…` | PASS |
| 5 | An unknown `DEFAULT_MODE` is refused instead of becoming `local` | `an unknown default mode…` | PASS |
| 6 | `DEFAULT_MODE=cloud` needs a Gemini key | `cloud as the default mode…` | PASS |
| 7 | The Gateway's address and key go together; http(s) only; key length ≥ 16 | `a Gateway address without its key…`, `…not http(s)…` | PASS |
| 8 | Only MongoDB database addresses | `a database address that is not…` | PASS |
| 9 | Limits for how many at once and for the poll interval | `how many at once…` | PASS |
| 10 | Every problem is listed at once | `lists every problem at once` | PASS |
| 11 | `loadConfig` gives the settings, or one error with every problem | `loadConfig: …` | PASS |
| 12 | A secret is never printed, not even a wrong one | `never prints a secret…` | PASS |
| 13 | The real server stops with code 1, naming every wrong setting, without trying the database | `startup.test.js: stops at once with code 1…` | PASS |
| 14 | `/readyz`: 200 with the database connected, 503 without | `readiness: …` | PASS |
| 15 | A JSON log line is one line of valid JSON; text keeps today's `[project] message` | `logLine: …` | PASS |
| 16 | Outdated UI build: true when a source file is newer than `dist/index.html`; false when the build is newer, or there is none | `webBuildIsStale: …` | PASS |
| 17 | The real server answers `/healthz` and `/readyz` | `integration/pipeline.test.js: answers /healthz…` | PASS |

## Step 21: Blob store, and small memory rows

- **`src/blobs.js`, `createBlobStore({ dir })`:**
  - `put` and `get` keep content as gzip files named by its SHA-256, and the same content is stored once;
  - `putJson` and `getJson` keep JSON values;
  - a blob is written next to its place and then renamed, so a reader never sees half of one;
  - a name that isn't 64 hex characters is refused, so it can't reach outside the folder.

  The Builder API's store lives in `runs/blobs/`.
- **`STORAGE` setting:** `local`, the default. `r2` is refused with "comes with the servers and Cloudflare (Step 46)", because it needs the Cloudflare account and keys; it will sit behind the same calls.
- **Memory (`src/memory/index.js`, `models/memory.js`):** a remembered reading, page or custom code is now a blob. The row keeps only `payloadKey` and `payloadBytes` plus its lookup fields, so it stays under 1 KB, which matters for the free 512 MB Atlas database.
  - Every read (`recall`, `recallSimilarPage`, `recallLibrary`) puts the content back.
  - A row whose blob is gone counts as not remembered, so the work is done again.
  - Rows remembered before Step 21 (content inside the row, e.g. on the Mac) still work.
- **Not in this step, on purpose:** the generated app folders and pages stay as files under `runs/`. The app has to run from a real folder for the Check and the live preview. When the two servers exist (Steps 24–28), pages travel through the job queue and the blob store.

### Tests

RED (`8fc98e2`): `node --test test/blobs.test.js test/config.test.js` gives `Cannot find module '.../src/blobs.js'`, and the `STORAGE` test fails.

GREEN, all on Laptop B: blobs + config **22/22**; unit **411/411**; integration **120/120**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | A blob's name is the SHA-256 of its content, and the content comes back as it was | `blobs.test.js: names a blob by the SHA-256…` | PASS |
| 2 | The same content is kept once | `keeps the same content once…` | PASS |
| 3 | Blobs are stored compressed (repetitive HTML under a tenth of its size) | `stores it compressed` | PASS |
| 4 | JSON values (readings) and plain text come back as they were | `keeps JSON values as they were` | PASS |
| 5 | A missing blob is named in the error | `says which blob is missing` | PASS |
| 6 | Names that could reach outside the folder are refused | `refuses a name that is not a SHA-256…` | PASS |
| 7 | `STORAGE` is `local` by default; `r2` waits for Step 46; anything else is refused | `config.test.js: storage other than local…` | PASS |
| 8 | After a real READY, every memory row has no content inside, a blob name, and is under 1 KB | `integration: keeps each memory row small…` | PASS |
| 9 | Memory reuse still works from blobs: exact repeats, near-duplicate pages, the custom-code library | `integration: Memory (Step 14)` (all) | PASS |

## Step 22: Project leases in MongoDB

The in-memory `active` and `rerun` sets that decided "this process is building that project" are gone; MongoDB decides now (`src/lease.js`).
- **`claimProject`:** one atomic `findOneAndUpdate` gives a free project, or one whose lease has run out, to one Builder API for `LEASE_MS` (default 60 s).
- **`renewLease`:** the holder renews every third of the lease while it works. If renewing fails, the lease ran out and was taken, which is logged.
- **`releaseProject`:** gives the lease back and says whether someone asked to look again meanwhile (`rerun`, e.g. a spec edit), which starts the next round.
- **`askRerun`:** a start request for a project someone else holds becomes "look again when you're done". Its own second request inside one process does the same.
- **`freeProjects`:** unfinished projects nobody holds, or whose lease ran out.
  - At start, and then every `LEASE_MS`, a Builder API picks these up.
  - Only *their* running reading and Check jobs are marked interrupted. Before, every running job was, which would break a second server's work.
  - Running page jobs keep their Gateway job and resume.
- **The owner** is `hostname:pid:random`, new at every start.

The job queue for the workers themselves (claimed jobs with leases) belongs with the services split in Stage 3 (Step 24 onward). Until then the jobs still run inside the project's lease.

### Tests

RED (`2a8cb88`): `TEST_MONGODB_URI=… node --test integration/lease.test.js` gives `Cannot find module '.../src/lease.js'`.

GREEN, all on Laptop B: lease **10/10** (real MongoDB); unit **412/412**; integration **130/130**, with every pipeline test (including the spec edit that relies on "look again") on leases.

| # | What is guaranteed | Test (`integration/lease.test.js`) | Result |
|---|---|---|---|
| 1 | A free project goes to the first who asks, until the lease runs out | `gives a free project to the first who asks…` | PASS |
| 2 | A project held by another builder is refused | `refuses a project another builder holds` | PASS |
| 3 | After the lease runs out, another builder takes over | `lets another builder take over…` | PASS |
| 4 | **Ten builders asking at the same moment: exactly one gets it** | `gives the project to exactly one of ten…` | PASS |
| 5 | Renewing works for the holder only | `renewLease: moves the end of the lease on…` | PASS |
| 6 | A builder whose lease was taken over learns it | `says the lease is lost…` | PASS |
| 7 | Releasing frees the project for the next builder | `frees the project for the next builder` | PASS |
| 8 | "Look again" asked during a run is handed to the holder at release, and used up | `tells the holder to look again…` | PASS |
| 9 | A builder that no longer holds the lease can't release it | `does nothing for a builder that no longer holds…` | PASS |
| 10 | Free projects: unfinished and unheld (or expired); never finished or held ones | `freeProjects: …` | PASS |
| 11 | `LEASE_MS` under 1000 is refused | `config.test.js: a project lease shorter than a second` | PASS |

### Real check on Laptop B: kill the Builder API mid-build

`LEASE_MS=5000`, m6 + m8 (2 screenshots), local model, through the Gateway:
1. API A started the build. It was **killed (`kill -9`) 6 s in, while reading the screenshots** (state `UPLOADED`).
2. API B started on the same database. It logged `Resuming 1 project(s), 1 interrupted job(s)`, read the screenshots again, and the project went CONTRACT_DRAFT → BUILDING → SYNCED → INTEGRATING → VERIFYING → **READY**.
3. Jobs: the interrupted reading (`failed: Interrupted: its Builder API stopped`), **one** new reading, **one** backend, **one job per page**, **one** Check. Finished once, never twice.

## Stage 2: where it stands

Steps 20, 21 and 22 are built, test-first, and merged into `main`. Next is the Mac check of the stage, then Stage 3 (microservices, Steps 24–28).

### After the Mac check: a faster restart (3 Nov 2026)

**The Mac's crash test** (Ctrl+C during Read, then `npm start`) finished the project once, by itself, but took **247 s**. Most of that was waiting:
- up to 60 s for the old lease to run out;
- up to another 60 s for the next search for free projects.

**What changed:**
- **Stopped on purpose (Ctrl+C, or a deploy's SIGTERM):** the Builder API now gives back every project it holds before it exits (`releaseAll`, `stopBuilding`), so the next start continues them at once. A second Ctrl+C stops it straight away.
- **After a real crash:** the search for free projects runs every third of a lease (20 s), not every lease (60 s). A crashed Builder API's projects now wait at most about 80 s.

RED (`4b6fa73`): `integration/lease.test.js` gives `does not provide an export named 'releaseAll'`. GREEN: lease **11/11**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 12 | Stopping on purpose frees every project this builder holds, at once, and leaves the others' alone | `releaseAll: frees every project this builder holds…` | PASS |

Ctrl+C itself is checked on the Mac. On Windows a background process can't be sent a real Ctrl+C: Windows ends it without running its shutdown handler.
