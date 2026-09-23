-- =============================================================================
-- Personal Finance Tracker — Phase 16 Cloud Database Schema
-- File: supabase/schema.sql
--
-- Purpose:
--   Defines the three PostgreSQL tables that store per-user finance data in
--   Supabase for authenticated users. This schema is the single source of truth
--   for the cloud database structure introduced in Phase 16.
--
-- How to apply:
--   Paste the contents of this file into the Supabase SQL Editor
--   (Dashboard → SQL Editor → New query) and run it.
--   Alternatively use the Supabase CLI:
--     supabase db push  (if migrations are set up)
--
-- Scope of this file:
--   - Table definitions, constraints, and indexes ONLY.
--   - Row Level Security (RLS) policies are intentionally NOT included here.
--     RLS is implemented separately in supabase/rls.sql (Task 16.2).
--   - Default categories are NOT stored in the database. They remain JavaScript
--     constants in js/categories.js (DEFAULT_EXPENSE_CATEGORIES /
--     DEFAULT_INCOME_CATEGORIES). Only user-created custom categories have rows.
--
-- Ownership model:
--   Every finance record is owned by a single authenticated Supabase user via
--   the user_id column, which references auth.users(id). The immutable Supabase
--   UUID (user.id from auth.js) is the ownership key — never the email address.
--   ON DELETE CASCADE ensures all finance data is removed when an auth account
--   is permanently deleted.
--
-- JavaScript ↔ PostgreSQL field mapping (implemented later in Task 16.4):
--   JS: transaction.itemName   ↔  DB: transactions.item_name
--   JS: transaction.createdAt  ↔  DB: transactions.created_at
--   JS: transaction.updatedAt  ↔  DB: transactions.updated_at
--   All other field names are identical between JavaScript and PostgreSQL.
--   The SupabaseDatabaseProvider (Task 16.4) is responsible for this mapping.
--
-- RLS status: NOT ENABLED. Task 16.2 will enable RLS and create policies.
-- =============================================================================


-- =============================================================================
-- TABLE: transactions
--
-- Stores all income and expense transactions for authenticated users.
--
-- Key design decisions:
--   id TEXT PRIMARY KEY
--     Preserved as TEXT to match the existing crypto.randomUUID()-generated
--     UUIDs that the JavaScript application already produces. Using a DB-
--     generated BIGSERIAL or UUID would break the current ID contract and
--     require changes to the insert path. The existing UUIDs are well-formed
--     and globally unique; TEXT gives us the flexibility to accept them as-is.
--
--   amount NUMERIC NOT NULL CHECK (amount > 0)
--     NUMERIC (arbitrary precision) is used instead of FLOAT or DOUBLE to
--     avoid floating-point rounding errors in financial calculations. The
--     CHECK constraint mirrors the application-layer validation in
--     transactions.js (normalizeAmount — rejects values <= 0 and NaN).
--
--   type TEXT NOT NULL CHECK (type IN ('income', 'expense'))
--     Mirrors the TRANSACTION_TYPES = ["income", "expense"] whitelist in
--     transactions.js. A future enum type is possible but TEXT + CHECK is
--     simpler to migrate and equally safe.
--
--   date DATE NOT NULL
--     Stored as PostgreSQL DATE ("YYYY-MM-DD") matching the format validated
--     by utils.isValidDate() and stored in the current LocalStorage schema.
--
--   created_at / updated_at TIMESTAMPTZ
--     Both default to NOW(). The application sets created_at on the client
--     at transaction creation time (new Date().toISOString()); the DB default
--     is the safety net. updated_at is included for future use (e.g. edit
--     transactions); no trigger is required for Phase 16 because transactions
--     are immutable after creation in the current application.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_name   TEXT        NOT NULL,
  amount      NUMERIC     NOT NULL CHECK (amount > 0),
  type        TEXT        NOT NULL CHECK (type IN ('income', 'expense')),
  category    TEXT        NOT NULL,
  date        DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT  transactions_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE  public.transactions                IS 'Per-user income and expense transactions. Owned via user_id → auth.users(id).';
