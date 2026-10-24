# TDD evidence: Step 14, Memory

**Source plan:** Step 14 in [plan.md](../../plan.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) (§9, §12).
**Rule:** no evidence, no code. Memorize only verified artifacts (state `READY`); never invent features from memory without screenshot evidence.

**Runners:** `builder-api`: `npm test` (323 unit tests pass, 0 fail).

---

## What it does

Memory accelerates app generation by caching and reusing verified work across projects:

1. **Level 1: Exact Repeat (SHA-256)**
   - Uploading an identical screenshot matches by SHA-256.
   - The UI inventory is reused immediately from verified memory.
   - **Skips the vision AI model pass entirely** (drops 15–20 s per screenshot to ~0 s).
   - Pipeline job records `provider: "memory"`.

2. **Level 2: Near-Duplicate Screenshot (perceptual dHash $\le$ 6)**
   - Screenshots with minor variations (slight cropping, recompression, 1px shifts) produce a 64-bit perceptual difference hash (`dHash`).
   - Resized to 9 columns $\times$ 8 rows in grayscale (72 raw bytes), comparing adjacent horizontal pixels (`pixel[x+1] > pixel[x]`).
   - If Hamming distance $\le$ 6 against a verified screenshot in memory, the previous verified inventory is reused, avoiding redundant vision passes.

3. **Level 4: Pattern Library for Custom Operations**
   - When the Backend stage generates code for an unmatched custom button (e.g. "Duplicate" or "Give 10% Raise"), it checks Memory first.
   - If a verified operation with the same entity and button intent exists:
     1. Runs the AST safety check (`checkCustomCode`).
     2. Runs the one-press test in the app sandbox (`test(code)`).
   - If tests pass, the verified code is reused with **0 LLM calls** (`provider: "memory"`).
   - If tests fail, it seamlessly falls back to normal AI generation (Gemini / Qwen).

4. **Memorization at `READY`**
   - In `verifyStage`, only when the Verifier confirms the app passes all checks (`job.report.ok === true`) and transitions to state `READY`, artifacts are saved into MongoDB `Memory`:
     - Screenshot inventory (`kind: "screenshot"`, `key: sha256`, `dHash`);
     - App Spec (`kind: "spec"`, `key: contract.hash`);
     - Verified custom button code (`kind: "operation"`, `key: `${entity}:${name}``).

---

## Code Touchpoints

| File | What was added |
|---|---|
| [`src/storage.js`](../../builder-api/src/storage.js) | `computeDHash(buffer)` (64-bit dHash as 16-hex string via Sharp) and `hammingDistance(hex1, hex2)` (popcount). |
| [`src/models/memory.js`](../../builder-api/src/models/memory.js) | `Memory` model: `kind` (`'screenshot'\|'spec'\|'operation'`), `key`, `dHash`, `verified`, `sourceProjectId`, `payload`. |
| [`src/models/project.js`](../../builder-api/src/models/project.js) | Added `dHash` to `screenshotSchema` and `imageDHash` to `projectSchema`. |
| [`src/models/job.js`](../../builder-api/src/models/job.js) | Added `"memory"` to `provider` enum. |
| [`src/server.js`](../../builder-api/src/server.js) | Computes and saves `dHash` on upload in `POST /api/projects`. |
| [`src/memory/index.js`](../../builder-api/src/memory/index.js) | `findScreenshotMemory`, `findOperationMemory`, `findSpecMemory`, `rememberVerifiedProject`. |
| [`src/orchestrator.js`](../../builder-api/src/orchestrator.js) | Reuses inventory in `contractStage`; saves verified artifacts in `verifyStage` at `READY`. |
| [`src/custom/writer.js`](../../builder-api/src/custom/writer.js) | Checks Pattern Library before invoking AI coding models. |

---

## Tests

### 1. Perceptual dHash (`test/dhash.test.js` — 11 tests)
- Identical images produce distance 0.
- Slightly modified images (1% brightness shift, minor crop) produce distance $\le 6$.
- Completely different images (table vs login vs noise) produce distance $> 15$.
- Input validation: rejects non-buffers and malformed hex strings.

### 2. Memory Model & Manager (`test/memory.test.js` — 13 tests)
- Model schema validation for `screenshot`, `spec`, and `operation` kinds.
- Level 1 exact match by SHA-256.
- Level 2 near-duplicate matching with minimal Hamming distance.
- Unverified artifacts are ignored.
- Upserting and retrieval of verified projects.

### 3. Pattern Library in Custom Writer (`test/custom-writer.test.js` — 13 tests)
- Reuses verified operation code when available and passing test.
- Falls back to AI model if memorized code fails safety or one-press test.
- Correctly reports `provider: "memory"` and 0 answers used.

**Full test suite result:** 323 / 323 passing across 82 suites (0 failures).
