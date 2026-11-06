# TDD evidence: Stage 4, users and keys

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 4 (Steps 29–32).

**Branch:** `stage4-users`.

**Suites, all on Laptop B:** Builder API unit and integration (MongoDB), web, Gateway.

| Step | What | Status |
|---|---|---|
| 29 | GitHub/Google sign-in, workspaces, invite list, secure cookie sessions | ✅ |
| 30 | `ownerId`/`workspaceId` on everything; memory per user plus a library scope (M2) | ✅ |
| 31 | BYOK: key slots, key vault, verified-models list, provider adapters | |
| 32 | Quotas, fair scheduling, adaptive concurrency per key, helmet/CSP/CORS/rate limits | |

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
