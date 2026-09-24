# Requirements Document

## Introduction

Phase 18 hardens the Personal Finance Tracker for production deployment. The application has completed Phases 1–17 (core finance tracking, authentication via Supabase Auth, cloud data storage via Supabase PostgreSQL, and local-to-cloud data migration). Phase 18 adds no new product features and does not redesign the application. Its sole purpose is to verify, document, and fix all security vulnerabilities, state-management weaknesses, data-leakage paths, and configuration risks discovered during a systematic audit of the existing codebase.

The scope of hardening covers eight concern areas: authentication and session handling (`js/auth.js`, `js/app.js`), Supabase client security (`js/config.js`, `js/supabase.js`), Row Level Security and user isolation (`supabase/schema.sql`, `supabase/rls.sql`, `js/supabase-storage.js`), migration security (`js/migration.js`), error handling and data leakage prevention, logout and session-expiration state cleanup, configuration and credential safety, and production security readiness.

All changes are corrective or protective. Nothing in this phase changes the user-visible application behavior for a user following normal flows. After Phase 18 is complete, no further implementation phases are planned — the application is production-ready.

## Glossary

- **App**: The Personal Finance Tracker web application as a whole.
- **Auth_Module**: `js/auth.js` — the provider-neutral authentication service backed by Supabase Auth.
- **Supabase_Client**: The singleton `SupabaseClient` instance created by `js/supabase.js` (`getSupabaseClient()`).
- **Supabase_Config**: The `SUPABASE_CONFIG` object exported from `js/config.js` containing only the public project URL and anon key.
- **Anon_Key**: The Supabase publishable/anon API key that identifies the project to Supabase but carries no database privileges on its own. Safe to commit to a public repository.
- **Service_Role_Key**: The privileged Supabase API key that bypasses all Row Level Security policies. Must NEVER appear in any client-side file.
- **RLS**: Row Level Security — the PostgreSQL mechanism enforced on the `transactions`, `categories`, and `settings` tables to ensure each authenticated user can only access their own rows.
- **Auth_State**: The current authentication context, either signed-in (with a non-null `state.currentUser`) or signed-out (with `state.currentUser === null`).
- **Session**: The JWT-based authentication session managed by Supabase Auth and stored in the browser by `supabase-js`. The App never writes auth session data to `localStorage` manually.
- **Session_Expiry**: The event that occurs when the Supabase JWT expires and is not refreshed, resulting in a signed-out Auth_State.
- **Finance_UI**: The protected finance dashboard sections (`#app-main`) visible only to authenticated users.
- **financeAppInitialized**: The boolean guard flag in `js/app.js` that prevents `initializeFinanceApplication()` from running more than once per page load.
- **Storage_Module**: `js/storage.js` — the only module that reads from or writes to `localStorage` for finance data.
- **Migration_Marker**: The per-user LocalStorage entry stored under `financeTrackerMigration_${userId}` that tracks migration progress.
- **Migration_Module**: `js/migration.js` — the module that implements the local-to-cloud migration path.
- **SupabaseDatabaseProvider**: The class in `js/supabase-storage.js` that issues all Supabase database queries.
- **Error_Boundary**: A try/catch block that catches an error, logs it internally (without leaking sensitive data), and returns a normalized error shape to the caller.
- **Credential**: Any value that grants access to a system, including passwords, API keys, JWTs, service-role keys, database passwords, and SMTP credentials.
- **PII**: Personally Identifiable Information, including email addresses and user IDs when combined with financial data.
- **Normalized_Error**: An error object of shape `{ code: string, message: string }` where `code` is an internal classification and `message` is safe for display in the UI.
- **Security_Finding**: A confirmed security issue, weakness, or misconfiguration discovered during the Phase 18 audit.
- **Production_Checklist**: The document created in task 18.11 that lists every security control the application depends on and its verification status.

---

## Requirements

### Requirement 24: Security Architecture Audit

**User Story:** As a maintainer preparing for production deployment, I want a documented audit of all security-relevant code paths, so that I can confirm the application has no unreviewed security gaps before going live.

#### Acceptance Criteria

