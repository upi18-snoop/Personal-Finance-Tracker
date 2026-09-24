# Production Security Checklist

**Project:** Personal Finance Tracker  
**Phase:** 18 — Security & Session Hardening  
**Purpose:** Confirm every security control is in place before accepting live traffic.

Each item carries exactly one status label:

| Label | Meaning |
|-------|---------|
| `PASS` | Verified correct by code inspection or static analysis |
| `FAIL` | Verified incorrect — must be resolved before deployment |
| `NEEDS MANUAL VERIFICATION` | Cannot be checked from code; requires live Supabase dashboard or browser testing |
| `NOT CONFIGURED` | Requires developer action before deployment |

> **Zero `FAIL` items are permitted at deployment time.** Any item marked `FAIL` must be
> resolved and re-evaluated before going live.

---

## 1. Supabase Configuration

Items in this section require live Supabase dashboard access and cannot be verified from code alone.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1.1 | RLS enabled on `transactions` table | `NEEDS MANUAL VERIFICATION` | In Supabase Dashboard → SQL Editor, run: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transactions';` — expect `rowsecurity = true`. The `supabase/rls.sql` file contains the correct `ALTER TABLE transactions ENABLE ROW LEVEL SECURITY` statement; apply it if not yet run. |
| 1.2 | RLS enabled on `categories` table | `NEEDS MANUAL VERIFICATION` | Same verification query as 1.1 for `tablename = 'categories'`. The `ALTER TABLE categories ENABLE ROW LEVEL SECURITY` statement is present in `supabase/rls.sql`. |
| 1.3 | RLS enabled on `settings` table | `NEEDS MANUAL VERIFICATION` | Same verification query as 1.1 for `tablename = 'settings'`. The `ALTER TABLE settings ENABLE ROW LEVEL SECURITY` statement is present in `supabase/rls.sql`. |
| 1.4 | `transactions_owner_policy` correct | `NEEDS MANUAL VERIFICATION` | Verify with: `SELECT policyname, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'transactions';` — expect `roles = {authenticated}`, `cmd = ALL`, `qual = (user_id = auth.uid())`, `with_check = (user_id = auth.uid())`. Policy definition is correct in `supabase/rls.sql`. |
| 1.5 | `categories_owner_policy` correct | `NEEDS MANUAL VERIFICATION` | Same verification query for `tablename = 'categories'`. Policy definition is correct in `supabase/rls.sql`. |
| 1.6 | `settings_owner_policy` correct | `NEEDS MANUAL VERIFICATION` | Same verification query for `tablename = 'settings'`. Policy definition is correct in `supabase/rls.sql`. |
| 1.7 | `anon` role has no permissive policies on any table | `NEEDS MANUAL VERIFICATION` | Verify with: `SELECT * FROM pg_policies WHERE tablename IN ('transactions','categories','settings') AND roles @> ARRAY['anon']::name[];` — expect zero rows. No anon grants exist in `supabase/rls.sql`. |
| 1.8 | `js/config.js` — non-placeholder project URL configured | `NOT CONFIGURED` | File contains `'YOUR_SUPABASE_PROJECT_URL'`. Replace with your Supabase Project URL from Dashboard → Project Settings → API → Project URL. |
| 1.9 | `js/config.js` — non-placeholder anon key configured | `NOT CONFIGURED` | File contains `'YOUR_SUPABASE_ANON_KEY'`. Replace with the `anon / public` key from Dashboard → Project Settings → API → Project API Keys. The anon key is safe to commit — it identifies the project but carries no privileges beyond what RLS allows. |
| 1.10 | Supabase email confirmation enabled | `NEEDS MANUAL VERIFICATION` | In Supabase Dashboard → Authentication → Providers → Email, confirm "Enable email confirmations" is turned on. Required to prevent users from accessing the app with unverified email addresses. |
| 1.11 | Supabase Auth JWT expiry configured (1–43200 minutes) | `NEEDS MANUAL VERIFICATION` | In Supabase Dashboard → Authentication → JWT settings, confirm "JWT expiry" is set to a value between 1 and 43,200 minutes (up to 30 days). Default is 3,600 minutes (1 hour); adjust to your desired session duration. |
| 1.12 | Supabase Auth redirect URLs include production domain | `NEEDS MANUAL VERIFICATION` | In Supabase Dashboard → Authentication → URL Configuration, confirm "Site URL" is set to your production domain (e.g. `https://<username>.github.io/<repo-name>`) and the same URL appears in "Redirect URLs". Required for password-reset email links to work correctly. |
| 1.13 | `supabase/schema.sql` applied to production project | `NEEDS MANUAL VERIFICATION` | In Supabase Dashboard → SQL Editor, confirm the `transactions`, `categories`, and `settings` tables exist with the correct columns. Run `supabase/schema.sql` if not yet applied. |
| 1.14 | `supabase/rls.sql` applied to production project | `NEEDS MANUAL VERIFICATION` | In Supabase Dashboard → SQL Editor, confirm RLS policies exist (see items 1.4–1.6). Run `supabase/rls.sql` if not yet applied. |

