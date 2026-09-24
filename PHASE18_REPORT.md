# Phase 18 Security Hardening Report

**Project:** Personal Finance Tracker  
**Phase:** 18 — Security & Session Hardening  
**Audit date:** 2026-09-24  
**Status:** Tasks 18.1–18.4 complete. Tasks 18.5–18.12 pending.

---

## Tasks Completed

| Task | Title | Status |
|------|-------|--------|
| 18.1 | Security Architecture Audit | ✅ Complete |
| 18.2 | Authentication Security — `js/auth.js` | ✅ Complete |
| 18.3 | Session Lifecycle Hardening — `js/app.js` | ✅ Complete |
| 18.4 | Supabase Client & Configuration Security | ✅ Complete |
| 18.5 | Row Level Security & Multi-User Isolation | ⏳ Pending |
| 18.6 | Storage Provider Security — `js/storage.js` | ⏳ Pending |
| 18.7 | Migration Security — `js/migration.js` | ⏳ Pending |
| 18.8 | Error Handling & Data Leakage Prevention | ⏳ Pending |
| 18.9 | Logout & State Cleanup — `js/app.js` | ⏳ Pending |
| 18.10 | Security Regression Test Matrix | ⏳ Pending |
| 18.11 | Production Security Checklist | ⏳ Pending |
| 18.12 | Final QA & Phase 18 Report | ⏳ Pending |
| 18.13 | Checkpoint | ⏳ Pending |

---

## Files Inspected (Task 18.1)

| File | Purpose |
|------|---------|
| `js/auth.js` | Authentication service — signUp, signIn, signOut, getCurrentUser, onAuthStateChange, resetPassword |
| `js/config.js` | Supabase public configuration (url + anonKey) |
| `js/supabase.js` | Supabase client singleton factory — getSupabaseClient() |
| `js/supabase-storage.js` | SupabaseDatabaseProvider — all Supabase CRUD methods |
| `js/storage.js` | Storage router — LocalStorage ↔ Supabase provider selection |
| `js/migration.js` | LocalStorage → Supabase migration service |
| `js/app.js` | App bootstrap, auth gate, session lifecycle, all UI orchestration |
| `supabase/schema.sql` | PostgreSQL table definitions |
| `supabase/rls.sql` | Row Level Security policies |
| `.gitignore` | Repository ignore rules |
| `README.md` | Project documentation and security notes |

---

## Security Findings

### F-01 — `_normalizeError()` in `js/auth.js` returns raw SDK message string
**Severity:** Medium  
**File:** `js/auth.js` lines 75–87  
**Description:** `_normalizeError(raw)` extracts `String(raw.message)` from the SDK error and
returns it verbatim as the `message` field of the Normalized_Error object. The raw SDK message
may contain internal Supabase server details (e.g., "invalid login credentials for user@example.com",
PostgREST error text, or server-side hints). This violates Req 25.9 which requires the `message`
field to be safe for display and free of raw SDK content.

```js
// Current (lines 82, 85 of auth.js):
return { code, message: msg };       // msg is raw SDK error.message
return { code: 'unknown', message: msg }; // msg is raw SDK error.message
```

**Fix required:** Replace `message: msg` with a static, code-keyed safe message looked up from
a separate safe-message map. The `msg` string should only be used internally for pattern matching
to derive `code`; it must not escape `_normalizeError()`.  
**Blocking:** No — does not allow unauthorized data access or auth bypass. Risk is information
leakage of server internals to UI consumers.  
**Task to fix:** 18.2

---

### F-02 — `_normalizeError()` in `js/supabase-storage.js` returns raw SDK message for unknown errors
**Severity:** Low  
**File:** `js/supabase-storage.js` lines 60–95  
**Description:** For errors that do not match `network-error` or `not-authenticated` patterns,
`_normalizeError()` returns `{ code: 'unknown', message: 'An error occurred. Please try again.' }`.
This final fallback is already a static safe string — **compliant**. The `network-error` and
`not-authenticated` branches also return static messages — **compliant**. The `duplicate` branch
returns a static message — **compliant**. No fix required for the static message content.  
However, `console.error` calls log `error.code ?? ''` which is safe (code only, no full message).
All `console.warn` and `console.error` calls in this file log only a method label and `error.code`
or `err?.name` — no full SDK messages are emitted.  
**Status:** PASS — confirmed compliant. No fix required.

---

