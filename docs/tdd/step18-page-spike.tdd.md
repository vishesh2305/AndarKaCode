# TDD evidence: Step 18, page-generation spike

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 1, Step 18.
**Question:** in production (no Laptop B), does **one direct cloud model call per page** build pages as good as Screenshot-to-Code (S2C), and faster?
**Branch:** `step18-page-spike` · **Runners:** `builder-api`: `npm test`; `web`: `npm test`. Node v22.21.1 on Laptop B.

| Piece | What | Status |
|---|---|---|
| 18.1 | The page exam: `npm run eval:pages` | ✅ built; works on the Mac (S2C built m1 through Laptop B) |
| 18.2 | The single-call page builder (`--method single`) | ✅ built; first real page on Laptop B; waiting for the Mac check |
| 18.3 | Both methods on all 8 mocks, scored by eye | exam tools built (strict prompt, `--specs-only`, page pictures); waiting for the specs from the Mac |
| 18.4 | The decision | to do |

## 18.1: The page exam

### What it does

```
npm run eval:pages -- [--method s2c] [--mode local|cloud|auto] [--read local|cloud|auto] [caseName]
```

1. **The same questions for every method:** the 8 mocks in `samples/mocks/` (m5 is two screenshots and one spec).
2. **The same spec for every method and every laptop.** The first run reads each case's screenshots once (`--read`) and keeps the spec in `samples/mocks/specs/<case>.json`. That file is meant to be committed; later runs use it and don't read again. So the only thing that changes between two runs is the page builder.
3. **A fresh page every run.** The Gateway hands back a page it already drew for the same (image, hash), so each run asks with its own hash (`runHash`). Otherwise a second run would show 0 seconds.
4. **Per page:**
   - the **seconds** taken;
   - **markers, raw** (what the builder drew itself);
   - the **Check after repair** (what the Verifier would say in production, once the binder has added what it can from labels and headers).
5. **Results** in `samples/mocks/results/pages/<run>/` (git-ignored, like the other eval output):
   - `results.md`: the table, with a blank "Your score (1–5)" column;
   - `results.json`;
   - `review.html`: each screenshot next to the page built from it, to score by eye;
   - one `.html` per page.
   They are saved after every page, so a run that stops keeps what it measured.

Screenshots are shrunk to 1280 px exactly as in the Builder API (`shrinkScreenshot`), so the builders see what production sends them.

### Tests

RED (`efe3deb`): `node --test test/eval-pages.test.js test/verify-markers.test.js`
→ `Cannot find module '.../src/eval/pages.js'` and `does not provide an export named 'missingMarkers'`.

GREEN (`662d3e8`): the same command gives `tests 30, pass 30, fail 0`. Full suites: **unit 330/330** (314 before + 16 new), **web 19/19**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | The exam is the 8 mocks, and every screenshot is on disk | `PAGE_CASES: are the 8 sample mocks…` | PASS |
| 2 | m5's two screens stay one case (one spec with the relation) | `PAGE_CASES: keep the two relation screens together…` | PASS |
| 3 | Defaults: every case, S2C, cloud, reading by whichever model is available | `parseArgs: defaults…` | PASS |
| 4 | Method, mode, reading mode and one case can be chosen | `parseArgs: takes the method…` | PASS |
| 5 | An unknown method, mode or case is refused, and the error says what is allowed | `parseArgs: refuses…` | PASS |
| 6 | Each run gets its own 64-character hash (no reused page from the Gateway) | `runHash: …` | PASS |
| 7 | A complete page: all markers present, and the Check passes | `scorePage: a complete page…` | PASS |
| 8 | A missing marker is counted and named the way a person sees it; the binder repair still makes it pass, as in production | `scorePage: a page that forgot a marker…` | PASS |
| 9 | A page with nothing to repair fails the Check | `scorePage: a page with nothing…` | PASS |
| 10 | The table has one row per page, with time, markers, Check and a blank score | `resultsTable: has a header…` | PASS |
| 11 | A page that wasn't built shows "not built" plus the reason | `resultsTable: shows a page that could not be built…` | PASS |
| 12 | A `\|` in a reason doesn't break the table | `resultsTable: keeps a \| …` | PASS |
| 13 | The review page puts each screenshot next to its page | `reviewHtml: shows the screenshot and the page…` | PASS |
| 14 | A page that wasn't built is named, never an empty frame | `reviewHtml: names a page that was not built…` | PASS |
| 15 | Text is escaped in the review page | `reviewHtml: escapes text…` | PASS |
| 16 | `missingMarkers` lists each missing marker on its own; the Verifier's `markerCheck` uses it unchanged | `missingMarkers lists each missing marker…` + all existing `markerCheck` tests | PASS |