---

## 2. Application Security

Items in this section are verified by static code analysis of the committed source files.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2.1 | No `service_role` key in any committed file | `PASS` | Credential scan (Task 18.1) found zero occurrences of `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `supabase_admin`, `service_role_key`, `postgres://`, `postgresql://`, or any JWT string longer than 200 characters in all `.js`, `.html`, `.md`, `.sql`, and `.json` files. |
| 2.2 | No manual JWT creation or token parsing in any JS module | `PASS` | Audit (Task 18.1) confirmed Supabase Auth (`supabase.auth.*`) is the sole authentication mechanism. No `atob`, `btoa`, `JSON.parse(atob(...))`, or manual JWT construction found in any module. |
| 2.3 | `createClient()` used only in `js/supabase.js` (singleton) | `PASS` | Scan found `createClient(` in exactly one file — `js/supabase.js`. No rogue Supabase client instantiation in any other module. Singleton constraint holds (Req 27.2). |
| 2.4 | All data queries scoped by `user_id = auth.uid()` in RLS policies | `PASS` (code) / `NEEDS MANUAL VERIFICATION` (live) | SQL in `supabase/rls.sql` contains correct `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` for all three tables. Live enforcement requires items 1.1–1.6 to be verified on the dashboard. |
| 2.5 | Every INSERT/UPDATE in `supabase-storage.js` includes explicit `user_id` field | `PASS` | Defence-in-depth audit (Task 18.5) confirmed: `addTransaction`, `addCustomCategory`, `setSettings`, and `initializeUserData` all include `user_id: userId` in their payload independently of RLS. |
| 2.6 | Finance_UI (`#app-main`) hidden until authenticated | `PASS` | `bootstrap()` in `js/app.js` hides `#app-main` immediately on load. `showProtectedApp()` is called only inside `initAuthSession()` when `state.currentUser` is set by `onAuthStateChange`. The finance dashboard is never rendered for unauthenticated users. |
| 2.7 | Logout clears `state.currentUser`, Finance_UI, and `financeAppInitialized` | `PASS` | `onLogout()` (Task 18.9) calls `clearAuthenticatedSessionState()` which: sets `state.currentUser = null` first, hides `#app-main`, resets `financeAppInitialized = false`, calls `hideMigrationModal()`, and calls `clearFinanceUIDOM()`. Covers Req 32.1–32.6. |
| 2.8 | Session expiry triggers identical teardown as explicit logout | `PASS` | `onAuthStateChange` signed-out `else` branch (Task 18.3) calls `clearAuthenticatedSessionState()` → `showSignedOutState()` → `showLoginView()` — the identical sequence used by `onLogout()`. SESSION_EXPIRED, TOKEN_REFRESHED→null, and remote SIGNED_OUT all route through the same single helper. |
| 2.9 | Migration scoped to authenticated user's UUID only | `PASS` | All six public migration entry points guard against null/undefined/empty/whitespace `userId` and return `{ ok: false, error: { code: 'unauthenticated' } }` (Task 18.7). Migration marker key uses UUID only (`financeTrackerMigration_${userId}`), never email. |
| 2.10 | Auth error responses return only `{ code, message }` — no raw SDK content | `PASS` | `_normalizeError()` in `js/auth.js` (Task 18.2) uses `SAFE_MESSAGES` map. Raw SDK `message` is used only internally for pattern matching; the returned `message` is always a static hard-coded string. `code` ≤ 50 chars, `message` ≤ 200 chars. |
| 2.11 | `signUp()` validates email format and password ≥ 8 chars before any network call | `PASS` | Pre-validation added in Task 18.2: email tested against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, password tested `< 8`. Both failures return `{ ok: false, error: { code: 'validation-error' } }` without calling `getSupabaseClient()`. UI `validateRegisterForm()` updated to match (password ≥ 8). |
| 2.12 | Storage provider routing enforces UUID v4 validation | `PASS` | `getProvider()` in `js/storage.js` (Task 18.6) uses `UUID_V4_PATTERN` and `_isSupabaseUser()` helper. null/undefined/empty/whitespace/non-UUID → `LocalStorageProvider`. Valid UUID v4 → `SupabaseDatabaseProvider`. All 10 exported functions use `_isSupabaseUser()` consistently. |
| 2.13 | Global error handlers suppress raw error exposure to DOM/users | `PASS` | `window.addEventListener('unhandledrejection', ...)` and `window.onerror` added in Task 18.8. Both log only a static message, never write raw error details to DOM, never call `alert()`. Default browser error reporting suppressed for security. |
| 2.14 | No `console.log` of financial objects (transactions, categories, settings, totals) | `PASS` | Scan (Task 18.8) found zero `console.log(` calls in any committed `.js` file. The sole `console.info` in `initializeFinanceApplication()` logs only `{ selectedMonth }` — safe, confirmed not to be removed. |
| 2.15 | `console.error`/`console.warn` calls log only error code or name, not full objects | `PASS` | All seven catch-block console calls in `js/app.js` were updated (Task 18.8) to log `err?.name ?? 'unknown'`. `js/supabase-storage.js` logs only `error.code ?? ''`. `js/auth.js` has no console calls. `js/supabase.js` catch clause logs a static message only (no `err` argument). |
| 2.16 | `window.confirm` messages contain no transaction data, user ID, or email | `PASS` | Both confirm calls in `js/app.js` use static messages only: `"Delete this transaction? This cannot be undone."` and `"This will permanently delete your local finance data from this browser. Your data is safely stored in the cloud. Continue?"`. |
| 2.17 | `getSupabaseClient()` rejects empty/whitespace/placeholder config values | `PASS` | Guard in `js/supabase.js` (Task 18.4) checks for falsy, empty string, whitespace-only, and placeholder strings for both `url` and `anonKey`. Returns `null` without CDN import in all invalid-config cases. |
| 2.18 | LocalStorage path remains functional when `js/config.js` has placeholder values | `PASS` | `getSupabaseClient()` returns `null` for placeholder config; `getProvider(null)` routes to `LocalStorageProvider`; all finance operations complete successfully without Supabase. No uncaught exceptions. |
| 2.19 | Two-user isolation: User B sees zero records from User A after sign-in | `NEEDS MANUAL VERIFICATION` | Requires two test Supabase accounts. Procedure: sign in as User A, add transactions, sign out, sign in as User B in same tab, verify no User A data visible. See §5 Manual Verification Steps. |

