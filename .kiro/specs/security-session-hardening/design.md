# Design Document: Phase 18 — Security & Session Hardening

## Overview

Phase 18 is a hardening-only phase. It introduces no new product features, no new user-visible
screens, and no changes to the architecture established in Phases 1–17. Its sole purpose is to
verify, document, and fix all security vulnerabilities, state-management weaknesses, data-leakage
paths, and configuration risks discovered during a systematic audit of the Phase 1–17 codebase.

After Phase 18 the application is production-ready. Every change is either:
1. **Corrective** — fixing a confirmed Security_Finding from the audit.
2. **Protective** — adding a guard or check that prevents a class of future vulnerability.
3. **Documentary** — producing the audit record, production checklist, and final report required
   by Requirements 33–34.

No change may alter user-visible application behavior beyond correcting a security defect or
updating documentation (Req 34.6).

### Scope

Eight concern areas are in scope, each mapped to one or more tasks:

| Area | Files | Tasks |
|---|---|---|
| Authentication & session handling | `js/auth.js`, `js/app.js` | 18.2, 18.3, 18.9 |
| Supabase client security | `js/config.js`, `js/supabase.js` | 18.4 |
| Row Level Security & user isolation | `supabase/schema.sql`, `supabase/rls.sql`, `js/supabase-storage.js` | 18.5 |
| Migration security | `js/migration.js` | 18.7 |
| Error handling & data leakage | all JS modules | 18.8 |
| Logout & session-expiration state cleanup | `js/app.js` | 18.9 |
| Configuration & credential safety | `js/config.js`, `.gitignore`, `README.md` | 18.4, 18.11 |
| Production security readiness | `PRODUCTION_CHECKLIST.md`, `PHASE18_REPORT.md` | 18.10, 18.11, 18.12 |

### What Does NOT Change in Phase 18

- The module graph, import graph, and layering remain identical to Phase 17.
- No new HTML sections, CSS classes, or UI components are introduced.
- `storage.js`, `transactions.js`, `categories.js`, `dashboard.js`, `reports.js`,
  `charts.js`, and `utils.js` are modified only if a Security_Finding directly implicates them.
- The Supabase schema (`schema.sql`) is not structurally changed; `rls.sql` is verified and
  potentially amended to close any RLS gaps.
- No new npm packages, CDN dependencies, or build steps are introduced.

---

## Architecture

### Module Graph (Unchanged from Phase 17)

```
index.html
    └─ js/app.js  (entry point, UI orchestrator, auth gate)
           ├─ js/auth.js          (authentication service)
           ├─ js/storage.js       (storage router: LocalStorage ↔ Supabase)
           │      └─ js/supabase-storage.js  (Supabase CRUD provider)
           │             └─ js/supabase.js   (singleton client factory)
           │                    └─ js/config.js  (public anon key only)
           ├─ js/migration.js     (LocalStorage → Supabase migration)
           ├─ js/transactions.js  (business logic)
           ├─ js/categories.js    (business logic)
           ├─ js/dashboard.js     (UI render)
           ├─ js/reports.js       (UI render)
           ├─ js/charts.js        (UI render)
           └─ js/utils.js         (shared helpers)
```

### Security Perimeter (Layered)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Auth Gate (app.js / auth.js)                                   │ │
│  │    state.currentUser  ← set ONLY by onAuthStateChange callback  │ │
│  │    userId             ← always state.currentUser.id (UUID)      │ │
│  │                                                                  │ │
│  │  Finance_UI (app-main)  ← hidden until currentUser !== null     │ │
│  │                                                                  │ │
│  │  Storage Router (storage.js)                                    │ │
│  │    userId === null   → LocalStorageProvider                     │ │
│  │    userId is UUID v4 → SupabaseDatabaseProvider                 │ │
│  │                                                                  │ │
│  │  Supabase Layer                                                  │ │
│  │    RLS: USING(user_id = auth.uid())                             │ │
│  │         WITH CHECK(user_id = auth.uid())                        │ │
│  │    Defence-in-depth: explicit user_id in every INSERT/UPDATE    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  localStorage                                                         │
│    "financeTrackerData"           ← LocalStorage path only           │
│    "financeTrackerMigration_UUID" ← migration marker (UUID-keyed)    │
│    supabase-auth-token-...        ← managed by supabase-js only      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components and Interfaces

### Task 18.1 — Security Architecture Audit

**Deliverable:** A documented audit finding record (captured in `PHASE18_REPORT.md`).

**Audit scope checklist:**

| Area | Audit question | Source |
|---|---|---|
| Credential handling | Does `config.js` contain only `url` and `anonKey`? Is there any `service_role` key in any committed file? | `js/config.js`, all `.js/.html/.md/.sql/.json` |
| Auth mechanism | Is Supabase Auth the only authentication path? No manual JWT creation, no manual token parsing? | `js/auth.js`, `js/app.js` |
| Session lifecycle | Is `state.currentUser` always set/cleared only by `onAuthStateChange`? | `js/app.js` |
| Database access control | Do all three tables have RLS enabled with FOR ALL + USING + WITH CHECK? | `supabase/rls.sql` |
| supabase-storage.js methods | Does every INSERT/UPDATE include an explicit `user_id` field? | `js/supabase-storage.js` |
| Migration ownership | Is `userId` validated at every migration entry point? | `js/migration.js` |
| Console/log leakage | Do any `console.*` calls expose passwords, JWTs, or full SDK error objects? | all `.js` |

**Finding severity classification:**

- **High** — allows unauthorized data access, credential exposure, or authentication bypass → **blocking**, must fix before deploying.
- **Medium** — degrades defence-in-depth but does not by itself enable an attack → fix preferred, accepted risk requires written rationale.
- **Low** — coding hygiene or missing hardening that does not introduce exploitable risk → fix encouraged, accepted risk allowed.

### Task 18.2 — Authentication Security (`js/auth.js`)

