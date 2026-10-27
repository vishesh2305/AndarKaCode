# Production Architecture and Master Plan: AndarKaCode as a startup

**Status:** plan v1, 28 Oct 2026. The business model is approved; the steps below are saved for review before any code changes.
**Replaces:** old Steps 18 (Sandbox), 19 (GitHub login + Publish) and the rest of Step 17 in [plan.md](../plan.md). Old Step 20 (demo rehearsal) can still be done at any time, because Laptop B stays as a development provider.
**Related:** [ARCHITECTURE.md](../ARCHITECTURE.md) (v3.1, the prototype).

**Size:** 34 steps in 10 stages, about **12–16 weeks part-time**.
**How we work (unchanged):** every step is test-first (a RED commit, then a GREEN commit) with a report in `docs/tdd/`. After each step we stop for a check on the Mac, and the next step starts only after that result.

---

## 1. Goals

- **No user work runs on Laptop B.** Builds run on **two free servers**:
  - a **Frontend pool**: pages are built in parallel;
  - a **Control + Backend pool**: our own tools, plus custom AI code.
- Laptop B stays as a development and demo provider, to show parallel generation.
- **Users bring their own AI keys (BYOK), in two slots:** *frontend* (a vision model) and *backend* (a code model). One key can fill both. Users who don't want to bring keys use our **managed models** and pay with credits.
- **Our own tools do most of the work:** spec, templates, wirer, verifier, memory. AI is used only for reading screenshots, drawing pages, real logic, and extending the spec (as data wherever possible).
- **A complete, working product every time.** A coverage ladder handles every visible control. On managed credits, the user only pays for READY builds.
- **A cheap cache:** small index rows in MongoDB plus compressed blobs in R2, scoped per user, with a reviewed shared library and a nightly clean-up.
- **Secure:** sign-in, one user's data kept from another's, a sandbox for generated code, a key vault, trust & safety checks.
- **₹0 for infrastructure** (free tiers) until there are paying users. A domain is the only cost.

---

## 2. Why this can be a startup

### 2.1 The structural advantage

Coding agents (Claude Code, Codex, Lovable, Bolt) use AI for *everything*. They plan, write and fix in loops, so every app costs many AI calls. In AndarKaCode the backend, wiring and checking are **ordinary deterministic code**. AI only does what code can't: read the screenshot, draw the page, and the odd custom button. That means **lower cost per app, more predictable results and faster builds.** This cost structure is the core of the investor story.

### 2.2 Positioning

**One-liner:** *"Screenshot in, a working, tested full-stack app out in minutes. No prompts. Bring your own AI key, or use ours."*

| Customer worry | Coding agents | AndarKaCode |
|---|---|---|
| "I can't write prompts or code" | Needs both | Screenshots only |
| "Will it actually work?" | You test it yourself | A Check report: every button tested before download |
| "It built things I didn't ask for" | It often does | No evidence, no code: every part is traced to the screen element that needs it |
| "It's expensive" | Paid per seat or per use, and agent loops burn tokens | Free with your own key; few AI calls per app |
| "Am I locked in?" | Sometimes | Standard Express + MongoDB, on your own GitHub |

**First markets:**
1. Indian college students (final-year and lab projects are CRUD apps).
2. Small businesses needing internal tools (staff, leave, inventory, orders).
3. Designers and agencies handing off mockups.

**Honest moat:**
- Templates alone can be copied.
- The lasting advantages are:
  - the **cost structure** (few AI calls, plus BYOK);
  - the **verified component library** (it grows from builds whose owners agreed to share);
  - the **evaluation suite**;
  - a **distribution niche** that token-heavy tools can't serve profitably.

**Main risk:** a large player adds "upload a screenshot". Our answer is a lower cost per working app, and verification.

### 2.3 Business model