---

## 3. Repository Hygiene

Items in this section are verified by inspecting committed source files.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 3.1 | `.gitignore` includes `.env` | `PASS` | Confirmed present in `.gitignore` (added in Task 18.4, Fix 18.4-C). Prevents accidental commit of environment files. |
| 3.2 | `.gitignore` includes `.env.local` | `PASS` | Confirmed present in `.gitignore`. |
| 3.3 | `.gitignore` includes `.env.production` | `PASS` | Confirmed present in `.gitignore`. |
| 3.4 | `.gitignore` includes `*.key` | `PASS` | Confirmed present in `.gitignore`. Prevents accidental commit of private key files. |
| 3.5 | `.gitignore` includes `*.pem` | `PASS` | Confirmed present in `.gitignore`. Prevents accidental commit of certificate/key files. |
| 3.6 | Pre-commit hook rejects `service_role` key commits | `PASS` | `.git/hooks/pre-commit` created in Task 18.4 (developer-local supplementary safeguard). Scans staged files for `service_role` and long `eyJ...` JWT patterns. **Note:** This hook is NOT committed to the repository and is NOT a repository-wide guarantee. It is a local developer safeguard supplementing primary controls (source scan, `.gitignore`, manual review). Each developer must have this hook installed locally. |
| 3.7 | No credentials in source files, documentation, or tests | `PASS` | Credential scan (Task 18.1) found zero occurrences of any privileged credential pattern in all committed files. `js/config.js` contains placeholder strings only — no real keys. |
| 3.8 | No `console.log` of financial data in any committed `.js` file | `PASS` | Scan (Task 18.8) found zero `console.log(` calls in any committed `.js` file. |
| 3.9 | README Security section documents anon-key safety and RLS requirement | `PASS` | Added in Task 18.11 (this task). The Security section covers: Service_Role_Key must never appear in the codebase; anon key is public and safe to commit; RLS must be enabled before going live; steps to rotate the anon key if accidentally exposed. |
| 3.10 | All Security_Findings from the audit are resolved or have accepted-risk rationale | `PASS` | 13 findings identified (F-01 through F-13). All 13 are either fixed (F-01 through F-13) or confirmed compliant (F-02). No finding has been accepted with an unaddressed risk. See PHASE18_REPORT.md Security Findings and Fixes Applied sections. |
| 3.11 | All Security_Findings rated High severity are resolved | `PASS` | F-03 (High — `onLogout()` missing teardown, cross-user leakage risk) and F-04 (High — `onAuthStateChange` signed-out branch incomplete) were both resolved in Tasks 18.3 and 18.9. No High-severity finding remains open. |

