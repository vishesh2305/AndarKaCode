| B1 |undefined| undefined **Done 25 Nov:** 4 samples under the drop zone (TechFest, Employees, Orders Dashboard, Staff & Departments) || A5 |undefined| undefined **Done 25 Nov:** `cd builder-api && npm run demo:check` (`-- --warm` loads the models). Found: Laptop B's vision model runs only 64% on the GPU, so close other GPU apps before the demo || A3 |undefined| undefined **Done 25 Nov:** `samples/mocks/m9-event-registrations` (TechFest 2026): READY, 11/11 checks, 239 s locally (read 29 s, page 203 s). Build it twice more || A2 |undefined| undefined **Done 25 Nov:** installed on Laptop B |# Phase 2 evaluation: getting the prototype ready to present

> This is the old **Step 20 (demo rehearsal)** in [plan.md](../plan.md), done before Stage 6.
> **Goal:** in about 10 minutes, the audience watches a screenshot become a working, tested app, and nothing breaks on stage.
> **Rule:** reliability first, polish second, features last. Nothing new gets built in the last 2 days, only rehearsal.

## The demo story (decide this first; everything else depends on it)

| # | What the audience sees | Proves |
|---|---|---|
| 1 | A screenshot they recognise (a college event registration screen) is dropped in | "Anyone can do this" |
| 2 | The metro map lights up: Read → Plan → Pages → Backend → Check → Ready | It works step by step, not as magic |
| 3 | **Side by side:** the screenshot and the generated app | It looks like what you drew |
| 4 | Live: add a record, **reload**, it is still there; edit; search; a custom button | A real backend and database, not a picture |
| 5 | The Check report: "8/8 passed", every button pressed by a robot | Tested, not only generated |
| 6 | The zip: models, routes, tests | Real code you own |
| 7 | 20 s clip: a fake bank login is **held for review** | Safety thought through |

Back-up demo projects, already READY before the talk:
- **m7** (employees with custom buttons);
- **m4** (login);
- **m3** (dashboard);
- the new event-registration mock.

## Phase A: make it reliable (must have)

| # | Task | Done when |
|---|---|---|
| A1 | Finish the Stage 5 Mac check: build the sandbox image visibly, `test:sandbox`, the bank mock held, `npm run review`, `npm run audit` | All pass on the Mac |
| A2 | Install the models on Laptop B: `ollama pull qwen2.5-coder:7b` (custom buttons in local mode) | m7's custom buttons are written locally |
| A3 | Make the event-registration mock (HTML → PNG, like `samples/mocks`) and build it 3 times | READY 3/3, and the time of each build noted |
| A4 | **A demo database:** start the API on a fresh `MONGODB_URI` (for example `andarkacode-demo`) so no test projects show; build the back-up projects into it | The project list holds only the demo projects |
| A5 | **`npm run demo:check`:** one command that checks Mongo, Ollama (models loaded), Screenshot-to-Code, the Gateway and the API, and loads the models first so the first build isn't slow | Prints one green line per service, or says which one is down |
| A6 | **The backup video:** a 2–3 minute screen recording of a full build plus the live app, saved offline on both laptops and a USB stick | It plays without internet |
| A7 | Venue check: projector resolution, the two laptops on one network (a phone hotspot as backup), power for both | Tried once in a similar room |

## Phase B: make it look like a product (should have; test-first, like every step)

| # | Task | Done when |
|---|---|---|
| B1 | **Try a sample:** on the upload screen, 3–4 sample screenshots to pick with one click (`samples/mocks`) | No file browsing on stage |
| B2 | **Side by side:** a third view next to *As built* / *Live*: the original screenshot beside the live page | Both fit on one projector screen |
| B3 | **A Ready card:** when a build finishes, one clear card: "Built in 3 min 12 s · 8/8 checks passed · 14 files · ₹0 (local models)" with *Open live* and *Download* | The result is clear at a glance, from the back of the room |
| B4 | **Readable from far away:** a presentation zoom (bigger text on the metro map and report), and the projector checked in light and dark | Readable at 1280×720 from 5 metres |
| B5 | Wording pass: every message the demo can show, in plain words (empty states, waiting, errors) | No developer wording on screen |

## Phase C: the story (must have)

| # | Task | Done when |
|---|---|---|
| C1 | **Slides (8):** problem; the demo (live); how it works (metro map + two laptops); what makes it different; the numbers; safety; roadmap (Stages 6–9); honest limits | Fits the time slot with 2 minutes to spare |
| C2 | **Demo script:** each click, what to say, how long it takes, and **what to do if it fails** (open the back-up project, or play the video) | You can run it without notes |
| C3 | **The numbers slide:** build time per mock, local vs cloud, tokens per build (the Step 25 metering), tests (unit 538, integration 242, sandbox 22, gateway 15, web 43) | Every number taken from a real run |
| C4 | **Q&A sheet**, at least these questions: "How is this different from ChatGPT or screenshot-to-code tools?" · "What if the AI writes wrong code?" · "What does a build cost?" · "Is it safe?" · "What can't it do yet?" · "Why two laptops?" | A short answer for each |
| C5 | **Two timed rehearsals**, one with a failure drill (stop the Gateway mid-build and recover) | Under time both times; the recovery takes under 30 s |

## Known gaps found while preparing
- The TechFest card "Total Registrations" is read as a custom metric instead of a count. It still passes; Stage 6 or a reader rule will fix it.
- Page drawing is the slow lane (about 3.5 min per page locally). The demo runs the build live, and while it draws, you show a back-up project.

## Order and time

| When | Do |
|---|---|
| Days 1–2 | A1–A4, then C2 drafted (the script shows what B needs) |
| Days 3–5 | B1–B3 (test-first, merged when green), then A5 |
| Day 6 | B4–B5, C1, C3, C4, A6 (record the video once the UI is final) |
| Day 7 | A7, then rehearsal 1 |
| Last day | Only rehearsal 2 and `demo:check`. No code changes |

**If there is less time:**
- **3 days:** Phase A, plus B1 and B3, plus Phase C.
- **1 day:** A3, A4 and A6, plus C1, C2 and C4, then demo from the back-up projects.

## On the day
1. Run `demo:check` an hour before, then do one warm-up build.
2. Open the back-up projects in tabs. Have the video ready.
3. Keep notifications off, and keep both laptops on power.
4. If a live build passes 3 minutes, say "here is one built this morning" and open its back-up project.
