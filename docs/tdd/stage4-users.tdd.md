# TDD evidence: Stage 4, users and keys

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 4 (Steps 29–32).

**Branch:** `stage4-users`.

**Suites, all on Laptop B:** Builder API unit and integration (MongoDB), web, Gateway.

| Step | What | Status |
|---|---|---|
| 29 | GitHub/Google sign-in, workspaces, invite list, secure cookie sessions | ✅ |
| 30 | `ownerId`/`workspaceId` on everything; memory per user plus a library scope (M2) | ✅ |
| 31 | BYOK: key slots, key vault, verified-models list, provider adapters | ✅ (31a, 31b, 31c) |
| 32 | Quotas, fair scheduling, adaptive concurrency per key, helmet/CSP/CORS/rate limits | ✅ (32a, 32b, 32c) |

## Step 29: Only invited accounts get in

- **`AUTH`** (`src/config.js`): `off`, the default, changes nothing: this computer only, no accounts, every existing test unchanged. `on` needs `PUBLIC_URL` and GitHub and/or Google (`*_CLIENT_ID` with `*_CLIENT_SECRET`); `SESSION_DAYS` (1–90, default 14). A secret is never printed. `GITHUB_URL`/`GITHUB_API_URL` and `GOOGLE_ISSUER` can point elsewhere (GitHub Enterprise, another OpenID issuer, and the tests).
- **The sign-in** (`src/auth/`):
  - `GET /auth/<github|google>/start` saves a one-time sign-in in MongoDB (`Login`: the state, a hash of a new `ak_login` cookie, the PKCE verifier; 10 minutes) and sends the person to the provider with the state and the S256 challenge.
  - `GET /auth/<provider>/callback` takes that sign-in back once, and only from the browser holding the `ak_login` cookie. It trades the code (with the verifier) for a token, and reads the person: GitHub's `/user` and primary email from `/user/emails`; Google's userinfo endpoint, found from its discovery document.
  - Who it is (`accounts.js`): a known identity, or a known verified email, is that person (GitHub and Google with the same verified email are one person). Anyone else needs an **invite** for that email. An email the provider has not verified never gets in.
  - A new person gets a **personal workspace** (owner). One per person even when two sign-ins arrive at once (a unique index).
  - Then a **session**: a random 32-byte token in the `ak_session` cookie (HttpOnly, SameSite=Lax, Path=/, Secure on https, `SESSION_DAYS`). MongoDB keeps only its SHA-256, and deletes it when it expires (TTL index).
  - Refusals go back to `/?signin=not-invited`, `not-verified` or `failed`, always to `PUBLIC_URL` (no open redirect).
- **The guard:** every `/api` route needs a session, except `GET /api/me` (who is signed in, and the providers) and `GET /api/health`. `/healthz` and `/readyz` stay open. A change (POST, PUT, DELETE) whose `Origin` is another site is refused (403): SameSite=Lax lets the cookie through on top-level visits, so this stops cross-site requests.
- **`POST /auth/logout`** deletes the session and empties the cookie.
- **Invites:** `npm run invite -- add <email> [note]`, `remove <email>`, `list` (who has signed in). Emails are trimmed and lowercased.
- **The UI** (`web/src/sign-in.js`, `SignIn.jsx`): with sign-in on and no session, a sign-in screen with one button per provider and a plain reason after a refusal; the header shows the person and **Sign out**. A 401 later (expired, or signed out elsewhere) brings the sign-in back. Vite's dev server passes `/auth` through as well.
- **Compose** passes the settings to the `api` service (`deploy/.env.example`).

**Not in Step 29:** projects are not yet kept apart. Everyone signed in still sees every project and the same memory: that is Step 30. The live preview's own port has no sign-in yet: that is Step 34 (its own domain).

### RED

`e250dd5`: `test/auth.test.js` (settings, PKCE, GitHub and Google with `fetch` replaced, the cookie), `integration/auth.test.js` (the real API with `AUTH=on`, MongoDB, and fake GitHub and Google servers that check the PKCE proof like the real ones; the test is the browser and follows the redirects), `web/test/sign-in.test.js`. They failed: `src/auth/providers.js`, `src/auth/invites.js` and `web/src/sign-in.js` did not exist.

### GREEN