---

## 4. Deployment

| # | Item | Status | Notes |
|---|------|--------|-------|
| 4.1 | HTTPS-only deployment confirmed | `NEEDS MANUAL VERIFICATION` | GitHub Pages enforces HTTPS by default for all `github.io` domains. Verify after deployment: open the published URL and confirm the browser shows a valid HTTPS padlock. If using a custom domain, confirm HTTPS is enforced in Repository Settings → Pages → "Enforce HTTPS". |
| 4.2 | Phase 18 security notes added to `README.md` | `PASS` | Security section added in Task 18.11 (this task). Covers credential safety, anon-key policy, RLS requirement, and key rotation procedure. |
| 4.3 | All Security_Findings from audit fixed or accepted with rationale | `PASS` | See item 3.10. All 13 findings resolved. `PHASE18_REPORT.md` documents each finding ID, severity, description, and fix status. |
| 4.4 | `PHASE18_REPORT.md` complete in repository root | `NEEDS MANUAL VERIFICATION` | `PHASE18_REPORT.md` tasks 18.10–18.12 sections are currently stubs (pending). Task 18.12 will finalize the report with: automated test results from browser QA, complete manual test matrix results, and final production configuration verification. |
| 4.5 | All Phase 1–17 features verified — no regressions | `NEEDS MANUAL VERIFICATION` | Manual verification required. Open `index.html` in Chrome/Firefox with DevTools Console. Test: LocalStorage path (unauthenticated), Supabase path (authenticated), transaction CRUD, category CRUD, currency selector, monthly reports, charts, migration modal. Zero console errors expected. |
| 4.6 | No new user-visible features introduced in Phase 18 | `PASS` | Phase 18 is hardening-only. All code changes in tasks 18.1–18.11 are either corrective (fixing a Security_Finding) or documentary (producing audit records). No new HTML sections, CSS components, API endpoints, or product behaviors were added. |