### Checked on Laptop B without models running

- `--method magic` → `Unknown method "magic": use s2c`.
- `--read local m1-edit-delete` with Ollama stopped → `FAILED to get a spec: local: fetch failed`, then `0/0 pages built` with a path to the empty review page. The run doesn't crash.

**Not yet run with a real page builder.** The Gateway, S2C and Ollama were not running on Laptop B during this piece. The first real run is the Mac check below.

### Known gaps (on purpose)

- "Looks the same" is scored **by eye** (1–5). A pixel comparison would need a real browser (Playwright), which is more than this spike needs.
- The time includes waiting in the Gateway's queue (one job at a time on Laptop B). Run one exam at a time.
- Coverage was not measured for this piece. The script's network glue (`scripts/eval-pages.mjs`) is checked by running it, like `eval:inventory`.

### Found during the Mac check of 18.1

- **NoMachine holds port 7001 on Laptop B** (`nxnode.bin`), which is Screenshot-to-Code's default port. The start script saw "something on 7001", said "already running", and never started S2C; the Gateway then answered "Cannot reach Screenshot-to-Code". Fixed in `e3cd14c`:
  - S2C now runs on **7002**;
  - the start script takes the port from `S2C_WS_URL` in `gateway/.env`;
  - it checks that S2C's own home page answers there, and names whatever else holds the port;
  - it starts S2C with `--max-port-attempts 1`, so S2C can no longer quietly move to a port the Gateway doesn't know.
- "fetch failed" when reading means the computer running the exam can't reach its own Ollama (`OLLAMA_URL`). On the Mac, Ollama wasn't running. On Laptop B later, Ollama, S2C and the Gateway had all stopped (Tailscale too), probably while the laptop slept.

## 18.2: The single-call page builder

`src/ai/page.js`: one screenshot plus our page instructions, then **one** model call (Ollama for `local`, Gemini for `cloud`, local then cloud for `auto`), then one HTML page.
- No agent steps, no Screenshot-to-Code, no Gateway: the computer running it calls the model directly. That's the shape the production ui-worker would have.
- The prompt keeps S2C's goals (look exactly like the screenshot, its exact text, one HTML file with Tailwind) and adds our page instructions word for word, so the wirer's markers are asked for the same way.
- The page is taken from a ```` ```html ```` block, or from `<!DOCTYPE`/`<html>` to `</html>`. An answer with no page, or one cut off before `</html>`, is an error, never a broken page.
- `GEMINI_PAGE_MODEL` (optional) picks the cloud model for pages; otherwise it uses `GEMINI_MODEL`.

### Tests

RED (`eb282c6`): `node --test test/page-model.test.js test/eval-pages.test.js` → `Cannot find module '.../src/ai/page.js'`, and `--method single` refused (`not ok: knows the single-call builder`).
GREEN: the same command gives `tests 30, pass 30, fail 0`. Full unit suite **345/345** (330 + 15 new).

| # | What is guaranteed | Test (`test/page-model.test.js` unless named) | Result |
|---|---|---|---|
| 1 | The model is asked for one HTML file that looks exactly like the screenshot, with its exact text, using Tailwind | `pagePrompt: asks for one HTML file…` | PASS |
| 2 | Our page instructions (the markers) are included word for word | `pagePrompt: includes our page instructions…` | PASS |
| 3 | The model is asked for the HTML only | `pagePrompt: asks for the HTML only…` | PASS |
| 4 | The page is taken out of a ```` ```html ```` block | `extractHtml: takes the page out of…` | PASS |
| 5 | …or from `<!DOCTYPE`/`<html>` to `</html>`, in any letter case | `extractHtml: takes the page from <!DOCTYPE…` | PASS |
| 6 | A page cut off before `</html>` is an error that says so | `extractHtml: says the page was cut off…` | PASS |
| 7 | An answer without HTML is an error | `extractHtml: says there is no page…` | PASS |
| 8 | Ollama gets the vision model, the prompt and the image, with no JSON format, thinking off, and a context long enough for a page | `local: sends the vision model…` | PASS |
| 9 | Ollama's error message is passed on | `local: throws Ollama's error message` | PASS |
| 10 | Gemini: key in a header (never in the URL), image inline, text answer (not JSON), answer parts joined | `cloud: sends the key in a header…` | PASS |
| 11 | Gemini: a temporary 503 is retried, a quota error (429) is not | `cloud: retries a temporary 503…` | PASS |
| 12 | `cloud` makes one call with the screenshot and the prompt | `buildPage: cloud: one call…` | PASS |
| 13 | `auto` tries local first, then cloud if local fails or answers without a page | `buildPage: auto…` | PASS |
| 14 | `local` has no cloud backup, and the error names the provider | `buildPage: local…` | PASS |
| 15 | The exam accepts `--method single` | `eval-pages.test.js: knows the single-call builder` | PASS |

### First real run (Laptop B, local model)

```
npm run eval:pages -- --method single --mode local --read local m1-edit-delete
  page 1: 54.1 s, markers 5/5, Check after repair pass (local)
