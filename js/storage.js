/*
 * storage.js — Storage layer.
 *
 * Single responsibility: the ONLY module that touches localStorage (Req 10.2,
 * 13.5). Owns the single versioned Storage_Schema, the
 * initializeData/loadData/saveData/clearData API, corruption recovery, and the
 * StorageProvider abstraction that keeps a future backend swappable (Req 13).
 *
 * Layer: Storage. May import utils.js (shared leaf) only. Business logic and UI
 * depend on this module's functions, never on the provider classes.
 *
 * Implemented scope:
 *   - 2.3: real Storage_Schema, defaultData(), and the
 *     initializeData/loadData/saveData/clearData API backed directly by
 *     localStorage.
 *   - 2.4: guaranteeing a loaded schema missing defaults gets them re-seeded.
 *   - 2.5: isValidSchema() + full JSON-parse/corruption recovery — missing,
 *     unreadable, or non-conforming stored data yields a valid default schema
 *     without throwing, and invalid stored data is recovered + re-persisted on
 *     startup.
 *   - 2.7: the StorageProvider seam (Req 13.5). LocalStorageProvider is the
 *     active v1 provider wrapping window.localStorage; readRaw/saveData/
 *     clearData route through it. GoogleSheetsProvider stays a documented,
 *     unconstructable placeholder (Req 13.2). Business logic and UI keep
 *     depending only on initializeData/loadData/saveData, never on a provider
 *     class, so a future backend swaps in with no changes above this layer.
 */

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
 * Load if present & valid, else create + persist a valid default schema
 * (Req 10.4/10.5/10.6).
 *
 * Startup recovery (task 2.5): on first run (nothing stored) this creates the
 * empty valid schema and persists it. If stored data is present but unreadable
 * (JSON parse failure) or non-conforming (fails isValidSchema), it falls back
 * to a fresh default schema and re-persists it so subsequent loads are stable —
 * without throwing. For a valid loaded schema, task 2.4's default-category
 * re-seeding still applies (persisting only when re-seeding changed something).
 * @returns {object} AppData
 */
export function initializeData() {
  const existing = readRaw();

  // Present and conforming: keep it, re-seeding defaults per task 2.4.
  if (isValidSchema(existing)) {
    const { data, changed } = ensureDefaultCategories(existing);
    if (changed) {
      saveData(data);
    }
    return data;
  }

  // First run (nothing stored) OR corrupt/invalid stored data: recover to a
  // fresh valid default and persist it. Neither path throws.
  const data = defaultData();
  saveData(data);
  return data;
}

/**
 * Guarantee the default income/expense categories are present in a loaded
 * schema (Req 8.4; task 2.4). Any default missing from a given type is appended
 * (preserving default order first, then any custom categories already present).
 * Existing custom categories and ordering of already-present entries are kept.
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
      // Defaults first (in their intentional order), then any custom entries.
      const custom = current.filter((name) => !defaults.includes(name));
      data.categories[type] = [...defaults, ...custom];
      changed = true;
    }
  };

  seed("income", DEFAULT_INCOME_CATEGORIES);
  seed("expense", DEFAULT_EXPENSE_CATEGORIES);

  return { data, changed };
}

/**
 * Read persisted data from localStorage and return a valid schema
 * (Req 10.4/10.5/10.6; task 2.5). For any stored value that is missing,
 * unreadable (JSON parse failure, handled in readRaw), or non-conforming to the
 * Storage_Schema (fails isValidSchema), this returns a fresh valid default
 * AppData and NEVER throws (design Property 15).
 * @returns {object} AppData
 */
export function loadData() {
  const existing = readRaw();
  return isValidSchema(existing) ? existing : defaultData();
}

/**
 * Persist the whole schema to localStorage (Req 10.1/10.3).
 * @param {object} data AppData
 * @returns {void}
 */
export function saveData(data) {
  provider.writeSync(data);
}

/**
 * Reset persisted state to a fresh default schema (Req 10.5; manual reset/tests).
 * @returns {void}
 */
export function clearData() {
  saveData(defaultData());
}

/**
 * Read + parse the raw stored value. This is the single localStorage read point
 * for the module. Returns the parsed value, or null when there is nothing
 * stored OR when the stored value is unreadable (task 2.5): the JSON.parse is
 * wrapped in try/catch so malformed/corrupted data resolves to null instead of
 * throwing. Shape validation of the parsed value is the caller's job (via
 * isValidSchema).
 * @returns {*|null} parsed stored value, or null if missing/unreadable
 */
function readRaw() {
  const raw = provider.readRawSync();
  if (raw === null || raw === undefined) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupted / non-JSON stored value — treat as "no readable data".
    return null;
  }
}

/*
 * StorageProvider abstraction (future-readiness, Req 13). Documented shape:
 *
 *   interface StorageProvider {
 *     read(): Promise<AppData | null>;   // parsed schema, or null if absent
 *     write(data: AppData): Promise<void>;
 *     clear(): Promise<void>;
 *   }
 *
 * The interface is async so a network-backed provider (e.g. a cloud/Google
 * Sheets backend) can be plugged in later without changing any layer above
 * storage.js. Everything above this layer depends only on
 * initializeData/loadData/saveData — never on a provider class — so swapping
 * the active provider requires no changes above the storage layer (Req 13.5).
 *
 * v1 wrinkle: the module's public API (loadData/saveData/clearData) is
 * synchronous because all current business logic and UI are synchronous. So the
 * active v1 provider (LocalStorageProvider) additionally exposes synchronous
 * companions (readRawSync/writeSync/clearSync) that storage.js uses directly.
 * The async read/write/clear methods are the documented seam a future provider
 * implements; in LocalStorageProvider they simply delegate to the sync path.
 */

/**
 * Active v1 provider — the ONLY thing that touches window.localStorage
 * (Req 13.5, 14.1). Data is stored solely in the browser under STORAGE_KEY; no
 * network calls are ever made (Req 14.2).
 */
export class LocalStorageProvider {
  /**
   * Synchronous raw read used by storage.js. Returns the raw stored string, or
   * null when nothing is stored. JSON parsing/validation is the caller's job.
   * @returns {string|null}
   */
  readRawSync() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === undefined ? null : raw;
  }

  /**
   * Synchronous write used by storage.js. Serializes and persists the schema.
   * @param {object} data AppData
   * @returns {void}
   */
  writeSync(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Synchronous clear used by storage.js — removes the stored key entirely.
   * @returns {void}
   */
  clearSync() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // --- Documented async StorageProvider interface (the future seam) ---
  // In v1 these delegate to the synchronous path above.

  /** @returns {Promise<object|null>} parsed AppData, or null if absent/unreadable */
  async read() {
    const raw = this.readRawSync();
    if (raw === null) {
      return null;
    }
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
 * in anywhere. No sync logic, no network calls, no auth.
 */
export class GoogleSheetsProvider {
  constructor() {
    throw new Error("Not implemented in v1");
  }
}

/**
 * The single active provider for v1. Selecting a different provider here is the
 * only change needed to swap backends — nothing above the storage layer refers
 * to a provider class (Req 13.5).
 * @type {LocalStorageProvider}
 */
const provider = new LocalStorageProvider();