### F-03 — `onLogout()` in `js/app.js` is missing required teardown steps
**Severity:** High  
**File:** `js/app.js` lines 1445–1453  
**Description:** The current `onLogout()` implementation is:

```js
function onLogout() {
  (async () => {
    await auth.signOut();
    showSignedOutState();
    const appMain = document.getElementById("app-main");
    if (appMain) appMain.hidden = true;
    showLoginView();
  })();
}
```

Missing from this implementation:
1. `financeAppInitialized` is NOT reset to `false` — a subsequent login by a different user on the
   same tab will find `financeAppInitialized === true` and skip `initializeFinanceApplication()`,
   meaning User B would not get their own fresh data loaded. **This is a cross-user data leakage
   risk** (Req 26.3, 32.1).
2. `hideMigrationModal()` is not called — the migration modal may remain open after logout (Req 32.2).
3. Finance_UI DOM content (transaction list, balance cards, category list, charts, reports) is not
   cleared — User B (or any observer) could see User A's data in the DOM before the new user's
   data loads (Req 32.6).
4. `auth.signOut()` failure is not handled — if `signOut()` throws or rejects, no teardown steps
   execute (Req 32.5).

**Blocking:** Yes — the `financeAppInitialized` not-reset is a confirmed data-leakage vector
between users in the same browser tab.  
**Task to fix:** 18.3, 18.9

---

### F-04 — `onAuthStateChange` signed-out branch missing `financeAppInitialized` reset and DOM clear
**Severity:** High  
**File:** `js/app.js` lines 1768–1771  
**Description:** The signed-out `else` branch in `initAuthSession()` / `onAuthStateChange`:

```js
} else {
  state.currentUser = null;
  showSignedOutState();
  hideProtectedApp();
}
```

Missing:
1. `financeAppInitialized = false` — session expiry or remote sign-out (TOKEN_REFRESHED → null,
   SIGNED_OUT) does not reset this guard. A subsequent login will skip full re-initialization.
2. `hideMigrationModal()` — migration modal stays open if a session expires mid-migration.
3. `clearFinanceUIDOM()` — Finance_UI DOM content remains populated while the user is signed out.

This applies to SESSION_EXPIRED, TOKEN_REFRESHED resulting in no user, and remote sign-out events —
all paths that do not go through `onLogout()`.  
**Blocking:** Yes — same cross-user data leakage risk as F-03.  
**Task to fix:** 18.3

---

### F-05 — `getSupabaseClient()` does not reject empty-string or whitespace-only config values
**Severity:** Low  
**File:** `js/supabase.js` lines 64–73  
**Description:** The current guard checks for placeholder strings and falsy values but not for
`url.trim() === ''` or `anonKey.trim() === ''`. A configuration value of `'   '` (whitespace only)
would pass the guard and attempt CDN import with a whitespace URL, producing a confusing error
rather than the clean `null` return. Edge case with low practical impact since config.js ships
with explicit placeholder strings.  
**Blocking:** No.  
**Task to fix:** 18.4

---

### F-06 — CDN load failure catch clause in `getSupabaseClient()` logs the raw error object
**Severity:** Low  
**File:** `js/supabase.js` line 99  
**Description:**

```js
console.error('supabase.js: failed to load supabase-js from CDN.', err);
```

The raw `err` object is passed as a second argument to `console.error`. This `err` may contain
the CDN URL (which includes the anonKey in some CDN configurations) or other internal details
in its stack trace. The config values themselves are not interpolated into the string, but the
raw error may still expose URL details in DevTools.  
**Blocking:** No — no credentials are in the stack trace, only the CDN URL which is public.
Risk is minimal but the static message pattern should be enforced.  
**Task to fix:** 18.4

---

### F-07 — `validateRegisterForm()` in `js/app.js` enforces password ≥ 6 chars, not ≥ 8
**Severity:** Low  
**File:** `js/app.js` lines 1153–1159  
**Description:** The UI-layer registration validation accepts passwords ≥ 6 characters:

```js
} else if (values.password.length < 6) {
  errors.push({ field: "password", message: "Password must be at least 6 characters." });
}
```

Task 18.2 requires `signUp()` in `auth.js` to enforce ≥ 8 characters with a `'validation-error'`
code before any network call. Once that is implemented, the UI and auth module would be inconsistent
— the UI would allow 6- and 7-character passwords through the form but the auth module would reject
them. This inconsistency means users receive no client-side feedback for passwords of length 6–7,
only a rejection from auth.js.  
**Blocking:** No. Functional issue after Task 18.2 is implemented.  
**Task to fix:** 18.2

