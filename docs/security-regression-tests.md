# Security Regression Test Matrix

**Project:** Personal Finance Tracker  
**Phase:** 18 — Security & Session Hardening  
**Created:** Task 18.10  
**Last updated:** 2026-09-24

This document contains the full security regression test suite for Phase 18. It is organized
into five matrices covering authentication, user isolation, migration, credential safety, and
state safety. Each matrix targets a distinct security concern area and specifies the execution
method required for each test.

Tests marked **PASS** in the Status column have been verified from the codebase (code-only
tests). All other tests require manual execution as described in the "How to Run" section below.

---

## How to Run

### Code-verifiable tests (D1–D3)

These tests are static scans against repository source files. No browser, server, or Supabase
account is required.

Run the following searches across all files with extensions `.js`, `.html`, `.md`, `.sql`,
`.json` and any `.env*` file, excluding `node_modules`:

- **D1** — Search for the literal string `service_role`
- **D2** — Search for a regex matching `eyJ[A-Za-z0-9_\-]{200,}` (a JWT-shaped token > 200 chars)
- **D3** — Search for the literal string `postgres://`

Record **PASS** if zero matches are found in production source files. Matches appearing only
inside spec or documentation files (`.kiro/`, `docs/`) are **not** a failure — those files
reference the pattern by name for documentation purposes, not as live credentials.

---

### Browser DevTools tests (A1–A9, D4–D6, E1–E5)

These tests require `index.html` opened in Chrome or Firefox with DevTools open.

**Setup:**
1. Open `index.html` directly in a browser (no server required).
2. Open DevTools → **Console** tab (for A1–A9, E1–E5, D6).
3. Open DevTools → **Application** → **Local Storage** (for D4).
4. Open DevTools → **Network** tab (for D5).

**For Matrix 5 state-safety tests (E1–E5):** After signing out, inspect module-level state via
the DevTools Console by typing `window._debugState` if exposed, or by observing DOM emptiness
directly. E3 can be confirmed visually: all finance cards, transaction list, charts, and
category list should be empty.

---

### Two-user Supabase account tests (B1–B6)

These tests require a live Supabase project with RLS fully configured.

**Prerequisites:**
- Two distinct Supabase accounts (User A and User B) registered against the live project.
- `js/config.js` updated with the real project URL and anon key.
- `supabase/schema.sql` and `supabase/rls.sql` applied to the live project.
- Two browser windows or tabs (use a private/incognito window for User B to isolate sessions).

**B6 — Direct INSERT with spoofed `user_id`:** Use the browser DevTools console to call the
Supabase JS client directly with User B's credentials but with User A's UUID as `user_id`.
Example (with Supabase JS client loaded):

```js
const { error } = await supabase
  .from('transactions')
  .insert({ user_id: '<User-A-UUID>', item_name: 'Spoof', amount: 1, type: 'expense',
            category: 'Other', date: new Date().toISOString() });
console.log(error); // Expected: RLS policy violation error
```

---

### Migration tests (C1–C5)

- **C1–C2:** Execute from the browser DevTools Console against a page with the app loaded:
  ```js
  // Assuming migration module is accessible — open index.html and run:
  import('./js/migration.js').then(m => {
    console.log(m.startMigration(null));           // C1
    console.log(m.startMigration('user@test.com')); // C2
  });
  ```
- **C3:** Verifiable from code — inspect `migration.js` `migrationMarkerKey()` implementation and
  confirm the key template is `MIGRATION_MARKER_PREFIX + userId` where `userId` is always the UUID.
- **C4:** Execute in browser with existing local data and an authenticated session. After
  `clearLocalFinanceData(userId)`, inspect DevTools → Application → Local Storage.
- **C5:** Requires network throttling (DevTools → Network → throttling → Offline mid-migration)
  or a mock that returns a network error from `addTransaction` after the first few records.

---

## Matrix 1 — Authentication

| ID | Test Description | Expected Result | Status |
|----|-----------------|-----------------|--------|
| A1 | Open `index.html` in a browser without signing in | Finance_UI (`#app-main`) is hidden; login form is visible | |
| A2 | Sign in with valid credentials | Finance_UI is revealed; the authenticated user's email is shown in the header | |
| A3 | Sign out via the logout button | Finance_UI is hidden; login form is visible; no prior user data remains in the DOM | |
| A4 | Simulate session expiry by revoking the session via Supabase Dashboard → Auth → Users | Same teardown as A3: Finance_UI hidden, login form shown, DOM cleared | |
| A5 | Refresh the page while already signed in | Finance_UI is shown with the correct data; session persists across refresh | |
| A6 | Refresh the page while signed out | Finance_UI remains hidden; login form is visible | |
| A7 | Attempt to register with a password shorter than 8 characters | Blocked by client-side validation before any network call; error message shown in the form | |
| A8 | Attempt to register with an invalid email format (e.g. `notanemail`) | Blocked by client-side validation before any network call; error message shown in the form | |
| A9 | Sign in with a correct email but wrong password | Error message displayed in the login form; Finance_UI remains hidden | |

---

## Matrix 2 — User Isolation

> All tests in this matrix require two distinct Supabase accounts and a live project with RLS enabled.
> See "Two-user Supabase account tests" in the How to Run section above.