1. THE App SHALL be audited against a defined scope covering: credential handling in `js/config.js` and `js/supabase.js`; authentication flows in `js/auth.js`; session lifecycle in `js/app.js`; database ownership and access control in `supabase/schema.sql` and `supabase/rls.sql`; all methods in `js/supabase-storage.js`; migration ownership enforcement in `js/migration.js`; and console/error output in all JS modules.
2. WHEN the audit is complete, THE App SHALL have a documented record of every Security_Finding identified, whether it was fixed or accepted as-is, and the rationale for any accepted risk.
3. THE App SHALL confirm that no Credential of any kind — including passwords, tokens, API keys, database passwords, SMTP credentials, and the Service_Role_Key — appears in any committed file with extensions `.js`, `.html`, `.md`, `.sql`, `.json`, or matching `.env*`, outside of `node_modules`.
4. THE App SHALL confirm that Supabase Auth is the sole authentication mechanism; no manual JWT creation, manual token parsing, or custom session storage is implemented.
5. THE App SHALL confirm that every database query in `js/supabase-storage.js` is scoped by `user_id = userId` in the query predicate as a defence-in-depth measure, independent of RLS.
6. WHEN the audit is complete, THE App SHALL confirm that no JavaScript module writes sensitive data — including credentials, session tokens, or user-identifying values — to the browser console or to unhandled error output visible outside the application.
7. IF any Security_Finding is rated as high severity — meaning it allows unauthorized data access, credential exposure, or authentication bypass — THEN THE App SHALL treat that finding as a blocking issue that must be resolved before deployment rather than accepted as-is.
8. WHEN the audit is complete, THE App SHALL confirm that all RLS policies in `supabase/rls.sql` cover every table that stores user data, with at least SELECT, INSERT, UPDATE, and DELETE operations restricted to the owning user.

### Requirement 25: Authentication Security

**User Story:** As a security-conscious maintainer, I want the authentication module to handle all auth paths safely, so that internal errors are never exposed to users and sessions are managed correctly.

#### Acceptance Criteria

1. WHEN `auth.signUp`, `auth.signIn`, `auth.signOut`, or `auth.resetPassword` produce an error, THE Auth_Module SHALL return only a Normalized_Error to the caller and SHALL NOT include raw Supabase SDK error objects, stack traces, or internal server messages in the returned value.
2. WHEN `auth.getCurrentUser()` is called and no active session exists, THE Auth_Module SHALL return `null` without throwing.
3. WHEN `auth.getCurrentUser()` is called and the Supabase client is not configured (placeholder values in Supabase_Config), THE Auth_Module SHALL return `null` without throwing.
4. WHEN `auth.onAuthStateChange` receives a `SIGNED_OUT` event or a `SESSION_EXPIRED` event, THE Auth_Module SHALL invoke the registered callback with `(event, null)` so that `js/app.js` can transition to the signed-out state.
5. THE Auth_Module SHALL NOT store, log, or return any password value at any point in any code path.
6. THE Auth_Module SHALL NOT log authentication tokens (JWTs) to the browser console at any point.
7. WHEN the Supabase client is not configured, THE Auth_Module SHALL return a Normalized_Error with code `'not-configured'` from all mutating functions (`signUp`, `signIn`, `signOut`, `resetPassword`) rather than throwing.
8. IF `auth.onAuthStateChange` is called before the Supabase client has resolved, THE Auth_Module SHALL fire the callback with `('INITIAL_SESSION', null)` via `queueMicrotask` so the application bootstrap does not hang.
9. A Normalized_Error returned by THE Auth_Module SHALL be a plain object with exactly two fields: `code` (a string of at most 50 characters containing only the error classification, no raw SDK content) and `message` (a string of at most 200 characters that is safe for display to the user and contains no raw SDK error text, JWT, or token content).
10. WHEN `auth.signOut` produces an error, THE Auth_Module SHALL return only a Normalized_Error to the caller and SHALL NOT include raw Supabase SDK error objects, stack traces, or internal server messages in the returned value.
11. WHEN `auth.signUp` is called, THE Auth_Module SHALL validate on the client side that the email conforms to a valid email format and that the password is at least 8 characters long before issuing any network request; IF validation fails, THE Auth_Module SHALL return a Normalized_Error with code `'validation-error'` without making a network call.

### Requirement 26: Session Lifecycle Hardening

**User Story:** As a maintainer, I want the session lifecycle to be hardened so that stale user data cannot persist between sessions and user state cannot cross user-account boundaries.

#### Acceptance Criteria

