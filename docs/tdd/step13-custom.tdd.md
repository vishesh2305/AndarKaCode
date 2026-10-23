# TDD evidence: Step 13, AI code for custom buttons

**Source plan:** the Step 13 plan (23 Oct), approved with the user's choices:
- **Safety:** a safety check, plus the app runner from Step 16, instead of Docker.
- **Code model:** test both, then decide. After the model test, the user chose **follow the project's mode**.

The user then asked for every generated app to be testable with working buttons. That added two things: the Live preview starts with the screenshot's rows, and the Pages tab opens on Live.

**Branch:** `step13-custom` (built on `step16-verifier`) · **Runners:** `builder-api`: `npm test`, integration with `TEST_MONGODB_URI`; `web`: `npm test`. Node v22.21.1 on Laptop B, Node 26 on the Mac.

## What it does

A **custom** button is one no template covers, such as "Give 10% Raise" or "Duplicate". Status buttons like "Approve" and "Export CSV" still come from templates. For each custom button, the Backend stage now does this:

1. **Ask a coding AI** for one function in a fixed shape:
   ```js
   export default async function ({ record, input, helpers }) { … return { message: "…" }; }
   ```
   The request gives the button, whether it sits on a row or on the page, the table's fields and types, the helpers it may use, and the rules. Screenshot evidence is never sent.
2. **Safety check** (`src/custom/safety.js`, using the acorn parser). The code is read as a structure and never run. It is refused, with the line number, if it has:
   - imports or `require`;
   - `process`, `eval`, `Function` or `globalThis`;
   - `constructor` / `__proto__` / `prototype` escapes;
   - timers or `fetch`;
   - `while` or `for (;;)` loops;
   - classes or `this`;
   - computed keys;
   - code outside the one function.
3. **Press the button once in the real app** (`src/custom/tester.js`). The app runs in its own process on a throwaway database with two sample rows, and signs in first if it has a login. The code passes when the button answers (200), or refuses with a message (400). A row button must leave the other row unchanged.
4. **Repair.** Whatever went wrong (safety problem, error, timeout, other rows changed) goes back to the AI together with its code. It gets up to **3 repairs per model**.
5. **Isolate.** A button that never passes gets no code file. It keeps answering "not available yet" (501), and the rest of the app is still built, checked and downloadable.

**Which AI** follows the project's mode, the same as the screenshot reader:
- **Local:** Qwen 2.5 Coder 7B on Ollama.
- **Cloud:** Gemini.
- **Auto:** Gemini first, because it was right more often in the test below, with Qwen as the backup.

**At run time** (`templates/backend/custom-runtime.js`, inside the generated app):
- Each press runs in its own **worker thread**. Inside it, the code runs in a `vm` room with no `process` and no `require`, and code can't be made from strings.
- Only plain text crosses between the room and the server.
- The code reaches data only through its helpers: `get`, `list`, `create`, `update`, `updateMany`, `remove`, `fail`. They cover its own table only and use the same validation as Add and Edit.
- A filter that names something other than a field is **refused**, not quietly turned into "every record".
- If the code goes 2 s without calling a helper (a stuck loop), or a press takes more than 30 s, the worker is stopped. The app keeps answering.

**Around it:**
- **Wire:** written buttons are marked available in `api-map.json`.
- **Binder:** runs a written button and shows its message ("Salary updated").
- **Check:** presses each written button like a person and reports what it answered.
- **App tests:** the app's own `tests/api.test.js` expects an answer from written buttons, and 501 only from isolated ones.
- **UI:** the Backend station lists who wrote each button, or why it was left out.

**Live preview for every generation:**
- **Starting rows.** The preview starts with the rows the screenshot shows. They're read from the page's `SAMPLE_*` array with the acorn parser, so the page's code is never run, and anything that would need running code is left out. If the page has no such array, the screenshot's table as read by the vision model is used. The values are converted to the spec's types (`$52,000` becomes 52000), and the rows keep the page's order.
- **Default view.** The Pages tab opens on **Live** once the app is Ready. **As built** is labelled as Laptop B's drawing, with buttons that don't save anything.

## Choosing the coding model

`node scripts/custom-model-test.mjs --provider local|cloud [--model X]` uses 5 example buttons, each with a hidden right answer:
- Give 10% raise (row);
- Duplicate (row);
- Mark all paid (page);
- Recalculate days (row);
- Restock (page).

