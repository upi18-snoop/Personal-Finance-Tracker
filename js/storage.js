/*
 * storage.js — Storage layer.
 *
 * Single responsibility: the ONLY module that touches localStorage (Req 10.2,
 * 13.5). Owns the single versioned Storage_Schema, the
 * initializeData/loadData/saveData/clearData API, corruption recovery, and the
 * StorageProvider abstraction that keeps a future backend swappable (Req 13).
 *
 * Layer: Storage. May import utils.js (shared leaf) and supabase-storage.js
 * (infrastructure) only. Business logic and UI depend on this module's
 * functions, never on the provider classes.
 *
 * Task 16.5 additions:
 *   - All public API functions are now async and accept an optional `userId`.
 *   - Provider selection: a truthy `userId` routes to SupabaseDatabaseProvider;
 *     null/undefined routes to LocalStorageProvider.
 *   - New CRUD exports: getTransactions, addTransaction, deleteTransaction,
 *     getCustomCategories, addCustomCategory, deleteCustomCategory — each
 *     delegates to the correct provider.
 *   - LocalStorageProvider class is unchanged — unauthenticated paths still work.
 *   - The module-level `provider` singleton is replaced by a per-call
 *     getProvider(userId) factory so authenticated users always get Supabase.
 */

import { SUPPORTED_CURRENCIES } from "./utils.js";
import { SupabaseDatabaseProvider } from "./supabase-storage.js";

// Storage_Schema constants (Req 10.7). STORAGE_KEY is the single localStorage
// key the whole app uses; SCHEMA_VERSION identifies the schema shape.
export const STORAGE_KEY = "financeTrackerData";
export const SCHEMA_VERSION = 1;

/**
 * Default categories seeded into a fresh schema (also referenced by task 2.4).
 * Order is intentional and user-facing.
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

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/**
 * UUID v4 pattern used to validate Supabase Auth user IDs before routing to
 * the cloud provider. Supabase Auth always returns standard UUID v4 values
 * (the `auth.users.id` column type is `UUID`). Any string that does not match
 * this pattern is rejected and routed to LocalStorage instead of Supabase
 * (Req 29.6), preventing accidental cloud calls with malformed identifiers.
 *
 * Confirmed: Supabase Auth `auth.uid()` always returns a UUID v4. The
 * `auth.users.id` column is typed `UUID` in `supabase/schema.sql`, and
 * `_normalizeUser()` in `js/auth.js` passes `supabaseUser.id` directly.
 * See also: PHASE18_REPORT.md Finding F-10.
 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Return the active storage provider for the given userId.
 *
 * Routing table (Req 29.1, 29.2, 29.6):
 *   null / undefined          → LocalStorageProvider
 *   ''  (empty string)        → LocalStorageProvider
 *   '  ' (whitespace-only)    → LocalStorageProvider
 *   'not-a-uuid' (non-UUID)   → LocalStorageProvider
 *   valid UUID v4             → SupabaseDatabaseProvider
 *
 * Source-integrity invariant (Req 29.3):
 *   The `userId` argument MUST originate from `state.currentUser.id` as set by
 *   the `auth.onAuthStateChange` callback in `js/app.js`. No exported function
 *   in this module reads `userId` from `localStorage`, URL parameters, query
 *   strings, user-editable form fields, or any other untrusted source. The
 *   caller is solely responsible for passing an authoritative identity value.
 *
 * A new provider instance is created per call. Both providers are stateless so
 * this is allocation-free in practice.
 *
 * @param {string|null|undefined} userId  Supabase UUID from the auth session, or null.
 * @returns {SupabaseDatabaseProvider|LocalStorageProvider}
 */
function getProvider(userId) {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return new LocalStorageProvider();
  }
  if (!UUID_V4_PATTERN.test(userId)) {
    return new LocalStorageProvider();
  }
  return new SupabaseDatabaseProvider();
}

/**
 * Return true when `userId` is a valid UUID v4 that should route to Supabase.
 * This is the single authoritative check used by all exported functions so that
 * UUID v4 validation in getProvider() is not accidentally bypassed.
 *
 * Routing is identical to getProvider(): false → LocalStorage; true → Supabase.
 *
 * @param {unknown} userId
 * @returns {boolean}
 */