| Plan | AI paid by | Our cost per build | Gets |
|---|---|---|---|
| **Free (BYOK)** | User's keys | Sandbox CPU plus storage (very small) | A few builds a month, download as zip |
| **Pro (BYOK)**, a small monthly platform fee | User's keys | The same | Unlimited builds (fair use), private projects, GitHub publish, live preview, spec editing, longer memory |
| **Managed credits** | Us, charged back in the credit price | AI tokens plus compute | No keys needed, best verified models, priority queue; **pay only for READY** |
| **Team** | Either | | Shared workspace, shared library, roles |
| **Enterprise / on-prem** (later) | Their models | | Self-hosted license with open models |

**Pricing rule:** every plan's price must be **at least 3–5 times the cost of the builds it includes**. Target **gross margin: 70% or more** across all plans. Credit prices come from the Step 19 measurements, never from guesses.

```
cost_per_build (BYOK)    = sandbox_seconds × CPU price + storage + bandwidth
cost_per_build (managed) = Σ AI calls (input tokens × input price + output tokens × output price) + BYOK costs
```

**Revenue later:** hosting the generated apps (with a margin), a template marketplace, college licenses, agency white-label.

**Metrics an investor will want** (built in from Step 25 onward): time to a working app, share of builds READY on the first try, activation (upload → download), week-4 retention, free → paid conversion, cost per build, gross margin, coverage %.

---

## 3. Architecture

### 3.1 Speed comes from running things in parallel, not from the GPU

```
TODAY (Laptop B, 3 screenshots)
 read 1 ─ read 2 ─ read 3 ─ spec ─┬─ page 1 ── page 2 ── page 3 ─┬─ wire ─ check
                                  └─ backend ────────────────────┘          ≈ 6–10 min

PRODUCTION (two servers, cloud models)
 read 1 ┐                  ┌─ page 1 ┐  (Frontend pool)
 read 2 ├─ spec ───────────┼─ page 2 ├─┬─ wire ─ check
 read 3 ┘                  ├─ page 3 ┘ │                       target: under 2 min (set in Step 19)
                           └─ backend + custom buttons ──┘  (Backend pool)
```

**Total time ≈ one screenshot read + the slowest page + the check.** It no longer grows with the number of pages.

### 3.2 Services

```
 Cloudflare: DNS · TLS · WAF · rate limits · Pages (web) · R2 (blobs) · Tunnel (no open ports)
                                   │
 SERVER 1  Control + Backend                     SERVER 2  Frontend
 ├ api           sessions, uploads, SSE status   ├ ui-worker ×N   one page per job (frontend slot)
 ├ orchestrator  states, fan-out, Barrier        └ preview        separate domain, auto-stop
 ├ ai-router     adapters, slots, metering
 ├ key-vault     BYOK encryption
 ├ backend-worker templates + custom (backend slot), wirer, packager, publisher
 ├ verifier      sandbox: Docker + gVisor, no network
 ├ billing       plans, credits ledger, Razorpay
 └ trust-safety  abuse flags, reports
 Shared: MongoDB Atlas M0 (state, queue, ledger, memory index) · R2 (screenshots, pages, memory blobs)
 Dev only: Laptop B (S2C + GPU) = the "local-gpu" provider inside ui-worker
```

- **Two free servers:** Oracle Cloud Always Free. The ARM allowance is split into 2 VMs (2 cores / 12 GB each), and they talk over Oracle's free private network. Check the current free-tier terms when signing up.
- **The services are separate in the code, but grouped onto two machines.** Each service has its own folder, API and permissions. When there is revenue, each pool moves to its own machine, and later to managed Kubernetes, without rewriting anything.
- **Queue:** jobs live in MongoDB. Workers claim a job with an atomic `findOneAndUpdate` (`queued → running`) plus a `leaseUntil` time; expired leases are picked up again. The existing `Job` model already has nearly every field this needs. The Sync Barrier stays as "all jobs for this contract hash are done".
- **Repo layout after Stage 3:** `services/{api,orchestrator,ai-router,ui-worker,backend-worker,verifier}`, plus `shared/` (models, config, auth, schemas), `templates/`, `web/`, `gateway/` (dev only), `deploy/` (compose, CI).

