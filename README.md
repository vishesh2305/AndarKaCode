# AndarKaCode

> **Screenshot in, working full-stack app out.**  
> Deterministic frontend and backend generation backed strictly by visible UI evidence.

[![Tests](https://img.shields.io/badge/tests-195%20unit%20%7C%2047%20integration-brightgreen)](#testing)
[![Status](https://img.shields.io/badge/status-Phase%201%20(Steps%201--12%2C%2015%2C%20UI%20v1)-blue)](#roadmap)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-orange)](#prerequisites)

---

## 🎯 The Guiding Rule: "No Evidence, No Code"

Traditional LLM code generators hallucinate unrequested schemas and broken endpoints. **AndarKaCode** derives code deterministically:

- **100% Traceable:** Every database model, Express route, and input validation rule points directly to a visible element on an uploaded screenshot.
- **Zero Ghost Code:** If no "Add" button is visible, no `POST /create` is generated. If no login screen is uploaded, **zero authentication code** is created.
- **Deterministic Contract:** Frontend and backend generation run against a shared SHA-256 Contract hash verified by the **Sync Barrier**.

---

## 🔄 How It Works (Pipeline Flow)

```
[UI Screenshots]
       │
       ▼
 1. Upload & Scale ───► SHA-256 fingerprint; image scaled to ≤ 1280px
       │
       ▼
 2. Vision Inventory ─► Ollama (Qwen3-VL) catalogs tables, buttons, inputs & cards
       │
       ▼
 3. Spec Deriver ─────► Deterministic rules compile App Spec with visible evidence
       │
       ▼
 4. Dual Generation ──► ┌─► Laptop B (GPU): S2C redraws HTML + markers (~2.5 min)
                        └─► Laptop A (Templates): Express CRUD + tests (<100 ms)
       │
       ▼
 5. Sync Barrier ─────► Verifies frontend & backend share identical Contract Hash
       │
       ▼
 6. Runtime Wirer ────► Injects `app.js` binder (preserves CSS, in-row edits, auth)
       │
       ▼
[Ready-to-Run App ZIP] (Express + MongoDB + Tailwind HTML)
```

---

## 🏗️ Architecture & Topology

The system splits heavy GPU vision tasks from orchestration across two machines:

| Service | Folder | Runs On | Port | Role |
|---|---|---|---|---|
| **Gateway** | [`gateway/`](gateway/) | Laptop B (Windows GPU) | `8787` | REST front-door with FIFO queue wrapping Ollama & S2C |
| **Builder API** | [`builder-api/`](builder-api/) | Laptop A (Mac / Host) | `4000` | State machine orchestrator, MongoDB, Spec Deriver, Templates |
| **Web UI** | [`web/`](web/) | Laptop A (Mac / Host) | `5173` | React / Vite dashboard with live Metro-Line pipeline tracker |
| **Templates** | [`templates/`](templates/) | Laptop A | — | Deterministic backend templates and frontend runtime binder (`app.js`) |
| **Shared** | [`shared/`](shared/) | Both | — | Shared contract schemas and hash verification logic |

> **Network Link:** Services communicate over a secure Tailscale overlay network protected by `X-API-Key` authentication.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** `>= 22.0.0`
- **MongoDB** running locally on port `27017`
- *(Laptop B only)*: NVIDIA GPU with **Ollama** (`qwen3-vl:8b`) and **Screenshot-to-Code**

### 1. Install Dependencies
```bash
# In the repository root
cd builder-api && npm install && cd ..
cd gateway && npm install && cd ..
cd web && npm install && cd ..
cd templates && npm install && cd ..
```

### 2. Configure Environment Files
Copy the `.env.example` templates:
```bash
cp builder-api/.env.example builder-api/.env
cp gateway/.env.example gateway/.env
```
*(If running both locally on one machine for development, set `HOST=127.0.0.1` and `GATEWAY_URL=http://127.0.0.1:8787`).*

### 3. Start Laptop B (GPU Worker)
On Windows, run the automated launch script:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-laptop-b.ps1
```
*This starts Ollama, Screenshot-to-Code (`:7001`), and the Gateway (`:8787`).*

### 4. Start Laptop A (Orchestrator & UI)
```bash
# Terminal 1: Start Builder API
cd builder-api
npm start

# Terminal 2: Start React Web UI
cd web
npm run dev
```
Open **http://127.0.0.1:5173** to drop screenshots and track the live pipeline.

---

## 🧪 Testing & Verification

Comprehensive test suites ensure zero regressions across both units and end-to-end browser execution:

```bash
cd builder-api

# Run all 195 unit tests
npm test

# Run integration tests against real MongoDB
npm run test:integration

# Run real headless Google Chrome smoke tests (Wirer & Binder verification)
npm run smoke:wire
```

---

## 🗺️ Project Roadmap & Status

| Step | Milestone | Status | Description |
|---|---|---|---|
| **1–4** | GPU & Vision Spikes | ✅ Done | Ollama on GPU, S2C patching, prompt instructions, contract extraction. |
| **5–7** | Connectivity & Gateway | ✅ Done | Monorepo layout, REST Gateway queue, Tailscale cross-machine calls. |
| **8–9** | Orchestrator & Barrier | ✅ Done | Express state machine, MongoDB persistence, Sync Barrier hash checking. |
| **10–12** | Inventory, Spec & Auth | ✅ Done | UI Inventory pass, App Spec deriver, backend templates, adaptive auth. |
| **15** | Runtime Wirer | ✅ Done | Universal `frontend/app.js` binder verified in real Chrome (7/7 Products, 6/6 Staff). |
| **17 (v1)**| React Metro-Line UI | ✅ Done | Live subway-style pipeline visualizer and ZIP export. |
| **16** | Verifier & Repair Loop | ⏳ Next | Automated headless audit verifying every button; auto-Gateway repair. |
| **13** | AI Custom Actions | 📅 Planned | Code generation model with Docker sandboxing for unmatched buttons. |
| **14** | Project Memory | 📅 Planned | Screenshot dHash & vector cache for instant repeat generations. |
| **18–20** | Preview, GitHub & Demo | 📅 Planned | Docker sandboxes, one-click GitHub OAuth export, and final presentation. |

---

## 📚 Documentation & Presentation

- **[ARCHITECTURE.md](ARCHITECTURE.md):** Complete v3.1 system architecture specification.
- **[plan.md](plan.md):** Granular step-by-step progress and decision log.
- **[AndarKaCode_Presentation_v2.pptx](AndarKaCode_Presentation_v2.pptx):** 10-slide visual presentation deck with architecture diagrams and screenshots.