---

## 5. Manual Verification Steps

The following tests require a live Supabase project and two test accounts. They cannot be
performed from static code analysis alone.

### 5.1 — Two-User Data Isolation (Req 28.5, 28.6)

```
Precondition: live Supabase project with RLS applied; two test accounts (UserA, UserB).

1. Sign in as UserA.
2. Add ≥1 transaction, ≥1 custom category via the app UI.
3. Sign out.
4. Sign in as UserB (same browser tab).
5. Verify: transaction list is empty (no UserA transactions visible).
6. Verify: category list shows only defaults (no UserA custom categories).
7. Verify: balance shows 0 / 0 / 0.
8. Verify: charts show empty state.

Expected: All Finance_UI sections show UserB's data only (empty at this point).
```

### 5.2 — RLS Blocks Cross-User INSERT (Req 28.6)

```
Precondition: signed in as UserB; have UserA's UUID available.

1. In browser DevTools Console, construct an INSERT with user_id = UserA's UUID:
   const { error } = await window._supabaseClient.from('transactions').insert({
     id: crypto.randomUUID(),
     user_id: '<UserA_UUID>',
     item_name: 'Spoofed',
     amount: 1,
     type: 'expense',
     category: 'Other',
     date: '2024-01-01',
     created_at: new Date().toISOString()
   });
   console.log(error);

Expected: error is non-null; message references "row-level security policy".
```

### 5.3 — RLS Blocks `anon` Role Access

```
Precondition: signed out (no active session).

1. Attempt a SELECT as the anon role via the Supabase Dashboard → API Docs → transactions
   (using the anon key, no Authorization header):
   GET /rest/v1/transactions

Expected: returns 0 rows (not an error — RLS default-deny returns empty result, not 403).
INSERT/UPDATE/DELETE expected to return a policy violation error.
```

### 5.4 — Session Expiry Teardown (Req 26.4, 32.3)

```
Precondition: signed in; UserA has transactions visible in the UI.

1. In Supabase Dashboard → Authentication → Users, select UserA and click "Invalidate all sessions".
2. Wait ≤60 seconds for the auth state change to propagate.
3. Verify: Finance_UI (#app-main) is hidden.
4. Verify: Login form is visible.
5. Verify: DOM transaction list and balance cards are empty.

Expected: identical teardown to explicit logout.
```

### 5.5 — RLS Status Verification Queries

Run these SQL queries in Supabase Dashboard → SQL Editor to confirm RLS configuration:

```sql
-- Confirm RLS is enabled on all three tables:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'categories', 'settings');
-- Expected: three rows, all with rowsecurity = true

-- Confirm one correct policy per table:
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'categories', 'settings');
-- Expected: three rows (one per table)
--   roles = {authenticated}
--   cmd   = ALL
--   qual  = (user_id = auth.uid())
--   with_check = (user_id = auth.uid())

-- Confirm no anon policies:
SELECT COUNT(*) FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'categories', 'settings')
  AND roles @> ARRAY['anon']::name[];
-- Expected: 0
```

---

## Summary

| Section | PASS | FAIL | NEEDS MANUAL VERIFICATION | NOT CONFIGURED |
|---------|------|------|--------------------------|----------------|
| 1. Supabase Configuration | 0 | 0 | 12 | 2 |
| 2. Application Security | 17 | 0 | 2 | 0 |
| 3. Repository Hygiene | 11 | 0 | 0 | 0 |
| 4. Deployment | 3 | 0 | 2 | 0 |
| **Total** | **31** | **0** | **16** | **2** |

**Zero `FAIL` items.** The 16 `NEEDS MANUAL VERIFICATION` items require a live Supabase project
and/or browser testing before final production deployment. The 2 `NOT CONFIGURED` items require
replacing placeholder values in `js/config.js` with real Supabase credentials before cloud
features will function.

The items that can be verified from code alone are all marked `PASS`. No blocking issue remains
in the codebase. Deployment readiness is gated only on live Supabase configuration and manual
browser verification.
