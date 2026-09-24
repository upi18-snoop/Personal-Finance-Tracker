/*
 * categories.js — Business logic layer.
 *
 * Single responsibility: category rules — defaults + custom reads, add with
 * duplicate-name prevention and type separation, in-use-guarded delete, and
 * validation helpers.
 *
 * Layer: Business logic. Imports storage.js and utils.js ONLY. Knows nothing
 * about the DOM.
 *
 * =============================================================================
 * Task 16.9 — Category CRUD Verification (PASSED)
 * =============================================================================
 *
 * AC1: Add custom category → row in Supabase `categories` table under correct
 *      `user_id`.
 *   STATUS: PASS
 *   TRACE:  addCategory(name, type, userId)
 *             → validateCategory() [guards blanks and duplicates]
 *             → storage.addCustomCategory(userId, { name: trimmed, type })
 *               [storage.js line: if (userId) → new SupabaseDatabaseProvider()]
 *             → SupabaseDatabaseProvider.addCustomCategory(userId, category)
 *               [supabase-storage.js: inserts { user_id: userId, name, type }
 *                into the `categories` table]
 *   The userId is threaded end-to-end; every insert carries the caller's
 *   Supabase UUID as `user_id`, satisfying per-user ownership (Req 20).
 *
 * AC2: Default categories remain JS constants — NO rows inserted into Supabase.
 *   STATUS: PASS
 *   TRACE:  DEFAULT_EXPENSE_CATEGORIES / DEFAULT_INCOME_CATEGORIES are pure
 *           const arrays in this file (and mirrored in storage.js).
 *           initializeData(userId) → SupabaseDatabaseProvider.initializeUserData
 *             only upserts one row into `settings` (ON CONFLICT DO NOTHING);
 *             it never touches the `categories` table.
 *           _loadFromSupabase() calls getCustomCategories(userId) and then
 *             spreads the JS defaults in front of the returned custom rows in
 *             memory: [...DEFAULT_INCOME_CATEGORIES, ...customIncome].
 *             No default names are ever written to the DB.
 *   Confirmed by schema.sql comment: "Default categories are NOT stored in the
 *   database. They remain JavaScript constants in js/categories.js."
 *
 * AC3: Duplicate category rejected by UNIQUE constraint + application guard.
 *   STATUS: PASS
 *   TRACE (application layer):
 *           validateCategory(name, type, userId)
 *             → getCategories(type, userId) → storage.loadData(userId)
 *               [for Supabase: assembles merged array from DB + JS defaults]
 *             → existing.includes(trimmed) → returns { ok: false, error: 'duplicate' }
 *             → addCategory returns { ok: false, error: 'duplicate' } before
 *               any storage write is attempted.
 *   TRACE (database layer):
 *           schema.sql: CONSTRAINT categories_user_name_type_unique
 *             UNIQUE (user_id, name, type) — rejects any duplicate that
 *             bypasses the application guard.
 *           supabase-storage.js _normalizeError: Postgres error code '23505'
 *             (UNIQUE violation) → { code: 'duplicate', message: '...' }
 *             propagated up as { ok: false, error: { code: 'duplicate' } }.
 *   Both guards are independent and complementary; neither alone is sufficient
 *   for full defence-in-depth.
 *
 * AC4: In-use category cannot be deleted (guard checks cloud transactions).
 *   STATUS: PASS
 *   TRACE:  deleteCategory(name, type, userId)
 *             → isCategoryInUse(name, type, userId)
 *               → storage.getTransactions(userId)
 *                 [storage.js: if (userId) → SupabaseDatabaseProvider
 *                  .getTransactions(userId) — fetches from Supabase `transactions`
 *                  table scoped by user_id]
 *               → list.some(tx => tx.type === type && tx.category === trimmed)
 *             → if in-use: returns { ok: false, error: 'in-use' }
 *               (no storage write, transactions untouched — Req 8.8)
 *   The in-use check reads live cloud data, not a stale local cache, so the
 *   guard is always accurate even across sessions.
 *
 * No gaps found. No code changes required. All four acceptance criteria are
 * satisfied by the implementation already in place across:
 *   - js/categories.js   (this file — business logic guards)
 *   - js/storage.js      (async CRUD facade, provider routing)
 *   - js/supabase-storage.js  (SupabaseDatabaseProvider CRUD methods)
 *   - supabase/schema.sql     (UNIQUE constraint on categories table)
 *   - supabase/rls.sql        (RLS policy: authenticated users own their rows)
 * =============================================================================
 *
 * Async update (task 16.6):
 *   All storage-touching functions are now async and accept an optional userId
 *   parameter (default null). A null userId routes to the LocalStorage path in
 *   storage.js; a truthy userId routes to the Supabase path. The new storage
 *   CRUD API (storage.addCustomCategory, storage.deleteCustomCategory,
 *   storage.getTransactions) is used for persistence.
 *
 *   Pure helpers (_defaults, _isDefault) are unchanged and remain synchronous.
 *
 * Implemented scope (task 8.1, updated task 16.6):
 *   - getCategories(type, userId): reads merged categories from storage.loadData
 *     (which handles the Supabase assembly path internally).
 *   - addCategory(name, type, userId): validates then persists via
 *     storage.addCustomCategory.
 *   - validateCategory(name, type, userId): async because it calls getCategories.
 *   - isCategoryInUse(name, type, userId): reads via storage.getTransactions.
 *   - deleteCategory(name, type, userId): guards defaults + in-use, then calls
 *     storage.deleteCustomCategory.
 */

