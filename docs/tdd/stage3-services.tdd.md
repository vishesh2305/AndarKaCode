# TDD evidence: Stage 3, services

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 3 (Steps 24–28): microservices, with the two servers simulated on one machine.

**Branch:** `stage3-services`.

**Suites, all on Laptop B:** Builder API unit and integration (MongoDB), web, Gateway, and the real Compose run below.

| Step | What | Status |
|---|---|---|
| 24 | `api` and `orchestrator` as two services on one database, Docker Compose | ✅ |
| 25 | Every model call metered on its job (tokens incl. thinking, seconds); new provider adapters moved to Step 31 | ✅ |
| 26 | `ui-worker`: page jobs from a queue in MongoDB, several at once (no Laptop B needed) | ✅ |
| 27 | `backend-worker` and `verifier` services | folded into Step 33 (see below) |
| 28 | Compose profiles `server-1`/`server-2`, killed-worker test, placement check, fingerprint bands (M3) | ✅ |

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

## Step 27: folded into Step 33

The backend already runs at the same time as the pages: on server 1, inside the orchestrator, while the ui-workers on server 2 draw the pages. A container of its own would not make anything faster: the backend lane takes milliseconds (templates), plus a few seconds per custom button. The verifier is the one part that runs generated code, so it gets its own service **together with its sandbox** (Step 33: gVisor, no network), instead of being split twice.

## Step 28: Two servers that share only MongoDB

- **Compose profiles** (`deploy/docker-compose.yml`, `COMPOSE_PROFILES` in `deploy/.env`):
  - `server-1`: `mongo`, `api`, `orchestrator`;
  - `server-2`: `ui-worker`, built on that machine by `deploy/server-2.yml` (on one machine the api service builds the image once for all three, so two builds of one image never collide again, Step 24);
  - MongoDB is published on `MONGO_BIND:MONGO_PORT` (default `127.0.0.1:27018`) for server 2. `MONGO_BIND` must be server 1's private address: the database has no login until Step 46.