function _isSupabaseUser(userId) {
  return (
    typeof userId === 'string' &&
    userId.trim() !== '' &&
    UUID_V4_PATTERN.test(userId)
  );
}

// ---------------------------------------------------------------------------
// Schema helpers (used by the LocalStorage path only)
// ---------------------------------------------------------------------------

/**
 * A fresh, valid, empty AppData schema (Req 10.4/10.7). Seeds the default
 * income/expense categories and the default currency. Returns a brand-new
 * object graph every call so callers can mutate it freely.
 * @returns {object} AppData
 */
function defaultData() {
  return {
    version: SCHEMA_VERSION,
    transactions: [],
    categories: {
      income: [...DEFAULT_INCOME_CATEGORIES],
      expense: [...DEFAULT_EXPENSE_CATEGORIES],
    },
    settings: { currency: "IDR" },
  };
}

/**
 * Validate that a parsed value conforms to the Storage_Schema (Req 10.5/10.6;
 * task 2.5). Returns true only for an object with a valid version identifier, a
 * `transactions` array, a `categories` object whose `income` and `expense` are
 * both arrays, and a `settings` object. Returns false for anything else and
 * NEVER throws (null, primitives, arrays, and partial shapes are all handled).
 * @param {unknown} obj candidate parsed value
 * @returns {boolean}
 */
export function isValidSchema(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }

  // Version identifier: must match the known schema version.
  if (obj.version !== SCHEMA_VERSION) {
    return false;
  }

  // transactions must be an array.
  if (!Array.isArray(obj.transactions)) {
    return false;
  }

  // categories must be an object with income/expense arrays.
  const categories = obj.categories;
  if (
    categories === null ||
    typeof categories !== "object" ||
    Array.isArray(categories) ||
    !Array.isArray(categories.income) ||
    !Array.isArray(categories.expense)
  ) {
    return false;
  }

  // settings must be an object (not null, not an array).
  const settings = obj.settings;
  if (
    settings === null ||
    typeof settings !== "object" ||
    Array.isArray(settings)
  ) {
    return false;
  }

  return true;
}

/**
 * Read + parse the raw stored value (localStorage only). Returns the parsed
 * value, or null when there is nothing stored OR when the stored value is
 * unreadable. JSON.parse is wrapped in try/catch so malformed/corrupted data
 * resolves to null instead of throwing. Shape validation is the caller's job
 * (via isValidSchema).
 * @returns {*|null} parsed stored value, or null if missing/unreadable
 */
function readRaw() {
  const localProvider = new LocalStorageProvider();
  const raw = localProvider.readRawSync();
  if (raw === null || raw === undefined) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Guarantee the default income/expense categories are present in a loaded
 * schema (Req 8.4; task 2.4). Any default missing from a given type is appended.
 * @param {object} data AppData (mutated in place and returned)
 * @returns {{ data: object, changed: boolean }}
 */
function ensureDefaultCategories(data) {
  let changed = false;

  if (!data.categories || typeof data.categories !== "object") {
    data.categories = { income: [], expense: [] };
    changed = true;
  }

  const seed = (type, defaults) => {
    const current = Array.isArray(data.categories[type])
      ? data.categories[type]
      : [];
    const missing = defaults.filter((name) => !current.includes(name));
    if (!Array.isArray(data.categories[type]) || missing.length > 0) {
      const custom = current.filter((name) => !defaults.includes(name));
      data.categories[type] = [...defaults, ...custom];
      changed = true;
    }
  };

  seed("income", DEFAULT_INCOME_CATEGORIES);
  seed("expense", DEFAULT_EXPENSE_CATEGORIES);

  return { data, changed };
}

// ---------------------------------------------------------------------------
// Core schema API — async, userId-routed
// ---------------------------------------------------------------------------

/**
 * Initialize storage for the given user.
 *
 * Supabase path: calls initializeUserData to seed the settings row (idempotent),
 * then loads and returns an AppData-shaped object assembled from cloud records.
 *
 * LocalStorage path: existing synchronous behaviour — load if valid, else seed
 * default schema and persist.
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<object>} AppData
 */
export async function initializeData(userId = null) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    // Seed settings row on first login (idempotent).
    await provider.initializeUserData(userId);
    // Assemble an AppData-shaped object from cloud records.
    return _loadFromSupabase(provider, userId);
  }

  // ---- LocalStorage path (synchronous logic, wrapped in Promise) ----
  const existing = readRaw();
  if (isValidSchema(existing)) {
    const { data, changed } = ensureDefaultCategories(existing);
    if (changed) {
      _saveLocalSync(data);
    }
    return data;
  }

  const data = defaultData();
  _saveLocalSync(data);
  return data;
}