import * as storage from "./storage.js";
import * as utils from "./utils.js";

/**
 * Default categories per type. These names are considered "built-in" and can
 * never be deleted regardless of whether they appear in the persisted array.
 * Source of truth for the "is this a default?" guard in deleteCategory.
 *
 * NOTE: storage.js also seeds these into the Storage_Schema on first run
 * (initializeData → ensureDefaultCategories), so the persisted categories array
 * will always include them. We keep a local reference here so categories.js can
 * answer "is this a default?" without parsing the schema.
 */
const DEFAULT_EXPENSE_CATEGORIES = [
  "Food",
  "Transport",
  "Fun",
  "Bills",
  "Shopping",
  "Health",
  "Other",
];

const DEFAULT_INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Business",
  "Investment",
  "Gift",
  "Other",
];

/**
 * The map from type to its default list. Kept separate so lookups are O(1)
 * after the initial Set construction.
 */
const DEFAULTS_MAP = {
  income: new Set(DEFAULT_INCOME_CATEGORIES),
  expense: new Set(DEFAULT_EXPENSE_CATEGORIES),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all categories for the given type — defaults merged with persisted
 * custom categories (Req 8.4). Reads the stored schema through the storage
 * layer via storage.loadData; for the Supabase path, storage.loadData assembles
 * the merged categories array internally so the return shape is identical.
 *
 * The persisted categories[type] array already contains both defaults (seeded
 * at start-up by storage.initializeData) and any custom categories the user
 * has added, so this function simply returns that array. If the stored array
 * is somehow absent (corrupt recovery), it falls back to defaults only.
 *
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<string[]>}
 */
export async function getCategories(type, userId = null) {
  const data = await storage.loadData(userId);
  const cats = data.categories && Array.isArray(data.categories[type])
    ? data.categories[type]
    : _defaults(type);
  // Return a copy so callers cannot mutate stored state.
  return [...cats];
}

/**
 * Add a custom category for the given type (Req 8.2, 8.3). Rejects:
 *   - blank / whitespace-only names (error: "invalid")
 *   - names that duplicate an existing category for the same type
 *     (case-sensitive, same comparison used by filterTransactions — error: "duplicate")
 *
 * On success, persists the new category via storage.addCustomCategory. The
 * other type's list is untouched.
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<{ ok: true } | { ok: false, error: "duplicate" | "invalid" }>}
 */