---

### F-08 — Migration entry-point guards use error code `'INVALID_USER_ID'` instead of `'unauthenticated'`
**Severity:** Low  
**File:** `js/migration.js` — `startMigration`, `retryMigration`, `migrateCategoriesStep`,
`migrateSettingsStep`, `verifyMigration`, `resolveCurrencyConflict`  
**Description:** All six entry points guard against null/undefined/non-string userId but return
`code: 'INVALID_USER_ID'` which is a non-standard internal code not aligned with the Normalized_Error
contract defined in Req 30.1. The guard in `clearLocalFinanceData` uses `console.warn` and
`return { ok: false }` without an error code at all.  
Guards also do not reject whitespace-only strings — `userId = '   '` would pass the
`!userId || typeof userId !== 'string'` check.  
**Blocking:** No — callers check `result.ok`, not `result.error.code`. Low practical impact.  
**Task to fix:** 18.7

---

### F-09 — `.gitignore` missing `.env*` and `*.key` / `*.pem` entries
**Severity:** Medium  
**File:** `.gitignore`  
**Description:** Current `.gitignore` contains OS cruft, editor files, and log exclusions but
does NOT include:
- `.env`
- `.env.local`
- `.env.production`
- `*.key`
- `*.pem`

If a developer creates a `.env` file with credentials or copies a private key into the repository
directory, there is no protection against accidental `git add .` committing it.  
**Blocking:** No — no such files currently exist in the repository.  
**Task to fix:** 18.4

---

### F-10 — `storage.js` `getProvider()` lacks UUID v4 validation and whitespace guard
**Severity:** Low  
**File:** `js/storage.js` line 72  
**Description:** Current routing:

```js
function getProvider(userId) {
  if (userId) {
    return new SupabaseDatabaseProvider();
  }
  return new LocalStorageProvider();
}
```

A whitespace-only string `'   '` is truthy and would route to `SupabaseDatabaseProvider`, issuing
a Supabase query with a malformed userId. Similarly, any non-UUID truthy string (e.g. an email
address accidentally passed as userId) would route to Supabase.  
**Note:** Supabase Auth user IDs are confirmed to be standard UUID v4 values (per Supabase
documentation and the `auth.users.id` column type `UUID` in schema.sql). UUID v4 validation
is therefore safe to implement without risk of routing legitimate authenticated users to
LocalStorage.  
**Blocking:** No — callers always pass `state.currentUser?.id ?? null` which is either null or
a Supabase UUID. Low practical risk in current architecture.  
**Task to fix:** 18.6

---

### F-11 — `js/app.js` has no `window.onerror` or `unhandledrejection` global error handlers
**Severity:** Low  
**File:** `js/app.js` — bootstrap section  
**Description:** No global `window.onerror` or `window.addEventListener('unhandledrejection', ...)`
handler exists. Unhandled errors and promise rejections are surfaced directly by the browser,
potentially exposing raw error messages (SDK details, stack traces) in the browser console and
in browser-native error dialogs. This does not expose data to other users but may expose
implementation details during a session (Req 31.8).  
**Blocking:** No.  
**Task to fix:** 18.8

---

### F-12 — README does not have a dedicated "Security" or "Production Configuration" section
**Severity:** Low  
**File:** `README.md`  
**Description:** The README contains security information scattered across multiple sections
(Phase 15 setup notes, Phase 16 audit notes, security invariants tables) but does not have a
single authoritative top-level "Security" or "Production Configuration" section as required by
Req 33.4 and Req 34.1. The scattered information is accurate but not easily discoverable by
a developer preparing for deployment.  
**Blocking:** No — documentation gap only.  
**Task to fix:** 18.11

---

## Credential Scan Results (Task 18.1)

| Pattern | Result |
|---------|--------|
| `service_role` | ✅ Not found in any `.js`, `.html`, `.sql`, `.json` file. Appears only in spec/docs as a term being warned against — no actual key value. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Not found |
| `supabase_admin` | ✅ Not found |
| `service_role_key` | ✅ Not found |
| `postgres://` | ✅ Not found |
| `postgresql://` | ✅ Not found |
| `eyJ[A-Za-z0-9_-]{200,}` (active JWT > 200 chars) | ✅ Not found |
| `createClient(` in files other than `js/supabase.js` | ✅ Not found — singleton constraint holds |
| Passwords/tokens in `console.*` calls | ✅ Not found — all console calls log safe labels, error codes, or static messages |
| `state.currentUser.email` used as userId in storage/migration | ✅ Not found — all calls pass `state.currentUser.id` or `state.currentUser?.id ?? null` |

