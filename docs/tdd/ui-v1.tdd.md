# TDD evidence: UI v1 (presentation version)

**Source plan:** no `*.plan.md`. The journeys come from the user's request (20 Oct): a clean, light, cartoon-style UI that runs the project, shows every stage as a pipeline with "how it works" for each one, and downloads the app as a zip. This is an early, smaller version of [plan.md](../../plan.md) Step 17.
**Branch:** `ui-v1` · **Runners:** `builder-api`: `npm test`, `npm run test:integration` (real MongoDB); `web`: `npm test`. Node v22.21.1 on Laptop B.
**Code:**
- `builder-api/src/zip.js` (zip writer)
- `builder-api/src/package-app.js` (file list, path check, README, archive)
- `builder-api/src/server.js` (UI endpoints, serves `web/dist`)
- `web/` (React 19 + Vite): `src/pipeline.js` (project → stations), `src/stations.js` (texts), `src/components/*`, `src/styles.css`

## User journeys

1. Upload 1 to 10 screenshots (drop or pick, reorder, remove), give a name and pick the AI mode, then start.
2. Watch the project move along a metro line: Upload, Read, Plan, then a split into Pages (Windows GPU) and Backend (Mac), joining at Sync check. Wire, Check and Ready show as "coming next".
3. Click any station to read how it works and see this project's live details (times, page jobs, spec fingerprint, errors).
4. Look at the screenshots, the plan with the evidence for each part, each generated page (live, sandboxed), and every generated backend file.
5. Download the app as a zip once it is SYNCED, never before.

## Design decisions

- **A home-made zip writer** (`zlib.deflateRawSync` + `zlib.crc32`, about 100 lines) instead of a new package. It is checked with the operating system's own `tar`, and it refuses names that could escape the folder (`..`, absolute paths, `\`).
- **Download only when SYNCED** (409 otherwise), and only the jobs for the current spec hash: the zip never mixes versions.
- **Generated files are read through `safeAppPath`**: a `?path=` outside the app folder gets 400.
- **The pipeline view is a pure function** (`pipelineStatus(project)`), tested without a browser. The components only draw what it returns.
- **Served by the Builder API** from `web/dist`: one address (`http://127.0.0.1:4000`), no CORS. `npm run dev` (port 5173) proxies `/api` for development.
- **Light mode only, with fonts bundled** (no Google Fonts call), and `prefers-reduced-motion` stops the animations.
- **Page previews run in `<iframe sandbox="allow-scripts">`**: a generated page can run its own scripts but cannot reach the UI.

## Task report

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | zip writer: `src/zip.js` missing. `f46c20f` |
| GREEN | `npm test` | **131/131**; zips listed and extracted by Windows `tar`. `cb783c5` |
| RED | integration | 4 fail: screenshots, files, file content without path escape, download (409 before SYNCED, zip after). `8cf89c4` |
| GREEN | `npm test`; integration | unit **131/131**, integration **40/40**. One test fix: `Content-Disposition` may or may not quote the file name. `bb1c3eb` |
| RED | `web: npm test` | `web/src/pipeline.js` missing. `e6c30a4` |
| GREEN | `web: npm test` | **8/8** (stations, current station, failed Plan for a rejected spec, jobs for old versions ignored, timings). `7104b79` |
| UI build | `web: npm run build` | about 246 KB JS (78 KB gzip), 30 KB CSS |
| Final run | all three | unit **131/131**, integration **40/40**, web **8/8** |

## Real run (Laptop B, real Ollama + Gateway, private test MongoDB)

- **Staff Directory** (login + employees screenshots): reached SYNCED. The UI showed both pages and all 14 backend files. The downloaded zip (31 KB) holds `backend/`, `tests/`, `frontend/page-1.html`, `frontend/page-2.html`, `frontend/index.html`, `screenshots/`, `README.md` and `app-spec.json`.
- **Leave Requests** (one screenshot): watched live through Read, Plan and the split build, then reached SYNCED.
- Checked with headless Chrome screenshots: building state, every station panel, the four tabs, the new-project form.

## Problems found and fixed on the way

- Metro labels were cut off at the top and bottom: the view box is now taller, and labels read name first, then place.
- The Page 1 preview looked blank in an early screenshot. It was the screenshot being taken before the page's own Tailwind script had loaded; with a short wait, the page renders inside the sandboxed frame.
- The code view showed `=>` as an arrow (font ligatures): turned off.