export async function addCategory(name, type, userId = null) {
  const validation = await validateCategory(name, type, userId);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const trimmed = name.trim();
  await storage.addCustomCategory(userId, { name: trimmed, type });

  return { ok: true };
}

/**
 * Delete a custom category for the given type (Req 8.6, 8.7, 8.8).
 *
 * Refuses with:
 *   - error: "default" — if the name is one of the Default_Categories for the type.
 *   - error: "in-use"  — if any stored transaction references this category+type
 *     (Req 8.7); never deletes transactions in this case (Req 8.8).
 *
 * On success, removes the category via storage.deleteCustomCategory. Transactions
 * are NEVER modified or deleted (Req 8.8).
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<{ ok: true } | { ok: false, error: "in-use" | "default" }>}
 */
export async function deleteCategory(name, type, userId = null) {
  const trimmed = typeof name === "string" ? name.trim() : "";

  // Guard: defaults are not deletable (Req 8.6 implicit — only custom categories
  // are deletable). Check against the authoritative DEFAULTS_MAP.
  if (_isDefault(trimmed, type)) {
    return { ok: false, error: "default" };
  }

  // Guard: refuse if any transaction references this category+type (Req 8.7).
  if (await isCategoryInUse(trimmed, type, userId)) {
    return { ok: false, error: "in-use" };
  }

  // Persist the deletion. If the category wasn't there, this is a no-op
  // (idempotent), still return ok:true since there is nothing to delete.
  await storage.deleteCustomCategory(userId, { name: trimmed, type });

  // Transactions are intentionally untouched (Req 8.8).
  return { ok: true };
}

/**
 * Validate a candidate category name for the given type. Called by addCategory
 * and by the UI for inline feedback. Async because it calls getCategories.
 *
 * Returns:
 *   - { ok: true }                      — name is valid and unique for this type.
 *   - { ok: false, error: "invalid" }   — name is blank or whitespace-only.
 *   - { ok: false, error: "duplicate" } — a category with this name (trimmed,
 *     case-sensitive) already exists for this type.
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<{ ok: boolean, error?: "duplicate" | "invalid" }>}
 */
export async function validateCategory(name, type, userId = null) {
  if (utils.isBlank(name)) {
    return { ok: false, error: "invalid" };
  }

  const trimmed = name.trim();
  const existing = await getCategories(type, userId);

  // Case-sensitive duplicate check (category names are stored as-is).
  if (existing.includes(trimmed)) {
    return { ok: false, error: "duplicate" };
  }

  return { ok: true };
}

/**
 * True if any stored transaction has both type === `type` and category === `name`
 * (Req 8.7). Used by deleteCategory and can be called by the UI to give the user
 * an early hint. Reads transactions through the storage layer.
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<boolean>}
 */
export async function isCategoryInUse(name, type, userId = null) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  const transactions = await storage.getTransactions(userId);
  const list = Array.isArray(transactions) ? transactions : [];

  return list.some(
    (tx) => tx && tx.type === type && tx.category === trimmed
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * The default list for a type (returns the raw array, not a copy — callers that
 * need a mutable copy should spread it). Falls back to an empty array for
 * unknown types so the rest of the module handles bad input gracefully.
 * @param {"income"|"expense"} type
 * @returns {string[]}
 */
function _defaults(type) {
  if (type === "income") return DEFAULT_INCOME_CATEGORIES;
  if (type === "expense") return DEFAULT_EXPENSE_CATEGORIES;
  return [];
}

/**
 * True if `name` is a Default_Category for the given `type`. The check is
 * case-sensitive and trims `name` before comparing, matching the storage
 * contract where category names are always trimmed.
 * @param {string} name (already trimmed by caller)
 * @param {"income"|"expense"} type
 * @returns {boolean}
 */
function _isDefault(name, type) {
  const defaults = DEFAULTS_MAP[type];
  return defaults ? defaults.has(name) : false;
}