| Guarantee | Test |
|---|---|
| Nothing in the API without a session; health checks and `/api/me` stay open | integration: nothing in the API without signing in |
| An invited GitHub account signs in: HttpOnly, SameSite=Lax cookie, personal workspace (owner), the API opens | integration |
| Not invited: no session, no account kept | integration |
| An email the provider has not verified is turned away | integration (Google), unit (GitHub) |
| Another state, or another browser (no login cookie): refused | integration |
| The same verified email through Google is the same person and workspace; both identities kept | integration |
| MongoDB keeps only the token's hash | integration |
| Signing out empties the cookie and the old token opens nothing | integration |
| An expired session opens nothing | integration |
| A change sent from another site is refused (403); from our own address it works | integration |
| The settings: off by default, what `on` needs, pairs go together, a secret is never printed | unit (7) |
| The provider requests: our id, the way back, state, S256 challenge, scopes; the code traded with the verifier; a refused code fails with the provider's reason | unit |
| The UI: loading, straight to the app with sign-in off, a button per provider, a plain reason per refusal | web (5) |

**Suites:** unit 457 (was 438), integration 161 (was 151), Gateway 15, web 34 (was 29).

**Found on the Mac (first real sign-in):** the app was opened at `http://127.0.0.1:4000` while `PUBLIC_URL` was `http://localhost:4000`. To a browser those are two sites: the login cookie was set for 127.0.0.1, the provider sent the person back to localhost, and the cookie stayed behind ("unknown or used state, or another browser"). Now `/auth/<provider>/start` on any other address first moves to `PUBLIC_URL` (once, with `?moved=1`, so a proxy that rewrites the Host header can't make it loop). Test: integration, "a sign-in started on another address of this server moves to PUBLIC_URL first, once" (RED, then GREEN).

**Still to do by hand:** a sign-in with the real GitHub and Google. That needs an OAuth app at each provider, with the callback address allowed (see README, Configuration).

## Step 30: User B never sees or reuses user A's work

- **Projects** (`src/models/project.js`) carry `ownerId` and `workspaceId`, set from the session when a project is made. Every project route finds a project only inside the signed-in person's workspace (`findProject(req)` in `src/app.js`): another workspace's project answers **404**, as if it did not exist, so its id gives nothing away. The list shows only the workspace's projects. With sign-in off nothing changes: one person, every project.
- **Jobs, Contracts and page jobs** are reached only through their project, so the project's check covers them; they don't carry the owner themselves.
- **Memory** (`src/memory/index.js`, plan M2) has a `scope`: `ws:<workspaceId>`, `library`, or `local` when sign-in is off. `memoryScope(owner)` is required by every lookup, write, count and forget: a call without a project or person **throws** instead of searching everyone's memory. A lookup sees its own scope, then the library, preferring its own. The same piece is kept once per scope (unique index `scope + kind + key`; the old `kind + key` index is dropped once, before the first write). Rows from before Step 30 have no scope and stay local. Counting and **Clear memory** touch only the asker's scope; the library stays. Blobs are stored by content hash and shared, but a blob is reached only through a row of one's own scope.
- **The library** is searched by everyone, but nothing is added to it yet: promotion, with the owner's consent, comes in Step 39 (M5).

**Not in Step 30:** the live preview's own port still has no sign-in (Step 34).

### RED

`3bb5cef`: `integration/memory-scope.test.js` (memory per scope, with MongoDB) and a Step 30 block in `integration/auth.test.js` (two signed-in people, A uploads a project). They failed: `memoryScope` did not exist, projects had no owner, and B's list and routes reached A's project. `integration/memory-bands.test.js` now passes the local scope.

### GREEN

| Guarantee | Test |
|---|---|
| A new project belongs to its creator and their workspace | integration (auth) |
| B's list never has A's project | integration (auth) |
| Every route to A's project (11: project, contract read and edit, page, screenshot, files, file content, check report, preview start and stop, download) answers B 404; A still reaches it | integration (auth) |
| The same screenshot read in A is not found from B; B keeps its own reading; A's stays A's | integration (memory-scope) |
| A near copy of A's screenshot finds A's page from A only | integration (memory-scope) |
| A's verified button code is not offered to B | integration (memory-scope) |
| Counting and forgetting touch only the asking workspace | integration (memory-scope) |
| A library piece is found from any workspace, a workspace's own piece first; forgetting leaves the library | integration (memory-scope) |
| A lookup without a scope throws | integration (memory-scope) |
| Memory from before Step 30 is still found locally, never from a workspace | integration (memory-scope), memory-bands |

**Suites:** unit 457, integration 174 (was 162), Gateway 15, web 34.

## Step 31: A build runs on two user keys (BYOK)

Built in three pieces, each test-first.

### 31a: one adapter per provider

- **`shared/providers.mjs`:** `callModel({ provider, apiKey, model, prompt, imageB64?, json?, schema?, purpose })` for **Gemini, OpenAI, Anthropic, Groq and OpenRouter**, each in its own request shape: image + JSON (reading), image + HTML (pages), text (code). Groq and OpenRouter speak OpenAI's chat completions at their own addresses. Anthropic has no JSON mode, so its JSON is taken out of prose or a code fence.
- **Usage** goes on the meter (Step 25) under the provider's own name, with reasoning tokens apart where the provider counts them.
- **A busy provider** (429, 5xx) is tried again after 2, 5 and 10 s; a refusal is not.
- **The key never reaches an error message,** even when the provider repeats it back (OpenAI does): `redactKey` hides the key and anything key-shaped (`sk-…`, `gsk_…`, `AIza…`, including the shortened `sk-abc...wxyz` form).
- **`checkKey`:** one cheap request that needs the key (a model list, or OpenRouter's `/key`).
- `<PROVIDER>_BASE_URL` points a provider elsewhere (a proxy, a regional endpoint, the tests).

### 31b: the key vault and the two slots

- **Vault** (`src/keys/vault.js`): AES-256-GCM under `KEY_VAULT_SECRET` (64 hex characters, `openssl rand -hex 32`, checked at start and never printed), with a fresh IV each time and the workspace and key id as additional data: a sealed key copied to another workspace or row, changed, or read with another secret does not open.
- **`/api/keys`**, for the signed-in workspace owner: list, add, delete; `PUT /api/keys/slots`. A key is checked with its provider **before** it is saved; a refusal gives the provider's reason with the key hidden. Only the last 4 characters are ever answered (`ApiKey`'s JSON drops the sealed form). A key belongs to its workspace: another workspace can't see, delete or use it.
- **Slots** on the workspace: `frontend` (reading screenshots and drawing pages) and `backend` (custom button code), each a saved key plus a model from **the verified-models list** (`shared/models.mjs`) for that provider and slot. Deleting a key empties the slots that used it.
- **The verified list today:** Gemini 3.5 Flash (verified: pages, and 5/5 custom code), and Claude Sonnet 5.5, Opus 5.5 and Haiku 5.5 (listed, not yet examined). No OpenAI, Groq or OpenRouter model is listed yet: a model is added once it is known to exist and can do the job, and marked verified once it passes our page and code exams with a real key.
- **The log:** a request the API refuses (bad JSON, too large) is no longer logged, since its body may carry a key.
- **The UI:** a **Keys** screen (header, `#/keys`): the two slots, saved keys (provider, name, last 4) with Delete, and "Check and save". The key field is a password field and is emptied once saved.

### 31c: builds on the workspace's keys

- **A new project keeps its workspace's slots** (`project.keys`: key id, provider, model, last 4; never the key). An empty slot uses the server's models by mode, as before.
- **Frontend slot:** reads every screenshot and draws every page with that key and model. The page is drawn by the orchestrator itself (two tries): **a user's key never goes to Laptop B's Gateway**, which is for development only, and needs no ui-worker (the call is a plain HTTPS request).
- **Backend slot:** writes the custom buttons' code (the same write, test and repair loop as before).
- **The key is opened from the vault at the first call** (`src/keys/slots.js`) and kept only in memory. A key deleted since the project was made **stops the build with a plain reason**, and never falls back to models the person did not choose.
- Jobs and memory name the provider that did the work (`anthropic`, `gemini`, …) beside `local` and `cloud`.

### RED

- 31a `62d4742`: `test/providers.test.js` (fetch faked). Failed: `shared/providers.mjs` did not exist.
- 31b `4c47441`: `test/vault.test.js`, `integration/keys.test.js` (the real API with fake OpenAI and Anthropic key checks), `web/test/keys.test.js`, and `integration/helpers/signed-in-api.js`. Failed: no vault, models list or keys API.
- 31c `7e73393`: `integration/byok-build.test.js` (a whole build with a fake Anthropic for the frontend key and a fake Gemini for the backend key, and **no server model reachable**: no Ollama, no Gateway), `test/slot-keys.test.js`. Failed: projects did not use the slots.

### GREEN

| Guarantee | Test |
|---|---|
| Each provider's request shape for image + JSON, image + HTML and text; usage metered per provider | unit (providers) |
| A busy provider is tried again, a refusal is not | unit (providers) |
| The key is never in an error, even when the provider repeats it back | unit (providers), integration (keys) |
| The vault opens nothing for another workspace, key id or secret, or a changed ciphertext | unit (vault) |
| A key is checked before saving; refused keys are not saved | integration (keys) |
| Only the last 4 characters are ever answered; the database holds the key only encrypted | integration (keys) |
| A slot takes only a saved key of the workspace and a verified model of that provider for that slot | integration (keys) |
| Deleting a key empties its slots | integration (keys) |
| Another workspace can't see, delete or use a key | integration (keys) |
| A key in a request the API can't read (bad JSON) is not logged | integration (keys) |
| **A build on two user keys reaches READY:** the frontend key read and drew, the backend key wrote the code, with no server model reachable | integration (byok-build) |
| The project keeps which key and model each slot used, never the key; jobs name and meter the provider | integration (byok-build) |
| No key in any answer or in the log during a whole build | integration (byok-build) |
| A deleted slot key stops the build with a plain reason; no fallback | unit (slot-keys) |

**Suites:** unit 489 (was 457), integration 191 (was 174), Gateway 15, web 37 (was 34).

**Still to do with real keys:** a build on a real Anthropic or Gemini key, and running the page and code exams on the listed Claude models to mark them verified.


### Real run on the Mac (7 Nov 2026)

Sign-in on, the Mac's Builder API, the workspace's own Gemini key in both slots (`gemini-3.5-flash`), m1 with **Start fresh**: **READY in 50 s**. Every job names `gemini` as its provider, and Laptop B's Gateway got no job. This was the first build on a real user key; the first real sign-in worked on the way.

## Step 32: Quotas, fair scheduling, slowing down per key, and the outer layer

Built in three pieces, each test-first.

### 32a: the outer layer (`src/security.js`)

- **Security headers on every answer** (helmet 8.3): `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, no `X-Powered-By`.
- **A Content Security Policy for the UI:** scripts only from our own address; framed only by us; `object-src 'none'`; the live preview's own port is the one other frame allowed. Checked against the real built UI: one script and one stylesheet from our address, a `data:` icon, no outside address, no `eval`.
- **Generated pages are served as their own sandbox** (`Content-Security-Policy: sandbox allow-scripts`, `connect-src 'none'`): their scripts and Tailwind run, but even opened directly in a tab they are not our site, so they can't use our cookies or call our API. (The UI already showed them in a sandboxed frame; this covers a page opened on its own.)
- **Changes only from our own site,** with sign-in on or off: a POST, PUT or DELETE whose `Origin` is another site gets 403. With sign-in off this stops any website from changing this computer's Builder API (for example clearing its memory).
- **No CORS:** other sites' pages get no `Access-Control-Allow-Origin`, so they can't read our answers.
- **Rate limits**, counted in MongoDB (`rate_hits`, deleted when their window ends) so every API instance shares them, answered with **429, `Retry-After` and a plain sentence**: starting a sign-in 20 a minute per address, the API 600 a minute per person (or address), adding a key 10 an hour per workspace (each one asks its provider). If MongoDB can't count, the request goes on.

### 32b: quotas and fair scheduling (`src/quotas.js`)

- **A plan per workspace:** `free` (default) or `pro`, set with `npm run plan -- set <email> pro` until payments do it (Stage 7).
- **Builds per plan in a window of days** (a new project is a build): free 5 every 30 days ("a few builds a month"), pro 50 a day (fair use); `FREE_BUILDS`, `FREE_BUILDS_DAYS`, `PRO_BUILDS`, `PRO_BUILDS_DAYS`.
- **Past the quota, refused politely before anything is kept:** 429, `Retry-After`, and e.g. "The free plan builds 5 apps every 30 days, and this workspace has built 5. The next build is possible on 14 Dec 2026 10:30 UTC." `/api/me` shows the quota (plan, used, limit, window, when it frees up). Sign-in off: no quota.
- **Fair scheduling, pro first, then oldest:** a pro workspace's projects and pages carry priority 1. The orchestrator picks up waiting projects, and ui-workers claim waiting pages, in that order.
- **`BUILD_PARALLEL`** (default 4): one orchestrator builds at most that many projects at once; the rest wait in MongoDB and the next one starts when a build ends. Without such a cap, "pro first" would mean nothing.

### 32c: slowing down per key (`shared/limiter.mjs`)

- **Each user key runs at most 4 model calls at once** (limiters are kept by a hash of the key, never the key).
- **A 429 halves that key's limit** (never below 1) **and pauses it** for the `Retry-After` the provider asked (or Gemini's RetryInfo; else 2, 4, 8 … up to 30 s). Calls that go through raise the limit again, one step at a time.
- `callModel` therefore **slows down instead of failing** (up to 8 slower tries, a few minutes in all). A wait of **more than 5 minutes** is a daily or monthly limit: that fails at once with "this key's limit is reached …; try again in about N h".
- Per process: two services sharing a key each slow down on their own.

### Found on the way

- **The rare flaky integration test** (seen on 4 Nov and 6 Nov) showed itself once: `pressOnce` in `custom-writer.test.js` got "fetch failed" pressing a button in a generated app, and six runs of that file alone all passed. The press now reports fetch's cause (a refused or reset connection), so the next occurrence says why. Suspected, not proven: a kept-alive connection reused after a later generated app got the same port.
- **Line endings:** edit scripts run on Windows had written some files with CRLF; they are LF again (`25d24d7`, and this report).
- **MongoDB's Windows service on Laptop B was stopped** on 15 Nov and can only be started as administrator; the suites ran on a throwaway `mongod` in a scratch folder (the tests drop their database anyway).

### RED

- 32a `e24d188`: `integration/security.test.js` (an API with sign-in on and one with it off). One test was corrected while making it pass: the sign-in done before the tests is the first of the 20 a minute.
- 32b `5e00733`: `test/quotas.test.js`, `integration/quotas.test.js`.
- 32c `27c9238`: `test/limiter.test.js` (a fake provider that takes 2 calls at once and answers 429 to more). One check was corrected while making it pass: the limit is raised again as calls go through, so the test checks that the key slowed down, not where its limit ends.

### GREEN

| Guarantee | Test |
|---|---|
| Security headers on every answer; nothing about the server | integration (security) |
| The CSP: own scripts only, framed only by us, the live preview allowed | integration (security) |
| No CORS for other sites, also on a preflight | integration (security) |
| Generated pages in their own sandbox: scripts and Tailwind, no cookies, no API | integration (security) |
| A change from another site is refused with sign-in off too | integration (security) |
| Rate limits answer 429 with `Retry-After` and a sentence; counted in MongoDB | integration (security) |
| **The quota limit is refused politely:** 429, how many were used, when the next build is possible, nothing kept | integration (quotas) |
| A pro workspace has its own limit, and its projects go first | integration (quotas) |
| Waiting projects and pages are picked up pro first, then oldest | integration (quotas) |
| An orchestrator starts only as many projects as `BUILD_PARALLEL` allows | unit (quotas) |
| The quota settings, within bounds | unit (quotas) |
| **A "too many requests" answer slows us down instead of failing:** 10 calls at once against a provider that takes 2 all succeed | unit (limiter) |
| A throttle halves the limit and pauses; calls that go through raise it again; one limiter per key | unit (limiter) |
| A wait of hours fails at once and says when to try again | unit (limiter) |

**Suites:** unit 500 (was 489), integration 206 (was 191), Gateway 15, web 37.

## Stage 4 done on Laptop B

Steps 29–32 are built and merged into `main`. Real runs on the Mac so far: a real GitHub/Google sign-in, and m1 READY in 50 s on the workspace's own Gemini key. Waiting for the Mac check of Stage 4 (once per stage).