### 3.3 One build, step by step

1. **Upload →** all screenshots are read **at the same time** (frontend slot).
2. **Spec**: rules only, takes milliseconds.
3. **Fan-out**, all at once:
   - **Frontend pool:** one job per page. Concurrency adapts to the key: start at N, and back off when the provider says "too many requests".
   - **Backend pool:** templates finish instantly; custom buttons are built in parallel (backend slot).
4. **Sync Barrier →** wire → check in the sandbox → **READY**. Pages appear live as each one finishes, and a timer shows "built in 84 s".

### 3.4 BYOK

- **Two slots:**
  - the frontend slot lets the user pick the best vision model;
  - the backend slot lets them pick a cheap code model;
  - two keys also spread the providers' rate limits.
- **One key can already run many requests at once**, so the slots are about choosing models, not mainly about parallelism. We don't encourage creating several accounts to get around a provider's limits.
- **Key vault:**
  - keys are encrypted with a master key held only in the server's secret store;
  - only ai-router can ask for a key to be decrypted, and keys are never logged;
  - each key is tested when it is saved and then shown only as `…a9F2`; the user can rotate or delete it;
  - a key is used only for its owner's projects.
- **Verified-models list:** users can only choose models that passed our evaluation suite. The UI shows each model's measured quality and speed.
- **Free AI capacity:** a small shared quota across several free providers (Gemini, Groq, OpenRouter, GitHub Models, Cloudflare Workers AI) lets people try it without a key. Free tiers may use the data to improve their models, so the privacy note says so.

### 3.5 Security and trust & safety

- **Sign-in:** OIDC (GitHub/Google), secure cookie sessions, an invite list for the beta, roles per workspace.
- **Isolation:** `ownerId`/`workspaceId` on every record and every query, with isolation tests.
- **Sandbox:** every generated app runs in a gVisor container: no network, CPU, memory, process and time limits, read-only image, no secrets, its own database. `custom/safety.js` stays as the first filter.
- **Preview** on its own domain (`preview.<domain>`), with auto-stop.
- **Edge:** helmet/CSP, CORS limited to our own domain, rate limits (Cloudflare WAF plus the app), and no open ports (Cloudflare Tunnel). The VM is reachable over SSH only through Tailscale.
- **Trust & safety:**
  - a famous brand's name on a login or payment form flags the build (phishing clones);
  - the terms of service say users must have the rights to what they upload;
  - a report button and an audit log.
- **Secrets** are stored in GitHub Actions and in the VM's `.env` (permissions 600); later in a cloud secret manager.

---

## 4. A complete working product: the coverage ladder

Our templates are **building blocks**, not whole apps: model, list, search, filter, page, sort, create, edit, delete, relations, status buttons, export, stats, login. So a new screenshot is usually **a new combination of existing blocks**, and needs no new backend.

| Kind of "new" | Example | How we handle it |
|---|---|---|
| A. New combination | Hospital, school, inventory | Existing blocks, no AI |
| B. New view of the same data | Kanban, calendar, gallery, timeline | View blocks: date-range filter, group by field, move between columns |
| C. New shape of data | Upload, settings page, comments, tags, "mine only" | Data-shape blocks (built once) |
| D. New behaviour | "Calculate Total", "Duplicate" | AI custom operation (Step 13: fixed function shape, safety check, tests, sandbox) |
| E. A new feature area | Booking with free slots, quiz scoring | **AI proposes a spec extension (data)**; our generator writes that code; AI writes only the logic |
| F. Outside services | Pay, email, SMS, map | Integration blocks with a working mock mode, plus setup steps |
| G. Truly unclear | A "Sync" button with no clues | Ask the user one question, with a sensible default |

