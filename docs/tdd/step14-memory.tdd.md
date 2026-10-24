# TDD evidence: Step 14, memory

**Source plan:** the Step 14 plan (24 Oct), approved with the user's choices:
- **Scope:** pieces 1–3 (exact repeats, near-duplicate screenshots, the verified-code library). **No embeddings**: our spec comes from fixed rules, so embeddings would only have suggested answers to open questions, at the cost of another model in the Mac's 16 GB.
- **When work is remembered:** only when a project reaches **Ready**.
- **UI:** "from memory" on the stations, **Start fresh**, and **Clear memory**.

**Branch:** `step14-memory` · **Runners:** `builder-api`: `npm test`, integration with `TEST_MONGODB_URI`; `web`: `npm test`. Node v22.21.1 on Laptop B, Node 26 on the Mac.

## What it does

When a project reaches **Ready**, so that every check passed, its verified work goes into a `memories` collection in MongoDB under fingerprints (`src/memory/keys.js`):

| Work | Fingerprint | What a later project skips |
|---|---|---|
| What the vision AI read on a screenshot | screenshot SHA-256 + the reading prompt and schema (`READING_VERSION`) | Read (10–20 s per screenshot) |
| A page Laptop B drew | screenshot SHA-256 + that page's instructions | Laptop B (2–4 min per page) |
| A custom button's code | button text + row or page + the table's fields + the custom-code runtime | the coding AI (5–30 s per button) |

- **Out-of-date memory stops matching by itself.** Anything that could change the result is part of the key: the reading prompt, a page's instructions, the runtime.
- **The first project stays the source.** A later identical piece doesn't replace it.
- **A project that needs attention adds nothing.**

**Near-duplicate screenshots** (`src/memory/dhash.js`):
- Every upload gets a **dHash**: the image shrunk to 9×8 grey pixels, one bit per pixel for "brighter than its right-hand neighbour".
- A copy of a screenshot, resized or saved again, stays within a few bits; a different screen differs in many.
- A page is reused for a screenshot **at most 6 bits** from a remembered one **with the same page instructions**. The copy is still read, so the spec still comes from the new picture.

Measured on our sample screenshots:

| Pair | Bits apart |
|---|---|
| m7 vs m7 at 80% size | 2 |
| m7 vs m7 at 1600 px wide | 2 |
| m7 vs m7 as JPEG (quality 70) | 4 |
| m7 vs m7 as WebP (quality 60) | 6 |
| m7 vs m7 made 5% brighter | 8 (not a copy) |
| any two different sample screenshots | **11 or more** (closest: m1 vs m5b, m2 vs m3) |

**The verified-code library** (`src/memory/library.js`):
- **When it's used:** when the exact match misses, remembered code for the **same button** (text, row or page) is offered for another table.
- **The rule:** every field of the old table that the code **really uses** must be in the new table with the same type. The code is parsed, never run, and a field name inside a message string doesn't count.
- **Why:** a missing field would be dropped by the checks without a word, and the button would quietly do nothing.
- **Then it's checked like new code:** the safety check and a real press in the new app. Only if nothing passes does the coding AI write new code.

**Where it's used** (`src/orchestrator.js`):
- the reading in the Read stage;
- the page before a Gateway job is submitted;
- custom code before the coding AI is asked.

Each reused job records `fromMemory`: the source project, the time the work took the first time, and, for near-duplicates and the library, `similar` (pages also get `distance`).

**UI:**
- **Badge:** a lilac ↻ badge on the stations that reused work.
- **Station facts:** what came from where, and the time saved. Examples: "from memory: a copy of a screenshot in “m7 first” (4 bits apart)", "from the code library: verified in “m7 first” (another table)".
- **New project:** a **Start fresh** checkbox (`fresh=true`) skips memory for that project.
- **Sidebar:** a **Memory** box shows the counts (`GET /api/memory`), and **Clear memory** (`DELETE /api/memory`) forgets them after a confirm. Projects are not touched.

## Task report

| Stage | Result | Commit |
|---|---|---|
| RED, piece 1: keys, a repeat with no AI/Gateway call, Start fresh, nothing from NEEDS_ATTENTION, clear memory | `src/memory/keys.js` missing. Pipeline tests now upload "fresh" by default, because the fake AI gives one screenshot file different readings in different tests | `b403ce0` |
| GREEN | unit 302/302, integration 112/112 | `b93d9ef` |
| RED, piece 2: dHash and near-duplicate pages | `src/memory/dhash.js` missing | `cd18d83` |
| GREEN | unit 306/306, integration 115/115. One test of mine was wrong: two "different" copies were the same bytes, so the second was an exact repeat. Each copy now gets its own size | `5223916` |
| RED → GREEN, real-run gap | pages remembered in piece 1 had no dHash, and memory never updates an entry, so they could never be found as near-duplicates. Now a page's dHash and instructions hash are filled in whenever its screenshot reaches Ready (the source stays) | `43d8c55` → `80a9c37` (integration 116) |
| RED, piece 3: verified-code library | `src/memory/library.js` missing | `a1e6bbb` |
| GREEN | unit 314/314, integration 118/118 | `46490d5` |
| Sample for the library | `samples/mocks/m8-staff-raise.png`: a Staff table with an extra Email column and the same "Give 10% Raise" button | `b1936f1` |
| RED → GREEN, piece 4: UI logic | web 4 fail → 19/19. The backend note "written by the coding AI" was wrong for reused code; that test and its fix were written together | `1e6b944` → `a3d4739` |

## Real runs

**Laptop B** (real vision AI, Screenshot-to-Code and coding AI; my own Builder API and database):

| Run | Ready in | What was reused |
|---|---|---|
| m7, first time | 43 s | nothing (the Gateway had today's page in its own short-term cache) |
| m7, same file again | **7 s** | reading, page, both buttons; no Laptop B call, no AI call |
| m7, resized JPEG copy | **26 s** | page (near-duplicate, 4 bits) and both buttons; the copy was read again |
| m8 (new screen, extra Email column) | 89 s | "Give 10% Raise" from the **library** (m7's code); the new page was drawn |

**UI:** checked in real headless Chrome on those projects:
- the ↻ badges;
- the station facts for a near-duplicate page and a library button;
- the Memory box;
- the Start fresh checkbox.

**On the Mac** (user's runs, 24 Oct):
- **Piece 1:** the second upload of m7 was Ready "almost immediately".
- **Piece 2:** a copy made with `sips` (JPEG, 760 px) gave `frontend FROM MEMORY of m7-copy (near-duplicate, 4 bits)`.
- **Piece 3:** m8 gave `["Give 10% Raise","library of m7-custom-buttons"]`.
- **Piece 4:** works as intended.

**Two Mac surprises, both explained, neither a bug:**
1. A first check showed empty memory, because that m7 project was built before the update.
2. m8 first got AI code, because the Builder API hadn't been restarted after `git pull`. A diagnostic read the memory entries directly and showed "no fields yet" even on the entry m8 had just saved.

**Lesson:** after every `git pull`, restart the Builder API, and rebuild `web/` when the UI changed.

**Final:** unit **314/314**, integration **118/118**, web **19/19**.

## Known gaps

- **No embeddings,** by choice. Screens with the same meaning but another look ("Staff" ≈ "Employees") are not found.
- **Readings are not reused for near-duplicates;** only pages are. A copy is always read again, so its spec comes from its own picture.
- **A brighter or recoloured copy** (8+ bits) counts as a new screen.
- **The Gateway's own cache on Laptop B lives only in its working memory.** Memory on the Mac doesn't depend on it.
- **Memory has no size limit or expiry yet.** Clear memory is the way to start over.