1. WHEN a user signs out, THE App SHALL set `state.currentUser` to `null` first, then hide the Finance_UI (`#app-main`), then reset `financeAppInitialized` to `false`, in that order, before any other session teardown action takes effect.
2. WHEN a user signs out, THE App SHALL hide the Finance_UI (`#app-main`) immediately after `state.currentUser` is set to `null`.
3. WHEN a user signs out, THE App SHALL reset `financeAppInitialized` to `false` so that a subsequent login by any user triggers a full re-initialization of the finance application with fresh data.
4. WHEN a `SESSION_EXPIRY` event is received via `auth.onAuthStateChange`, THE App SHALL set `state.currentUser` to `null`, hide the Finance_UI (`#app-main`), and reset `financeAppInitialized` to `false`, in that order, before any other session teardown action takes effect.
5. WHEN User A signs out and User B signs in within the same browser tab, THE App SHALL initialize the Finance_UI exclusively with transaction records, category records, and per-user settings belonging to User B; no transaction record, category record, per-user setting, or per-user storage-version marker belonging to User A SHALL be rendered in any Finance_UI panel or chart.
6. WHILE `state.currentUser` is `null`, THE App SHALL return without executing any Supabase database read or write operation when any storage provider method is invoked.
7. WHEN `auth.onAuthStateChange` fires a `SIGNED_IN` event and `financeAppInitialized` is already `true`, THE App SHALL NOT call `initializeFinanceApplication()` a second time for the current authenticated session.

### Requirement 27: Supabase Client and Configuration Security

**User Story:** As a maintainer, I want to confirm that the Supabase client uses only the publishable anon key and that no privileged credentials ever appear in the codebase.

#### Acceptance Criteria

1. THE Supabase_Config SHALL contain only the public project URL and the Anon_Key; the Service_Role_Key, database password, JWT secret, and any other privileged credential SHALL NOT appear in `js/config.js` or any other committed file with extensions `.js`, `.html`, `.md`, `.sql`, `.json`, or matching `.env*`, outside of `node_modules`.
2. THE App SHALL use a single Supabase_Client singleton across all modules; no module other than `js/supabase.js` SHALL call `createClient()` to instantiate a Supabase client directly.
3. WHEN `getSupabaseClient()` is called and `SUPABASE_CONFIG.url` or `SUPABASE_CONFIG.anonKey` contain a placeholder string, an empty string, or a whitespace-only string, THE App SHALL return `null` without attempting to create a client; WHEN `getSupabaseClient()` is called after a client has already been created successfully, THE App SHALL return the existing client without creating a new one.
4. WHEN `getSupabaseClient()` fails to load the `supabase-js` CDN module (e.g. network error), THE App SHALL return `null` and log only a static safe error message that does not include any substring of `SUPABASE_CONFIG.url` or `SUPABASE_CONFIG.anonKey`.
5. THE repository SHALL NOT contain any file (outside `node_modules`) with extensions `.js`, `.html`, `.md`, `.sql`, `.json`, or matching `.env*` that contains any of the strings `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `supabase_admin`, `service_role_key`, `postgres://`, `postgresql://`; or a string beginning with `eyJ` that exceeds 200 characters in length, which is the pattern of an active Supabase service-role JWT.

### Requirement 28: Row Level Security and Multi-User Isolation

**User Story:** As a maintainer, I want to confirm that every table storing user data enforces strict per-user Row Level Security, so that no user can ever read or write another user's financial records.

#### Acceptance Criteria

1. THE `transactions`, `categories`, and `settings` tables in Supabase SHALL each have Row Level Security enabled, verifiable by querying `pg_tables` and confirming `rowsecurity = true` for all three tables.
2. EACH of the three tables SHALL have exactly one RLS policy scoped to the `authenticated` role with `FOR ALL` operations, a `USING` predicate of `user_id = auth.uid()`, and a `WITH CHECK` predicate of `user_id = auth.uid()`; no additional permissive policies SHALL exist on those tables for that role.
3. THE `anon` Supabase role SHALL have no permissive RLS policy on any of the three tables, such that any request arriving without a valid JWT receives an empty result set for SELECT and a rejection error for INSERT, UPDATE, and DELETE rather than accessing any row.
4. EVERY INSERT and UPDATE operation in `js/supabase-storage.js` SHALL include an explicit `user_id` field in the row payload set to the currently authenticated user's UUID, independently of RLS enforcement.
5. WHEN a verified two-user isolation test is performed — User A authenticates and inserts at least one record into each of the three tables, then User B authenticates with a distinct account and issues a SELECT against those same tables — THE system SHALL return zero rows belonging to User A in every result set returned to User B.
6. WHEN an authenticated user submits an INSERT request with a `user_id` value set to a UUID belonging to a different authenticated user, THE Supabase RLS `WITH CHECK` policy SHALL reject the insert and return an error indicating a policy violation, and no row SHALL be written to the database.
7. IF RLS has not been enabled on a table at the time a data-access request is made, THEN THE system SHALL deny all access to that table by default, consistent with Supabase's default-deny behaviour when RLS is off for a non-superuser role.