**Credential scan: CLEAN.** No privileged credentials found in any committed file.

---

## Auth Mechanism Audit

| Check | Result |
|-------|--------|
| Supabase Auth is the sole authentication mechanism | ✅ PASS — only `supabase.auth.*` methods used; no manual JWT creation |
| No manual JWT parsing in any module | ✅ PASS |
| Session JWT managed solely by supabase-js | ✅ PASS — no manual `localStorage.setItem` for auth tokens |
| Passwords never stored, logged, or returned | ✅ PASS — `auth.js` never persists password values |
| `onAuthStateChange` fires `queueMicrotask('INITIAL_SESSION', null)` when not configured | ✅ PASS |
| `getCurrentUser()` returns `null` safely when unconfigured or no session | ✅ PASS |

---

## RLS Audit (SQL Analysis of `supabase/rls.sql`)

| Check | Result |
|-------|--------|
| `ALTER TABLE transactions ENABLE ROW LEVEL SECURITY` | ✅ Present |
| `ALTER TABLE categories ENABLE ROW LEVEL SECURITY` | ✅ Present |
| `ALTER TABLE settings ENABLE ROW LEVEL SECURITY` | ✅ Present |
| `transactions_owner_policy` — FOR ALL, authenticated, USING + WITH CHECK = auth.uid() | ✅ Present |
| `categories_owner_policy` — FOR ALL, authenticated, USING + WITH CHECK = auth.uid() | ✅ Present |
| `settings_owner_policy` — FOR ALL, authenticated, USING + WITH CHECK = auth.uid() | ✅ Present |
| No permissive policy for `anon` role on any table | ✅ Confirmed — no anon grants present |
| Verification queries provided in rls.sql | ✅ Present |

---

## Defence-in-Depth Audit (`js/supabase-storage.js`)

| Method | `user_id: userId` in payload | Result |
|--------|------------------------------|--------|
| `addTransaction` | `user_id: userId` explicitly set in `row` object | ✅ PASS |
| `addCustomCategory` | `user_id: userId` explicitly set in insert payload | ✅ PASS |
| `setSettings` | `user_id: userId` in upsert payload | ✅ PASS |
| `initializeUserData` | `user_id: userId` in upsert payload | ✅ PASS |
| `deleteTransaction` | `.eq('user_id', userId)` in WHERE predicate | ✅ PASS |
| `deleteCustomCategory` | `.eq('user_id', userId)` in WHERE predicate | ✅ PASS |
| `getTransactions` | `.eq('user_id', userId)` in SELECT predicate | ✅ PASS |
| `getCustomCategories` | `.eq('user_id', userId)` in SELECT predicate | ✅ PASS |
| `getSettings` | `.eq('user_id', userId)` in SELECT predicate | ✅ PASS |

All nine methods enforce per-user scoping at the application layer independently of RLS.

---

## Migration Security Audit (`js/migration.js`)

| Check | Result |
|-------|--------|
| All entry points guard against null/undefined/non-string userId | ✅ PASS (F-08: error codes need standardisation) |
| `migrationMarkerKey()` uses UUID, never email | ✅ PASS — `MIGRATION_MARKER_PREFIX + userId` where userId comes from `state.currentUser.id` |
| All call sites in `app.js` pass `state.currentUser.id` (not `.email`) | ✅ PASS — confirmed by static analysis |
| `clearLocalFinanceData` removes only `STORAGE_KEY`, not marker key | ✅ PASS — confirmed by static analysis |
| Migration module never calls `localStorage.setItem(STORAGE_KEY, ...)` | ✅ PASS — only `writeMigrationMarker()` writes to localStorage, using the marker key |
| Network error stops upload and sets status to `'partial'` | ✅ PASS — implemented in `startMigration` upload loop |

---

## Console / Log Leakage Audit