```
 every visible control
  1. existing block?            → template                 (no AI)
  2. new view of known data?    → view block               (no AI)
  3. known new data shape?      → data-shape block         (no AI)
  4. needs new data?            → AI spec extension (JSON + evidence) → our generator
  5. needs logic?               → AI custom operation/module (fixed shape, safety, tests, repair ×3)
  6. outside service?           → integration block in mock mode
  7. still unclear or failing   → ask the user → retry; else that control is "needs attention" and named in the report
```

**Rules:**
- **AI writes data, not code, wherever possible.**
- **READY** means every visible control was used once in the sandbox and worked.
- A **partial result** names exactly what doesn't work. Nothing is shipped broken without saying so.
- On managed credits, **only READY builds are paid in full**, and credits for parts that don't work are given back.

**Gap in the prototype that Step 36 fixes:** the inventory has fixed slots (tables, forms, buttons, stat cards, auth, navigation). A control with no slot (a star rating, an upload box, a calendar cell) is dropped without a word, and the Verifier can't see it.

**Flywheel:**
1. Everything handled on rung 4 or higher is logged.
2. The most common ones become new blocks.
3. AI modules that keep passing join the shared library, after owner consent, removing private data and review.
4. Coverage % rises; cost and build time fall.

---

## 5. Keeping the cache cheap (memory at scale)

**The prototype's problems:**
- Page HTML is stored inside MongoDB (the free tier has 512 MB).
- Nothing ever expires.
- The near-duplicate search loads every candidate and compares them one by one.

