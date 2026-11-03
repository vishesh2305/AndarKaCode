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
| 21 | Storage interface (`local` or `r2`); memory payloads become compressed blobs named by their hash | to do |
| 22 | Job queue and project leases in MongoDB | to do |

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