/**
 * Load the current AppData for the given user.
 *
 * Supabase path: assembles AppData shape from cloud records.
 * LocalStorage path: reads, validates, falls back to default schema.
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<object>} AppData
 */
export async function loadData(userId = null) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return _loadFromSupabase(provider, userId);
  }

  const existing = readRaw();
  return isValidSchema(existing) ? existing : defaultData();
}

/**
 * Persist AppData for the given user.
 *
 * Supabase path: this is a no-op. Supabase uses individual record CRUD
 * (addTransaction, deleteTransaction, etc.); bulk save does not apply.
 *
 * LocalStorage path: serialises and writes to localStorage.
 *
 * @param {object} data AppData
 * @param {string|null} [userId=null]
 * @returns {Promise<void>}
 */
export async function saveData(data, userId = null) {
  if (_isSupabaseUser(userId)) {
    // No-op for Supabase — individual CRUD functions handle persistence.
    return;
  }
  _saveLocalSync(data);
}

/**
 * Reset persisted state to a fresh default schema.
 *
 * Supabase path: no-op (clearing cloud data is not supported in v1).
 * LocalStorage path: writes a fresh default schema.
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<void>}
 */
export async function clearData(userId = null) {
  if (_isSupabaseUser(userId)) {
    return; // Not applicable for Supabase in v1.
  }
  _saveLocalSync(defaultData());
}

// ---------------------------------------------------------------------------
// Currency API — async, userId-routed
// ---------------------------------------------------------------------------

/**
 * Return the user's currently selected currency code (Req 9.2).
 *
 * Supabase path: reads from the settings table.
 * LocalStorage path: reads from the stored schema; defaults to "IDR".
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<string>} ISO 4217 currency code
 */
export async function getCurrency(userId = null) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    const settings = await provider.getSettings(userId);
    const currency = settings?.currency;
    return (typeof currency === "string" && SUPPORTED_CURRENCIES[currency])
      ? currency
      : "IDR";
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  const currency = data?.settings?.currency;
  return (typeof currency === "string" && SUPPORTED_CURRENCIES[currency])
    ? currency
    : "IDR";
}

/**
 * Persist the user's selected currency code (Req 9.2).
 *
 * Supabase path: upserts the settings row.
 * LocalStorage path: updates the schema and persists.
 *
 * Changing the currency NEVER converts stored transaction amounts (Req 9.3).
 *
 * @param {string} currency ISO 4217 currency code
 * @param {string|null} [userId=null]
 * @returns {Promise<boolean>} true if persisted, false if rejected
 */
export async function setCurrency(currency, userId = null) {
  if (typeof currency !== "string" || !SUPPORTED_CURRENCIES[currency]) {
    return false;
  }

  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    const result = await provider.setSettings(userId, { currency });
    return result.ok === true;
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  if (!data.settings || typeof data.settings !== "object") {
    data.settings = {};
  }
  data.settings.currency = currency;
  _saveLocalSync(data);
  return true;
}

// ---------------------------------------------------------------------------
// Transaction CRUD — async, userId-routed
// ---------------------------------------------------------------------------

/**
 * Return all transactions for the given user.
 *
 * Supabase path: fetches from the transactions table.
 * LocalStorage path: returns the transactions array from the stored schema.
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<object[]>}
 */
export async function getTransactions(userId = null) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return provider.getTransactions(userId);
  }

  const data = _loadLocalSync();
  return Array.isArray(data.transactions) ? data.transactions : [];
}

/**
 * Persist a new transaction for the given user.
 *
 * Supabase path: inserts a row via the transactions table.
 * LocalStorage path: appends to the stored transactions array and saves.
 *
 * @param {string|null} userId
 * @param {object} transaction Well-formed transaction object (all required fields present).
 * @returns {Promise<{ ok: true, transaction: object } | { ok: false, error: object }>}
 */
