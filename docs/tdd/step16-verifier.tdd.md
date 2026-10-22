# TDD evidence: Step 16, the Verifier (and the live preview)

**Source plan:** the Step 16 plan (22 Oct), approved with the user's choices: the **Check station** in the UI with Download waiting for the checks (plus a small "Download anyway"), and a **Live** view in the Pages tab. The Laptop B "redraw this page" repair was left for later.
**Branch:** `step16-verifier` · **Runners:** `builder-api`: `npm test`, integration with `TEST_MONGODB_URI`; `web`: `npm test`. Node v22.21.1 on Laptop B.

## What it does

After the Sync check, every project goes through three more stages:
- **Wire:** the wired pages are written into the app folder, so that folder *is* the finished app.
- **Check:** the Verifier runs.
- **Ready:** every check passed, and Download turns on.

The Verifier:
1. **Markers.** Each page is read in jsdom with its own scripts, plus the binder in markers-only mode. Every field and button the spec asks of *that* page must be there. The binder repairs a forgotten marker when the page clearly shows where it belongs (a label, a column header, a button's text), and each repair is reported as a warning.
2. **Health.** The generated app starts in its own process: `127.0.0.1`, a port it picks itself, its own throwaway database, the Builder API's packages through a `node_modules` link, and no keys in its environment.
3. **Person-like run.** Each page is used through the page itself (jsdom + binder against the running app): Add (with real choices, never a "Select …" prompt), reload, Edit, Search, filters, page buttons, row/page buttons, stat cards, Delete, sign-in, and "no login sends you to sign-in". Pages without Add get one record first.
4. **The app's own tests** run on another throwaway database.

Every check says what happened and, when it fails, which layer to blame:
- **page:** nothing was sent, or an input is missing;
- **spec:** the backend's rules refused what the page offers, like the "Select Department" bug;
- **backend:** the server answered with an error.

The report is kept with the project (`GET /api/projects/:id/verify`), shown on the Check station (problems first), and goes into the zip as `verify-report.md`.

**Live preview.** The Pages tab can show **Live**: the wired app on its own test database. It's served by the Builder API on its **own local port** (API port + 1), which the browser treats as another site than the UI, so a generated page can keep its own login without reaching the UI. Apps with a login get sign-in details. The preview stops after 15 minutes without use, and its test data is deleted.

## Task report

| Stage | Result | Commit |
|---|---|---|
| RED, app runner | `src/verify/app-runner.js` missing | `d94343f` |
| GREEN | unit 203/203, integration 54/54. One test fix: an app that only awaits forever makes Node exit ("unsettled top-level await"), so the time-limit test keeps the event loop alive | `786b83c` |
| RED, marker check | `src/verify/markers.js` missing | `f965598` |
| GREEN | unit 213/213 | `68fc2ca` |
| RED, Verifier on real generated apps | `src/verify/index.js` missing | `d1c05d0` |
| Real finding while going GREEN | the real m2 page's category filter has only "All categories", so nobody can filter. The Verifier now reports that as a page problem, and the binder fills empty filter dropdowns (RED `084ba3e`) | |
| GREEN | unit 215/215, integration 66/66 | `73699a6` |
| RED, rule-based marker repair in the binder | 6 fail | `3107d53` |
| GREEN | unit 223/223. One repair rule removed: no "create" marker when a form's own submit button already adds | `c36dcfa` |
| RED → GREEN, Verifier reads markers after repair | | `e567c34` → `e0d610a` (unit 225, integration 67) |
| RED, pipeline Wire + Check + READY, report, download rules | projects stay SYNCED. The pipeline tests got a fake Screenshot-to-Code that builds pages from the instructions | `ac0ca26` |
| GREEN | integration 73/73 | `d62ab23` |
| RED, live preview | 6 fail | `a7030f2` |
| GREEN | integration 79/79. Apps also stop with the Builder API (IPC). The "orphan" test passed on Windows *before* that fix, because Windows already ties child processes to their parent; it guards macOS, where only the fix makes it pass | `5a670cd` |
| RED → GREEN, preview on its own port | a design fix for safety: on the UI's own address, a Live page could reach the UI | `3e97bd1` → `0743e3c` |
| RED → GREEN, UI pipeline (Wire/Check/Ready, report, download anyway) | web 6 fail → 12/12 | `e27fff3` → `0743e3c` |
| UI components (station texts, report, Download, As built / Live) | checked with headless Chrome screenshots (below) | `f7791c6` |

## Real run (Laptop B)

**First try (22 Oct):** Laptop B had restarted with its services off, so the projects stopped at Read with "fetch failed". That wasn't a Step 16 problem.

**On the Mac (user's run, `samples/employees.png`):** the Check stage stopped the project with 6 failed checks, all blamed on the page. The root cause was in the report: `Uncaught [SyntaxError: missing ) after argument list]`. Laptop B's model had written a page whose own script didn't parse, so it drew no rows. Fixed test-first (RED `e4134a5`, GREEN `e47164b`):
- the binder builds rows from the table's header when a page draws none;
- the marker check names the page's script error first;
- browser messages ("Constraints not satisfied") are reported only when a form was really submitted.

**On Laptop B (real Ollama + Screenshot-to-Code), the same screenshot:** this time the model wrote a correct page. SYNCED, then Wire → Check → **READY** in 211 s, with **8 passed, 0 failed, 0 warnings** in 7.2 s (markers, health, add, reload, edit, search, delete, the app's own 7 tests).
- **UI:** the Check station shows the report. The Live view shows the page from `127.0.0.1:4101/preview/<project>/`, checked with headless Chrome screenshots.
- **Live preview in real Chrome:** `npm run smoke:wire -- http://127.0.0.1:4101/preview/<project>` gave **7/7** (add, reload, edit, search, delete).
- **UI fixes from the screenshots:** the Check station's place label was too long and overlapped Wire and Ready on the metro line; the project list showed the raw word "READY".

**Final:** unit **229/229**, integration **80/80**, web **12/12**.

## Known gaps

- Redrawing a page on Laptop B when markers can't be repaired by rule needs a new Gateway request type; left for later.
- The person-like run uses jsdom, not a real browser. `npm run smoke:wire` stays for checks in real Chrome.
- The Builder API (port 4000) still has no login or CSRF protection. It only listens on `127.0.0.1`, as before (a GitHub login comes later).
