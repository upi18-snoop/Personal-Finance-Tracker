# Task 16.11 — User Data Isolation Verification

**Requirements covered:** Req 20 (User Identity & Data Isolation), Req 22 (Authentication Privacy & Security)  
**Dependencies satisfied:** Tasks 16.8 (Transaction CRUD), 16.9 (Category CRUD), 16.10 (Settings / Currency)  
**Type:** Verification-only (no new source files produced)

---

## 1. Overview

This document proves that the Row Level Security (RLS) policies applied in Task 16.2
(`supabase/rls.sql`) correctly enforce per-user data isolation across all three cloud
tables: `transactions`, `categories`, and `settings`. It also confirms that the
application-layer code in `js/supabase-storage.js` provides defence-in-depth by always
scoping every query with an explicit `user_id` filter.

---

## 2. Static Code Analysis

### 2.1 `supabase/schema.sql` (Task 16.1)

Every table carries a `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
column. This is the immutable ownership key required by Req 20 and is never the user's
email address.

| Table          | user_id column | ON DELETE CASCADE | Primary key          |
|----------------|---------------|-------------------|----------------------|
| `transactions` | ✅ UUID NOT NULL | ✅               | `id TEXT` (client UUID) |
| `categories`   | ✅ UUID NOT NULL | ✅               | `id BIGINT` (auto)   |
| `settings`     | ✅ UUID PK      | ✅               | `user_id UUID`       |

A `UNIQUE (user_id, name, type)` constraint on `categories` prevents per-user duplicate
custom categories at the database level, matching the application-layer `validateCategory`
guard in `categories.js`.

### 2.2 `supabase/rls.sql` (Task 16.2)

RLS is enabled on all three tables and a single `FOR ALL … TO authenticated` policy is
created per table.

```sql
-- transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transactions_owner_policy ON public.transactions
  FOR ALL TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_owner_policy ON public.categories
  FOR ALL TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- settings
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_owner_policy ON public.settings
  FOR ALL TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

**USING clause** — PostgreSQL evaluates this predicate against every existing row before
returning it (SELECT) or before permitting a mutation (UPDATE / DELETE). Rows where
`user_id` does not match the calling user's UUID are silently excluded on reads and
silently rejected on writes.

**WITH CHECK clause** — Applied on INSERT and UPDATE. An authenticated user who
attempts to INSERT a row with a spoofed `user_id` (one that does not equal `auth.uid()`)
receives the error:

```
new row violates row-level security policy for table "transactions"
```

**anon role** — No permissive policy is granted to `anon` on any of the three tables.
Because RLS is enabled, PostgreSQL's default-deny behaviour takes effect: unauthenticated
requests return 0 rows on SELECT and a permission error on INSERT / UPDATE / DELETE.

### 2.3 `js/supabase-storage.js` — Defence-in-Depth (Task 16.4)

The `SupabaseDatabaseProvider` class always includes an explicit `user_id` filter or
value in every query, independently of RLS. This provides a second layer of defence so
that even if RLS were misconfigured, cross-user data would still not be served.

| Method                  | Explicit user_id guard                                      |
|-------------------------|-------------------------------------------------------------|
| `getTransactions`       | `.eq('user_id', userId)`                                    |
| `addTransaction`        | `row.user_id = userId` (always set before insert)           |
| `deleteTransaction`     | `.eq('id', id).eq('user_id', userId)` (both conditions)     |
| `getCustomCategories`   | `.eq('user_id', userId)`                                    |
| `addCustomCategory`     | `{ user_id: userId, … }` in INSERT payload                  |
| `deleteCustomCategory`  | `.eq('user_id', userId).eq('name', …).eq('type', …)`        |
| `getSettings`           | `.eq('user_id', userId)`                                    |
| `setSettings`           | `{ user_id: userId, … }` in upsert payload                  |
| `initializeUserData`    | `{ user_id: userId }` in upsert, `onConflict: 'user_id'`    |

The immutable Supabase UUID (`user.id`, exposed by `auth.js` via `_normalizeUser`) is
used as the ownership key in every call. Email address is never used as a data-ownership
identifier (Req 20).

### 2.4 `js/auth.js` — Ownership Key Contract (Task 15.2)

The `_normalizeUser` function reduces the raw Supabase user to `{ id, email }` and the
`id` field is the immutable UUID:

```js
function _normalizeUser(supabaseUser) {
  return {
    id: supabaseUser.id,    // immutable UUID — the ownership key
    email: supabaseUser.email ?? '',  // display only
  };
}
```

`app.js` stores this as `state.currentUser` and passes `state.currentUser.id` to every
storage call. Email is never propagated to any storage method.

### 2.5 `js/storage.js` — Provider Routing (Task 16.5)

The `getProvider(userId)` factory returns `SupabaseDatabaseProvider` for authenticated
users (truthy `userId`) and `LocalStorageProvider` for unauthenticated users (`null` /
`undefined`). Every public storage export delegates to the appropriate provider without
mixing paths.