export async function addTransaction(userId, transaction) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return provider.addTransaction(userId, transaction);
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  if (!Array.isArray(data.transactions)) {
    data.transactions = [];
  }
  data.transactions.push(transaction);
  _saveLocalSync(data);
  return { ok: true, transaction };
}

/**
 * Delete a transaction by ID for the given user.
 *
 * Supabase path: deletes the row from the transactions table.
 * LocalStorage path: filters the transaction out of the stored array and saves.
 *
 * @param {string|null} userId
 * @param {string} transactionId
 * @returns {Promise<{ ok: true } | { ok: false, error: object }>}
 */
export async function deleteTransaction(userId, transactionId) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return provider.deleteTransaction(userId, transactionId);
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  const list = Array.isArray(data.transactions) ? data.transactions : [];
  const remaining = list.filter((tx) => !(tx && tx.id === transactionId));

  if (remaining.length === list.length) {
    return { ok: false, error: { code: "not-found", message: "Transaction not found." } };
  }

  data.transactions = remaining;
  _saveLocalSync(data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Category CRUD — async, userId-routed
// ---------------------------------------------------------------------------

/**
 * Return all custom (non-default) categories for the given user.
 *
 * Supabase path: fetches from the categories table (default categories are JS
 * constants and are never stored in Supabase).
 *
 * LocalStorage path: reads the stored schema and returns categories that are
 * NOT in the default lists. Returns objects of shape { name, type }.
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<Array<{ name: string, type: string }>>}
 */
export async function getCustomCategories(userId = null) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return provider.getCustomCategories(userId);
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  const defaultExpenseSet = new Set(DEFAULT_EXPENSE_CATEGORIES);
  const defaultIncomeSet  = new Set(DEFAULT_INCOME_CATEGORIES);
  const result = [];

  if (Array.isArray(data.categories?.income)) {
    for (const name of data.categories.income) {
      if (!defaultIncomeSet.has(name)) {
        result.push({ name, type: "income" });
      }
    }
  }
  if (Array.isArray(data.categories?.expense)) {
    for (const name of data.categories.expense) {
      if (!defaultExpenseSet.has(name)) {
        result.push({ name, type: "expense" });
      }
    }
  }
  return result;
}

/**
 * Add a custom category for the given user.
 *
 * Supabase path: inserts a row into the categories table.
 * LocalStorage path: appends to the appropriate type array in the stored schema.
 *
 * @param {string|null} userId
 * @param {{ name: string, type: string }} category
 * @returns {Promise<{ ok: true } | { ok: false, error: object }>}
 */
export async function addCustomCategory(userId, category) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return provider.addCustomCategory(userId, category);
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  const type = category.type;
  if (!data.categories || typeof data.categories !== "object") {
    data.categories = { income: [...DEFAULT_INCOME_CATEGORIES], expense: [...DEFAULT_EXPENSE_CATEGORIES] };
  }
  if (!Array.isArray(data.categories[type])) {
    data.categories[type] = type === "income" ? [...DEFAULT_INCOME_CATEGORIES] : [...DEFAULT_EXPENSE_CATEGORIES];
  }
  data.categories[type].push(category.name.trim());
  _saveLocalSync(data);
  return { ok: true };
}

/**
 * Delete a custom category for the given user by name and type.
 *
 * Supabase path: deletes the row from the categories table.
 * LocalStorage path: filters the name from the appropriate type array and saves.
 *
 * @param {string|null} userId
 * @param {{ name: string, type: string }} category
 * @returns {Promise<{ ok: true } | { ok: false, error: object }>}
 */