COMMENT ON COLUMN public.transactions.id             IS 'Client-generated UUID string (crypto.randomUUID()). Preserved as TEXT to match the JS transaction model.';
COMMENT ON COLUMN public.transactions.user_id        IS 'Immutable Supabase user UUID. Ownership key. Never the email address.';
COMMENT ON COLUMN public.transactions.item_name      IS 'Transaction description. JS field: itemName.';
COMMENT ON COLUMN public.transactions.amount         IS 'Positive transaction amount. NUMERIC for financial precision. JS validates > 0 before insert.';
COMMENT ON COLUMN public.transactions.type           IS 'Transaction classification: income or expense only.';
COMMENT ON COLUMN public.transactions.category       IS 'Category name. References a default or custom category name. No FK — category names are soft references.';
COMMENT ON COLUMN public.transactions.date           IS 'Transaction date (YYYY-MM-DD). Stored as DATE. JS field: date.';
COMMENT ON COLUMN public.transactions.created_at     IS 'Client-set ISO timestamp at creation. JS field: createdAt.';
COMMENT ON COLUMN public.transactions.updated_at     IS 'Last update timestamp. Unused in Phase 16 (transactions are immutable). Reserved for future edit support.';


-- =============================================================================
-- TABLE: categories
--
-- Stores user-created custom categories ONLY.
--
-- Key design decisions:
--   Default categories (Food, Transport, Fun, Bills, Shopping, Health, Other
--   for expense; Salary, Freelance, Business, Investment, Gift, Other for
--   income) are JavaScript constants in js/categories.js and do NOT have rows
--   in this table. This matches the current architecture: categories.js merges
--   the JS defaults with whatever is stored, so the DB only needs to hold the
--   custom additions.
--
--   id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY
--     A simple auto-increment surrogate key for the category row. The
--     application does not expose category IDs; it operates on (name, type)
--     pairs. GENERATED BY DEFAULT AS IDENTITY allows explicit IDs if needed
--     during migration (Task 17).
--
--   UNIQUE (user_id, name, type)
--     Enforces the same duplicate-prevention rule as validateCategory() in
--     categories.js: a user cannot have two categories with the same name and
--     type. The unique constraint also makes the (user_id, name, type) triple
--     the effective natural key for lookups and deletes.
--
--   updated_at TIMESTAMPTZ
--     Included for symmetry and future use. Not updated automatically in
--     Phase 16 (categories are add/delete only in the current application).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id          BIGINT      GENERATED BY DEFAULT AS IDENTITY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('income', 'expense')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT  categories_pkey         PRIMARY KEY (id),
  CONSTRAINT  categories_user_name_type_unique UNIQUE (user_id, name, type)
);

COMMENT ON TABLE  public.categories             IS 'User-created custom categories only. Default categories remain JS constants in categories.js and are NOT stored here.';
COMMENT ON COLUMN public.categories.id          IS 'Surrogate auto-increment key. The application operates on (user_id, name, type) — this id is internal.';
COMMENT ON COLUMN public.categories.user_id     IS 'Immutable Supabase user UUID. Ownership key.';
COMMENT ON COLUMN public.categories.name        IS 'Category name as entered by the user. Trimmed before storage (mirrors categories.js addCategory behavior).';
COMMENT ON COLUMN public.categories.type        IS 'Category type: income or expense. Matches the Transaction_Type it applies to.';
COMMENT ON COLUMN public.categories.created_at  IS 'Row creation timestamp.';
COMMENT ON COLUMN public.categories.updated_at  IS 'Last update timestamp. Reserved for future use.';


-- =============================================================================
-- TABLE: settings
--
-- Stores per-user application settings. One row per authenticated user.
--
-- Key design decisions:
--   user_id UUID PRIMARY KEY
--     The user is both the primary key and the owner. There is exactly one
--     settings row per user; INSERT ... ON CONFLICT (user_id) DO UPDATE is
--     the safe upsert pattern for first-login initialization (Task 16.4).
--
--   currency TEXT NOT NULL DEFAULT 'IDR'
--     Stores the ISO 4217 currency code selected by the user (Req 18).
--     Defaults to 'IDR' matching the application default in storage.js
--     (getCurrency() falls back to "IDR" when absent or invalid).
--     Validation against SUPPORTED_CURRENCIES (the 14-code set in utils.js)
--     remains an application-layer concern; no FK or CHECK to a currencies
--     table is added here because the supported set may evolve and is already
--     authoritative in JS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.settings (
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency    TEXT        NOT NULL DEFAULT 'IDR',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT  settings_pkey PRIMARY KEY (user_id)
);

