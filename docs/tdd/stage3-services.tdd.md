# TDD evidence: Stage 3, services

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 3 (Steps 24–28): microservices, with the two servers simulated on one machine.

**Branch:** `stage3-services`.

**Suites, all on Laptop B:** Builder API unit and integration (MongoDB), web, Gateway, and the real Compose run below.

| Step | What | Status |
|---|---|---|
| 24 | `api` and `orchestrator` as two services on one database, Docker Compose | ✅ |
| 25 | Every model call metered on its job (tokens incl. thinking, seconds); new provider adapters moved to Step 31 | ✅ |
| 26 | `ui-worker`: page jobs from a queue in MongoDB, several at once (no Laptop B needed) | ✅ |
| 27 | `backend-worker` and `verifier` services | to do |
| 28 | Compose profiles `server-1`/`server-2`, killed-worker test, placement check | to do |

## Step 24: Two services that meet only in MongoDB

- **`ROLE`** (`src/config.js`): `all` (the default, the single process of today), `api` or `orchestrator`. `src/server.js` checks the settings, then loads `app.js`, or `worker.js` for the orchestrator.
- **`api`:** uploads, the UI, status, spec edits and the live preview. It never builds. `startPipeline` becomes "look again" (`askRerun`) in MongoDB, and the project itself is already saved as unfinished.
- **`orchestrator`** (`src/worker.js`): no UI and no project API. Its HTTP answers are only `/healthz`, `/readyz`, and a 404 that points to the api service. Every `PICKUP_MS` (1 s here) it picks up unfinished projects nobody holds, takes their lease (Step 22) and builds them. Ctrl+C or SIGTERM gives the leases back.
- **One image for both** (`deploy/Dockerfile`):
  - the UI is built in a first stage;
  - only production packages are installed (`npm ci --omit=dev`);
  - it runs as the `node` user;
  - it has a health check on `/readyz`.
- **`deploy/docker-compose.yml`:**
  - MongoDB 8 (with a health check), `api` (ports 4000/4001 on this computer only) and `orchestrator` (no ports);
  - a shared `runs` volume (projects, generated apps, blobs);
  - settings from `deploy/.env` (git-ignored; `deploy/.env.example` is committed).
- **The folder split into `services/`** waits until the services' code differs (from Step 25). Now it would only move the same code into two places.

### Found while preparing the containers

1. **`jsdom` was only a development package, although the Check uses it at run time** (`src/verify/browser.js`, `src/verify/markers.js`). A production install would have broken every Check. It is now a dependency, and a test checks that every package the running code imports is one.
2. **The live preview's address was built from `HOST`.** Inside a container that is `0.0.0.0`, which a browser can't open. The new `PREVIEW_ORIGIN` setting says where the browser finds it.
3. **Both services built the same image at once, and the second build collided with the first.** Now only `api` builds; `orchestrator` runs the same image.
4. **Compose prefers variables already set in the shell over `deploy/.env`.** A shell that had loaded `gateway/.env` sent `OLLAMA_URL=http://127.0.0.1:11434`, which means the container itself, so reading failed (`fetch failed`). The README says to run Compose from a fresh terminal.

### Tests

RED:
- `b8bca67`: `integration/split.test.js` 2 of 3 failing (no roles yet: the API built the project itself, the "orchestrator" served the project API); the config tests for `ROLE` and `PICKUP_MS` failing;
- the next RED commit: `test/dependencies.test.js` names `src/verify/browser.js imports "jsdom"` and `src/verify/markers.js imports "jsdom"`; the `PREVIEW_ORIGIN` config test failing.

GREEN, all on Laptop B: unit **416/416**, integration **134/134** (with the 3 two-service tests), web **29/29**, Gateway **14/14**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Two processes on one database: the API takes the upload, the orchestrator builds it to READY, read once, and the API builds nothing | `integration/split.test.js: the API takes the upload…` | PASS |
| 2 | The orchestrator has only its health checks: no UI, no project API | `…the orchestrator has no UI and no project API…` | PASS |
| 3 | A spec edit on the API is rebuilt by the orchestrator (version 2, READY) | `…a spec edit on the API is rebuilt…` | PASS |
| 4 | `ROLE` is `all` by default; `api` and `orchestrator` are taken; anything else is refused | `config.test.js: which service this process is…` | PASS |
| 5 | `PICKUP_MS` under 100 is refused | `config.test.js: how often the orchestrator looks…` | PASS |
| 6 | `PREVIEW_ORIGIN` is taken when it is an http(s) address | `config.test.js: the live preview's address…` | PASS |
| 7 | Every package imported under `src/` and `shared/` is a production dependency | `dependencies.test.js` | PASS |

