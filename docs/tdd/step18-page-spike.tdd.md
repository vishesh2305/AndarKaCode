# TDD evidence: Step 18, page-generation spike

**Source plan:** [docs/production-architecture.md](../production-architecture.md) §7, Stage 1, Step 18.
**Question:** in production (no Laptop B), does **one direct cloud model call per page** build pages as good as Screenshot-to-Code (S2C), and faster?
**Branch:** `step18-page-spike` · **Runners:** `builder-api`: `npm test`; `web`: `npm test`. Node v22.21.1 on Laptop B.

| Piece | What | Status |
|---|---|---|
| 18.1 | The page exam: `npm run eval:pages` | ✅ built (this report); waiting for the Mac check |
| 18.2 | The single-call page builder (`--method single`) | to do |
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