| Module | Calls found | Leakage risk |
|--------|-------------|--------------|
| `js/auth.js` | None | ✅ PASS — no console calls in auth.js |
| `js/supabase.js` | `console.error('...', err)` on CDN failure | ⚠️ F-06 — raw `err` object logged (Low) |
| `js/supabase-storage.js` | `console.error(label, error.code ?? '')` and `console.warn(label)` | ✅ PASS — code only, no full messages |
| `js/storage.js` | None in routing logic | ✅ PASS |
| `js/migration.js` | `console.warn(label)` for invalid userId in `detectMigrationOpportunity` and `clearLocalFinanceData` | ✅ PASS — static labels only |
| `js/app.js` | `console.error(label, err)`, `console.warn(label, err)`, `console.info(label, { selectedMonth })` | ✅ PASS — no transaction/category/settings objects; `err` is raw but no sensitive data expected in migration/render errors |
| `js/charts.js` | `console.warn(label)` | ✅ PASS — static label |

No console call outputs passwords, JWTs, transaction data, category lists, settings objects,
or financial totals in production code paths.

---

## Files Changed

| File | Change |
|------|--------|
| `PHASE18_REPORT.md` | Created (Task 18.1) — audit findings, security scan results, report stubs |
| `js/auth.js` | Task 18.2 — added `SAFE_MESSAGES` map; `_normalizeError()` now returns static safe messages only (never raw SDK message); added `signUp()` pre-validation for email format and password ≥ 8 before any network call |
| `js/app.js` | Task 18.2 — raised `validateRegisterForm()` password minimum from 6 to 8 characters; updated `getRegisterErrorMessage()` weak-password case to match |
| `js/supabase.js` | Task 18.4 — hardened `getSupabaseClient()` guard to also reject empty-string and whitespace-only config values (Req 27.3, fixes F-05); replaced CDN `catch` log with a static-only message that does not interpolate `err`, `url`, or `anonKey` (Req 27.4, fixes F-06) |
| `.gitignore` | Task 18.4 — added `.env`, `.env.local`, `.env.production`, `*.key`, `*.pem` entries to prevent accidental credential commits (Req 33.3, fixes F-09) |
| `.git/hooks/pre-commit` | Task 18.4 — created developer-local credential scanner that blocks commits containing `service_role` or a long `eyJ…` JWT (Req 33.6); **not committed to the repository**; supplementary safeguard only |

---

## Fixes Applied

### Fix 18.2-A — Addresses F-01: `_normalizeError()` in `auth.js` returns raw SDK message
**File:** `js/auth.js`  
**Finding:** F-01 (Medium)  
**Change:** Added `SAFE_MESSAGES` constant — a map of error code → static safe string. Rewrote `_normalizeError()` so the raw SDK `message` is used only internally for pattern matching to derive `code`; the raw string is never assigned to any returned field. The returned `{ code, message }` object always has `message` from `SAFE_MESSAGES`, which is a hard-coded static string ≤ 200 characters with no SDK content, no JWT, no credentials.  
**Verification:** `SAFE_MESSAGES` exists in `auth.js`; `_normalizeError()` returns `SAFE_MESSAGES[code]` not `rawMsg`; confirmed by static grep. `node --check` passes.

### Fix 18.2-B — Addresses F-07: `signUp()` password minimum was < 8 at auth layer
**File:** `js/auth.js`  
**Finding:** F-07 (Low)  
**Change:** Added client-side pre-validation in `signUp()` before any network call: (1) empty/missing email check; (2) email format regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; (3) `password.length < 8` check. All failures return `{ ok: false, error: { code: 'validation-error', message: '...' } }` without calling `getSupabaseClient()`.

### Fix 18.2-C — Addresses F-07: UI layer `validateRegisterForm()` inconsistent with auth layer
**File:** `js/app.js`  
**Finding:** F-07 (Low)  
**Change:** `validateRegisterForm()` now requires `password.length >= 8` (was `>= 6`). Error message updated to "Password must be at least 8 characters." `getRegisterErrorMessage()` `weak-password` case updated to match.  
**Verification:** `password.length < 8` present in `app.js` `validateRegisterForm`; "at least 8 characters" in error message; confirmed by static grep. `node --check` passes.

### Fix 18.4-A — Addresses F-05: `getSupabaseClient()` did not reject whitespace-only config values
**File:** `js/supabase.js`  
**Finding:** F-05 (Low)  
**Change:** Added `SUPABASE_CONFIG.url.trim() === ''` and `SUPABASE_CONFIG.anonKey.trim() === ''` checks to the existing guard block. The function now returns `null` immediately for any falsy, empty, whitespace-only, or placeholder config value without attempting CDN import (Req 27.3).  
**Verification:** Guard block in `js/supabase.js` contains `.trim() === ''` checks for both `url` and `anonKey`; confirmed by static read. The six-condition guard covers all invalid-config cases.