**Normalized_Error contract** (Req 25.9):

```js
// Every error returned by any auth.js export MUST conform to this shape exactly.
// No additional fields. No raw SDK content.
{
  code:    string,  // ≤ 50 characters, internal classification only, no JWT or URL substrings
  message: string,  // ≤ 200 characters, safe for display, no raw SDK text, no token content
}
```

**Accepted error code values:**

| Code | Trigger |
|---|---|
| `'not-configured'` | Supabase client not initialised (placeholder config) |
| `'validation-error'` | Client-side format/length check failed in `signUp` |
| `'invalid-credentials'` | Wrong email or password |
| `'email-not-confirmed'` | Account exists but email unverified |
| `'email-in-use'` | Registration: address already registered |
| `'weak-password'` | Registration: password below minimum length |
| `'invalid-email'` | Email fails format validation |
| `'user-not-found'` | No account for that address |
| `'rate-limited'` | Too many requests |
| `'network-error'` | Fetch / CDN failure |
| `'unknown'` | All other cases |

**`signUp` client-side pre-validation (Req 25.11):**

```
Before any network call:
  1. Trim and test email against /^[^\s@]+@[^\s@]+\.[^\s@]+$/
     → if invalid: return { ok: false, error: { code: 'validation-error', message: '...' } }
  2. Test password.length >= 8
     → if too short: return { ok: false, error: { code: 'validation-error', message: '...' } }
  Only after both pass: call client.auth.signUp(...)
```

> Phase 17 validation used ≥6 chars. Phase 18 raises the minimum to **≥8 chars** to meet Req 25.11.
> The UI-layer validation in `app.js` (`validateRegisterForm`) must be updated consistently.

**`signOut` error path (Req 25.1, 25.10):**

Currently `signOut` passes the error through `_normalizeError` correctly. The audit confirms
this is already compliant; no code change needed — audit acceptance is sufficient.

**`onAuthStateChange` before client resolves (Req 25.8):**

```js
// When SUPABASE_CONFIG contains placeholders, fire the callback safely:
queueMicrotask(() => callback('INITIAL_SESSION', null));
return () => {};
```

This path is already implemented. The audit confirms it; no code change needed.

**`getCurrentUser` null-safe path (Req 25.2, 25.3):**

```js
// Returns null — never throws — when:
//   a. getSupabaseClient() returns null (placeholder config or CDN failure)
//   b. client.auth.getUser() returns an error or no user
```

This path is already implemented. Confirm via audit.

**Security invariants enforced in `auth.js`:**

- Passwords are never logged, stored in variables that outlive the call, or included in return values.
- JWTs managed by `supabase-js` are never extracted, logged, or returned.
- `_normalizeError` never passes the raw SDK `error.message` through when it contains token-shaped content.

### Task 18.3 — Session Lifecycle Hardening (`js/app.js`)

**Required teardown sequence** (Req 26.1, 26.4, 32.1):

```
onLogout() / onSessionExpired():
  1. await auth.signOut()              // attempt to end the Supabase session
  2. state.currentUser = null          // clear user identity FIRST
  3. hideMigrationModal()              // close migration modal if open (Req 32.2)
  4. const appMain = document.getElementById('app-main');
     if (appMain) appMain.hidden = true // hide Finance_UI
  5. financeAppInitialized = false     // reset the init guard
  6. clearFinanceUIDOM()               // clear all Finance_UI DOM content (Req 32.6)
  7. showLoginView()                   // show login form
```

This sequence applies **even when `auth.signOut()` returns an error** (Req 32.5). Steps 2–7
execute regardless of the signOut result.

**`financeAppInitialized` guard** (Req 26.7):

```js
// In initAuthSession() onAuthStateChange callback:
if (user) {
  state.currentUser = user;
  // ...
  if (!financeAppInitialized) {        // ← explicit guard
    await initializeFinanceApplication();
  }
}
```

The existing guard `if (financeAppInitialized) return;` inside `initializeFinanceApplication`
handles this. Verify the guard is checked before any state mutation inside the function.

**SESSION_EXPIRY handling** (Req 26.4):

```js
auth.onAuthStateChange((event, user) => {
  if (user) {
    // ... SIGNED_IN path
  } else {
    // Handles both SIGNED_OUT and TOKEN_REFRESHED→null / SESSION_EXPIRED
    state.currentUser = null;
    showSignedOutState();
    hideProtectedApp();
    // Phase 18: also reset financeAppInitialized and clear DOM
    financeAppInitialized = false;
    clearFinanceUIDOM();
  }
});
```

**`clearFinanceUIDOM()` — new helper** (Req 32.6):

```js
/**
 * Clear all Finance_UI DOM content so no prior user's data is visible
 * to a subsequent user in the same browser tab (Req 32.6).
 * Called at the end of every logout/session-expiry teardown sequence.
 */
function clearFinanceUIDOM() {
  // Transaction list
  const listEl = document.getElementById('transaction-list');
  if (listEl) listEl.replaceChildren();
  // Balance/totals cards (clear text content, not the structure)
  for (const id of ['total-balance', 'total-income', 'total-expense', 'transaction-count']) {
    const el = document.getElementById(id);
    if (el) utils.safeText(el, '');
  }
  // Category list
  const catListEl = document.getElementById('category-list');
  if (catListEl) catListEl.replaceChildren();
  // Reports / monthly summary (clear container)
  const reportEl = document.getElementById('monthly-summary');
  if (reportEl) reportEl.replaceChildren();
  // Charts — destroy active Chart.js instances
  charts.destroyCharts();
  // Data error banner
  clearDataError();
}
```

**User A → User B isolation** (Req 26.5, 32.4):

The combination of:
1. Teardown sequence resetting `financeAppInitialized = false`,
2. `clearFinanceUIDOM()` wiping all rendered content, and
3. `initializeFinanceApplication()` fetching fresh data for User B's `userId`

