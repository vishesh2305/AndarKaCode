# TDD evidence: Stage 5, safety

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 5 (Steps 33–35). Required before any outside user.

**Branch:** `stage5-safety`.

**Suites, all on Laptop B:** Builder API unit, integration (MongoDB) and the new sandbox suite (Docker), web, Gateway.

| Step | What | Status |
|---|---|---|
| 33 | Sandbox: containers, no network, limits, a database inside; the verifier as its own service | ✅ (33a, 33b, 33c); gVisor itself not run yet (see below) |
| 34 | The live preview on its own site, auto-stop | ✅ (34a, 34b) |
| 35 | Trust & safety: brand + login/payment held for review; report button; audit log | ✅ |

## Step 33: the sandbox, and the verifier as its own service

### 33a: the sandbox (`src/verify/sandbox.js`, `deploy/sandbox/`)

Each generated app runs in a container of its own:

- **On its own Docker network, made `--internal`:** no internet, no DNS, not this computer, not our MongoDB, not another sandbox.
- **A plain user (1000) with no capabilities** (`--cap-drop ALL`, `no-new-privileges`), and an init that reaps processes.
- **A read-only image.** The only writable places are small scratch spaces in memory: `/app` (written once by root, read-only for the app), `/data/db`, `/tmp`.
- **Limits:** 768 MB of memory with no swap, 1 CPU, 256 processes, and a time limit (the keeper ends the sandbox; Docker removes it).
- **None of our folders and none of our settings.** The app's files are copied in as a tar (`tar.js`, written here so no tar program is needed on Windows or macOS). The packages come from the image (`/node_modules`: Express and Mongoose at exactly the Builder API's versions).
- **Its own MongoDB inside** (`keeper.mjs`), so the app needs no network at all.
- **Our door** (`door.mjs`, a second small container that never runs the app's code) forwards our connections to the app and its database, published on this computer's loopback only.
- **gVisor:** `SANDBOX_RUNTIME=runsc` runs the sandbox in it.

A sandbox opens in about 1.2 s and the app starts in 0.4 s.

**Attack tests** (`sandbox-tests/sandbox.test.js`). Each one runs as the app's own user, inside its sandbox, as if the code had got past `custom/safety.js`. Seen on Laptop B:

| Attack | Result |
|---|---|
| The internet | `ENETUNREACH`; DNS `EAI_AGAIN` |
| This computer, Docker's gateway, ports 27017, 4000, 8787 | blocked |
| Another app's sandbox | blocked |
| Our settings and keys | none inside |
| User and capabilities | uid 1000, CapEff 0 |
| Writing its own code, the image, `/etc` | refused; `/tmp` works |
| Our folders | none mounted |
| 400 processes | 219 refused |
| 2.5 GB of memory | the process is killed (137); the sandbox carries on |
| Running past its time limit | stopped |

### 33b: everything that runs a generated app uses a box (`src/verify/box.js`)

- The Verifier (its own tests in the same box), the button tester and the live preview all open a box.
- **`SANDBOX=docker`:** a sandbox. **`SANDBOX=process`** (the default, for development): a process here on our throwaway databases, as before.
- **Time limits:** 15 min to verify, 5 min to press a button, `PREVIEW_MAX_MS` (4 h) for a preview.
- **Outside users** (`NODE_ENV=production` with sign-in on) **only with the sandbox**, wherever apps run. Sign-in on with `SANDBOX=process` is a warning at start.

### 33c: the verifier as its own service (`ROLE=verifier`, `src/verifier.js`)

- **A box queue in MongoDB** (`box_jobs`): "verify" and "press". Pro first, then oldest; a lease that another verifier takes over when it runs out.
- **The orchestrator's lane** (`verify/lane.js`) runs them inline, or with `VERIFY_LANE=queue` through the verifier. It is the one service that may start sandboxes.
- **`SANDBOX_REACH=network`:** a verifier running in a container joins each sandbox's network while it lives (no door; the door's loopback ports are out of its reach).
- **Compose:**
  - the verifier service gets the Docker socket (the Docker CLI and the sandbox image's build context are in the image);
  - the orchestrator runs on `VERIFY_LANE=queue`.

**Done when "the employees sample reaches READY 8/8"** (Compose on Laptop B, the Gateway drawing pages): **8 of 8 READY.** Each build was verified by the verifier container in a sandbox: 8 checks passed each time, in 3.3–4.3 s. The first build was fresh (118 s); later ones reused memory (6 s).

## Step 34: the live preview on its own site

### 34a: the preview as its own service (`ROLE=preview`, `src/preview-service.js`)

- **The api service runs no generated app.** It asks for a preview through MongoDB (`previews`). The app's files (a tar) and its starting rows travel in the request, since server 2 shares no disk with server 1.
- **The preview worker** (also inside `ROLE=all`):
  - unpacks the request (`untarTo` checks every checksum and refuses names outside the folder);
  - runs the app in a box and gives it a secret address, `/preview/<project>/<32-character token>/` (nothing without the token);
  - keeps MongoDB up to date (running, stopped, failed, a heartbeat);
  - stops what was asked to stop, or replaced by a newer version.
- **Reuse:** the same version reuses the running preview. A preview whose service went quiet is started again.
- **`ROLE=api` needs `PREVIEW_ORIGIN`.** In Compose the preview service is on server 2, with the Docker socket.
- Through Compose on Laptop B: a preview in its sandbox in 1.6 s with the screenshot's rows; 404 without its token; stopped on request.

### 34b: another site (`src/sites.js`)

- **Cookies follow sites, not ports.** With sign-in on, a `PREVIEW_ORIGIN` on the same site as `PUBLIC_URL` (the same host, another port, or a subdomain) is refused.
- **On one computer** the preview's address is another site than the one people open: `127.0.0.1` when they open `localhost`, and the other way round.
- **The session cookie is host-only.** A page on the preview's site can't change anything through our API (403), nor read its answers (no CORS).
- **Through the preview's address:**
  - no cookie reaches the app, and none comes back;
  - `Referrer-Policy: no-referrer`, so the token doesn't leave in a Referer (to the Tailwind CDN, say);
  - `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
- **Auto-stop:** after `PREVIEW_IDLE_MS` without use (Step 16), or `PREVIEW_MAX_MS`.

## Step 35: trust & safety

- **The check** (`src/safety/brands.js`): a famous brand's name together with a login form, or a payment form (card number, CVV, UPI PIN...), anywhere in the same app, is flagged.
  - About 50 brands: Indian and global banks, payment services, big sign-ins, government services.
  - Only the screen's own words count (titles, form labels, buttons); table rows don't. Matches are whole words.
  - "Sign in with Google" doesn't count.
- **Held for review** (`src/safety/review.js`):
  - The check runs right after reading, before any page is drawn or any model is paid for. The project becomes `HELD`, saying why.
  - While held or blocked: no spec edit, no preview, no download.
  - A reviewer uses `npm run review -- held | release <id> "note" | block <id> "note" | reports | close-report <id>`. A released project is built like any other; a blocked one (`BLOCKED`) can no longer be previewed or downloaded.
- **Reports:** "Report a problem" in the header (`POST /api/reports`): a reason (5–2000 characters), and the project or address it is about. At most 10 an hour per person.
- **The audit log** (`audit_events`, `src/audit.js`):
  - **What it keeps:** sign-in, refused sign-ins, sign-out, keys (the provider and last four characters only), slots, new projects, previews, downloads, reports, reviews, plans and invites.
  - **Who:** a person, a reviewer, or one of our services.
  - **How it is kept:** only ever added to, for a year. It has no API route; `npm run audit` reads it.
- **The UI:**
  - held and blocked in the project list;
  - a notice on the project;
  - the Plan station shows "Held for review" with why.

**Done when "a bank-login mock is held for review":** HDFC Bank NetBanking with Customer ID and Password is held after reading, with no page sent to be drawn. Released, it reaches READY; blocked, no preview or download. The audit log has held, released and blocked, with who and why.

## RED and GREEN

| Piece | RED | GREEN |
|---|---|---|
| 33a sandbox | `d276c80` | `bed3dfe` |
| 33b boxes | `9c4770c` | `4e323e9` |
| 33c verifier service | `eab1403` | `16a89cc` |
| 34a preview service | `596e463` | `17a067a` |
| 34b another site | `a0e8e6e` | `4f1101b` |
| 35 trust & safety | `9e603f4` | `438c7ec` |

**Test changes made while making them pass** (each one named in its GREEN commit):
- **34a:** the pipeline test's preview addresses now carry the token (new behaviour).
- **34b:** the sign-in tests' preview moved to `localhost`, another site than their `127.0.0.1`.
- **35:** the case of "held for review" in one assertion, and a MongoDB connection for the reviewer's side of the pipeline test.

**Suites:**

| Suite | Before | Now |
|---|---|---|
| Unit | 500 | 537 |
| Integration | 206 | 237 |
| Sandbox (new; needs Docker) | — | 22, gVisor skipped here |
| Gateway | 15 | 15 |
| Web | 37 | 41 |

## Not done here

- **gVisor itself.** It needs Linux. Laptop B and the Mac run Docker Desktop, which has no `runsc`. Adding it to Docker Desktop's VM would change Docker's own settings, so it was left for a decision. The sandbox passes `--runtime runsc` when `SANDBOX_RUNTIME=runsc`, and the suite has a gVisor check that runs there. To do on the first Linux server (Stage 9), or in a Linux VM.
- **One origin for every preview.** Previews share the preview site, so one preview's page could read another's storage on that origin. It holds only its throwaway sign-in, and the address's token keeps them apart otherwise. A wildcard domain (`<token>.preview.<domain>`) gives each preview an origin of its own; it comes with the domain and TLS (Stage 9).

## Stage 5 done on Laptop B

Steps 33–35 are built. Waiting for the Mac check of Stage 5 (once per stage).