export async function deleteCustomCategory(userId, category) {
  if (_isSupabaseUser(userId)) {
    const provider = new SupabaseDatabaseProvider();
    return provider.deleteCustomCategory(userId, category);
  }

  // ---- LocalStorage path ----
  const data = _loadLocalSync();
  const type = category.type;
  if (Array.isArray(data.categories?.[type])) {
    data.categories[type] = data.categories[type].filter((c) => c !== category.name);
    _saveLocalSync(data);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// LocalStorage sync helpers (used internally — not exported)
// ---------------------------------------------------------------------------

/**
 * Synchronous localStorage read + JSON parse + schema validation.
 * Returns parsed AppData or defaultData() on any failure. Never throws.
 * @returns {object} AppData
 */
function _loadLocalSync() {
  const existing = readRaw();
  return isValidSchema(existing) ? existing : defaultData();
}

/**
 * Synchronous localStorage write. Delegates to a LocalStorageProvider instance.
 * @param {object} data AppData
 */
function _saveLocalSync(data) {
  const localProvider = new LocalStorageProvider();
  localProvider.writeSync(data);
}

// ---------------------------------------------------------------------------
// Supabase assembly helper
// ---------------------------------------------------------------------------

/**
 * Load all user data from Supabase and assemble it into an AppData-shaped
 * object. This keeps callers (business logic, UI) working with the same schema
 * shape regardless of which backend is active.
 *
 * The AppData shape returned:
 * {
 *   version: SCHEMA_VERSION,
 *   transactions: [...],        // from Supabase transactions table
 *   categories: {
 *     income:  [...defaults, ...customIncome],
 *     expense: [...defaults, ...customExpense],
 *   },
 *   settings: { currency: '...' }
 * }
 *
 * @param {SupabaseDatabaseProvider} provider
 * @param {string} userId
 * @returns {Promise<object>} AppData
 */
async function _loadFromSupabase(provider, userId) {
  // Fetch all three in parallel for performance.
  const [transactions, customCategories, settings] = await Promise.all([
    provider.getTransactions(userId),
    provider.getCustomCategories(userId),
    provider.getSettings(userId),
  ]);

  // Merge defaults with custom categories, preserving order.
  const customIncome  = customCategories.filter((c) => c.type === "income").map((c) => c.name);
  const customExpense = customCategories.filter((c) => c.type === "expense").map((c) => c.name);

  return {
    version: SCHEMA_VERSION,
    transactions: Array.isArray(transactions) ? transactions : [],
    categories: {
      income:  [...DEFAULT_INCOME_CATEGORIES,  ...customIncome],
      expense: [...DEFAULT_EXPENSE_CATEGORIES, ...customExpense],
    },
    settings: {
      currency: (settings?.currency && SUPPORTED_CURRENCIES[settings.currency])
        ? settings.currency
        : "IDR",
    },
  };
}

// ---------------------------------------------------------------------------
// StorageProvider classes — exported for extensibility (Req 13)
// ---------------------------------------------------------------------------

/*
 * StorageProvider abstraction (future-readiness, Req 13). Documented shape:
 *
 *   interface StorageProvider {
 *     read(): Promise<AppData | null>;
 *     write(data: AppData): Promise<void>;
 *     clear(): Promise<void>;
 *   }
 *
 * The interface is async so a network-backed provider can be plugged in later
 * without changing any layer above storage.js. Everything above this layer
 * depends only on the exported functions — never on a provider class — so
 * swapping requires no changes above the storage layer (Req 13.5).
 */

/**
 * Active v1 provider — the ONLY thing that touches window.localStorage
 * (Req 13.5, 14.1). Unchanged from the original implementation.
 */
export class LocalStorageProvider {
  /**
   * Synchronous raw read. Returns the raw stored string, or null.
   * @returns {string|null}
   */
  readRawSync() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === undefined ? null : raw;
  }

  /**
   * Synchronous write. Serialises and persists the schema.
   * @param {object} data AppData
   * @returns {void}
   */
  writeSync(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Synchronous clear — removes the stored key entirely.
   * @returns {void}
   */
  clearSync() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // --- Documented async StorageProvider interface ---

  /** @returns {Promise<object|null>} parsed AppData, or null if absent/unreadable */
  async read() {
    const raw = this.readRawSync();
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** @param {object} data AppData @returns {Promise<void>} */
  async write(data) {
    this.writeSync(data);
  }

  /** @returns {Promise<void>} */
  async clear() {
    this.clearSync();
  }
}

/**
 * Placeholder ONLY — documents the future extension point (Req 13.1). NOT
 * implemented in v1 (Req 13.2): constructing it throws, and it is never wired
 * in anywhere.
 */
export class GoogleSheetsProvider {
  constructor() {
    throw new Error("Not implemented in v1");
  }
}