```

- The page has the "Employees" heading, 3 sample rows, and Edit/Delete on every row.
- For comparison, S2C measured **104–194 s per page** on the same laptop (ARCHITECTURE.md §5). This is one page only; 18.3 compares both methods properly, on the same specs.
- Laptop B's local model read only 3 columns of m1 here (the spec was read again on this laptop). That spec file was deleted, so the Mac's spec stays the one we compare on.

### First fair comparison: m1, the Mac's spec (`10ad80a`), Laptop B local model, back to back

| Builder | Seconds | Markers | Check after repair | Look (Claude's score, 1–5) | Differences from the screenshot |
|---|---|---|---|---|---|
| S2C | 56.7 | 5/5 | pass | 3.5 | salaries lost their commas (`52000`); headers UPPERCASE; Edit/Delete as coloured text links |
| Single call | 38.8 | 5/5 | pass | 4 | exact text kept (`52,000`); headers UPPERCASE; Edit/Delete filled blue/red instead of outlined grey |

- The single call is about 1.5× faster on this page, and kept the exact text better.
- The earlier "104–194 s" for S2C came from bigger pages, so the 54.1 s single-call run above isn't a fair comparison.
- Neither builder copies button styles exactly. A stricter prompt about colours and styles is worth trying in 18.3.
- One simple page only: no decision until 18.3 covers all 8 mocks. The user's score by eye still has to be added.

## 18.3: Both builders on all 8 mocks

### What was added to the exam first

```
npm run eval:pages -- [--method s2c|single] [--mode ...] [--read ...] [--prompt plain|strict] [--specs-only] [caseName]
```

- **`--specs-only`**: reads and keeps each case's spec, builds no pages and writes no results folder. That's how the Mac reads the specs for m2–m8, so every run compares on the same specs.
- **`--prompt strict`** (single call only): two more rules in the prompt.
  - Copy every button's style as it is: filled or outlined, colours, corners.
  - Keep the text letter for letter: `52,000` stays `52,000`, and no UPPERCASE headers unless the screenshot has them.

  Everything else in the prompt is the same, so a strict run against a plain run measures only these rules. The run is named `single-strict-...`. With `--method s2c` it's refused, because S2C writes its own prompt.
- **A picture of every built page**: headless Chrome or Edge (`SHOT_BROWSER` to choose one) saves a 1280×800 PNG next to the page. `review.html` shows that picture beside the screenshot, and clicking it opens the live page. With no browser, the review shows the live page as before.

### Tests

RED (`aa08381`): `node --test test/eval-pages.test.js test/page-model.test.js` gives:
- `does not provide an export named 'browserCandidates'`;
- the 3 strict-prompt tests failing.

GREEN: the same command gives `tests 41, pass 41, fail 0`. The full unit suite is **356/356**.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Defaults now include `prompt: "plain"` and `specsOnly: false` | `parseArgs: defaults…`, `takes the method…` | PASS |
| 2 | `--prompt strict` is accepted for the single call | `parseArgs: takes the strict prompt…` | PASS |
| 3 | The strict prompt is refused for S2C, and the error says why | `parseArgs: refuses the strict prompt for S2C…` | PASS |
| 4 | `--specs-only` can be combined with one case | `parseArgs: can read and keep the specs only…` | PASS |
| 5 | An unknown prompt is refused, and the error names the allowed ones | `parseArgs: refuses an unknown…` | PASS |
| 6 | The review shows the page's picture, linked to the live page (no frame) | `reviewHtml: shows the browser's picture…` | PASS |
| 7 | The picture is 1280×800, headless, after a time budget for Tailwind, with the page given as a file URL | `shotArgs: …` | PASS |
| 8 | `SHOT_BROWSER` is tried first; Chrome/Edge on Windows and Chrome on a Mac are known | `browserCandidates: …` | PASS |
| 9 | The strict prompt has the button-style rules | `pagePrompt strict: adds rules for button styles…` | PASS |
| 10 | The strict prompt has the exact-text rules (number format, letter case) | `pagePrompt strict: adds rules for keeping text…` | PASS |
| 11 | The strict prompt keeps every line of the plain one | `pagePrompt strict: keeps everything…` | PASS |
| 12 | `buildPage({ strict: true })` sends the strict prompt | `buildPage: sends the strict prompt…` | PASS |

### Checked on Laptop B

