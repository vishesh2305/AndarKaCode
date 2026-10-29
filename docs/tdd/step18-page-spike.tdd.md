# TDD evidence: Step 18, page-generation spike

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 1, Step 18.
**Question:** in production (no Laptop B), does **one direct cloud model call per page** build pages as good as Screenshot-to-Code (S2C), and faster?
**Branch:** `step18-page-spike` · **Runners:** `builder-api`: `npm test`; `web`: `npm test`. Node v22.21.1 on Laptop B.

| Piece | What | Status |
|---|---|---|
| 18.1 | The page exam: `npm run eval:pages` | ✅ built; works on the Mac (S2C built m1 through Laptop B) |
| 18.2 | The single-call page builder (`--method single`) | ✅ built; first real page on Laptop B; waiting for the Mac check |
| 18.3 | Both methods on all 8 mocks, scored by eye | to do |
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
