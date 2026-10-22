# TDD evidence: Step 15, the Wirer (pages connected to the backend)

**Source plan:** the `/ecc:plan` for Step 15 (21 Oct), approved with its three recommendations: wire at download time, a dev-only fake browser for tests, and edit inside the row when a page has no form. Journeys come from that plan and [plan.md](../../plan.md) Step 15.
**Branch:** `step15-wirer` · **Runners:** `builder-api`: `npm test`, `npm run test:integration` (real MongoDB), `npm run smoke:wire` (real Chrome); `web`: `npm test`. Node v22.21.1 on Laptop B.
**Code:**
- `builder-api/src/wirer/index.js`: `apiMap(spec)`, `wirePage(html)`, `wireApp({ spec, pages })`.
- `templates/frontend/app.js`: the binder, the same file for every app, plain browser JavaScript, no packages.
- `builder-api/src/package-app.js`: the zip carries `frontend/app.js`, `frontend/api-map.json`, and each page with one `<script src="app.js">` line.
- `builder-api/scripts/wire-smoke.mjs`: the real check in headless Chrome.

**Not touched (user rule):**
- `web/**`;
- the UI endpoints (the Pages preview still shows the unwired page; an integration test guards this);
- the project states (the UI's Wire station stays "coming next").

## User journeys

1. Open the downloaded app (`npm start`) and see the real records in the page's own look, not the screenshot's sample rows.
2. Add, edit and delete on the page itself, and still see the changes after a reload.
3. Search, filter and go to the next or previous page, with the backend doing the work; stat cards show real numbers.
4. Approve-style buttons and Export work. Custom buttons say "not available yet" (Step 13 builds them).
5. Only with a login screen: sign in (or sign up). Data pages need a login, every request carries the token, and an expired login goes back to the login page.

## Design decisions

- **Wired at download time.** `wireApp` is plain code that takes milliseconds. No new state, so the UI is unchanged. Step 16 will reuse it.
- **`api-map.json` reuses the generator's `operationRoute`,** so a page and the backend can't disagree on an address. Custom buttons are marked `available: false`, and screenshot evidence never reaches the browser.
- **The binder keeps the page's look:**
  - Each new row is a copy of the page's first sample row.
  - Each field remembers how the samples drew each value (a green "Approved" badge, "Out of Stock" in red, `$2.50`), matched through the page's `SAMPLE_*` array.
  - Messages use the browser's own boxes: field bubbles via `setCustomValidity`, plus `confirm` and `alert`.
  - The only text it changes is on buttons: "Save changes" while editing, "Save" for a new row.
- **The page's own sample-only scripts never run.** The binder catches clicks, submits and typing on markers in the capture phase, before the page's listeners.
- **Values are always put in as text** (`nodeValue`), never as HTML.
- **`<html data-andarkacode="loading|ready|error">`** tells tests and the Verifier (Step 16) when a page is wired.
- **jsdom 29.1.1 (dev-only) instead of happy-dom.** happy-dom 20 runs a page's inline scripts only after parsing and never fires their `DOMContentLoaded`. Generated pages draw their sample rows in exactly that listener, so happy-dom would have tested the wrong order. jsdom matches a browser, and it lets the test install a fake `fetch` before any page script runs. jsdom 30 needs Node ≥ 22.22.2, and Laptop B has 22.21.1, so 29.1.1 is pinned.

## Task report

| Stage | Command | Result |
|---|---|---|
| RED, piece 1 (map, script line, zip) | `npm test`; integration | `src/wirer/index.js` missing; integration zip test fails. `af301eb` |
| GREEN | `npm test`; integration | unit **146/146**, integration **41/41**. `bc60efc` |
| RED, piece 2 (reading) | `npm test` | 14 fail (sample rows remain, no API calls). `60cc757` |
| GREEN | `npm test`; integration | unit **161/161**, integration **41/41**. `da5adf8` |
| RED, piece 3 (writing) | `npm test` | 13 fail. `371e69b` |
| GREEN | `npm test`; integration | unit **175/175**, integration **41/41**. `767f34d` |
| RED, piece 4 (login) | `npm test` | 9 fail ("empty form not sent" and "no token without login" already true). `759cdfb` |
| GREEN | `npm test`; integration | unit **186/186**, integration **41/41**. `fcf5864` |
| Piece 5, end to end (written after pieces 2–4, so no RED stage) | integration | real generated backend + MongoDB + the real Laptop B employees page in jsdom: add, edit, search, delete, field error, login, in-row edit, all surviving a reload: **47/47**. `c6f4dab` |
| RED, double click | `npm test` | Add clicked twice sent 2 records. `0d7d40f` |
| GREEN | `npm test` | **187/187**. `b5f0209` |
| Real run (Laptop B) | real Ollama + Screenshot-to-Code, `samples/mocks` m2 and m4 + m1 | both SYNCED (403 s, 413 s); zips unzipped, `npm install`, `npm start`. Smoke in real Chrome, first run: Products 3/6 (see below), Staff 4/4 |
| RED, real pages | `npm test` | the real pages + real specs became fixtures: 6 fail (Add with no form, page-number buttons, `$12.00`, "Showing 1-3 of 24"). `c69f7b6` |
| GREEN | `npm test` | **195/195**. `dff2a0d` |
| Real run, again | `npm run smoke:wire` | **Products 7/7** (add through a new row, saved after reload, edit inside the row, search, delete); **Staff 6/6** (no login sends you to the login page, sign in, rows from the database, edit inside the row, delete) |
| Final | all | unit **195/195**, integration **47/47**, web **8/8**; `wirer/index.js` coverage 100% lines and functions, 88.6% branches |

## What the real pages taught us

Laptop B's real Products page (from the m2 screenshot) differed from the hand-written test pages:
- **An "+ Add Product" button with no form.** The screenshot showed only the button. The binder now opens a new row in the page's own look; Save or Enter saves it, and Escape cancels.
- **Page-number buttons marked `prevPage` / `nextPage`** ("1", "2", "3" as prev, "8" as next). A numbered button now goes to that page, and only the arrows switch off at the ends.
- **Prices drawn as `$2.50`.** Numbers now follow the samples' format.
- **"Showing 1-3 of 24"** under the table is kept true.
- **Markers set from JavaScript** (`cell.dataset.field = ...`) already worked, because the binder reads the page after it has drawn.

## Known gaps

- **Logout** is wired only if a page has `data-action="logout"`. Step 10's instructions never asked Laptop B for that marker.
- **A cleared field during Edit** keeps its old value: the generated validation treats empty as "unchanged".
- **Other text the page made up** (for example "Page 1 of 13" written in another way, or a column the spec doesn't have) stays as the sample showed it.
- **Generated pages need internet** for the Tailwind script, as before.
- **The binder's own code coverage can't be measured by Node,** because it runs inside the fake browser. Its behaviour is covered by 49 page tests, plus the end-to-end and real-Chrome runs.

## Bug found after Step 15 (22 Oct): Add Employee never worked for samples/employees.png

**What the user saw:** the page was built and wired, but Add Employee saved nothing.

**Cause, from the real run:** the screenshot's Department dropdown is closed, so the vision model saw only its prompt, "Select Department". The Spec Deriver made Department a fixed list (`enum`) whose only allowed value was that prompt. The backend then refused every real department ("must be one of: Select Department"). The binder showed this only as a small bubble on the dropdown. The binder also gave the page's empty prompt the value "Select Department", so the smoke check (which picked the first non-empty option) saved the prompt and passed.

**Fix (test-first):**

| Stage | Result |
|---|---|
| RED `ee7e984` | 5 fail: placeholders became allowed values; a closed dropdown became an enum with no real choices |
| GREEN `648e07c` | Spec Deriver: dropdown prompts ("Select …", "Choose …", "-- Select --", "All …", the label itself) are never values. A dropdown with no visible choices is stored as text with `control: "select"`, and the page instructions still ask for a `<select>`. The open question says the choices were not visible. Unit 200/200 |
| RED `2a87ed2` | binder gave the empty prompt a value; the smoke script now picks a real choice like a person, and fails on the before-fix app with the same message the user saw |
| GREEN `60998b0` | binder keeps an empty prompt empty. Unit 201/201, integration 47/47 |
| Real run | same screenshot, fixed code → SYNCED in 151 s → `npm start` → real Chrome: **7/7** (add with "Engineering", reload, edit, search, delete) |