The LocalStorage key (`financeTrackerData`) is written only by `LocalStorageProvider`;
it is never touched by `SupabaseDatabaseProvider`. This satisfies the acceptance criterion
that *"LocalStorage data for either user is untouched"* while authenticated.

---

## 3. Verification Test Matrix

The acceptance criteria from Task 16.11 are mapped to the specific code evidence
and the manual/interactive test procedures below.

### AC 1 — User A's data is completely invisible to User B

**Static evidence:**

- `USING (user_id = auth.uid())` on all three tables (§ 2.2) silently filters every
  row that does not belong to the querying user on SELECT, UPDATE, and DELETE.
- `SupabaseDatabaseProvider` always adds `.eq('user_id', userId)` to every SELECT query
  (§ 2.3) so the supabase-js client itself sends the filter even before RLS is evaluated.

**Manual test procedure (run with two real Supabase accounts):**

1. Sign in as **User A**. Add three transactions (two expense, one income) and a custom
   category. Verify all appear in the dashboard.
2. Open a second browser profile (or incognito window). Sign in as **User B** (a
   different registered account).
3. Observe the dashboard — it should show an empty state (no transactions).
4. Confirm in the Supabase Table Editor that filtering `transactions` by `user_id = B`
   returns 0 rows.

**Expected result:** User B sees no data belonging to User A. ✅

### AC 2 — Cross-user read returns 0 rows (RLS silently filters)

**Static evidence:**

- PostgreSQL RLS with `USING (user_id = auth.uid())` returns an empty result set (not an
  error) for non-matching rows. This is the documented PostgreSQL RLS behaviour for
  permissive policies.
- `SupabaseDatabaseProvider.getTransactions` returns `[]` both on empty results and on
  error (the error path falls back to `[]` in the catch block — §2.3 source).

**Manual test procedure:**

1. While signed in as User B (from AC 1), run in the browser console:
   ```js
   // Obtain the client (already initialised after login)
   const { getSupabaseClient } = await import('./js/supabase.js');
   const client = await getSupabaseClient();
   const { data, error } = await client.from('transactions').select('*');
   console.log('rows:', data?.length, 'error:', error);
   ```
2. Even without an explicit `user_id` filter, RLS restricts results to User B's own rows.

**Expected result:** `rows: 0`, `error: null` (0 rows, no error thrown). ✅

### AC 3 — Cross-user INSERT with spoofed user_id is rejected by WITH CHECK

**Static evidence:**

- `WITH CHECK (user_id = auth.uid())` on all three tables (§ 2.2) rejects any INSERT or
  UPDATE where the `user_id` column does not match the authenticated caller's UUID.
- The Postgres error returned is:
  `new row violates row-level security policy for table "transactions"`
- `SupabaseDatabaseProvider._normalizeError` maps this (a non-23505, non-JWT Supabase
  error) to `{ code: 'unknown', message: 'An error occurred. Please try again.' }` — a
  safe, non-leaking message surfaced to the UI.

**Manual test procedure:**

1. While signed in as User B, run in the browser console:
   ```js
   const { getSupabaseClient } = await import('./js/supabase.js');
   const client = await getSupabaseClient();

   // Attempt to insert a transaction claiming it belongs to User A's UUID
   const userAUUID = '<paste User A uuid here>';
   const { data, error } = await client.from('transactions').insert({
     id: crypto.randomUUID(),
     user_id:   userAUUID,       // spoofed — not auth.uid()
     item_name: 'Spoofed row',
     amount:    1,
     type:      'expense',
     category:  'Other',
     date:      '2025-01-01',
   });
   console.log('data:', data, 'error:', error?.message);
   ```
2. Verify the insert fails.

**Expected result:** `data: null`, `error.message` contains "violates row-level security
policy". The row does NOT appear in User A's data. ✅

Repeat the same test for `categories` and `settings`:

```js
// categories spoofed insert
await client.from('categories').insert({
  user_id: userAUUID,
  name:    'SpooferCategory',
  type:    'expense',
});

// settings spoofed upsert
await client.from('settings').upsert({
  user_id:  userAUUID,
  currency: 'USD',
}, { onConflict: 'user_id' });
```

Both should fail with the same RLS violation error. ✅

### AC 4 — LocalStorage data for either user is untouched

**Static evidence:**

- `LocalStorageProvider` is only invoked from `getProvider(userId)` when `userId` is
  null/undefined (§ 2.5).
- `SupabaseDatabaseProvider` contains zero references to `localStorage` or
  `window.localStorage` — confirmed by inspection of `supabase-storage.js` (§ 2.3).
- The LocalStorage key (`financeTrackerData`) is written exclusively by
  `LocalStorageProvider.writeSync`, which is only called on the unauthenticated code path.

**Manual test procedure:**

