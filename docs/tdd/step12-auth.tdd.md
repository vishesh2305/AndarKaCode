# TDD evidence: Step 12, login templates (only when a login screen is shown)

**Source plan:** no `*.plan.md`; journeys from [ARCHITECTURE.md](../../ARCHITECTURE.md) v3.1 §4.2 (login form → accounts, login, token, protected routes, first account; sign-up / user menu / roles only when visible) and [plan.md](../../plan.md) Step 12.
**Branch:** `step12-auth` · **Runners:** `npm test`, `npm run test:integration` (real MongoDB), Node v22.21.1 on Laptop B.
**Code:** `templates/backend/auth.js` (passwords, account model, login-session model, middleware, first-account seed, auth routes); `server.js`, `env-example.js`, `api-tests.js` templates extended; `builder-api/src/generator/index.js`.

## User journeys

1. No login screen → no login code at all (no accounts, no guard, nothing in `.env.example`).
2. A login screen → accounts, `POST /api/auth/login`, every `/api` data route needs a login (`/health` and the pages stay public), first account from `.env`.
3. Sign-up link → `/register`; user menu → `/me` + `/logout`; role labels → a `role` on accounts. Each only when shown.
4. Passwords never stored, tokens never stored, wrong-password answers identical for unknown emails, login paused after 5 wrong passwords, sessions expire.
5. The generated app's own tests log in and test these rules.

## Design decisions

- **Opaque random tokens + a `loginSessions` collection** (only a SHA-256 fingerprint stored, TTL index removes expired rows) instead of JWT: logout really ends a login, nothing to misconfigure, and no extra package (the app stays Express + Mongoose).
- **Node's built-in `scrypt`** with a random salt per password; constant-time comparison.
- **`Account` / `LoginSession`** model names (collections `accounts`, `loginSessions`), decided before implementation: a screenshot of a "Users" or "Sessions" table must not clash with the login models.
- **Roles add no route restrictions**: a screenshot can't show who may do what. Registered accounts get no role; the first account gets the first role label shown.

## Task report

| Stage | Command | Result |
|---|---|---|
| RED | `npm test`; integration | unit 9 fail ("no login code without a login screen" already passed); integration 8 fail, 28 pass. `f6c0329` |
| Test design change (before implementation) | — | models renamed to `Account` / `LoginSession` in the RED tests |
| GREEN | `npm test`; integration | unit **125/125**, integration **36/36** (8 login checks + generated apps' own tests incl. one with sign-up/me/roles). One test fix: the roles check reads the generated text, because two generated apps in one test process share Mongoose's model registry. `0d173a3` |
| Real-model specs | generate + run each app's own tests | 7/7 apps pass: m1 5, m2 9, m3 3, **m4-login 6**, m5 7, m6 4, **login+employees 10** (real login + real employees inventories read together). Login code only in the two apps with a login screen. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | No login screen → no auth files, no guard, no `ADMIN_*` / `SESSION_*` | `generator-auth.test.js` | unit | PASS |
| 2 | Login screen → accounts, sessions, passwords, guard, seed, auth routes; login alone → only `POST /login` | `generator-auth.test.js` | unit | PASS |
| 3 | Sign-up + user menu → `/register`, `/me`, `/logout`; roles → `role` enum only when shown | `generator-auth.test.js` | unit | PASS |
| 4 | `/api/auth` mounted before the guard; the guard before every data route | `generator-auth.test.js` | unit | PASS |
| 5 | Salted scrypt hash (new salt each time), verify right/wrong/malformed, no `passwordHash` in JSON | `generator-auth.test.js` | unit | PASS |
| 6 | Generated tests log in and include the login rules | `generator-auth.test.js` | unit | PASS |
| 7 | No token / made-up token → 401; `/health` public | `generated-auth.test.js` | integration | PASS |
| 8 | Right password → token + data; same answer for wrong password and unknown email | `generated-auth.test.js` | integration | PASS |
| 9 | 5 wrong passwords → the right one gets 429 | `generated-auth.test.js` | integration | PASS |
| 10 | Raw token never stored; expired session → 401 | `generated-auth.test.js` | integration | PASS |
| 11 | Register logs in straight away; duplicate (any case) → 409; short password → 400 | `generated-auth.test.js` | integration | PASS |
| 12 | `/me` returns the user and role; logout ends the session | `generated-auth.test.js` | integration | PASS |
| 13 | First account from `.env` only while there are none | `generated-auth.test.js` | integration | PASS |

## Known gaps

- The lockout counter lives in memory: it resets when the app restarts and isn't shared between several app instances (fine for one generated app).
- The login form is always email + password; a screenshot with a "Username" field still gets an email login.
- The frontend side (storing the token, sending it, redirecting to the login page on 401) is the Wirer's job in Step 15.

## Merge evidence

RED `f6c0329` → GREEN `0d173a3` → this report.