- **Page jobs carry their screenshot and their page** (`src/page-queue.js`). The screenshot is dropped once the job is over. Jobs and pages from before Step 28 are still read from the blob store.
- **Placement check** (`src/placement.js`): at start, a ui-worker pings MongoDB 5 times and takes the median. Over `PLACEMENT_MS` (5 ms by default, 1–1000) it logs an error saying the servers are too far apart.
- **`RUNS_DIR`** puts `runs/` elsewhere (a server's own disk; the tests give each ui-worker its own).

### Found while splitting the servers

1. **A ui-worker on server 2 could not draw any page.** It read the screenshot from the blob store, a folder on server 1's disk: `claiming a page failed: blob d622… is missing`, again and again, with the page never drawn. The test with a ui-worker on a disk of its own shows it: it fails with the Step 26 page queue and passes now.
2. **Local pages over 5 minutes failed with `fetch failed`** (real run below). Not streamed, Ollama sends nothing until the whole page is written, and Node's `fetch` gives up after 300 s without headers, whatever our own 10-minute limit says. Both pages failed after exactly 2 × 5 minutes. The local page call now streams (`shared/page.mjs`), so headers come at once; one reader takes a streamed or a single answer and throws an error sent in the middle of the stream. The Gateway on Laptop B uses the same code, so it is fixed there too.

## Step 28b: Fingerprint bands for near-duplicate search (memory plan M3)

A copy of a screenshot (resized, re-saved) is found by its dHash, at most `NEAR` (6) bits away. Before, the search loaded every remembered page with the same instructions and compared each one.

Now each remembered page also keeps its dHash cut into `NEAR + 1` = 7 numbered bands, under an index (`src/memory/dhash.js`, `models/memory.js`). Two fingerprints at most 6 bits apart differ in at most 6 bands, so they always share one: the search looks only at the rows that share a band, and misses no copy. Rows remembered before the bands are still compared, until a READY project fills them in.

Measured on Laptop B, 100,000 remembered pages with the same instructions, a copy 1 bit away:

| | Rows compared | Time |
|---|---|---|
| Before (every row) | 100,000 | 2,056 ms |
| Bands | 1,273 | **32 ms** |

### Tests

RED:
- `0d29a79`: `placement.test.js` (no `src/placement.js`), the `PLACEMENT_MS` config test, the page-queue test for the bytes inside the job, and `two-servers.test.js` (no round trip logged). The killed-worker test already passed: the Step 26 lease takeover holds when a worker is killed mid-page;
- `9de5d33`: `page-model.test.js`, the stream asked and read, an error in the middle of the stream;
- `df19053`: `dhash.test.js` bands, `memory-bands.test.js` (no `bands`).

GREEN, all on Laptop B: unit **438/438**, integration **151/151**, web **29/29**, Gateway **15/15**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | **A ui-worker with a disk of its own** (as on server 2) draws the pages, and the project reaches READY | `two-servers.test.js: a ui-worker with a disk of its own…` | PASS |
| 2 | **A ui-worker killed in the middle of a page** (SIGKILL): a second one takes the page over when the lease runs out, draws it once more, and the project reaches READY | `two-servers.test.js: a ui-worker killed in the middle of a page…` | PASS |
| 3 | The screenshot and the page travel inside the job; the screenshot is dropped once it is drawn | `page-queue.test.js: the screenshot and the page travel inside the job…` | PASS |
| 4 | The round trip is the median of 5 pings (one slow ping doesn't count) | `placement.test.js: measureDelay…` | PASS |
| 5 | Under the limit it says so; over it, it says how far, the same region, and `PLACEMENT_MS` | `placement.test.js: placementCheck…` | PASS |
| 6 | `PLACEMENT_MS` is 5 by default, 1–1000 | `config.test.js: how far MongoDB may be…` | PASS |
| 7 | The local page call streams, and the pieces are joined into the page with the last piece's token counts | `page-model.test.js: asks Ollama to stream…` | PASS |
| 8 | An error sent in the middle of the stream is thrown | `page-model.test.js: throws an error Ollama sends…` | PASS |
| 9 | 7 numbered bands; any two fingerprints at most 6 bits apart share one (2,000 random pairs) | `dhash.test.js: bands…` | PASS |
| 10 | Among 100,000 remembered pages, a copy 4 bits away is found in under 0.5 s | `memory-bands.test.js: finds the copy…` | PASS |
| 11 | A page remembered before the bands is still found | `memory-bands.test.js: a page remembered before…` | PASS |

Compose checked with `docker compose config --services`: `server-1` gives `mongo`, `api`, `orchestrator`; `server-2` gives `ui-worker`; both give all four.

### Real run: two servers on Laptop B, 3 Nov 2026

Two separate Compose projects, `ak-server-1` (`--profile server-1`) and `ak-server-2` (`--profile server-2` with `deploy/server-2.yml`), no Laptop B Gateway (`PAGE_LANE=queue`), local model on Laptop B's GPU. Server 2 has **no volume**, and it reaches server 1's MongoDB only through the published port (`host.docker.internal:27018`). Its log: `MongoDB is 2.2 ms away (under 5 ms)`.

m1 + m3 (2 screenshots), fresh: **READY in 139 s**.

| Job | Where | From → to | Model calls |
|---|---|---|---|
| Reading (2 screenshots at once) | server 1, orchestrator | 0 → 32 s | 2 reads: in 1,409 / out 370, 22.7 s and in 1,409 / out 279, 32.3 s |
| Backend | server 1, orchestrator | 32 → 32 s | none |
| Page 1 | **server 2**, ui-worker `050985f5995d` | 33 → 86 s | in 1,429 / out 950, 52.5 s |
| Page 2 | **server 2**, same ui-worker, **same moment** | 33 → 134 s | in 1,409 / out 1,105, 100.1 s |
| Check | server 1, orchestrator | 134 → 136 s | none |

Both page jobs were claimed at the same instant (17:04:38.366). After drawing, each job holds its page (3,465 and 4,009 bytes) and no screenshot.

The run before the streaming fix: Laptop B's GPU was full (7.8 of 8 GB, 22% of the model on the CPU, 3.2 tokens/s), the pages took over 5 minutes, and both failed with `fetch failed` (Found #2). Earlier still, a cold `ollama serve` let both readings run past their 3-minute limit. Neither was the two-server split. On one local GPU the two pages share it; with a cloud model, or one GPU per ui-worker, they overlap fully.