guarantees zero cross-user data leakage in the DOM. The `state.currentUser` reset to `null`
ensures the storage router never reads User A's Supabase data during User B's session.

**Null-userId storage guard** (Req 26.6):

`storage.js` already routes `userId === null` to `LocalStorageProvider`. The Supabase path is
never reached when `state.currentUser` is null. This is confirmed by the audit; no code change
is required — but the guard is documented here as a critical invariant.

### Task 18.4 — Supabase Client & Configuration Security (`js/config.js`, `js/supabase.js`)

**`getSupabaseClient()` null-return guards** (Req 27.3):

```js
// Current guard in supabase.js — already checks for placeholder strings.
// Phase 18 hardens to also reject empty strings and whitespace-only values:
if (
  !SUPABASE_CONFIG.url ||
  !SUPABASE_CONFIG.anonKey ||
  SUPABASE_CONFIG.url.trim() === '' ||
  SUPABASE_CONFIG.anonKey.trim() === '' ||
  SUPABASE_CONFIG.url === 'YOUR_SUPABASE_PROJECT_URL' ||
  SUPABASE_CONFIG.anonKey === 'YOUR_SUPABASE_ANON_KEY'
) {
  return null;
}
```

**CDN load failure — safe log message** (Req 27.4):

```js
catch (err) {
  // SAFE: does NOT log SUPABASE_CONFIG.url or SUPABASE_CONFIG.anonKey
  console.error('supabase.js: failed to load supabase-js from CDN. Check your network connection.');
  return null;
}
```

The current implementation logs `err` which may contain the CDN URL string. Phase 18 replaces
the catch log with a static message that never interpolates config values.

**Singleton check** (Req 27.2):

Search all JS files for `createClient(` — only `supabase.js` may contain it. This is a static
audit check; no code change expected.

**Credential scan patterns** (Req 27.5, 33.1):

| Pattern | Risk |
|---|---|
| `service_role` | Privileged key identifier |
| `SUPABASE_SERVICE_ROLE_KEY` | Env var name for privileged key |
| `supabase_admin` | Admin role name |
| `service_role_key` | Alternate naming |
| `postgres://` | Direct DB connection string |
| `postgresql://` | Direct DB connection string |
| `eyJ[A-Za-z0-9_\-]{200,}` | JWT >200 chars (service-role or similar) |

These patterns are checked in all files with extensions `.js`, `.html`, `.md`, `.sql`, `.json`,
and any `.env*` file outside `node_modules`.

**`.gitignore` required entries** (Req 33.3):

```
.env
.env.local
.env.production
*.key
*.pem
```

**Pre-commit hook** (Req 33.6):

A pre-commit hook at `.git/hooks/pre-commit` scans staged files for the service-role JWT
pattern (`eyJ` + role claim `service_role`). If found, the commit is rejected with a message
explaining a privileged credential was detected.

### Task 18.5 — Row Level Security & Multi-User Isolation (`supabase/rls.sql`)

**Required RLS state** (Req 28.1, 28.2, 28.3):

```sql
-- Verification query (run after applying rls.sql):
SELECT tablename, rowsecurity
FROM   pg_tables
WHERE  schemaname = 'public'
  AND  tablename IN ('transactions', 'categories', 'settings');
-- Expected: all three rows with rowsecurity = true

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('transactions', 'categories', 'settings');
-- Expected: one row per table
--   roles = {authenticated}
--   cmd   = ALL
--   qual  = (user_id = auth.uid())        ← USING
--   with_check = (user_id = auth.uid())   ← WITH CHECK
```

**anon role** (Req 28.3):

No permissive policy exists for the `anon` role on any of the three tables. With RLS enabled,
PostgreSQL's default-deny means any `anon` SELECT returns 0 rows and INSERT/UPDATE/DELETE is
rejected.

**Defence-in-depth — explicit `user_id` in writes** (Req 28.4):

Every INSERT and UPDATE in `js/supabase-storage.js` must include `user_id: userId` explicitly
in the payload, independently of RLS. This is verified per-method:

| Method | INSERT/UPDATE payload | user_id present? |
|---|---|---|
| `addTransaction` | `{ id, user_id, item_name, amount, type, category, date, created_at }` | ✓ |
| `addCustomCategory` | `{ user_id, name, type }` | ✓ |
| `setSettings` | `{ user_id, currency, updated_at }` | ✓ |
| `initializeUserData` | `{ user_id, currency: 'IDR' }` | ✓ |

If the audit finds any method missing `user_id`, it is added as a Security_Finding and fixed.

**Two-user isolation test procedure** (Req 28.5, 28.6):

```
Manual test:
  1. Log in as User A. Insert ≥1 transaction in each table (via the app UI).
  2. Log in as User B (separate private browsing window or tab).
  3. SELECT all transactions/categories/settings — expect 0 rows from User A.
  4. Attempt INSERT with user_id = User A's UUID via browser devtools (Supabase JS client).
     Expected: error "new row violates row-level security policy".
```

### Task 18.6 — Storage Provider Security (`js/storage.js`)

**Provider selection logic — hardened** (Req 29.1, 29.2, 29.6):

```js
/**
 * UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where y is 8, 9, a, or b.
 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getProvider(userId) {
  // null / undefined / empty string / whitespace → LocalStorageProvider (Req 29.1)
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return new LocalStorageProvider();
  }
  // Non-UUID-v4 format → LocalStorageProvider (Req 29.6)
  if (!UUID_V4_PATTERN.test(userId)) {
    return new LocalStorageProvider();
  }
  // Valid UUID v4 → SupabaseDatabaseProvider (Req 29.2)
  return new SupabaseDatabaseProvider();
}
```

**`SupabaseDatabaseProvider` when client is null** (Req 29.5):

Every method in `SupabaseDatabaseProvider` already calls `getSupabaseClient()` first.
When it returns `null`:

