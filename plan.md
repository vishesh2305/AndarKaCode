# Roadmap: AI Frontend-to-Backend Builder

> **Design:** see [ARCHITECTURE.md](ARCHITECTURE.md) (v2, approved). This file is our **step-by-step to-do list**.
> **Rule:** do one step, report back, then move on. Tick the box when its "Done when" is true.

**Current step:** ▶ **Step 9: State machine + Sync Barrier**

---

## How we work on each step

Every step has four parts:
- **Why:** what this step proves or builds.
- **You do:** the hands-on tasks (we write any code together, in small pieces).
- **Done when:** a clear test that the step is finished.
- **Report back:** what to send, so we can check it and move on.

---

## Phase 1: Prove the risky parts first (small experiments)

*Why first:* if local models can't do the job, we want to know **now**, not after building everything else.

- [x] **Step 1: Ollama on Laptop B's GPU.** ✅ 14 Oct: runs well on the GPU; correctly identified the screenshot's columns and buttons. Install Ollama, pull `qwen3-vl:8b`, and confirm it runs **100% on the GPU**.
- [x] **Step 2: Screenshot-to-Code on Laptop B (local model).** ✅ 15 Oct: works with local `qwen3-vl:8b` (alias `gpt-5.5`), about 60–70% match, **over 5 min** per page. Run it with Ollama behind it, apply the 1-variant patch, generate one dashboard through *its own* UI, and capture the WebSocket messages in DevTools.
- [x] **Step 3: Contract instructions + backup key.** ✅ 15 Oct: local 3 min 38 s, Gemini 30 s. All `data-field` markers present in both; local missed `data-action="create"`; one output had no `SAMPLE_EMPLOYEES`. Send field names and `data-field` / `data-action` markers as text with the image, and check they appear in the HTML. Try the cloud key path once.
- [x] **Step 4: Contract Extractor experiment (Laptop A).** ✅ 15 Oct: Laptop B 12 s, Mac 20.1 s, all checks passed (`employees.png`). More screenshots and `--cloud` still to try. A small Node script: screenshot → Ollama → valid Contract JSON. Time it.

## Phase 2: Connect the two laptops

- [x] **Step 5: Project repo skeleton.** ✅ 15 Oct: folders, root README, `.gitignore`, one `.env.example` per service. One Git repo for both laptops: folders for `gateway/`, `builder-api/`, `web/`, `templates/`, `spikes/`, `samples/`, plus `.gitignore` and `.env.example`.
- [x] **Step 6: Gateway on Laptop B.** ✅ 15 Oct: health, auth, queue, REST jobs; user's run 132 s local, 16 `data-field`. Our first real service: `POST /v1/generations`, `GET /v1/generations/:id`, `GET /v1/health`, with an API key and a queue.
- [x] **Step 7: Tailscale + first call between the laptops.** ✅ 15 Oct: Mac → Gateway over Tailscale, local generation 104 s, `contractHash` matches. `curl` from Laptop A → Gateway on B → HTML comes back.

## Phase 3: Orchestrator on Laptop A

- [x] **Step 8: Builder API skeleton.** ✅ 16 Oct: on the Mac, MongoDB `builder_db`, upload → `UPLOADED`, `/api/health` reaches the Gateway. Express + MongoDB, `projects` / `jobs` / `contracts` models, upload endpoint.
- [ ] **Step 9: State machine + Sync Barrier.** Upload → Contract → both branches run → the Barrier checks `contractHash`.

## Phase 4: Generate, wire, verify

- [ ] **Step 10: Backend Generator.** Contract → Express/Mongoose code + generated API tests (from our templates).
- [ ] **Step 11: Wirer.** Babel AST: replace `SAMPLE_*` with `fetch`, connect `data-action` buttons.
- [ ] **Step 12: Verifier + repair loop.** Contract check, boot check, API tests; automatic repair with an "update" job.

## Phase 5: Ship to the user

- [ ] **Step 13: Our React UI.** Upload, live status, Contract review and edit, download.
- [ ] **Step 14: Sandbox preview.** Docker, with limits and no secrets, plus a Playwright smoke test.
- [ ] **Step 15: GitHub login + Publish.** OAuth App, encrypted token, create a repo and push one commit, CI turns green.
- [ ] **Step 16: Demo rehearsal.** Demo mode, warm cache, backup video, viva practice.

---

## Notes and decisions log