Every answer goes through the safety check, then runs in a real generated app, and the database is compared with the right answer. One repair is allowed.

| Model | Right | Right the first time | Model time | Where |
|---|---|---|---|---|
| `gemini-3.5-flash` (cloud) | **5/5** | **5** | 42.4 s | Mac |
| `qwen2.5-coder:7b` (local) | 4/5 | 2 | 38.9 s | Mac |
| `llama3.1` (local, general model) | 2/5 | 1 | – | Laptop B |

- Every answer from both coding models passed the safety check the first time.
- Qwen's miss: it counted 10 to 12 January as 2 days, where a person counts 3.
- **Why "first time" matters most:** a real build has no hidden right answer. The one-press test can only see that a button answers and keeps the data valid, so the model that is right on its first try is the safer one.

## Task report

| Stage | Result | Commit |
|---|---|---|
| RED, safety check + runtime in a generated app | `src/custom/safety.js` missing, custom buttons still 501 | `e06939f` |
| GREEN | unit 258/258, integration 91/91. A real finding: a `vm` time limit with `microtaskMode: "afterEvaluate"` crashed Node itself (an assertion in `InternalCallbackScope`), so each press runs in a worker thread that can always be stopped | `45164fd` |
| RED → GREEN, prompt, repair prompt, code extraction | | `3e293bc` → `15765ec` (unit 267) |
| Model test script + first numbers | llama3.1 2/5; Gemini answered 503 "high demand" on Laptop B (later 5/5 on the Mac) | `4ca05ff` |
| RED, AI writer in the Backend stage | `src/custom/writer.js` and `tester.js` missing | `99edaf7` |
| GREEN | unit 278/278, integration 102/102 (a pipeline run with one button written and one isolated after 4 unsafe answers, still READY) | `760da96` |
| Sample screenshot with custom buttons | `samples/mocks/m7-custom-buttons.png` | `c46a00e` |
| RED, Live with sample rows, written buttons available / run / checked, UI | | `a48ce09` |
| GREEN | unit 294/294, integration 103/103, web 15/15 | `bb7454d` |
| RED, real-run bug (below) | | `0623fc0` |
| GREEN | unit 296/296, integration 106/106 | `6b6d7f0` |

## Real runs

**The user's report (Mac):** the app was generated, but **Live showed no buttons**, and the As built buttons did nothing. Reproduced on Laptop B with m7:
- the Live preview started on an **empty** database, so there were no rows and no row buttons;
- the screenshot has no Add button, so a row couldn't be made;
- As built is only a drawing.

This led to the sample rows and the Live default above.

**A real bug found by clicking in real Chrome (Laptop B, llama3.1):** "Duplicate" changed **every** employee's salary, and showed `$62,920.000000000015`.
- **Cause:** the AI wrote `helpers.updateMany({ id: newId }, …)`. `id` is not a field, so the validation dropped it from the filter, and the filter matched every record.
- **Why the one-press test missed it:** it had used a single row, where "every record" looked like "this row".

Fixed test-first:
- filters naming a non-field are refused;
- the one-press test uses two rows, and a row button must leave the other unchanged;
- numbers show at most 2 decimals;
- the AI is told to round money and to change one record with `update(id, …)`.

**Final real run on Laptop B (m7, local llama3.1 as the coding model):**
- Backend: 2 of 2 buttons written on the first answer.
- Check: 6 passed, 0 failed. Both custom buttons were pressed: "Salary updated", "Employee duplicated successfully".
- Live in real Chrome:
  - 4 rows from the screenshot, 12 row buttons;
  - Give 10% Raise changed only Ann Lee, from $52,000 to $57,200;
  - Duplicate added a fifth row;
  - each button showed its message.

**On the Mac (user's run, 23 Oct):** the tests passed, and m7 worked in Live: the buttons are there, Give 10% Raise and Duplicate work, and the Backend and Check stations show the results.

**Final:** unit **296/296**, integration **106/106**, web **15/15**.

## Known gaps

- **Docker is not used.** The plan named a Docker sandbox. The user chose the safety check plus the worker-thread room, inside the generated app's own process with no keys and a throwaway database. A full container sandbox is still Step 18.
- **The one-press test can't know the right answer.** A button that answers and keeps the other rows unchanged passes, even if its sum is off by one. The model choice ("right the first time") is the guard for that, and the user sees the result in Live.
- **Repairs reach only the coding AI.** A custom button the page forgot to draw is still a page problem; the Check reports it as one.