- Read methods (`getTransactions`, `getCustomCategories`): return `[]`
- `getSettings`: returns `{ currency: 'IDR' }` (safe default)
- Write methods (`addTransaction`, `addCustomCategory`, `deleteTransaction`,
  `deleteCustomCategory`, `setSettings`, `initializeUserData`):
  return `{ ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } }`

This behavior is confirmed by the audit. The current implementation matches — no code change
expected; audit confirmation is sufficient.

**`userId` source integrity** (Req 29.3):

`userId` passed to storage functions always originates from `state.currentUser.id` set by the
`onAuthStateChange` callback in `app.js`. No storage function reads `userId` from URL
parameters, query strings, user-editable form fields, or localStorage values. This is verified
by the audit as a static analysis check.

**Email never used as ownership field** (Req 29.4):

`SupabaseDatabaseProvider` has no query that uses `email` in a `.eq()`, `.filter()`,
`.insert()`, or `.upsert()` predicate. `email` appears only in `_normalizeUser` in `auth.js`
as a display field. Confirmed by the audit.

### Task 18.7 — Migration Security (`js/migration.js`)

**Unauthenticated userId guard** (Req 30.1):

All six migration entry points (`startMigration`, `retryMigration`, `migrateCategoriesStep`,
`migrateSettingsStep`, `verifyMigration`, `clearLocalFinanceData`) already guard against
null/undefined/empty `userId` and return early. Phase 18 standardizes the error code to
`'unauthenticated'`:

```js
// Standard guard at the top of every public migration function:
if (!userId || typeof userId !== 'string' || userId.trim() === '') {
  return {
    ok: false,
    error: { code: 'unauthenticated', message: 'A signed-in user is required.' },
  };
}
```

The current implementation uses `'INVALID_USER_ID'` as the error code. Phase 18 changes this to
`'unauthenticated'` to match Req 30.1 explicitly. This is a low-risk code change that does not
affect the calling UI (which checks `result.ok`, not `result.error.code`).

**Migration marker key — UUID only** (Req 30.2):

The marker key is always `financeTrackerMigration_${userId}` where `userId` is the Supabase
UUID from `state.currentUser.id`. The audit verifies:
- `migrationMarkerKey()` is called with the UUID, never with `email`.
- `app.js` passes `state.currentUser.id`, not `state.currentUser.email`.

**`clearLocalFinanceData` invariant** (Req 30.3, 30.4):

```js
// What clearLocalFinanceData does:
localStorage.removeItem(STORAGE_KEY);   // removes "financeTrackerData" ONLY

// What it NEVER does:
// - localStorage.removeItem(`financeTrackerMigration_${userId}`)  ← marker preserved
// - localStorage.setItem(STORAGE_KEY, ...)                        ← never writes finance data

// Post-condition: readMigrationMarker(userId) returns same value as before the call.
```

This is already correct in the Phase 17 implementation. The audit confirms; no code change needed.

**Migration module never writes to STORAGE_KEY** (Req 30.5):

The audit scans `migration.js` for any `localStorage.setItem` call with key `STORAGE_KEY` or
the literal string `"financeTrackerData"`. The only `localStorage.setItem` calls in
`migration.js` are via `writeMigrationMarker()`, which uses the migration marker key. Confirmed
by static analysis.

**Network error during upload** (Req 30.6):

The upload loop in `startMigration` already implements this:

```
On network-error from provider.addTransaction():
  1. Record the failure in failed[].
  2. Set networkStopped = true to stop the loop.
  3. Set finalStatus = MIGRATION_STATUS.PARTIAL.
  4. Write marker with status: 'partial'.
  5. Return. STORAGE_KEY is never touched.
```

Confirmed by the audit; no code change needed.

### Task 18.8 — Error Handling & Data Leakage Prevention

**Console output policy** (Req 31.1, 31.2, 31.3, 31.7):

| Forbidden | In module | Fix |
|---|---|---|
| `console.log(password)` | `auth.js` | Never implemented — confirmed by audit |
| `console.log(token/JWT)` | any | Never implemented — confirmed by audit |
| `console.log(SUPABASE_CONFIG.url\|anonKey)` | `supabase.js` | CDN catch clause may log `err` containing URL — fixed by static message |
| `console.log(transaction\|categories\|settings object)` | `app.js` | `console.info(...)` in `initializeFinanceApplication` logs `{ selectedMonth }` only — no financial objects — confirmed |

**`supabase-storage.js` error logging policy** (Req 31.4):

```js
// Current pattern (already compliant in most methods):
console.error('supabase-storage: methodName error', error.code ?? '');
//                                                   ^^^^^^^^^^^^^^ only code, not full message
```

Phase 18 audit confirms all `console.error` calls in `supabase-storage.js` log only
`error.code` (or `err?.name`). The full SDK error object is never logged.

**Normalized_Error from `supabase-storage.js`** (Req 31.4):

```js
// _normalizeError() returns exactly:
{ code: 'network-error' | 'duplicate' | 'not-authenticated' | 'unknown', message: staticString }
// 'message' is a hard-coded static string — not copied from the SDK error.
// The SDK error.message is matched only for pattern classification, never surfaced to callers.
```

**DOM error panels** (Req 31.5):

All DOM error messages are written via `utils.safeText()` (which sets `textContent`, never
`innerHTML`). The message strings in `app.js` are static. No Supabase error object is ever
passed to a DOM write function. Confirmed by audit.

**`window.confirm` messages** (Req 31.6):

```js
// DELETE transaction confirm (onDeleteTransaction):
window.confirm("Delete this transaction? This cannot be undone.")
// ✓ No amount, name, user ID, or email.

// CLEAR LOCAL DATA confirm (migration UI):
window.confirm(
  "This will permanently delete your local finance data from this browser. " +
  "Your data is safely stored in the cloud. Continue?"
)
// ✓ No financial data.
```

Both are confirmed by audit. No code change needed.

**Global error handler** (Req 31.8):