- `--specs-only m1-edit-delete` → `spec ready: 1 page(s), entities employee`, and no results folder.
- `--prompt strict` with S2C → `The strict prompt is for --method single (Screenshot-to-Code writes its own prompt)`.
- The picture of the earlier m1 single-call page: Chrome found at `C:\Program Files\Google\Chrome\Application\chrome.exe`. The PNG took 1.1 s, and Tailwind styles were applied.

### Run 1: the single call on all 9 pages, Laptop B local model (`qwen3-vl:8b-instruct`), Mac specs (`db69cfe`)

| Screenshot | Plain prompt: seconds | Strict prompt: seconds | Markers (both) | Check after repair (both) |
|---|---|---|---|---|
| m1-edit-delete | 75.8 | 46.4 | 5/5 | pass |
| m2-add-search-page | 92.0 | 111.6 | 11/11 | pass |
| m3-dashboard | 50.3 | 49.4 | 7/7 | pass |
| m4-login | 23.3 | 22.2 | 4/4 | pass |
| m5a-employees-dept | 42.6 | 37.0 | 4/4 | pass |
| m5b-departments | 35.0 | 33.3 | 3/3 | pass |
| m6-approve | 66.3 | 58.2 | 6/6 | pass |
| m7-custom-buttons | 67.4 | 66.4 | 6/6 | pass |
| m8-staff-raise | 54.9 | 54.6 | 5/5 | pass |
| **Total** | **507.6 s** | **479.1 s** | **51/51** | **9/9** |

- **Every page was built, every marker was drawn by the model itself, and every Check passes.** No repair was needed on any page.
- **The strict prompt barely changes the look on the local model.**
  - m3: the strict page is almost identical to the plain one. Its headers are still UPPERCASE, despite the rule.
  - m1: both kept `52,000` and the header case this time, but the strict page still filled Edit/Delete blue and red; the screenshot has outlined grey buttons.
  - The small 8B model mostly ignores the extra rules. Whether a cloud model follows them is still to measure.
- Both prompts made the same layout change on m3: the stat cards stretched to the full width, while the screenshot has 3 narrow cards.
- Results (git-ignored): `samples/mocks/results/pages/single-local-2026-11-01T07-17-22-113Z/` and `single-strict-local-2026-11-01T07-26-04-476Z/`. Each has `review.html` with the pictures.
- **Still to run:**
  - S2C on the same 9 pages (blocked: Tailscale on Laptop B is logged out, so the Gateway can't start);
  - the single call on cloud (Gemini);
  - the user's score by eye.

### Run 2: S2C on the same 9 pages, Laptop B local model, same specs

Laptop B's `builder-api` has no `.env`, so the run took the Gateway's address and key from `gateway/.env` on the command line. The first try without them built 0/9 pages (`GATEWAY_URL/GATEWAY_API_KEY not set`).

| Screenshot | S2C seconds | S2C markers | S2C Check | Single (plain) seconds | Single markers | Single Check |
|---|---|---|---|---|---|---|
| m1-edit-delete | 70.7 | 5/5 | pass | 75.8 | 5/5 | pass |
| m2-add-search-page | 132.6 | 10/11 (no "+ Add Product" marker) | pass | 92.0 | 11/11 | pass |
| m3-dashboard | 122.5 | 7/7 | pass | 50.3 | 7/7 | pass |
| m4-login | 98.4 | 3/4 (no "Sign up" marker) | **fail** | 23.3 | 4/4 | pass |
| m5a-employees-dept | 50.3 | 4/4 | pass | 42.6 | 4/4 | pass |
| m5b-departments | 62.3 | 3/3 | pass | 35.0 | 3/3 | pass |
| m6-approve | 116.6 | 6/6 | pass | 66.3 | 6/6 | pass |
| m7-custom-buttons | 146.7 | 6/6 | pass | 67.4 | 6/6 | pass |
| m8-staff-raise | 68.3 | 5/5 | pass | 54.9 | 5/5 | pass |
| **Total** | **868.4 s** | **49/51** | **8/9** | **507.6 s** | **51/51** | **9/9** |

- **On the same specs and the same local model, the single call is 1.7× faster in total** (507.6 s against 868.4 s). It was faster on 8 of 9 pages, and 4× faster on m4.
- **The single call drew every marker itself.** S2C missed 2. The binder repaired the "+ Add Product" one, but the Sign-up link on m4 stayed unmarked, so in production that page would fail the Verifier.
- **The look is close on the pages compared so far.** The two m4 pages are nearly the same: both show the email placeholder as dark text, where the screenshot has it grey. The user's score by eye is still to come (S2C review: `samples/mocks/results/pages/s2c-local-2026-11-01T16-50-34-911Z/review.html`).
- Still to run: the single call on cloud (Gemini) from the Mac.