COMMENT ON TABLE  public.settings              IS 'Per-user application settings. One row per authenticated user, created on first login.';
COMMENT ON COLUMN public.settings.user_id      IS 'Immutable Supabase user UUID. Primary key and ownership key. One row per user.';
COMMENT ON COLUMN public.settings.currency     IS 'ISO 4217 currency code selected by the user. Validated against SUPPORTED_CURRENCIES in the application layer. Defaults to IDR.';
COMMENT ON COLUMN public.settings.created_at   IS 'Row creation timestamp (first login).';
COMMENT ON COLUMN public.settings.updated_at   IS 'Last settings update timestamp.';


-- =============================================================================
-- INDEXES
--
-- Index rationale:
--
--   idx_transactions_user_id
--     The most common query pattern in Phase 16: "load all transactions for
--     the current user" → SELECT * FROM transactions WHERE user_id = $1.
--     Without this index Postgres would perform a full sequential scan of the
--     transactions table. As a user's transaction count grows (the design
--     targets several thousand, per Req 16.3), this scan becomes increasingly
--     expensive. A B-tree index on user_id brings the scan to O(log N + k)
--     where k is the user's transaction count.
--
--   idx_transactions_user_date
--     Supports month-scoped queries: "transactions for user in month YYYY-MM"
--     → WHERE user_id = $1 AND date >= $2 AND date < $3.
--     This compound index covers both the user_id filter and the date range
--     in one index scan, avoiding a secondary filter pass over all of the
--     user's transactions. The column order (user_id first, then date) matches
--     the query pattern: user_id is always the leading equality predicate and
--     date is the range predicate. This index also satisfies ORDER BY date
--     queries without an additional sort step.
--
--   idx_categories_user_id
--     The UNIQUE (user_id, name, type) constraint already creates an implicit
--     index on (user_id, name, type). Queries of the form
--     SELECT * FROM categories WHERE user_id = $1 will use that existing
--     unique index since user_id is its leading column. A separate index on
--     user_id alone would be redundant and is therefore NOT created.
--
--   No index on settings.user_id:
--     settings.user_id is the PRIMARY KEY, which Postgres automatically
--     indexes. No additional index is needed.
-- =============================================================================

-- Supports: SELECT * FROM transactions WHERE user_id = $1
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON public.transactions(user_id);

-- Supports: WHERE user_id = $1 AND date >= $2 AND date < $3  (month-scoped reads)
--           ORDER BY user_id, date  (recent-transactions sort)
CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON public.transactions(user_id, date);

-- idx_categories_user_id is intentionally omitted:
-- The UNIQUE (user_id, name, type) constraint creates an implicit index whose
-- leading column is user_id. That index satisfies WHERE user_id = $1 queries.
-- A redundant standalone index would waste storage and slow down writes.


-- =============================================================================
-- SCHEMA SUMMARY
-- =============================================================================
--
--  Table          Rows represent          Owned by        Primary key
--  ─────────────────────────────────────────────────────────────────────────
--  transactions   One income/expense tx   user_id → auth  id TEXT (client UUID)
--  categories     One custom category     user_id → auth  id BIGINT (auto)
--  settings       User preferences        user_id → auth  user_id UUID
--
--  All tables:  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
--
-- =============================================================================
--
--  JavaScript ↔ PostgreSQL field mapping (for SupabaseDatabaseProvider Task 16.4)
--
--  JavaScript (camelCase)    PostgreSQL (snake_case)    Notes
--  ────────────────────────────────────────────────────────────────────────────
--  transaction.id            transactions.id            Same value; TEXT on both sides
--  transaction.itemName      transactions.item_name     camelCase → snake_case
--  transaction.amount        transactions.amount        JS number → NUMERIC
--  transaction.type          transactions.type          'income'|'expense' on both
--  transaction.category      transactions.category      TEXT on both sides
--  transaction.date          transactions.date          JS 'YYYY-MM-DD' → DATE
--  transaction.createdAt     transactions.created_at    camelCase → snake_case
--  (no JS field)             transactions.updated_at    DB-only; not exposed in JS yet
--  (no JS field)             transactions.user_id       Added by provider; not in JS model
--
-- =============================================================================
--
--  RLS STATUS: NOT ENABLED
--  Row Level Security policies will be created in Task 16.2 (supabase/rls.sql).
--  Until RLS is enabled, access control is enforced only at the application layer.
--  DO NOT expose these tables to public/anon access before Task 16.2 is complete.
--
-- =============================================================================