```js
// Add to app.js bootstrap (if not already present):
window.addEventListener('unhandledrejection', (event) => {
  // Prevent the default which may log to console with raw error details.
  event.preventDefault();
  // Do NOT surface event.reason to any DOM element or alert().
  console.error('app: unhandled promise rejection (suppressed for security)');
});

window.onerror = function(message, source, lineno, colno, error) {
  // Do NOT write error details to DOM or call alert().
  console.error('app: uncaught error (suppressed for security)');
  return true; // prevents default browser error reporting
};
```

If these handlers are not already present in `app.js`, adding them is a Phase 18 task.

### Task 18.9 — Logout & State Cleanup (`js/app.js`)

**`onLogout()` — hardened implementation** (Req 32.1, 32.2, 32.5, 32.6):

```js
function onLogout() {
  (async () => {
    // Step 1: End the Supabase session (may fail — we proceed regardless, Req 32.5).
    await auth.signOut();

    // Step 2: Clear user identity (MUST be first, Req 32.1).
    state.currentUser = null;

    // Step 3: Close migration modal if open (Req 32.2).
    hideMigrationModal();

    // Step 4: Hide Finance_UI immediately (Req 32.1).
    const appMain = document.getElementById('app-main');
    if (appMain) appMain.hidden = true;

    // Step 5: Reset the init guard (Req 32.1, 26.3).
    financeAppInitialized = false;

    // Step 6: Clear all Finance_UI DOM content (Req 32.6).
    clearFinanceUIDOM();

    // Step 7: Update header to signed-out state.
    showSignedOutState();

    // Step 8: Show login form.
    showLoginView();
  })();
}
```

**`onAuthStateChange` signed-out path — hardened** (Req 26.4, 32.3):

```js
// In the else branch of the auth state change handler:
} else {
  // currentUser = null is set by showSignedOutState()
  state.currentUser = null;
  showSignedOutState();
  hideProtectedApp();

  // Phase 18 additions:
  hideMigrationModal();                 // Req 32.2
  financeAppInitialized = false;        // Req 26.4, 26.3
  clearFinanceUIDOM();                  // Req 32.6
}
```

**Finance_UI cleared on signed-out (Req 32.3):**

While `state.currentUser === null`, `clearFinanceUIDOM()` ensures the `#app-main` section is
both hidden (`.hidden = true`) and emptied of prior user data. Subsequent `renderAll()` calls
are blocked because `initializeFinanceApplication()` is guarded by `financeAppInitialized` and
only runs when `state.currentUser` is truthy.

### Task 18.10 — Security Regression Test Matrix

**Matrix 1 — Authentication**

| # | Test | Expected |
|---|---|---|
| A1 | Open app without signing in | Finance_UI (`#app-main`) is hidden; login form visible |
| A2 | Sign in with valid credentials | Finance_UI revealed; correct user email shown |
| A3 | Sign out | Finance_UI hidden; login form visible; no prior data in DOM |
| A4 | Session expires (simulate via Supabase dashboard revoke) | Same teardown as A3 |
| A5 | Refresh page while signed in | Finance_UI shown with correct data (session persists) |
| A6 | Refresh page while signed out | Finance_UI hidden; login form visible |
| A7 | Register with password < 8 chars | Blocked by client-side validation; no network call |
| A8 | Register with invalid email format | Blocked by client-side validation; no network call |
| A9 | Sign in with wrong password | Error message shown; Finance_UI remains hidden |

**Matrix 2 — User Isolation**

| # | Test | Expected |
|---|---|---|
| B1 | User A adds transaction; User B signs in | User B sees zero transactions from User A |
| B2 | User A signs out; User B signs in same tab | Finance_UI shows only User B's data |
| B3 | User A signs out; User B signs in — charts | Charts show only User B's data |
| B4 | User A signs out; User B signs in — categories | Category list shows only User B's custom categories |
| B5 | User A signs out; User B signs in — balance | Balance reflects only User B's transactions |
| B6 | Direct DB INSERT with spoofed user_id | RLS WITH CHECK rejects; error returned |

**Matrix 3 — Migration**

| # | Test | Expected |
|---|---|---|
| C1 | Call `startMigration(null)` | Returns `{ ok: false, error: { code: 'unauthenticated' } }` |
| C2 | Call `startMigration(userEmail)` (non-UUID) | Returns `{ ok: false, error: { code: 'unauthenticated' } }` |
| C3 | Migration marker key format | Key is `financeTrackerMigration_${UUID}`, never contains `@` |
| C4 | `clearLocalFinanceData(userId)` after migration | `financeTrackerData` removed; marker preserved with `status: 'completed'` |
| C5 | Network error mid-migration | `status: 'partial'`; `financeTrackerData` byte-for-byte unchanged |

**Matrix 4 — Credential Safety**

| # | Test | Expected |
|---|---|---|
| D1 | Scan all `.js/.html/.md/.sql/.json` for `service_role` | Zero matches |
| D2 | Scan for `eyJ[A-Za-z0-9_\-]{200,}` | Zero matches |
| D3 | Scan for `postgres://` | Zero matches |
| D4 | Check localStorage after sign-in | Only `financeTrackerData` and `supabase-auth-*` keys; no password |
| D5 | Open browser DevTools Network during auth | No plaintext password in request body logs |
| D6 | Check DevTools Console during full session | No JWT, no password, no config values |

**Matrix 5 — State Safety**

| # | Test | Expected |
|---|---|---|
| E1 | Logout: check `state.currentUser` | `null` |
| E2 | Logout: check `financeAppInitialized` | `false` |
| E3 | Logout: check DOM content | All Finance_UI sections empty |
| E4 | Session expiry: same checks as E1–E3 | Same results |
| E5 | User A → User B: no stale DOM | Balance, list, charts, categories all show User B's data only |

### Task 18.11 — Production Security Checklist

**File:** `PRODUCTION_CHECKLIST.md` (repository root)

**Required sections and items:**