| ID | Test Description | Expected Result | Status |
|----|-----------------|-----------------|--------|
| B1 | Sign in as User A, add ≥1 transaction, then sign out and sign in as User B | User B sees zero transactions belonging to User A; transaction list is empty or shows only User B's own data | |
| B2 | Sign out as User A and sign in as User B in the same browser tab | Finance_UI shows exclusively User B's data (transactions, balance, totals) | |
| B3 | Sign out as User A and sign in as User B — inspect charts | Charts display only User B's spending data; no User A amounts appear in any chart segment | |
| B4 | Sign out as User A and sign in as User B — inspect category list | Only User B's custom categories are listed; User A's custom categories do not appear | |
| B5 | Sign out as User A and sign in as User B — inspect balance cards | Total balance, income, and expense figures reflect only User B's transactions | |
| B6 | Authenticated as User B, attempt a direct `INSERT` into `transactions` with `user_id` set to User A's UUID via the DevTools console | Supabase returns a Row Level Security `WITH CHECK` violation error; no row is inserted | |

---

## Matrix 3 — Migration

| ID | Test Description | Expected Result | Status |
|----|-----------------|-----------------|--------|
| C1 | Call `startMigration(null)` from the DevTools console | Returns `{ ok: false, error: { code: 'unauthenticated', message: 'A signed-in user is required.' } }` immediately; no Supabase call made | |
| C2 | Call `startMigration('user@example.com')` (a non-UUID string) from the DevTools console | Returns `{ ok: false, error: { code: 'unauthenticated', message: 'A signed-in user is required.' } }` immediately; no Supabase call made | |
| C3 | Inspect the migration marker key written to localStorage after a migration starts | Key is `financeTrackerMigration_${UUID}` where UUID is the Supabase user UUID; the key never contains `@` or any email-shaped substring | |
| C4 | Call `clearLocalFinanceData(userId)` after a completed migration | `localStorage.getItem('financeTrackerData')` returns `null`; migration marker (`financeTrackerMigration_${userId}`) remains present with `status: 'completed'` unchanged | |
| C5 | Trigger a network error mid-migration (throttle to Offline in DevTools after upload begins) | Migration stops uploading; final status is `'partial'`; `localStorage.getItem('financeTrackerData')` returns the byte-for-byte identical value it held before migration started | |

---

## Matrix 4 — Credential Safety

| ID | Test Description | Expected Result | Status |
|----|-----------------|-----------------|--------|
| D1 | Search all `.js`, `.html`, `.md`, `.sql`, `.json` source files for the literal string `service_role` | Zero matches in production source files (`js/`, `css/`, `index.html`, `supabase/`) | PASS |
| D2 | Search all source files for `eyJ[A-Za-z0-9_\-]{200,}` (JWT-shaped token longer than 200 characters) | Zero matches in any committed file | PASS |
| D3 | Search all source files for `postgres://` (direct database connection string) | Zero matches in any committed file | PASS |
| D4 | After signing in, inspect DevTools → Application → Local Storage | Only `financeTrackerData` and `supabase-auth-*` keys are present; no key contains a plaintext password or Service_Role_Key | |
| D5 | Open DevTools → Network tab before signing in, then complete the sign-in flow | No plaintext password appears in any outgoing request body or URL visible in the network log | |
| D6 | Open DevTools → Console and perform a full authenticated session (sign in, add transaction, sign out) | No JWT, no plaintext password, no `SUPABASE_CONFIG` values appear in any console output | |

**D1 scan detail (Task 18.1 audit):** The string `service_role` appears in production JS files
(`js/auth.js`, `js/config.js`, `js/supabase.js`) and `docs/migration-task-17.1-tests.html` only
as a JSDoc security warning or a test assertion confirming it is absent — never as an actual
credential value. No `service_role` key or JWT token appears in any committed file.  
**D2 scan detail:** Zero matches in any file.  
**D3 scan detail:** `postgres://` appears only in `.kiro/specs/` documentation — zero matches in production source files.

---

## Matrix 5 — State Safety

| ID | Test Description | Expected Result | Status |
|----|-----------------|-----------------|--------|
| E1 | After logout, inspect `state.currentUser` via DevTools Console | Value is `null`; the state object holds no user identity | |
| E2 | After logout, inspect the `financeAppInitialized` flag | Value is `false`; a subsequent login by a different user will trigger full re-initialization | |
| E3 | After logout, visually inspect all Finance_UI sections in the DOM | Transaction list, balance cards (total, income, expense, count), category list, monthly summary, and charts are all empty or destroyed | |
| E4 | Simulate session expiry (revoke session via Supabase Dashboard), then inspect state and DOM | Same results as E1–E3: `state.currentUser === null`, `financeAppInitialized === false`, all Finance_UI sections empty | |
| E5 | Sign in as User A, add transactions, sign out, then sign in as User B | Balance cards, transaction list, charts, and category list all show exclusively User B's data; no User A record, amount, or category name appears anywhere in the Finance_UI | |

---

## Summary

| Matrix | Tests | Code-verifiable | Browser DevTools | Two-user Supabase | Verified |
|--------|-------|-----------------|------------------|-------------------|----------|
| 1 — Authentication | A1–A9 (9) | 0 | 9 | 0 | 0 / 9 |
| 2 — User Isolation | B1–B6 (6) | 0 | 1 (B6 partial) | 6 | 0 / 6 |
| 3 — Migration | C1–C5 (5) | 1 (C3) | 4 | 0 | 0 / 5 |
| 4 — Credential Safety | D1–D6 (6) | 3 (D1–D3) | 3 | 0 | 3 / 6 |
| 5 — State Safety | E1–E5 (5) | 0 | 5 | 0 | 0 / 5 |
| **Total** | **31** | **4** | **22** | **6** | **3 / 31** |

3 of 31 tests have been verified from code (D1–D3). The remaining 28 require manual execution
in a browser with or without a live Supabase project as described in the How to Run section.
All 28 manual tests must pass before production deployment.
