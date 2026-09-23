-- =============================================================================
-- Personal Finance Tracker — Phase 16 Row Level Security Policies
-- File: supabase/rls.sql
--
-- Purpose:
--   Enables Row Level Security (RLS) on the three cloud finance tables and
--   creates policies that enforce strict per-user data isolation. Every row
--   can only be seen or mutated by the authenticated user who owns it.
--
-- How to apply:
--   After applying supabase/schema.sql, paste this file into the Supabase SQL
--   Editor (Dashboard → SQL Editor → New query) and run it.
--   Alternatively use the Supabase CLI:
--     supabase db push  (if migrations are set up)
--
-- Security model:
--   ┌───────────────────────────────────────────────────────────────────────┐
--   │  AUTHENTICATED users (role: authenticated)                            │
--   │    Can SELECT / INSERT / UPDATE / DELETE their OWN rows only.         │
--   │    Enforced by: USING (user_id = auth.uid())                          │
--   │                 WITH CHECK (user_id = auth.uid())                     │
--   │                                                                       │
--   │  UNAUTHENTICATED users (role: anon)                                   │
--   │    No permissive policy is granted to anon on any table.              │
--   │    RLS is enabled, so the default-deny behaviour of PostgreSQL rejects │
--   │    ALL anon requests implicitly — no rows are returned and inserts are │
--   │    rejected with a permission error.                                  │
--   │                                                                       │
--   │  USING clause  — filters which existing rows are visible/mutable.     │
--   │  WITH CHECK    — filters which rows can be written (INSERT/UPDATE).   │
--   │  Using both prevents a user from inserting a row with someone else's  │
--   │  user_id (spoofed-ownership attack).                                  │
--   └───────────────────────────────────────────────────────────────────────┘
--
-- Policy naming convention:
--   "<table>_owner_policy"
--   A single FOR ALL policy per table keeps the policy set minimal and easy
--   to audit. Both USING and WITH CHECK are always set together so there is
--   no gap between read isolation and write isolation.
--
-- Dependencies:
--   supabase/schema.sql (Task 16.1) — tables must exist before RLS can be
--   enabled on them.
--
-- Requirements covered:
--   Req 20 — User Identity & Data Isolation: each user's data is private.
--   Req 22 — Authentication Privacy & Security: anon access is denied;
--             spoofed-user_id inserts are rejected by WITH CHECK.
-- =============================================================================


-- =============================================================================
-- TRANSACTIONS TABLE
-- =============================================================================

-- Enable Row Level Security. Once enabled, the table is in default-deny mode:
-- no rows are accessible to any role unless a permissive policy is matched.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Drop the policy first if it already exists (idempotent re-run support).
DROP POLICY IF EXISTS transactions_owner_policy ON public.transactions;

-- Single FOR ALL policy for authenticated users.
--
-- USING (user_id = auth.uid())
--   Postgres evaluates this predicate for every existing row before returning
--   it (SELECT) or before allowing mutation (UPDATE / DELETE). Rows where
--   user_id does not match the calling user's UUID are silently filtered out
--   on reads and rejected on writes.
--
-- WITH CHECK (user_id = auth.uid())
--   Applied on INSERT and UPDATE. Prevents an authenticated user from
--   inserting a row with a user_id that is not their own (spoofed ownership).
--   Combined with USING, this closes the full attack surface.
CREATE POLICY transactions_owner_policy ON public.transactions
  FOR ALL
  TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Verify: no policy is granted to the anon role on this table.
-- Anon requests will receive 0 rows on SELECT and a permission error on
-- INSERT / UPDATE / DELETE — no explicit DENY policy is needed because
-- RLS default-deny handles it once the table has RLS enabled.


-- =============================================================================
-- CATEGORIES TABLE
-- =============================================================================

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_owner_policy ON public.categories;

-- Same ownership pattern as transactions.
-- The UNIQUE (user_id, name, type) constraint in the schema already prevents
-- duplicate custom categories at the database level; RLS enforces that a user
-- can only read/write their own category rows.
CREATE POLICY categories_owner_policy ON public.categories
  FOR ALL
  TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- SETTINGS TABLE
-- =============================================================================

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_owner_policy ON public.settings;

-- Settings uses user_id as its PRIMARY KEY (one row per user), so USING and
-- WITH CHECK still evaluate correctly: user_id = auth.uid() ensures a user
-- can only read or upsert their own settings row.
CREATE POLICY settings_owner_policy ON public.settings
  FOR ALL
  TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- VERIFICATION QUERIES
--
-- Run these after applying the policies to confirm the security configuration.
-- All three checks should return exactly the rows shown in the comments.
--
-- 1. Confirm RLS is enabled on all three tables:
--
--    SELECT tablename, rowsecurity
--    FROM   pg_tables
--    WHERE  schemaname = 'public'
--      AND  tablename IN ('transactions', 'categories', 'settings');
--
--    Expected:
--      tablename     | rowsecurity
--      --------------+------------
--      transactions  | true
--      categories    | true
--      settings      | true
--
-- 2. Confirm the three policies exist:
--
--    SELECT tablename, policyname, roles, cmd, qual, with_check
--    FROM   pg_policies
--    WHERE  schemaname = 'public'
--      AND  tablename IN ('transactions', 'categories', 'settings');
--
--    Expected: one row per table, roles = {authenticated}, cmd = ALL.
--
-- 3. Test user isolation (requires two test Supabase accounts):
--
--    a. Log in as User A via the JS client.
--    b. Insert a transaction row — should succeed (user_id = A's UUID).
--    c. Log in as User B via a second JS client instance.
--    d. SELECT all transactions — should return 0 rows (A's row is filtered).
--    e. Attempt INSERT with user_id set to A's UUID — should be rejected by
--       the WITH CHECK policy (error: "new row violates row-level security
--       policy for table \"transactions\"").
--    f. Test the same for categories and settings.
--
-- 4. Test anon rejection:
--
--    a. Use the Supabase JS client WITHOUT calling signIn() (anon key only).
--    b. SELECT from any of the three tables — should return 0 rows.
--    c. INSERT — should return a permission error.
-- =============================================================================


-- =============================================================================
-- SUMMARY
-- =============================================================================
--
--  Table          RLS    Policy                  Roles          Effect
--  ─────────────────────────────────────────────────────────────────────────
--  transactions   ON     transactions_owner_policy  authenticated  Own rows only
--  categories     ON     categories_owner_policy    authenticated  Own rows only
--  settings       ON     settings_owner_policy      authenticated  Own row only
--
--  anon role: no permissive policy on any table → all requests rejected (RLS default-deny).
--
-- =============================================================================