```markdown
# Production Security Checklist

Each item carries exactly one status:
  PASS | FAIL | NEEDS MANUAL VERIFICATION | NOT CONFIGURED

---

## Supabase Configuration
[ ] RLS enabled on transactions table
[ ] RLS enabled on categories table
[ ] RLS enabled on settings table
[ ] transactions_owner_policy: FOR ALL, authenticated, USING + WITH CHECK = auth.uid()
[ ] categories_owner_policy: FOR ALL, authenticated, USING + WITH CHECK = auth.uid()
[ ] settings_owner_policy: FOR ALL, authenticated, USING + WITH CHECK = auth.uid()
[ ] anon role: no permissive policies on any of the three tables
[ ] js/config.js: non-placeholder project URL configured
[ ] js/config.js: non-placeholder anon key configured
[ ] Supabase email confirmation enabled (Supabase Dashboard → Authentication → Email)
[ ] Supabase Auth JWT expiry between 1 and 43200 minutes
[ ] Supabase Auth redirect URLs include production domain

## Application Security
[ ] No service_role key in any committed file
[ ] No manual JWT creation or token parsing in any JS module
[ ] All data owned by auth.uid() (user_id = auth.uid() in all RLS policies)
[ ] Finance_UI (#app-main) hidden until authenticated
[ ] Logout clears state.currentUser, Finance_UI, and financeAppInitialized
[ ] Session expiry triggers the same teardown as logout
[ ] Migration scoped to authenticated user's UUID only

## Repository Hygiene
[ ] .gitignore includes .env*, *.key, *.pem
[ ] Pre-commit hook rejects service_role key commits
[ ] No credentials in source files, documentation, or tests
[ ] No console.log of financial objects in committed source
[ ] README Security section documents anon-key safety and RLS requirement

## Deployment
[ ] HTTPS-only deployment confirmed (GitHub Pages enforces HTTPS by default)
[ ] Phase 18 security notes added to README.md
```

**Status label rules** (Req 34.2):
- Every item must carry exactly one label: `PASS`, `FAIL`, `NEEDS MANUAL VERIFICATION`, or
  `NOT CONFIGURED`.
- `FAIL` items must be resolved before the checklist is finalized (Req 34.3).
- `NOT CONFIGURED` is used for Supabase-dashboard items that require manual setup.
- `NEEDS MANUAL VERIFICATION` is used for items that cannot be checked programmatically.

### Task 18.12 — Final QA & Report

**File:** `PHASE18_REPORT.md` (repository root)

**Required sections** (Req 34.4):

```markdown
# Phase 18 Security Hardening Report

## Tasks Completed (18.1 – 18.12)
  [Task ID] [Title] — [one-sentence status]

## Files Changed
  [filename] — [one-sentence description of the change]

## Security Findings
  Finding-ID | Severity | Description | Status (Fixed / Accepted)

## Fixes Applied
  Fix-ID | Finding-ID | File changed | Description

## Automated Tests Performed
  [test name] — PASS / FAIL

## Manual Tests Still Required
  [test name] — [verification step] — [responsible party]

## Production Configuration Still Required
  [item] — [step] — [responsible party]
```

**Syntax validation** (Req 34.4):

Before finalizing the report, run a JavaScript syntax check on all modified `.js` files:

```
# Browser-based: open index.html in Chrome/Firefox; verify zero console errors on load.
# Or: use a linter (eslint --no-eslintrc --rule 'no-undef: off') if available.
```

**No regression rule** (Req 34.5):

Every item in the Phase 1–17 manual test matrix (from the Phase 17 design) must return
`PASS` or `SKIP`. Any `FAIL` result is a blocking regression that must be fixed before the
report is finalized.

**No new features rule** (Req 34.6):

The report includes a "new features introduced" section. It must be empty. Any observable
behavior change beyond correcting a security defect requires a revert.

---

## Data Models

No data models change in Phase 18. The storage schema (`financeTrackerData`), the Supabase
table schema, the `Transaction` object shape, and the `AppData` shape are all unchanged.

**Migration marker — security-relevant fields reviewed** (no changes):

```json
{
  "userId":                    "supabase-uuid (never email)",
  "status":                    "not-needed|available|...|completed|failed",
  "migratedTransactionIds":    ["uuid1", "uuid2"],
  "migratedCategories":        [{ "name": "...", "type": "expense|income" }],
  "settingsMigrated":          false,
  "conflicts":                 [],
  "startedAt":                 "ISO 8601",
  "completedAt":               "ISO 8601 | null"
}
```

Key: `financeTrackerMigration_${userId}` — UUID only, never email.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a
system — essentially, a formal statement about what the system should do. Properties serve as the
bridge between human-readable specifications and machine-verifiable correctness guarantees.*

These properties target the pure/logic portions of the security layer: the auth error
normalization contract, provider routing, migration guard, and session-isolation invariants. UI,
DOM rendering, and production-configuration items are validated by the test matrices (manual
tests) in Tasks 18.10–18.12.

### Property 1: Normalized_Error contract holds for all auth failures

*For any* call to `signUp`, `signIn`, `signOut`, or `resetPassword` that produces an error
condition (network failure, invalid credentials, rate limit, not-configured, or any other
failure), the returned error object SHALL be a plain object with exactly two fields — `code`
(a string of at most 50 characters) and `message` (a string of at most 200 characters) — and
SHALL NOT contain any field that holds raw Supabase SDK error content, stack traces, or
authentication tokens.

**Validates: Requirements 25.1, 25.9, 25.10**

### Property 2: signUp rejects all invalid (email, password) pairs before making a network call