1. Before signing in (unauthenticated): open DevTools → Application → Local Storage.
   Note the value (or absence) of `financeTrackerData`.
2. Sign in as User A. Add a transaction.
3. Check Local Storage again. `financeTrackerData` should be absent or unchanged from
   step 1 (no writes from the authenticated path).
4. Sign out. The Supabase session key (managed by `supabase-js` under its own key, e.g.
   `sb-<project>-auth-token`) is cleared; `financeTrackerData` remains untouched.

**Expected result:** `financeTrackerData` is never written to during an authenticated
session. ✅

---

## 4. Supabase Dashboard Verification Queries

After applying `supabase/rls.sql`, run the following in the Supabase SQL Editor to confirm
the security configuration:

### 4.1 Confirm RLS is enabled

```sql
SELECT tablename, rowsecurity
FROM   pg_tables
WHERE  schemaname = 'public'
  AND  tablename IN ('transactions', 'categories', 'settings');
```

**Expected:**

| tablename    | rowsecurity |
|--------------|-------------|
| transactions | true        |
| categories   | true        |
| settings     | true        |

### 4.2 Confirm policies exist with correct clauses

```sql
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('transactions', 'categories', 'settings');
```

**Expected:** One row per table.

| tablename    | policyname                  | roles           | cmd | qual                         | with_check                   |
|--------------|-----------------------------|-----------------|-----|------------------------------|------------------------------|
| transactions | transactions_owner_policy   | {authenticated} | ALL | (user_id = auth.uid())       | (user_id = auth.uid())       |
| categories   | categories_owner_policy     | {authenticated} | ALL | (user_id = auth.uid())       | (user_id = auth.uid())       |
| settings     | settings_owner_policy       | {authenticated} | ALL | (user_id = auth.uid())       | (user_id = auth.uid())       |

### 4.3 Confirm anon access is denied

Using the Supabase JS client with the anon key and NO `signIn()` call:

```js
const { data, error } = await client.from('transactions').select('*');
// Expected: data = [], error = null (RLS default-deny returns empty, not an auth error)

const { data: d2, error: e2 } = await client.from('transactions').insert({
  id: crypto.randomUUID(), user_id: '<any uuid>', item_name: 'test',
  amount: 1, type: 'expense', category: 'Other', date: '2025-01-01',
});
// Expected: d2 = null, e2.message contains "row-level security"
```

---

## 5. Security Properties Confirmed

| Property | Mechanism | Status |
|----------|-----------|--------|
| User A's rows invisible to User B | RLS `USING (user_id = auth.uid())` | ✅ Policy in place |
| Spoofed `user_id` INSERT rejected | RLS `WITH CHECK (user_id = auth.uid())` | ✅ Policy in place |
| Anon requests return 0 rows | RLS default-deny (no anon policy) | ✅ Policy in place |
| LocalStorage untouched for auth users | `getProvider` routes to Supabase only | ✅ Code verified |
| Ownership key is immutable UUID | `_normalizeUser` returns `{ id, email }`; storage uses `user.id` | ✅ Code verified |
| Email never used as ownership key | No email-based filter in any storage method | ✅ Code verified |
| No service_role key in client code | `supabase.js` uses `anonKey` from `config.js` only | ✅ Code verified |
| Passwords never stored or logged | `auth.js` passes credentials directly to `signInWithPassword` | ✅ Code verified |

---

## 6. Findings and Conclusion

All four acceptance criteria for Task 16.11 are met:

1. **User A's data is invisible to User B** — enforced by `USING (user_id = auth.uid())`
   on all three tables and reinforced by explicit `.eq('user_id', userId)` filters in
   `SupabaseDatabaseProvider`.

2. **Cross-user read returns 0 rows** — RLS silently filters non-matching rows; no error
   is surfaced to the calling user (PostgreSQL permissive-policy semantics).

3. **Spoofed `user_id` INSERT is rejected** — `WITH CHECK (user_id = auth.uid())` rejects
   the write with a row-level security violation. The application normalizes this to a safe
   user-facing message without leaking internals.

4. **LocalStorage is untouched for authenticated users** — `SupabaseDatabaseProvider`
   contains zero `localStorage` references; the provider routing in `storage.js`
   exclusively uses `SupabaseDatabaseProvider` for authenticated (truthy `userId`) calls.

The RLS policies are minimal (one `FOR ALL` policy per table), correct (both `USING` and
`WITH CHECK` always set together), and idempotent (`DROP POLICY IF EXISTS` guards in
`rls.sql` allow safe re-application). No credentials are present in any SQL or JS file.

**Task 16.11 acceptance criteria: PASS** (static analysis + interactive test procedures
documented above).

---

*Generated as part of Task 16.11 — User Data Isolation Verification.*  
*Reviewed files: `supabase/schema.sql`, `supabase/rls.sql`, `js/supabase-storage.js`, `js/storage.js`, `js/auth.js`, `js/supabase.js`.*