| Date | Note |
|---|---|
| 13 Oct 2026 | Laptop A: Apple M5, 16 GB, Node 26, Python 3.14, Poetry 2.5, Ollama installed (`qwen3-vl:8b` present). No Docker or MongoDB yet. |
| 14 Oct 2026 | Laptop B: RTX 4060 8 GB VRAM, 16 GB RAM. OS: _to fill in_. |
| 14 Oct 2026 | Architecture v2 approved: contract-first sync, local-first with a cloud backup key, GitHub publish. |
| 15 Oct 2026 | Laptop B OS: **Windows 11**. Screenshot-to-Code at `Desktop\screenshot-code\screenshot-to-code`; patch = 2 variant lines + 2 Windows fixes (`main.py` UTF-8, `start.py` event loop). |
| 15 Oct 2026 | Frontend style: **`html_tailwind`**. The Wirer must not depend on `SAMPLE_*` (models sometimes skip it): render rows from the first `data-field` table row. A missing `data-action` goes to the repair step. |
| 15 Oct 2026 | S2C picks Ollama over Gemini when an OpenAI key is in its `.env`, so the Gateway's cloud mode needs that key removed from `.env`. |
| 15 Oct 2026 | Contract Extractor: use **`qwen3-vl:8b-instruct`** (the thinking variant returns empty `content` with structured output). Test on Laptop B: 12 s, correct Contract. Enum options only list values visible in the screenshot, so the user should review them. |
| 15 Oct 2026 | Contract Extractor on the Mac: 20.1 s, all checks passed. Still untested: other screenshots, Gemini `--cloud` path. |
| 15 Oct 2026 | Repo: one `.env.example` per service (each runs on a different laptop). Gateway port 8787, Builder API port 4000. `1.html` moved to `samples/step3-cloud.html`. |
| 15 Oct 2026 | Gateway piece 1 done (`/v1/health` + `X-API-Key`). Health showed `gpt-5.5` only **68% GPU** (8.1 GB at 16k context): the §5.2 Ollama settings were never set (flash attention off, KV cache fp16). Likely cause of the 3 min 38 s local time. Also: Ollama not on PATH; tray app's server failed to start once. |
| 15 Oct 2026 | Applied §5.2 Ollama settings + Ollama on PATH. `gpt-5.5` still can't reach 100% GPU (Windows keeps ~1 GB VRAM): 16k ctx = 78% GPU, 29.6 tok/s; 12k = 84%, 34.7 tok/s; 8k = 89%, 39 tok/s. Kept 16k for now; decide after piece 2 measures real S2C prompt size. Cloud stays the demo path. |
| 15 Oct 2026 | Gateway piece 2: first "local" run went to Gemini (429, free tier 5/min) because S2C's `.env` still had `GEMINI_API_KEY`; with Gemini + OpenAI-style keys S2C picks Gemini first. Moved the key to `gateway/.env`; S2C `.env` now has no keys (as §5.1 says). Agent mode streams code as repeated full-page `setCode` messages, not `chunk`. |
| 15 Oct 2026 | Gateway piece 2 done: local run **111 s** (was 3 min 38 s), 6,175 chars, all 4 fields marked, `SAMPLE_EMPLOYEES` present, `data-action="create"` missing again (Add button is `type="submit"`). Largest S2C call used 9,098 tokens, so **keep 16k context** (12k would leave too little room for bigger pages). |
| 15 Oct 2026 | Gateway piece 3 done: `POST`/`GET /v1/generations`, in-memory one-at-a-time queue, same request = same job, JSON errors. REST run: 132 s, local, 16 `data-field`, `create` missing. PowerShell 5.1: build JSON text with `[IO.File]::ReadAllText`, not `Get-Content -Raw` (adds hidden properties). |
| 15 Oct 2026 | Step 7 first Mac call: Tailscale + key worked, but S2C's agent kept editing a finished page (broken tool call, then ~50 s edits) and hit the 600 s timeout. S2C also **keeps running after the client disconnects**. Fixes: `gpt-5.5` alias temperature 1 → 0.5; S2C `max_steps` 30 → 6 (5th patch line, full patch in `docs/s2c-local.patch`); Gateway accepts the last complete page 60 s after `</html>` appears (`finishedEarly`). 3 runs in a row: 145 s, 163 s, 169 s, all done. |
| 15 Oct 2026 | Markers are sometimes added by JavaScript (`setAttribute("data-field", ...)`), so the Verifier must count them in the rendered page (headless browser), and the Wirer can't assume a static table row exists. |
| 15 Oct 2026 | Editing S2C `.py` files triggers its auto-reload, which hung on Windows. After patching S2C, restart it manually. |
| 16 Oct 2026 | Cloud checks. Extractor `--cloud`: `gemini-2.5-flash` retired; `gemini-3.8-flash` and `gemini-flash-latest` gave 503 "high demand"; **`gemini-3-flash-preview` works: 9.6 s, all checks passed**, same fields as local (only `required` flags differ, so a different hash). Added retries (2/5/10 s) for 500/502/503/504. |
| 16 Oct 2026 | Gateway `auto` fallback verified: with local broken, the job switched to `provider: cloud` by itself. Gateway `cloud` reached Gemini (key passed correctly) but got **429: free tier = 20 requests/day per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`); one S2C agent page uses several requests. A successful cloud page through the Gateway is still unverified. **Demo needs billing on the Google project or cached demo results.** |
| 16 Oct 2026 | Step 8 Builder API written (`builder-api/`: Express 5, Mongoose 9, multer, sharp) and tested on Laptop B against a test DB: upload → `UPLOADED`, image shrunk to ≤1280 px under `runs/<id>/`, hash of original file, 400/404 cases, `/api/health` sees the Gateway over Tailscale. Waiting for the Mac run. |
| 16 Oct 2026 | Step 9 on Laptop B (test DB): upload → `CONTRACT_DRAFT` → `BUILDING` → **`SYNCED` in 194 s**. Instructions are now generated from the Contract (`shared/instructions.mjs`), and with the exact example button the local model **added `data-action="create"` for the first time**. Edits: invalid → 400, unchanged → no rebuild, v2 → v3 + Builder API kill → resumed and `SYNCED` on v3 with both label edits in the page. |
| 16 Oct 2026 | Fixed: a restart left the superseded v2 frontend job `running` forever; each build round now marks such jobs `cancelled`. Known limit: an edit during a build still waits for the stale page (~2 min) because the Gateway has no cancel yet and S2C keeps running anyway. |
| 16 Oct 2026 | Laptop B's MongoDB Windows service was stopped; tests use a private `mongod` on port 27018. Added `scripts/start-laptop-b.ps1` (starts Ollama, S2C, Gateway; skips what is already running). |
| 16 Oct 2026 | Sync Barrier verified (no restart): edit → v2, edit → v3 while v2 built → `Barrier refused: built for bf26fac3a246, Contract is now v3` → rebuilt → `SYNCED` v3, no jobs left running, served page has both edits and all 4 actions. Same screenshot + same Contract hash returns the Gateway's cached page in ~2 s. Waiting for the Mac run. |