### Real run through Compose on Laptop B, 3 Nov 2026

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up --build -d
```

- Image `andarkacode/builder-api`: 516 MB.
- `mongo`, `api` and `orchestrator` all healthy; `/readyz` gives `{"ready":true,"db":true}`.
- The api container reaches Laptop B's Gateway over Tailscale (`pageBuilder: single`).
- m1, local model, fresh: **READY in 81 s**. Jobs: reading, backend, page 1 and Check, each done once.
- The orchestrator's JSON log has the project's 6 state changes, and the API's log has none.

## Step 25: Every model call metered on its job

- **`shared/meter.mjs`** (Builder API and Gateway):
  - `withUsage(list, work)` collects every `recordUsage(...)` made inside `work`, however deep and however parallel (Node's `AsyncLocalStorage`), so the model calls keep their shapes;
  - `ollamaUsage` and `geminiUsage` read the tokens out of each provider's answer, with Gemini's thinking tokens kept apart, because they are billed like output.
- **Every model call records** `{ purpose, provider, model, inputTokens, outputTokens, thinkingTokens, seconds }`:
  - reading a screenshot (`src/ai/vision.js`, `read`);
  - drawing a page (`shared/page.mjs`, `page`);
  - writing a custom button (`src/custom/model.js`, `code`).

  A call the provider refuses records nothing.
- **On the job:** `runJob` meters its work into `job.usage`. A page job takes the usage the Gateway hands back with its page: the Gateway meters each of its jobs, and `/v1/generations/:id` returns `usage` once the page is done.
- **Not in this step:** the extra provider adapters (OpenAI, Anthropic, Groq, OpenRouter) and the "one service for every AI call" shape are needed once users bring their own keys, so they move to **Step 31 (BYOK)**. The metering is what the cost per build needs now.

### Tests

RED (`a35d228`):
- `node --test test/meter.test.js` and the Gateway suite give `Cannot find module '.../shared/meter.mjs'`;
- the pipeline test now expects usage on its jobs (its fake Ollama returns token counts, and its fake Gateway returns page usage).

GREEN, all on Laptop B: meter **10/10**, unit **426/426**, integration **134/134**, Gateway **15/15**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Usage recorded while work runs is collected, in order | `meter.test.js: collects what is recorded…` | PASS |
| 2 | Outside metered work, recording is ignored without failing | `records nothing outside…` | PASS |
| 3 | Two pieces of work at the same time keep their usage apart | `keeps two pieces of work…apart` | PASS |
| 4 | Ollama's and Gemini's token counts are read; thinking is apart; missing usage gives zeros | `ollamaUsage and geminiUsage: …` | PASS |
| 5 | Reading, pages and custom code record purpose, provider, model, tokens and seconds, locally and on Gemini | `every model call records its usage` | PASS |
| 6 | A refused call records nothing | `a call the provider refuses records nothing` | PASS |
| 7 | The Gateway hands back its page's usage | `gateway/test/jobs.test.js: usage (Step 25)` | PASS |
| 8 | In the real pipeline, the reading job holds one `read` entry per screenshot, and each page job holds the Gateway's usage | `integration/pipeline.test.js: builds a spec from two screenshots…` | PASS |

### First real numbers (Laptop B, local `qwen3-vl:8b-instruct`, m7, fresh), 3 Nov 2026

| Job | Calls | Tokens in | Tokens out | Seconds |
|---|---|---|---|---|
| Reading | 1 | 1,409 | 298 | 19.7 |
| Page (through the Gateway) | 1 | 1,472 | 1,336 | 70.4 |
| **Build** | **2** | **2,881** | **1,634** | **90.1** |

The backend made no model call here: this reading of m7 gave no custom buttons. The `code` metering is covered by the tests, not yet by a real run. Cloud numbers, with thinking tokens and real prices, come when a paid or reset Gemini key is used; they feed `docs/economics.md` before Step 42.

## Step 26: The ui-worker, pages from a queue in MongoDB

- **`PAGE_LANE`:**
  - `gateway`: Laptop B, for development; the default when `GATEWAY_URL` is set;
  - `queue`: production; the default otherwise.

  Both lanes answer the same two calls (`submit`, `get`), so the orchestrator's frontend branch is unchanged.
- **`src/page-queue.js` and `models/page-job.js`:**
  - `submitPage` and `getPage` work like the Gateway: the same screenshot and spec give the same job, an unknown job is a 404, and a finished one comes back with its HTML and usage;
  - `claimPageJob` is one atomic update with a lease: the oldest waiting page, or one whose worker died;
  - `renewPageJob`, `finishPageJob` and `failPageJob` work for the holder only.

  The screenshot and the page travel as blobs.
- **`src/ui-worker.js` (`ROLE=ui-worker`):**
  - runs `UI_PARALLEL` lanes (default 4); each claims a page, renews its lease while drawing, and hands it back;
  - draws with the single call (`shared/page.mjs`) and the Step 18.6 retry rule, which moved to `shared/attempts.mjs` so the Gateway uses the same one;
  - meters every model call and hands the usage back with the page;
  - its only HTTP answers are its health checks.
- **Compose:** a `ui-worker` service on the same image; `PAGE_LANE` and `UI_PARALLEL` come from `deploy/.env`.

### Found on the way: a race in the blob store

Three identical pages finished at the same moment, and two of them tried to store the same blob under the same temporary name (process id plus millisecond). The second rename failed (`ENOENT`), so the page failed. Now:
- a blob that already exists isn't written again (its name is its content);
- every write uses a unique temporary name;
- a writer that loses the race to an identical blob cleans up and succeeds.

New test: 12 puts of the same content at once give one blob and no leftovers.

### Tests

RED (`940db3c`):
- `integration/page-queue.test.js` gives `Cannot find module '.../src/page-queue.js'`;
- `integration/ui-worker.test.js` fails, because there is no ui-worker role;
- the `PAGE_LANE` and `UI_PARALLEL` config tests fail.

The blob race was reproduced as RED in `test/blobs.test.js` before its fix.

GREEN, all on Laptop B: page queue **10/10**, ui-worker **2/2**, blobs **7/7**; unit **429/429**, integration **146/146**, Gateway **15/15**, web **29/29**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | A page job is queued and reported as waiting | `page-queue.test.js: queues a page job…` | PASS |
| 2 | The same screenshot and spec give the same job | `hands back the same job…` | PASS |
| 3 | An unknown job is a 404, like the Gateway after a restart | `knows no such job…` | PASS |
| 4 | **Five workers asking at once: exactly one gets the page, with its screenshot and instructions** | `gives a waiting job to exactly one of five workers…` | PASS |
| 5 | Nothing to claim gives nothing | `gives nothing when no job waits` | PASS |
| 6 | A dead worker's page goes back to the queue once its lease runs out, and only then | `gives a job back to the queue when its worker died…` | PASS |
| 7 | Renewing works for the holder only | `renews a lease for its holder only` | PASS |
| 8 | A drawn page comes back with its provider and usage | `a drawn page is handed back…` | PASS |
| 9 | A worker that lost its lease can't hand back a result | `a worker that lost its lease…` | PASS |
| 10 | A failed page says why; the same request then makes a new job | `a failed page says why…` | PASS |
| 11 | **A ui-worker draws the 3 pages of a 3-screenshot project at the same time** (the fake model sees 3 at once), and the project reaches READY with each page's usage | `ui-worker.test.js: draws the 3 pages…` | PASS |
| 12 | The ui-worker has only its health checks | `ui-worker.test.js: the ui-worker has only its health checks` | PASS |
| 13 | `PAGE_LANE` defaults (gateway with `GATEWAY_URL`, else queue); `gateway` without the Gateway is refused; `UI_PARALLEL` 1–20; `ui-worker` is a role | `config.test.js: where pages are drawn…`, `a ui-worker draws 1 to 20…` | PASS |
| 14 | The same content stored 12 times at once gives one blob, no leftovers | `blobs.test.js: stores the same content put many times…` | PASS |

### Real run through Compose with no Laptop B Gateway, 3 Nov 2026

`PAGE_LANE=queue`, `UI_PARALLEL=2`, local model on Laptop B's GPU through `host.docker.internal`; m5 (2 screenshots), fresh: **READY in 108 s**.

| Job | From → to | Model calls |
|---|---|---|
| Reading (2 screenshots at once) | 0 → 16.5 s | 2 reads: 8.6 s and 16.5 s, overlapping |
| Backend | 16.5 → 16.6 s | none |
| Page 1 (ui-worker) | 16.5 → 102.7 s | in 1,408, out 883, 85.3 s |
| Page 2 (ui-worker, same time) | 16.5 → 60.6 s | in 1,342, out 746, 43.3 s |
| Check | 102.7 → 105.1 s | none |

Both pages started together. On one local GPU they share it; with a cloud model they overlap fully.