**The economics:** a compressed page is about 5–10 KB, so one million pages ≈ 10 GB in R2, which costs a few cents a month (R2 doesn't charge for downloads). One AI page call costs far more than keeping its result for years. So: **keep what gets reused, store it in the cheap place, delete what doesn't.**

```
 lookup ─► L1 worker memory (LRU, a few MB)   hottest library items
           │ miss
           ▼
           L2 MongoDB: small INDEX rows only   key, fingerprints, scope, version, bytes, hits, lastUsedAt, blob hash
           │ hit
           ▼
           L3 R2: compressed BLOBS named by their content hash (identical content stored once)
```

- **Lookups:**
  - exact repeats use an indexed `findOne`;
  - near-duplicates use **fingerprint bands**: the 64-bit dHash is split into 7 indexed pieces, so distance ≤ 6 means at least one piece matches exactly;
  - every search is first narrowed by `scope + kind + version`;
  - search by meaning (embeddings) is added only if the numbers show it helps.
- **Two scopes:**
  - **private** (Free: kept 30 days after last use; Pro: 1 year; a cap on entries per user);
  - **shared library** (curated, reviewed, kept small, kept indefinitely).
  - Content-hash dedupe saves storage only. Reuse between users happens only through the library.
- **Nightly clean-up:** expired entries, old versions (every key includes the generator, template and prompt version), and, when over budget, the lowest `value = (hits + 1) × secondsSaved ÷ bytes ÷ days since last use`.
- **Never cached:** zips (rebuilt on request), preview and sandbox databases, failed AI outputs, versions that never reached READY. Screenshots follow the 14-day retention rule; memory keeps only their hash and fingerprint.
- **Dashboard:** hit rate, bytes, AI calls saved, money saved vs money spent, per kind. A kind that doesn't pay for itself stops being stored.

---

## 6. Patterns to follow

| Category | Source | Pattern |
|---|---|---|
| Naming / comments | `builder-api/src/orchestrator.js:1-2` | Small ES modules; a plain-English header comment that links to an ARCHITECTURE.md section |
| Errors | `builder-api/src/orchestrator.js:47`, `builder-api/src/server.js:299-306` | `runJob` marks the job `failed` with its message cut to length; the project goes to `NEEDS_ATTENTION`; the API hides internal errors |
| Logging | `builder-api/src/orchestrator.js:36` | `[projectId] STATE: error`, which becomes JSON lines with the same fields |
| Service auth | `gateway/src/auth.js:6` | Constant-time key check, reused between services |
| Data access | `builder-api/src/models/common.js`, `builder-api/src/models/memory.js` | Mongoose plus shared `schemaOptions` (`id`, never `_id`), indexes declared in the model |
| Versioned keys | `builder-api/test/memory-keys.test.js` | `READING_VERSION`-style hashes in keys, so old entries stop matching on their own |
| Schemas | `shared/inventory.schema.json` | JSON Schema for every AI output |
| Tests | `builder-api/test/`, `builder-api/integration/`, `web/test/` | `node:test` with describe/it and plain-English test names; RED then GREEN; TDD report per step |

---

## 7. The steps

### Stage 1: Prove (≈1 week). Decides how Stage 3 is built and what credits cost
| Step | What | Done when |
|---|---|---|
| **18** | **Page-generation spike:** a single model call per page vs S2C, on cloud models, across the 8 sample mocks | A table of time, markers present and how close it looks, with a decision |
| **19** | **Cost and speed measurement:** tokens, seconds and cost per stage and per build; rate limits per key; blob sizes | `docs/economics.md` gives the cost per build, a draft of credit prices, and the speed target |

### Stage 2: Foundation, still one process (≈1.5 weeks)
| Step | What | Done when |
|---|---|---|
| **20** | Config module (fails fast on missing settings), `/healthz` and `/readyz`, JSON logs | All suites green; a missing setting gives a clear error at start |
| **21** | Storage interface (`local` or `r2`) for screenshots and artifacts; **memory payloads become compressed blobs named by their hash, and MongoDB keeps only index rows** (M1) | READY with each storage setting; each memory row under 1 KB |
| **22** | Job queue plus project leases in MongoDB, replacing the in-memory `active`/`rerun` sets | Killing a build mid-way and restarting finishes it once, never twice |
| **23** | **Screenshots read in parallel**; a version in every cache key | Reading 3 screenshots takes about as long as reading 1 |

### Stage 3: Microservices, two servers simulated on the Mac (≈2 weeks)
| Step | What | Done when |
|---|---|---|
| **24** | Split `api` and `orchestrator` into `services/`, with `shared/` and Docker Compose | The same project reaches READY through Compose |
| **25** | `ai-router` service: adapters (Gemini, Ollama, then OpenAI, Anthropic, Groq, OpenRouter), slots, token metering | Every AI call goes through it, with tokens and seconds recorded on the Job |
| **26** | `ui-worker` (the method chosen in Step 18), with Laptop B as the `local-gpu` dev provider | 3 pages are built at the same time |
| **27** | `backend-worker` and `verifier` services | The backend is built at the same time as the pages; the Barrier still waits for both |
| **28** | Compose profiles `server-1` and `server-2`; a test that kills a worker mid-build; **fingerprint bands for near-duplicate search** (M3) | Builds survive a killed worker; a test with 100,000 entries still finds the near-duplicate fast |

### Stage 4: Users and keys (≈2 weeks)
| Step | What | Done when |
|---|---|---|
| **29** | GitHub/Google sign-in, workspaces, invite list, secure cookie sessions | Only invited accounts get in |
| **30** | `ownerId`/`workspaceId` on everything; **memory scoped per user, plus a library scope** (M2) | Isolation tests: user B never sees or reuses user A's work |
| **31** | **BYOK:** frontend and backend key slots, key vault, verified-models list | A build runs on two user keys; a key never appears in logs or API responses |
| **32** | Quotas, fair scheduling (paid ahead of free), adaptive concurrency per key, helmet/CSP/CORS/rate limits | The quota limit is refused politely; a "too many requests" answer slows us down instead of failing |

### Stage 5: Safety (≈1.5 weeks). Required before any outside user
| Step | What | Done when |
|---|---|---|
| **33** | Sandbox: gVisor containers, no network, limits, a database inside the sandbox | Attack tests are blocked; the employees sample reaches READY 8/8 |
| **34** | Preview on its own domain, auto-stop | A preview can't read the main site's cookies |
| **35** | Trust & safety: a famous brand's name together with a login or payment form is flagged; report button; audit log | A bank-login mock is held for review |

### Stage 6: Complete apps, the coverage ladder (≈3 weeks)
| Step | What | Done when |
|---|---|---|
| **36** | **Catch everything:** `otherControls` in the inventory; the deriver sends each one up the ladder; the Verifier fails on any visible control not backed | Unknown controls are named in the report and never dropped silently |
| **37** | Blocks batch 1: upload, settings (one record), child records, tags, "mine only", date range, group-by, move between columns, reorder | Kanban, calendar, profile and blog-with-comments mocks reach READY with no AI backend code |
| **38** | **AI spec extensions** (JSON plus evidence, schema-checked), plus **spec editing in the UI** (the rest of old Step 17) | A booking mock gets AI-proposed entities that the user can review and edit |
| **39** | AI custom modules; library promotion (owner consent, private data removed, review) (M5) | "Book if free" passes its tests; a promoted button is reused in another user's app |
| **40** | Integrations in mock mode (email, payment, SMS, maps) plus setup steps | A "Pay" button works in mock mode |
| **41** | Ask the user (one question), then retry; an honest partial result | An unclear button produces one question; answering it gives READY |

### Stage 7: Money (≈1.5 weeks)
| Step | What | Done when |
|---|---|---|
| **42** | Plans plus a credits ledger (idempotent, built on transactions), using the metering from Step 25 | Every managed build deducts exactly what it cost × the price |
| **43** | Razorpay (test mode first), webhooks, **pay only for READY** (refunds for parts that don't work) | A test payment adds credits; a partial build refunds the right amount |
| **44** | Pricing page, usage page, BYOK settings page | You can see the whole money flow in the UI |

### Stage 8: Speed and user experience (≈1 week)
| Step | What | Done when |
|---|---|---|
| **45** | Live status (SSE), each page shown as soon as it's built, build timer, onboarding with sample screenshots | A 3-page build meets the speed target from Step 19 |

### Stage 9: Go live (≈1.5 weeks)
| Step | What | Done when |
|---|---|---|
| **46** | Two free Oracle ARM VMs, private network, Cloudflare (Tunnel, Pages, R2, WAF), Atlas, GitHub Actions → GHCR → deploy | Phone on mobile data: sign in → BYOK build → download |
| **47** | Operations: Sentry, UptimeRobot, nightly backup to R2 plus a test restore, **cache clean-up job** (M4), runbook | A deliberate crash is seen in Sentry; the restore works; expired cache entries are removed |
| **48** | Terms of service, privacy policy (DPDP Act, GDPR), "Delete my data", **publish to GitHub through a GitHub App** (old Step 19) | Legal pages are live; a READY app is pushed to the user's repo and its CI turns green |

### Stage 10: Beta and growth (ongoing)
| Step | What | Done when |
|---|---|---|
| **49** | Coverage evaluation set (50–100 screenshots) plus dashboards: coverage %, READY rate, cost per build, cache savings (M6) | Every release is compared against these numbers |
| **50** | Beta: 5 → 20 → 50 invited users | Real numbers for activation, retention, time to a working app |
| **51** | Investor pack: one-pager plus deck built on the beta numbers | Ready to share |

### Cut lines

- **Free beta (BYOK, invite-only):** after Steps **18–36**, then **46–48**. About 9–10 weeks. This needs safety, isolation and coverage, but no billing.
- **Paid launch:** after Steps **37–45**. Managed credits and pay-only-for-READY.

### Non-code tasks, alongside the steps
Domain · company registration (needed for Razorpay KYC and GST invoices) · DPIIT Startup India recognition · applications to startup credit programs (Google, AWS, Microsoft, Anthropic) · a lawyer's review of the terms of service and privacy policy before the paid launch.

---

## 8. Main files that change

| Path | Action | Why |
|---|---|---|
| `builder-api/src/*` | Move into `services/*` (Stage 3) | Microservices |
| `shared/config.js`, `shared/storage/*`, `shared/queue.js` | Create | Steps 20–22 |
| `builder-api/src/models/memory.js`, `builder-api/src/memory/*` | Update | Blobs, scope, bands, value fields (M1–M4) |
| `builder-api/src/orchestrator.js` | Update / split | Leases, parallel reading, fan-out through the queue |
| `builder-api/src/ai/vision.js`, `builder-api/src/custom/model.js` | Move into `ai-router` | Adapters, slots, metering |
| `shared/inventory.schema.json`, `builder-api/src/spec/derive.js` | Update | `otherControls`, coverage ladder, spec extensions |
| `templates/backend/*` | Add blocks | Batch 1 (Step 37) |
| `builder-api/src/verify/app-runner.js` | Replace the process runner with containers | Sandbox |
| `services/{key-vault,billing,trust-safety}` | Create | Stages 4, 5 and 7 |
| `web/src/*` | Update | Sign-in, BYOK, spec editing, live pages, pricing and usage |
| `deploy/*`, `.github/workflows/*` | Create | Compose, CI/CD, backups, clean-up |
| `ARCHITECTURE.md`, `plan.md`, `docs/economics.md` | Update / create | Keep the documents true |

## 9. How each step is checked

```bash
cd builder-api && npm test                                    # unit
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:integration
cd ../web && npm test                                         # UI logic
npm run eval:inventory && npm run eval:custom                 # model quality gates (and the new page eval, Step 18)
docker compose --profile server-1 --profile server-2 up       # from Stage 3 onward
```

Plus a check on the Mac after every step.

## 10. Risks

| Risk | Level | What we do about it |
|---|---|---|
| Single-call pages worse than S2C | High | Step 18 decides before any rewrite; S2C could also run on the Frontend server calling cloud models |
| Free AI quotas / BYOK model quality | High | BYOK, several providers, verified-models list, Check report |
| AI code escapes the sandbox | High | Stage 5 before any outside user |
| Data leaking between users (including the cache) | High | Isolation tests (Step 30); content-hash dedupe never implies reuse |
| Phishing clones or copyright misuse | High | Step 35 plus the terms of service |
| A large player adds screenshot-to-app | High | Cost per working app, verification, the India student/SMB niche |
| Scope too big for one founder | High | Cut lines, strict order, stop after any stage |
| Underpricing managed credits | Medium | Prices come from the Step 19 numbers; margin dashboard |
| Leaked user keys | Medium | Key vault, least privilege, never logged, rotate and delete |
| Free tiers change, or Oracle reclaims a VM | Medium | Portable Compose; fallback to one VM or Laptop A behind a Tunnel |
| Breaking what works today | Medium | All suites green at every step; Stage 2 before the split |

## 11. Decisions

**Approved:** the business model (BYOK Free and Pro, managed credits, Team, Enterprise later).

**Assumed, to confirm before Step 18:**
1. Oracle Cloud Always Free, with 2 ARM VMs as the two servers.
2. First market: Indian students plus small businesses with CRUD/admin apps.
3. Razorpay first, Stripe later.
4. "AI writes data, not code, wherever possible."
5. Pay only for READY on managed credits.
6. Cache retention: Free 30 days, Pro 1 year; a small reviewed shared library.
7. Block batch 1 as listed in Step 37.

## 12. Acceptance

- [ ] Every step's "Done when" is met and checked on the Mac
- [ ] All test suites and model evaluations pass at every step
- [ ] Patterns in §6 are followed, not reinvented
- [ ] ARCHITECTURE.md and plan.md are updated as each stage lands