### Requirement 29: Storage Provider Security

**User Story:** As a maintainer, I want to confirm that the storage layer enforces correct provider routing so that unauthenticated access never reaches Supabase and authenticated users cannot access each other's data through the storage API.

#### Acceptance Criteria

1. WHEN `userId` is `null`, `undefined`, or a string containing only whitespace characters in any `storage.js` exported function, THE Storage_Module SHALL route the call to `LocalStorageProvider` and SHALL NOT invoke any method on the Supabase client instance.
2. WHEN `userId` is a non-empty, non-whitespace string in any `storage.js` exported function, THE Storage_Module SHALL route the call to `SupabaseDatabaseProvider` and SHALL NOT read from or write to the `STORAGE_KEY` (`"financeTrackerData"`) `localStorage` key.
3. THE Storage_Module SHALL NOT accept `userId` values from any untrusted source including URL parameters, query strings, user-editable form fields, or `localStorage` values. The `userId` passed to storage functions SHALL always originate from `state.currentUser.id` as set by the `auth.onAuthStateChange` callback in `js/app.js`.
4. THE `SupabaseDatabaseProvider` SHALL use email address as a read-only display or lookup field only; email SHALL NOT serve as the value stored in a user ownership or data-scoping field used to filter, insert, or update records in any database operation.
5. IF `getSupabaseClient()` returns `null` (not configured or CDN failure), THEN `SupabaseDatabaseProvider` read methods SHALL return an empty array for list operations or `null` for single-object operations without throwing, and write methods SHALL return an object with `ok` set to `false` and an error field indicating the client is not configured, without throwing.
6. IF `userId` is a non-empty, non-whitespace string that does not match the UUID v4 format (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`), THEN THE Storage_Module SHALL route the call to `LocalStorageProvider` and SHALL NOT invoke any method on the Supabase client instance.

### Requirement 30: Migration Security

**User Story:** As a maintainer, I want to confirm that the migration module enforces authenticated-user ownership throughout, so that local data can only be migrated to the account of the currently authenticated user and migration markers cannot be spoofed.

#### Acceptance Criteria

1. WHEN `startMigration`, `retryMigration`, `migrateCategoriesStep`, `migrateSettingsStep`, `verifyMigration`, or `clearLocalFinanceData` is called with a `userId` that is `null`, `undefined`, or an empty string, THE Migration_Module SHALL return an object of shape `{ ok: false, error: { code: 'unauthenticated', message: '…' } }` without reading from or writing to Supabase.
2. THE Migration_Module SHALL use only `state.currentUser.id` (the immutable Supabase UUID provided by `auth.onAuthStateChange`) as the `userId` argument; email address SHALL NOT be used as a `userId` in any migration function call or Migration_Marker key.
3. THE Migration_Marker key stored in `localStorage` SHALL follow the pattern `financeTrackerMigration_${userId}` where `userId` is the Supabase UUID; no migration marker key SHALL contain an email address, username, or any other identifier.
4. WHEN `clearLocalFinanceData(userId)` is called, THE Migration_Module SHALL remove only the `STORAGE_KEY` (`"financeTrackerData"`) from `localStorage`; when `localStorage.getItem('financeTrackerMigration_' + userId)` is called immediately after, it SHALL return the same value it held before `clearLocalFinanceData` was invoked.
5. THE Migration_Module SHALL NOT write to the `STORAGE_KEY` (`"financeTrackerData"`) `localStorage` key at any point; all writes made by the migration module SHALL target only the Migration_Marker key for the authenticated user.
6. WHEN any migration upload call encounters a network error or HTTP error response (status ≥ 400), THE Migration_Module SHALL stop further upload attempts, set the migration marker status to `'partial'`, and preserve all original LocalStorage finance data intact — where "intact" means that `localStorage.getItem(STORAGE_KEY)` returns the same byte-for-byte value as before the migration attempt began.

### Requirement 31: Error Handling and Data Leakage Prevention

**User Story:** As a maintainer, I want to confirm that no sensitive data — passwords, tokens, user IDs in combination with financial data, or Supabase internals — is leaked through console output, error messages surfaced to users, or thrown errors.

#### Acceptance Criteria

1. THE App SHALL NOT log any password value to `console.log`, `console.error`, `console.warn`, `console.debug`, or `console.info` in any module.
2. THE App SHALL NOT log any authentication token (JWT) to any console method in any module.
3. THE App SHALL NOT log the Supabase project URL, anon key, API key, or service role key to any console method in any module.
4. WHEN a Supabase SDK error occurs in `js/supabase-storage.js`, THE App SHALL log only the error's `code` field to `console.error`; the logged message SHALL NOT include the full SDK error message, SQL state, stack trace, or any field other than `code`; and THE App SHALL return to the caller only a Normalized_Error with two fields: `message` containing a static, user-safe string (not copied from the SDK error) and `code` copied from the SDK error's code field with no other SDK fields included.
5. WHEN an error is surfaced to the user through a DOM element (error panel, `role="alert"`, inline validation message), the displayed text SHALL NOT include raw Supabase error messages, stack traces, SQL state codes, or database column names.
6. WHEN `window.confirm` is used for destructive confirmations (transaction delete, clear local data), the confirmation message SHALL NOT include any transaction amount, category name, user ID, or email address.
7. THE App SHALL NOT contain any call to `console.log` that outputs a transaction object, category list, settings object, or financial total in committed source files; the presence of such a call in any committed `.js` file is a violation regardless of whether the code path is reachable at runtime.
8. WHEN an unhandled promise rejection or uncaught exception is caught by `window.onunhandledrejection` or `window.onerror`, THE App SHALL NOT surface raw error details — including stack traces, error messages, or object dumps — to the user through any DOM element or `alert()` call.

### Requirement 32: Logout and State Cleanup

**User Story:** As a maintainer, I want logout and session-expiry to fully clean up all in-memory application state, so that a subsequent user on the same browser tab starts from a completely fresh state.

#### Acceptance Criteria

1. WHEN `onLogout()` is called in `js/app.js`, THE App SHALL call `auth.signOut()`, set `state.currentUser` to `null`, hide the Finance_UI, reset `financeAppInitialized` to `false`, and show the login view — in that order.
2. WHEN the migration modal is open at the time of logout or session expiry, THE App SHALL close the migration modal before completing the signed-out state transition.
3. WHEN `state.currentUser` is `null`, THE App SHALL NOT render any transaction, category, setting, or financial total in the Finance_UI, regardless of what remains in the DOM from a previous session.
4. WHEN a new user signs in after a prior user's session has ended, the Finance_UI SHALL be populated exclusively from the new user's data fetched from their Supabase account (or from their own LocalStorage data for the unauthenticated case).
5. IF `auth.signOut()` returns an error, THEN THE App SHALL still set `state.currentUser` to `null`, hide the Finance_UI, reset `financeAppInitialized` to `false`, and show the login view, so that a failed sign-out does not leave the App in a partially-authenticated state.
6. WHEN `onLogout()` completes, THE App SHALL clear all Finance_UI DOM content — including any previously rendered transaction lists, chart canvases, category lists, report summaries, and balance totals — so that no prior user's data remains visible to a subsequent user in the same browser tab.

### Requirement 33: Configuration and Credential Safety

**User Story:** As a maintainer, I want the repository to be verifiably free of all privileged credentials and to have documented guidance for safely configuring production deployments.

#### Acceptance Criteria

1. THE repository SHALL NOT contain any value for the Supabase Service_Role_Key in any file including `.env`, `.env.example`, configuration files, SQL files, JS files, HTML files, and documentation files.
2. THE `js/config.js` file SHALL contain only the placeholder strings `'YOUR_SUPABASE_PROJECT_URL'` and `'YOUR_SUPABASE_ANON_KEY'` (or real Supabase anon key values) and no credential other than the anon key.
3. THE `.gitignore` file SHALL include entries preventing accidental commit of `.env`, `.env.local`, `.env.production`, and any file matching `*.key` or `*.pem`.
4. THE README SHALL include a "Security" or "Production Configuration" section that explicitly states: the Service_Role_Key must never appear in the codebase; the anon key is public and safe to commit; RLS must be enabled before going live; and the steps to rotate the anon key if it is accidentally exposed.
5. WHERE `js/config.js` contains placeholder values (not yet configured), THE App SHALL remain functional for the LocalStorage-only path (Phase 1–14 features) without throwing any JavaScript errors or uncaught exceptions; only Supabase-dependent features SHALL be degraded by displaying a user-visible notice that cloud sync is unavailable.
6. WHEN a file is added to the repository that contains a string matching the pattern of a Supabase Service_Role_Key (a JWT with role claim equal to `service_role`), THE repository pre-commit hook SHALL reject the commit and display an error message indicating that a privileged credential was detected.

### Requirement 34: Production Security Readiness

**User Story:** As a maintainer deploying to production, I want a verified production security checklist and a final security report, so that I can confirm every security control is in place before accepting live traffic.

#### Acceptance Criteria

1. THE App SHALL produce a Production_Checklist document stored in the repository root as `PRODUCTION_CHECKLIST.md`, covering at minimum the following eight items: Supabase RLS enabled on all three tables; no Service_Role_Key present in any committed file; `js/config.js` configured with a non-placeholder project URL and Anon_Key; Supabase email confirmation enabled; Supabase Auth JWT expiry configured to a value between 1 and 43200 minutes; HTTPS-only deployment confirmed; `README.md` updated with Phase 18 notes; all Security_Findings from the audit either marked fixed or accompanied by an accepted-risk rationale of at least one sentence.
2. EACH item in the Production_Checklist SHALL carry exactly one of the status labels: `PASS`, `FAIL`, `NEEDS MANUAL VERIFICATION`, or `NOT CONFIGURED`; no item SHALL be left without a status label, and no status label other than these four SHALL appear.
3. WHEN the Production_Checklist is finalized, THE App SHALL contain zero items carrying the `FAIL` status; any item found with `FAIL` status during the audit SHALL be resolved and its status updated to `PASS` or `NEEDS MANUAL VERIFICATION` before the checklist document is committed.
4. THE Phase 18 final report SHALL be stored in the repository as `PHASE18_REPORT.md` and SHALL document: every task completed in the range 18.1–18.12 identified by task number and title; every file changed with the change described in one sentence; every Security_Finding identified by a unique ID and severity; every fix applied referencing the Security_Finding ID it addresses; every automated test performed with a pass/fail result; all manual tests still required listed with the verification step; and all production configuration steps still required listed with the responsible party.
5. WHEN the Phase 18 changes are applied, THE App SHALL pass every test case in the Phase 1–17 manual test matrix while the user is authenticated, with zero test cases returning a result other than `PASS` or `SKIP`; any test case returning a result other than `PASS` or `SKIP` SHALL be treated as a regression and SHALL block finalization of the Production_Checklist.
6. THE App SHALL NOT introduce any new user-visible features, new UI elements, new API endpoints, or new product behaviors as part of Phase 18; IF a code change introduced during Phase 18 produces any observable difference in application behavior beyond correcting a security defect or updating documentation, THEN THE App SHALL revert that change before the Production_Checklist is finalized.

---

## Requirement Coverage Matrix (Phase 18)

| Requirement | Description                              | Task(s)        | Status          |
|-------------|------------------------------------------|----------------|-----------------|
| 24          | Security Architecture Audit              | 18.1           | Not implemented |
| 25          | Authentication Security                  | 18.2           | Not implemented |
| 26          | Session Lifecycle Hardening              | 18.3           | Not implemented |
| 27          | Supabase Client & Configuration Security | 18.4           | Not implemented |
| 28          | RLS & Multi-User Isolation               | 18.5           | Not implemented |
| 29          | Storage Provider Security                | 18.6           | Not implemented |
| 30          | Migration Security                       | 18.7           | Not implemented |
| 31          | Error Handling & Data Leakage Prevention | 18.8           | Not implemented |
| 32          | Logout & State Cleanup                   | 18.9           | Not implemented |
| 33          | Configuration & Credential Safety        | 18.4, 18.11    | Not implemented |
| 34          | Production Security Readiness            | 18.10–18.12    | Not implemented |

> **Scope boundary:** Requirements 24–34 are additive to Requirements 1–23 (Phases 1–17). No Requirement 1–23 acceptance criterion is modified or removed by Phase 18. Phase 18 is the final implementation phase; no Phase 19 is planned.