*For any* pair where the email string does not match the format `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
after trimming, or where the password string has fewer than 8 characters, `signUp` SHALL return
`{ ok: false, error: { code: 'validation-error', ... } }` without invoking any Supabase client
method and without making any network request.

**Validates: Requirements 25.11**

### Property 3: null/whitespace/placeholder config always yields null client

*For any* value of `SUPABASE_CONFIG.url` or `SUPABASE_CONFIG.anonKey` that is null, an empty
string, a whitespace-only string, or the placeholder strings `'YOUR_SUPABASE_PROJECT_URL'` /
`'YOUR_SUPABASE_ANON_KEY'`, `getSupabaseClient()` SHALL return `null` without attempting to
import or instantiate the Supabase CDN module.

**Validates: Requirements 27.3**

### Property 4: Storage provider routing is correct for all userId values

*For any* call to any exported function in `storage.js`:
- When `userId` is `null`, `undefined`, an empty string, a whitespace-only string, or a
  string that does not match UUID v4 format → the function SHALL use `LocalStorageProvider`
  and SHALL NOT call any method on a `SupabaseDatabaseProvider` instance.
- When `userId` is a string matching the UUID v4 pattern → the function SHALL use
  `SupabaseDatabaseProvider` and SHALL NOT read from or write to `localStorage` key
  `"financeTrackerData"`.

**Validates: Requirements 29.1, 29.2, 29.6**

### Property 5: SupabaseDatabaseProvider degrades safely when client is null

*For any* `SupabaseDatabaseProvider` method invoked when `getSupabaseClient()` returns
`null`: list-returning read methods (`getTransactions`, `getCustomCategories`) SHALL return
`[]`, the settings read method (`getSettings`) SHALL return `{ currency: 'IDR' }`, and all
write methods (`addTransaction`, `addCustomCategory`, `deleteTransaction`,
`deleteCustomCategory`, `setSettings`, `initializeUserData`) SHALL return
`{ ok: false, error: { code: 'not-configured', message: '...' } }`, without throwing.

**Validates: Requirements 29.5**

### Property 6: Migration entry points reject all invalid userId values

*For any* call to `startMigration`, `retryMigration`, `migrateCategoriesStep`,
`migrateSettingsStep`, `verifyMigration`, or `clearLocalFinanceData` with a `userId` that is
`null`, `undefined`, or a string that is empty or composed entirely of whitespace, the function
SHALL return `{ ok: false, error: { code: 'unauthenticated', message: '...' } }` without
reading from or writing to Supabase, and without modifying `localStorage`.

**Validates: Requirements 30.1**

### Property 7: clearLocalFinanceData preserves the migration marker for all userId values

*For any* valid `userId` string and any marker previously stored under
`financeTrackerMigration_${userId}`, calling `clearLocalFinanceData(userId)` SHALL remove
`localStorage.getItem('financeTrackerData')` AND ensure `localStorage.getItem('financeTrackerMigration_' + userId)` returns the byte-for-byte identical value it held before the call.

**Validates: Requirements 30.3**

### Property 8: Migration module never writes to STORAGE_KEY

*For any* execution of any migration module function (`startMigration`, `retryMigration`,
`migrateCategoriesStep`, `migrateSettingsStep`, `verifyMigration`, `clearMigrationMarker`)
with any valid input, no `localStorage.setItem` call is ever made with the key
`"financeTrackerData"`.

**Validates: Requirements 30.4, 30.5**

### Property 9: Finance_UI shows no data while state.currentUser is null

*For any* Finance_UI state (any combination of rendered transactions, categories, reports,
and charts), while `state.currentUser === null`, every subsequent render attempt SHALL result
in empty Finance_UI sections; no transaction, category, financial total, or chart data
belonging to any user SHALL be visible in the DOM.

**Validates: Requirements 26.6, 32.3**

### Property 10: User A data never appears in User B's Finance_UI session

*For any* two distinct authenticated users A and B with distinct transaction and category
data sets, after User A signs out (triggering full teardown including `clearFinanceUIDOM()`)
and User B signs in (triggering `initializeFinanceApplication()` with User B's UUID), every
DOM element in the Finance_UI that displays financial data SHALL contain exclusively data
belonging to User B; zero records, amounts, category names, or balances belonging to User A
SHALL appear.

**Validates: Requirements 26.5, 32.4**

### Property 11: LocalStorage-only path remains functional with placeholder Supabase config

*For any* finance operation (add transaction, delete transaction, add category, delete
category, change currency, view reports) performed while `SUPABASE_CONFIG` contains
placeholder values (client not configured), the operation SHALL complete successfully using
the LocalStorage path, without throwing any JavaScript exception or producing any console
error related to the missing Supabase configuration.

**Validates: Requirements 33.5**

---

## Error Handling

All error handling in Phase 18 follows one rule: **no sensitive data escapes the module
boundary through error paths.**

| Error condition | Where handled | Behavior |
|---|---|---|
| Auth SDK error | `auth.js._normalizeError()` | Map to code; static message; never return raw SDK object |
| Supabase DB error | `supabase-storage.js._normalizeError()` | Log `error.code` only; return static Normalized_Error |
| CDN load failure | `supabase.js` catch | Log static message (no URL/key substrings); return null |
| Placeholder config | `supabase.js` guard | Return null silently; no error logged |
| Invalid userId in storage | `storage.js.getProvider()` | Route to LocalStorageProvider; no error thrown |
| Invalid userId in migration | `migration.js` guard | Return `{ ok: false, error: { code: 'unauthenticated' } }` |
| signOut failure | `app.js.onLogout()` | Continue teardown regardless; no partial-auth state |
| Session expiry | `auth.onAuthStateChange` → `app.js` | Identical teardown as explicit logout |
| Unhandled rejection | `window.addEventListener('unhandledrejection')` | Suppress raw error from DOM/alert; log static message |
| Uncaught error | `window.onerror` | Suppress raw error from DOM/alert; return true |

---

## Security

### Credential Safety Summary

| Credential type | Where it lives | Safe to commit? | Phase 18 action |
|---|---|---|---|
| Supabase Project URL | `js/config.js` | Yes — public identifier | Confirm via audit |
| Supabase Anon Key | `js/config.js` | Yes — publishable key | Confirm via audit |
| Supabase Service Role Key | **Nowhere in the repo** | No — bypasses RLS | Credential scan; pre-commit hook |
| Database password | **Nowhere in the repo** | No | Credential scan |
| User passwords | Never stored or logged | N/A | Confirm via audit |
| JWTs / session tokens | `supabase-js` internal storage | N/A | Confirm never logged |

### Defence-in-Depth Layers

1. **RLS policies** — database-level; every row query filtered by `auth.uid()`.
2. **Explicit `user_id` in writes** — application-level; every INSERT/UPDATE sets `user_id`.
3. **Provider routing** — storage-layer; null/invalid userId routes to LocalStorage, never Supabase.
4. **Auth gate** — UI-layer; Finance_UI hidden until `state.currentUser` is set by `onAuthStateChange`.
5. **DOM clearing** — session-boundary; `clearFinanceUIDOM()` empties all Finance_UI content on logout/expiry.

### XSS Prevention

All user-provided text (item names, category names, error messages) is written via
`utils.safeText()` → `textContent` only. No user content is ever string-interpolated into
`innerHTML`. This was established in Phase 1 and confirmed by the Phase 18 audit.

### Data Exfiltration Prevention

Financial data is written only to:
- `localStorage["financeTrackerData"]` (LocalStorage path)
- Supabase PostgreSQL via the authenticated session (Supabase path)

The only outbound network request carrying user data is the Supabase API call (authenticated,
TLS-encrypted). Chart.js is loaded from CDN but receives no financial data. The privacy notice
in the footer confirms this to users.

---

## Testing Strategy

### Approach

This phase uses two complementary verification approaches:

1. **Property-based tests** validate universal invariants of the security-critical logic
   (Properties 1–11). These target pure or near-pure functions in `auth.js`, `storage.js`,
   `supabase-storage.js`, and `migration.js` where the input space is large enough for
   randomized testing to find edge cases.

2. **Manual test matrices** validate session lifecycle, user isolation, credential safety,
   and production configuration (Tasks 18.10–18.11). These behaviors require a real browser,
   a real Supabase project, and two test user accounts to execute fully.

### Property-Based Testing

If property-based tests are implemented, use **fast-check** (the standard PBT library for JS).
Configure each property test for **≥ 100 iterations**. Tag each test with:

```
Feature: security-session-hardening, Property {N}: {property_title}
```

**Property test sketches:**

| Property | Generator inputs | What to assert |
|---|---|---|
| P1: Normalized_Error contract | Arbitrary error values (null, string, object, Error instances) | Returned shape has exactly `{ code, message }`, lengths ≤ 50/200 |
| P2: signUp pre-validation | Arbitrary (email, password) pairs via `fc.string()` | Invalid pairs rejected without Supabase call; code is `'validation-error'` |
| P3: Config null guard | Arbitrary strings including empty/whitespace/placeholders | Client returns null for any invalid config |
| P4: Provider routing | UUID v4 strings vs arbitrary non-UUID strings | Correct provider selected for each class |
| P5: Supabase null degradation | No setup needed (mock `getSupabaseClient()` to return null) | Each method returns the specified safe default |
| P6: Migration unauthenticated guard | null, undefined, '', whitespace strings | All six functions return `{ ok: false, error: { code: 'unauthenticated' } }` |
| P7: clearLocalFinanceData marker preservation | Any string as userId with any marker object | Marker byte-identical after call |
| P8: Migration never writes STORAGE_KEY | Any valid userId | `localStorage.setItem` never called with `'financeTrackerData'` |
| P9–P10: User isolation | Any two distinct UUIDs with distinct data sets | No cross-user data in DOM |
| P11: LocalStorage fallback | Placeholder config strings | All finance operations complete without error |

### Unit Tests (Example-Based)

| # | Scenario | Expected |
|---|---|---|
| U1 | `_normalizeError(null)` | `{ code: 'unknown', message: '...' }` |
| U2 | `_normalizeError({ code: '23505' })` | `{ code: 'duplicate', message: '...' }` |
| U3 | `getProvider(null)` | Returns `LocalStorageProvider` instance |
| U4 | `getProvider('not-a-uuid')` | Returns `LocalStorageProvider` instance |
| U5 | `getProvider('550e8400-e29b-41d4-a716-446655440000')` | Returns `SupabaseDatabaseProvider` instance |
| U6 | `startMigration(null)` | `{ ok: false, error: { code: 'unauthenticated' } }` |
| U7 | `startMigration('')` | `{ ok: false, error: { code: 'unauthenticated' } }` |
| U8 | `clearLocalFinanceData(userId)` — verify marker survives | Marker value unchanged after call |
| U9 | `signUp('a@b.com', '1234567')` (7 chars) | `{ ok: false, error: { code: 'validation-error' } }` |
| U10 | `signUp('notanemail', 'password123')` | `{ ok: false, error: { code: 'validation-error' } }` |

### Manual Tests

The full manual test matrices are documented in Task 18.10. Key acceptance gates:

1. **Authentication** (Matrix 1, A1–A9): All pass before merging.
2. **User isolation** (Matrix 2, B1–B6): All pass before merging (requires two test accounts).
3. **Migration** (Matrix 3, C1–C5): All pass before merging.
4. **Credential safety** (Matrix 4, D1–D6): All pass before merging.
5. **State safety** (Matrix 5, E1–E5): All pass before merging.

---

## Future Extensibility

Phase 18 introduces no new extension points. All hardening is applied to existing modules and
interfaces. The `StorageProvider` abstraction, the `Normalized_Error` contract, and the
`MIGRATION_STATUS` enum remain the same shaped seams for future work:

- A future `CloudStorageProvider` will benefit from the UUID v4 routing guard automatically.
- A future re-authentication or multi-factor flow will use the same `Normalized_Error`
  contract established in Phase 18.
- The pre-commit hook for credential detection will protect all future commits automatically.