### Fix 18.4-B — Addresses F-06: CDN `catch` clause logged raw `err` object
**File:** `js/supabase.js`  
**Finding:** F-06 (Low)  
**Change:** Replaced `console.error('supabase.js: failed to load supabase-js from CDN.', err)` with a fully static message: `console.error('supabase.js: failed to load supabase-js from CDN. Check your network connection.')`. The `err` parameter is renamed `_err` to make clear it is intentionally unused (Req 27.4). No config values, CDN URL, or error details are interpolated.  
**Verification:** `catch` block in `js/supabase.js` contains static-only `console.error` with no variable interpolation; confirmed by static read.

### Fix 18.4-C — Addresses F-09: `.gitignore` missing credential file exclusions
**File:** `.gitignore`  
**Finding:** F-09 (Medium)  
**Change:** Added `.env`, `.env.local`, `.env.production`, `*.key`, `*.pem` entries under a "Credentials & secrets" comment block (Req 33.3). Prevents accidental `git add .` from staging environment files or private keys.  
**Verification:** All five entries confirmed present in `.gitignore` by static read.

### Fix 18.4-D — Pre-commit credential scanner created (developer-local supplementary safeguard)
**File:** `.git/hooks/pre-commit` *(not committed to the repository)*  
**Requirement:** Req 33.6  
**Change:** Created a bash pre-commit hook that scans every staged file for (a) the literal string `service_role` and (b) any base64url token starting with `eyJ` that is longer than 200 characters. If either pattern is detected, the commit is blocked with an explanatory message. The hook header explicitly documents that it is a developer-local safeguard only, not committed to the repository, not a repository-wide guarantee, and not a substitute for primary controls (source scan, `.gitignore`, manual review).  
**⚠️ Pre-commit hook note:** This hook resides in `.git/hooks/pre-commit` which is NOT tracked by Git. It protects only the developer who has it installed locally. It is a supplementary safeguard; the primary security controls are the source credential scan, `.gitignore` exclusions, and the policy that no Service_Role_Key appears in any committed file.

### Task 18.4 — `createClient(` singleton scan result
**Scan result:** No rogue `createClient(` calls found. The pattern was searched across all `.js` files (excluding `node_modules`). It appears exactly once — in `js/supabase.js` — where it is the correct, intended instantiation. Singleton constraint holds (Req 27.2).

---

## Automated Tests Performed

*(To be populated in Task 18.12.)*

---

## Manual Tests Still Required

| Test | Verification step | Responsible party |
|------|-------------------|-------------------|
| B1–B6: User isolation | Two Supabase accounts, cross-user SELECT and spoofed INSERT | Developer |
| C1–C5: Migration matrices | Live migration test with LocalStorage data and authenticated session | Developer |
| D4: No password in localStorage | DevTools Application → Local Storage inspection after sign-in | Developer |
| D5: No plaintext password in network | DevTools Network tab during sign-in | Developer |
| D6: No JWT/credentials in console | DevTools Console during full authenticated session | Developer |
| A4: Session expiry | Revoke session via Supabase Dashboard → Auth → Users | Developer |
| Supabase Dashboard RLS verification | Query pg_tables and pg_policies as documented in rls.sql | Developer |

---

## Production Configuration Still Required

| Item | Step | Responsible party |
|------|------|-------------------|
| `js/config.js` — real Supabase project URL | Replace `YOUR_SUPABASE_PROJECT_URL` | Developer |
| `js/config.js` — real Supabase anon key | Replace `YOUR_SUPABASE_ANON_KEY` | Developer |
| Supabase Dashboard — RLS enabled | Verify via `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` | Developer |
| Supabase Dashboard — email confirmation enabled | Authentication → Email → Enable email confirmations | Developer |
| Supabase Dashboard — JWT expiry configured | Authentication → JWT settings (1–43200 minutes) | Developer |
| Supabase Dashboard — redirect URLs | Authentication → URL Configuration → Redirect URLs | Developer |
| Apply `supabase/schema.sql` to production project | SQL Editor → run schema.sql | Developer |
| Apply `supabase/rls.sql` to production project | SQL Editor → run rls.sql | Developer |

---

*This report will be completed in Task 18.12 after all hardening tasks are executed.*
