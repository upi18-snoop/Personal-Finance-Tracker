# Implementation Plan: Phase 18 — Security & Session Hardening

## Overview

Phase 18 is a hardening-only phase. It introduces no new product features, no new user-visible
screens, and no changes to the architecture established in Phases 1–17. Every task either fixes
a confirmed Security_Finding, adds a protective guard, or produces the audit and production
readiness documentation required by Requirements 33–34.

Tasks map 1:1 to the twelve Phase 18 task numbers (18.1–18.12) as specified in the design
document. Task 18.13 is a final manual checkpoint only. No task introduces new user-facing
behavior.

Phase 18 completion means: security hardening implemented, static/security QA complete,
documentation complete, production checklist prepared, and remaining live verification
explicitly documented. It does NOT mean live production deployment. After Phase 18 the project
still requires: final E2E testing, live Supabase configuration, RLS verification against the
real project, two-user isolation test, production deployment, online smoke test, and release.

---

## Tasks

- [ ] 18. Phase 18 — Security & Session Hardening

  - [x] 18.1 Security Architecture Audit
    - Read and audit the following files in their entirety: `js/auth.js`, `js/config.js`,
      `js/supabase.js`, `js/supabase-storage.js`, `js/storage.js`, `js/migration.js`,
      `js/app.js`, `supabase/schema.sql`, `supabase/rls.sql`
    - For each file answer the audit checklist from design §Task 18.1:
      credentials present?, auth mechanism correct?, session lifecycle correct?,
      RLS configured?, defence-in-depth user_id in all writes?, migration guards present?,
      console/log leakage?
    - Scan all `.js`, `.html`, `.md`, `.sql`, `.json` and `.env*` files (outside
      `node_modules`) for the forbidden patterns: `service_role`,
      `SUPABASE_SERVICE_ROLE_KEY`, `supabase_admin`, `service_role_key`,
      `postgres://`, `postgresql://`, and any string beginning with `eyJ` that
      exceeds 200 characters in length
    - Classify every finding by severity: High (blocking), Medium, or Low
    - Create `PHASE18_REPORT.md` in the repository root with stubs for all required
      sections (Tasks Completed, Files Changed, Security Findings, Fixes Applied,
      Automated Tests, Manual Tests Still Required, Production Configuration Still
      Required); populate the Security Findings section with all findings discovered
      in this task
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8_

  - [x] 18.2 Authentication Security — `js/auth.js`
    - Audit `_normalizeError()`: currently it copies the raw SDK `message` string
      directly into the returned `{ code, message }` object; this leaks raw SDK
      internals — replace the returned `message` with a static, code-keyed string
      looked up from a safe-message map (never copied from the raw error); the
      `code` field is still derived by pattern-matching `raw.message` internally,
      but the matched string must not escape the function
    - Verify the returned Normalized_Error shape is exactly `{ code, message }`:
      `code` ≤ 50 characters, `message` ≤ 200 characters, no raw SDK content, no
      JWT, no stack trace in either field
    - Confirm `signOut()` error path already routes through `_normalizeError()` —
      it does; no code change needed, confirm via audit only
    - Add client-side pre-validation to `signUp` before any network call:
      (a) trim email and test against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — on failure
      return `{ ok: false, error: { code: 'validation-error', message: '...' } }`;
      (b) test `password.length >= 8` — on failure return same shape with
      `code: 'validation-error'`; only after both checks pass call
      `client.auth.signUp()`; the existing weak-password guard (`password.length === 0`)
      is replaced by this stricter check
    - Update `validateRegisterForm()` in `js/app.js` to require password ≥ 8
      characters (currently `< 6`), keeping it consistent with the auth module
      pre-validation; update the error message accordingly
    - Confirm `getCurrentUser()` returns `null` without throwing when
      `getSupabaseClient()` returns `null` or when `client.auth.getUser()` returns
      an error — both paths already safe; confirm via audit
    - Confirm `onAuthStateChange` fires `queueMicrotask(() => callback('INITIAL_SESSION', null))`
      when `SUPABASE_CONFIG` still contains placeholder strings — already
      implemented; confirm via audit
    - Confirm no `console.log`, `console.error`, `console.warn`, or `console.info`
      call in `auth.js` outputs a password or JWT — already clean; confirm via audit
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 25.9, 25.10, 25.11_

  - [x] 18.3 Session Lifecycle Hardening — `js/app.js`
    - Implement `clearAuthenticatedSessionState()` as the single internal teardown
      helper in `js/app.js`; this function centralises the consistent teardown
      sequence used by both explicit logout and every signed-out auth event,
      eliminating duplicate implementations:
      ```
      function clearAuthenticatedSessionState() {
        state.currentUser = null;          // 1. clear identity first
        hideProtectedApp();                // 2. hide #app-main
        financeAppInitialized = false;     // 3. reset init guard
        hideMigrationModal();              // 4. close migration modal if open
        clearFinanceUIDOM();               // 5. wipe Finance_UI DOM content
        // caller is responsible for step 6: show login/signed-out UI
      }
      ```
    - Implement `clearFinanceUIDOM()` as a new private helper in `js/app.js`:
      - Clear `#transaction-list` via `replaceChildren()`
      - Clear text content of `#total-balance`, `#total-income`, `#total-expense`,
        `#transaction-count` via `utils.safeText(el, '')`
      - Clear `#category-list` via `replaceChildren()`
      - Clear `#monthly-summary` via `replaceChildren()`
      - Call `charts.destroyCharts()` to destroy active Chart.js instances
      - Call `clearDataError()` to clear any data-error banner
    - Add `destroyCharts()` export to `js/charts.js` that destroys the active
      expense and income Chart.js instances (setting their module-level variables
      to null) so `initCharts()` can recreate them cleanly on the next login
    - Rewrite the signed-out `else` branch in `onAuthStateChange` to call
      `clearAuthenticatedSessionState()` followed by `showSignedOutState()` and
      `showLoginView()` — this single call handles SIGNED_OUT, SESSION_EXPIRED,
      and TOKEN_REFRESHED→null uniformly without any duplicate teardown logic
    - Verify the `financeAppInitialized` guard at the top of
      `initializeFinanceApplication()` fires before any state mutation when the
      flag is already `true` — already implemented; confirm via audit
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7_

  - [x] 18.4 Supabase Client & Configuration Security — `js/supabase.js`, `.gitignore`
    - Harden `getSupabaseClient()` in `js/supabase.js`: in addition to the existing
      placeholder-string checks, also reject any value where
      `SUPABASE_CONFIG.url.trim() === ''` or `SUPABASE_CONFIG.anonKey.trim() === ''`;
      return `null` without attempting CDN import in all invalid-config cases
    - Replace the CDN `catch` clause log in `getSupabaseClient()` with a static
      message that does NOT interpolate `err`, `SUPABASE_CONFIG.url`, or
      `SUPABASE_CONFIG.anonKey`:
      `console.error('supabase.js: failed to load supabase-js from CDN. Check your network connection.');`
    - Scan all JS files for `createClient(` — confirm it appears only in
      `js/supabase.js`; if found elsewhere, remove the rogue call and document as
      a Security_Finding
    - Add the following entries to `.gitignore` if not already present:
      `.env`, `.env.local`, `.env.production`, `*.key`, `*.pem`
    - Create `.git/hooks/pre-commit` as a supplementary developer-local credential
      scanner: it scans staged files for the service-role JWT pattern (a string
      starting with `eyJ` longer than 200 chars, or any occurrence of the literal
      `service_role`); exit 1 with an explanatory message if found; document
      clearly in the file header and in PHASE18_REPORT.md that this hook is a
      developer-local safeguard only — it is NOT committed to the repository, is
      NOT a repository-wide security guarantee, and is NOT a substitute for the
      primary controls (source credential scan, `.gitignore`, manual review, and
      no Service_Role_Key in committed files); on Windows the hook runs as a
      PowerShell or Git-bash script and does NOT require `chmod +x` as a
      prerequisite for the application's security
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 33.1, 33.3, 33.6_

  - [x] 18.5 Row Level Security & Multi-User Isolation — `supabase/rls.sql`, `js/supabase-storage.js`
    - Review `supabase/rls.sql` and confirm it sets `ENABLE ROW LEVEL SECURITY` on
      all three tables (`transactions`, `categories`, `settings`) and that each
      table has exactly one `FOR ALL` policy scoped to `authenticated` with both
      `USING (user_id = auth.uid())` and `WITH CHECK (user_id = auth.uid())`; if
      any policy is missing or incorrect, add or fix the SQL and document as a
      Security_Finding
    - Verify the `anon` role has no permissive policies on any of the three tables;
      no explicit DENY is needed — the absence of a permissive policy combined with
      RLS enabled is sufficient
    - Audit every INSERT and UPDATE in `js/supabase-storage.js` and confirm each
      payload explicitly includes `user_id: userId`; the four write paths to check
      are `addTransaction`, `addCustomCategory`, `setSettings`, and
      `initializeUserData` — if any are missing `user_id`, add it and document as
      a Security_Finding
    - Add the two-user isolation manual test procedure (design §Task 18.5) to
      `PRODUCTION_CHECKLIST.md` under a "Manual Verification Steps" subsection
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7_

  - [x] 18.6 Storage Provider Security — `js/storage.js`
    - Before implementing UUID v4 validation, inspect the actual Supabase Auth user
      ID format produced by the live project: read `js/auth.js` `_normalizeUser()`
      (returns `supabaseUser.id`) and read the Supabase documentation to confirm
      that `auth.uid()` always returns a standard UUID v4
      (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`); if confirmed, proceed with the
      UUID validation below; if Supabase Auth IDs do NOT satisfy the UUID v4
      pattern (e.g. they use a different format), stop, document the finding in
      PHASE18_REPORT.md, and implement only the null/undefined/whitespace guard
      without the UUID format check — do NOT silently route a legitimate
      authenticated user to LocalStorage
    - If UUID v4 is confirmed: add the UUID v4 pattern constant and update the
      `getProvider()` routing in `js/storage.js`:
      ```js
      const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      function getProvider(userId) {
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
          return new LocalStorageProvider();
        }
        if (!UUID_V4_PATTERN.test(userId)) {
          return new LocalStorageProvider();
        }
        return new SupabaseDatabaseProvider();
      }
      ```
    - Confirm the full routing table: `null` → Local; `undefined` → Local;
      `''` → Local; `'  '` → Local; `'not-a-uuid'` → Local;
      valid UUID v4 → Supabase
    - Confirm no exported `storage.js` function reads `userId` from `localStorage`,
      URL params, or any source other than the argument passed by the caller;
      document the source-integrity invariant in a JSDoc comment on `getProvider()`
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.6_

  - [x] 18.7 Migration Security — `js/migration.js`
    - In all six public migration entry points (`startMigration`, `retryMigration`,
      `migrateCategoriesStep`, `migrateSettingsStep`, `verifyMigration`,
      `clearLocalFinanceData`), change the guard error code from `'INVALID_USER_ID'`
      to `'unauthenticated'`; also update the guard to reject strings that are
      non-empty but composed entirely of whitespace (`userId.trim() === ''`),
      returning `{ ok: false, error: { code: 'unauthenticated', message: 'A signed-in user is required.' } }`
    - Confirm `migrationMarkerKey()` and all call sites in `app.js` pass `userId`
      derived from `state.currentUser.id` (the UUID), never from
      `state.currentUser.email`; if any call site passes email, fix it and document
      as a Security_Finding
    - Confirm `clearLocalFinanceData` calls only
      `localStorage.removeItem(STORAGE_KEY)` and never touches the migration marker
      key; add a code comment documenting the invariant explicitly
    - Scan `migration.js` for any `localStorage.setItem` call — confirm only
      `writeMigrationMarker()` performs localStorage writes and that its key is
      always the migration marker key, never `STORAGE_KEY`; if any violation
      exists, fix it and document as a Security_Finding
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5, 30.6_

  - [x] 18.8 Error Handling & Data Leakage Prevention — all JS modules
    - Audit every `console.error` call in `js/supabase-storage.js` and confirm
      each logs only `error.code` (or `err?.name` for caught exceptions), never
      the full SDK error object or `error.message`; fix any call that logs more
    - Confirm `_normalizeError()` in `js/supabase-storage.js` returns a `message`
      field that is a hard-coded static string, not copied from `raw.message`; if
      any message is currently derived from the SDK error, replace it with a safe
      static literal
    - Add a `window.addEventListener('unhandledrejection', ...)` handler to
      `js/app.js` bootstrap if not already present; the handler must:
      (a) call `event.preventDefault()` to prevent default browser error reporting
      which may expose raw error details in the console;
      (b) log only the static message
      `'app: unhandled promise rejection (suppressed for security)'`;
      (c) never write `event.reason` to any DOM element, never call `alert()`;
      (d) preserve reasonable DevTools debugging capability — the static log message
      is intentional; do not suppress it entirely as that would hide regressions
    - Add a `window.onerror` handler to `js/app.js` bootstrap if not already
      present; the handler must: (a) log only
      `'app: uncaught error (suppressed for security)'`; (b) return `true` to
      suppress the default browser error dialog; (c) never write raw error details
      to DOM or call `alert()`; (d) this is security suppression of raw details,
      not suppression of developer diagnostics — the static console log remains
    - Audit every `console.log` call across all committed `.js` files and remove
      any call that outputs a transaction object, category list, settings object,
      or financial total; the `console.info` call at the end of
      `initializeFinanceApplication()` that logs `{ selectedMonth }` is acceptable
      and must NOT be removed; document each removed call in `PHASE18_REPORT.md`
    - Confirm `window.confirm` message strings for transaction delete and
      clear-local-data do not include transaction amount, category name, user ID,
      or email — both are already clean; confirm via audit
    - _Requirements: 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7, 31.8_

  - [x] 18.9 Logout & State Cleanup — `js/app.js`
    - Rewrite `onLogout()` to use `clearAuthenticatedSessionState()` (implemented
      in task 18.3) so there is only one teardown implementation; the new
      `onLogout()` is:
      ```js
      function onLogout() {
        (async () => {
          // Attempt session end; proceed with teardown regardless of result (Req 32.5).
          await auth.signOut().catch(() => {});
          clearAuthenticatedSessionState();   // single shared teardown helper
          showSignedOutState();               // update header
          showLoginView();                    // show login form
        })();
      }
      ```
    - Confirm `clearAuthenticatedSessionState()` sets `state.currentUser = null`
      as its very first action, so no Supabase operation can slip through with a
      stale identity after logout begins; `showSignedOutState()` also sets
      `state.currentUser = null` — add an inline comment explaining the intentional
      redundancy (belt-and-suspenders, not a bug)
    - Confirm the `onAuthStateChange` signed-out branch (updated in task 18.3) also
      calls `clearAuthenticatedSessionState()` — this ensures SESSION_EXPIRED,
      TOKEN_REFRESHED→null, and explicit SIGNED_OUT all go through the identical
      single teardown sequence with no duplication
    - _Requirements: 32.1, 32.2, 32.3, 32.4, 32.5, 32.6_

  - [x] 18.10 Security Regression Test Matrix — documentation
    - Create `docs/security-regression-tests.md` containing all five test matrices
      from design §Task 18.10, formatted as tables with columns: ID, Test
      description, Expected result, and Status (initially blank for manual tests):
      - Matrix 1 — Authentication (A1–A9)
      - Matrix 2 — User Isolation (B1–B6)
      - Matrix 3 — Migration (C1–C5)
      - Matrix 4 — Credential Safety (D1–D6)
      - Matrix 5 — State Safety (E1–E5)
    - For each test that can be verified from code alone (D1–D3 credential scans),
      record the actual scan result (PASS / FAIL) in the Status column based on
      the audit output from task 18.1
    - Add a "How to run" section to the document explaining which tests require two
      test Supabase accounts, which require browser DevTools, and which can be
      executed via code
    - _Requirements: 34.1, 34.5_

  - [x] 18.11 Production Security Checklist — `PRODUCTION_CHECKLIST.md`
    - Create `PRODUCTION_CHECKLIST.md` in the repository root with all four
      sections from design §Task 18.11: Supabase Configuration, Application
      Security, Repository Hygiene, Deployment
    - Every item must carry exactly one status label: `PASS`, `FAIL`,
      `NEEDS MANUAL VERIFICATION`, or `NOT CONFIGURED`; no item may be left
      without a label
    - Set status for items verifiable from the codebase (e.g. `.gitignore`
      entries, `console.log` audit, `STORAGE_KEY` write scan) to `PASS` or `FAIL`
      based on findings from tasks 18.1–18.9
    - Set Supabase Dashboard items (RLS enabled, email confirmation, JWT expiry,
      redirect URLs) to `NEEDS MANUAL VERIFICATION` with a note explaining what
      to check in the dashboard
    - Set `js/config.js` URL/key items to `NOT CONFIGURED` when the file still
      contains placeholder strings, or `PASS` if real values are present
    - Ensure zero items carry `FAIL` status at the time the file is committed —
      any `FAIL` items must be resolved in the appropriate earlier task first
    - Update `README.md` to add a "Security" or "Production Configuration" section
      stating: the Service_Role_Key must never appear in the codebase; the anon key
      is public and safe to commit; RLS must be enabled before going live; steps to
      rotate the anon key if accidentally exposed
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 34.1, 34.2, 34.3_

  - [x] 18.12 Final QA & Phase 18 Report — `PHASE18_REPORT.md`, `README.md`
    - Open `index.html` in Chrome/Firefox with DevTools Console open; verify zero
      JavaScript errors on load, on sign-in, on sign-out, and on each major
      interaction (add transaction, delete transaction, add category, change
      currency, view reports); document results in `PHASE18_REPORT.md` under
      "Automated Tests Performed"
    - Verify that every Phase 1–17 feature still functions correctly: LocalStorage
      path (unauthenticated), Supabase path (authenticated), transaction CRUD,
      category CRUD, currency selector, monthly reports, charts, migration modal;
      any regression is blocking
    - Confirm no new user-visible features, UI elements, or API behaviors were
      introduced in tasks 18.1–18.11; if any behavioral change does not correct a
      security defect, revert it
    - Finalize `PHASE18_REPORT.md` by completing all sections:
      - Tasks Completed: all 12 tasks with one-sentence status each
      - Files Changed: every modified file with one-sentence description
      - Security Findings: every finding by ID, severity (High/Medium/Low),
        description, and status (Fixed / Accepted with rationale)
      - Fixes Applied: each fix referencing the Security_Finding ID it addresses
      - Automated Tests Performed: browser console verification results
      - Manual Tests Still Required: from the five matrices, list each test not
        yet executable from code alone, with verification step and responsible party
      - Production Configuration Still Required: Supabase dashboard items from
        the checklist marked `NEEDS MANUAL VERIFICATION` or `NOT CONFIGURED`
    - Add Phase 18 notes to `README.md` alongside the existing phase notes
    - _Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 34.6_

- [ ] 18.13. Checkpoint — Manual verification before production configuration
  - Open `index.html` in a modern browser; verify zero console errors on initial
    load, on sign-in, on sign-out, and on core interactions
  - Verify sign-in, sign-out, transaction add/delete, category add/delete,
    currency change, and report/chart rendering all work correctly
  - Confirm `PRODUCTION_CHECKLIST.md` contains zero `FAIL` items
  - Review `PHASE18_REPORT.md` Manual Tests Still Required and Production
    Configuration Still Required sections; confirm the handoff plan is clear
  - This is a checkpoint only — no new code, no deployment, no Phase 19

---

## Notes

- Tasks 18.3 and 18.9 share a single `clearAuthenticatedSessionState()` helper;
  there is only one teardown implementation — duplication has been eliminated
- Task 18.6 UUID v4 validation requires confirming that Supabase Auth IDs satisfy
  the pattern before implementing — do not break authenticated cloud persistence
- Tasks 18.4 pre-commit hook is a developer-local supplementary safeguard only;
  primary credential safety relies on source scanning, `.gitignore`, and manual
  review — the hook is not committed to Git and is not a repository-wide guarantee
- Task 18.8 global error handlers preserve DevTools debugging capability via
  static console messages; they suppress raw error exposure to the DOM/users only
- Task 18.13 is a manual checkpoint only — no new product behavior, no deployment
- Phase 18 is the final implementation phase; no Phase 19 will be created; after
  18.13 the project proceeds to the agreed production sequence: E2E testing → live
  Supabase configuration → RLS verification → two-user isolation test → deployment
  → smoke test → release
- `PHASE18_REPORT.md` is started in task 18.1 and completed in task 18.12
- `PRODUCTION_CHECKLIST.md` is created in task 18.11 with items populated from
  findings in tasks 18.1–18.9

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["18.1"] },
    { "id": 1, "tasks": ["18.2", "18.3", "18.4", "18.7"] },
    { "id": 2, "tasks": ["18.5", "18.6", "18.8", "18.9"] },
    { "id": 3, "tasks": ["18.10", "18.11"] },
    { "id": 4, "tasks": ["18.12"] },
    { "id": 5, "tasks": ["18.13"] }
  ]
}
```
