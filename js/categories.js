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
 * Implemented scope (task 8.1):
 *   - getCategories(type): merges default + persisted custom categories for
 *     the type (Req 8.4). Reads from storage via loadData; returns every
 *     category name in their stored order (defaults first, then custom).
 *   - addCategory(name, type): validates name (non-blank, no per-type duplicate)
 *     (Req 8.2); on success appends the name to data.categories[type] and
 *     persists the schema via storage.saveData (Req 8.3). Never adds to the
 *     other type's list.
 *   - validateCategory(name, type): pure helper used by addCategory and the UI
 *     for inline validation feedback.
 *   - isCategoryInUse(name, type): checks the stored transaction set for any
 *     transaction whose type AND category match (Req 8.7). Used by deleteCategory
 *     and available to the UI.
 *   - deleteCategory(name, type): guards that the category is not a default and
 *     not in use (Req 8.6, 8.7); removes it from data.categories[type] and
 *     persists on success. NEVER touches transactions (Req 8.8).
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
 * layer; never touches localStorage directly.
 *
 * The persisted categories[type] array already contains both defaults (seeded
 * at start-up by storage.initializeData) and any custom categories the user
 * has added, so this function simply returns that array. If the stored array
 * is somehow absent (corrupt recovery), it falls back to defaults only.
 *
 * @param {"income"|"expense"} type
 * @returns {string[]}
 */
export function getCategories(type) {
  const data = storage.loadData();
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
 * On success, appends the trimmed name to data.categories[type] and persists
 * the updated schema via storage.saveData. The other type's list is untouched.
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: true } | { ok: false, error: "duplicate" | "invalid" }}
 */
export function addCategory(name, type) {
  const validation = validateCategory(name, type);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const trimmed = name.trim();
  const data = storage.loadData();

  // Ensure the array exists (defensive, should always be seeded by storage).
  if (!data.categories || typeof data.categories !== "object") {
    data.categories = { income: [...DEFAULT_INCOME_CATEGORIES], expense: [...DEFAULT_EXPENSE_CATEGORIES] };
  }
  if (!Array.isArray(data.categories[type])) {
    data.categories[type] = [..._defaults(type)];
  }

  data.categories[type].push(trimmed);
  storage.saveData(data);

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
 * On success, removes the name from data.categories[type] and persists the
 * change. Transactions are NEVER modified or deleted (Req 8.8).
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: true } | { ok: false, error: "in-use" | "default" }}
 */
export function deleteCategory(name, type) {
  const trimmed = typeof name === "string" ? name.trim() : "";

  // Guard: defaults are not deletable (Req 8.6 implicit — only custom categories
  // are deletable). Check against the authoritative DEFAULTS_MAP.
  if (_isDefault(trimmed, type)) {
    return { ok: false, error: "default" };
  }

  // Guard: refuse if any transaction references this category+type (Req 8.7).
  if (isCategoryInUse(trimmed, type)) {
    return { ok: false, error: "in-use" };
  }

  const data = storage.loadData();

  // Remove from the categories list. If the category wasn't there, this is a
  // no-op (idempotent), still return ok:true since there is nothing to delete.
  if (Array.isArray(data.categories && data.categories[type])) {
    data.categories[type] = data.categories[type].filter((c) => c !== trimmed);
    storage.saveData(data);
  }

  // Transactions are intentionally untouched (Req 8.8).
  return { ok: true };
}

/**
 * Validate a candidate category name for the given type. Pure helper used by
 * addCategory and by the UI for inline feedback.
 *
 * Returns:
 *   - { ok: true }                   — name is valid and unique for this type.
 *   - { ok: false, error: "invalid" } — name is blank or whitespace-only.
 *   - { ok: false, error: "duplicate" } — a category with this name (trimmed,
 *     case-sensitive) already exists for this type.
 *
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: boolean, error?: "duplicate" | "invalid" }}
 */
export function validateCategory(name, type) {
  if (utils.isBlank(name)) {
    return { ok: false, error: "invalid" };
  }

  const trimmed = name.trim();
  const existing = getCategories(type);

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
 * @returns {boolean}
 */
export function isCategoryInUse(name, type) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  const data = storage.loadData();
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];

  return transactions.some(
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
