# TDD evidence: Stage 3, services

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 3 (Steps 24–28): microservices, with the two servers simulated on one machine.

**Branch:** `stage3-services`.

**Suites, all on Laptop B:** Builder API unit and integration (MongoDB), web, Gateway, and the real Compose run below.

| Step | What | Status |
|---|---|---|
| 24 | `api` and `orchestrator` as two services on one database, Docker Compose | ✅ |
| 25 | `ai-router`: every model call through one service, tokens and seconds per job | to do |
| 26 | `ui-worker`: page jobs from the queue | to do |
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
