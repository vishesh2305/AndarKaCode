# AndarKaCode

Screenshot in, working app out. Laptop B builds the frontend (Screenshot-to-Code on the GPU); Laptop A builds the backend from templates. Both follow the same **Contract**. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and [plan.md](plan.md) for progress.

| Folder | Runs on | What it is |
|---|---|---|
| `gateway/` | Laptop B | REST front door to Screenshot-to-Code (Step 6) |
| `builder-api/` | Laptop A | Orchestrator: state machine, Sync Barrier, MongoDB (Steps 8–12) |
| `web/` | Laptop A | Our React UI: upload, live pipeline, download the app (UI v1) |
| `templates/` | Laptop A | Backend code templates filled from the Contract (Step 10) |
| `shared/` | Both | Contract schema and hash, used by both laptops |
| `spikes/` | Either | Small experiments from Phase 1 |
| `samples/` | Either | Test screenshots and their outputs |

Each service has its own `.env.example`. Copy it to `.env` on the laptop that runs that service and fill in the values. `.env` files are never committed.

## Open the UI (Laptop A)

1. Build it once (and again after UI changes): `cd web && npm install && npm run build`
2. Start the Builder API as usual (`cd builder-api && npm start`).
3. Open http://127.0.0.1:4000

While changing the UI, `cd web && npm run dev` serves it at http://127.0.0.1:5173 with live reload (the Builder API must be running).
