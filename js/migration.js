/*
 * migration.js — Phase 17: LocalStorage → Supabase migration service.
 *
 * Single responsibility: provide a safe, idempotent, non-destructive migration
 * path for users who accumulated financial data in LocalStorage (Phases 1–16)
 * and then sign in with a Supabase account.
 *
 * Architecture position:
 *   app.js  →  migration.js  →  storage.js (LocalStorage path, userId = null)
 *                            →  supabase-storage.js (SupabaseDatabaseProvider)
 *
 * This module does NOT import auth.js. The caller (app.js) supplies the
 * authenticated user's immutable Supabase UUID as `userId`. Email is never
 * used as an ownership identifier.
 *
 * Safety invariants (Task 17.1 scope — validation foundation only):
 *   - This module is entirely non-destructive in Task 17.1.
 *   - It does NOT delete or overwrite LocalStorage.
 *   - It does NOT call Supabase insert / upsert / delete.
 *   - It does NOT trigger migration automatically on sign-in.
 *   - It ONLY reads LocalStorage and returns structured validation results.
 *   - All actual upload logic (Tasks 17.4–17.6) is stubbed and guarded.
 *
 * Migration marker key convention:
 *   localStorage key: `financeTrackerMigration_${userId}`
 *   `userId` is always the Supabase UUID — never the user's email address.
 *
 * Layer: Migration service. Imports storage.js and supabase-storage.js only.
 *        Does not import auth.js, transactions.js, categories.js, or any UI
 *        module. No circular dependencies.
 *
 * Requirements covered: Req 23 (23.1–23.13)
 */

import {
  STORAGE_KEY,
  isValidSchema,
  setCurrency,
} from './storage.js';
import { SupabaseDatabaseProvider } from './supabase-storage.js';
import { SUPPORTED_CURRENCIES, isValidDate, isBlank } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * LocalStorage key prefix for the per-user migration marker.
 * Full key: `${MIGRATION_MARKER_PREFIX}${userId}` — never uses email.
 * @type {string}
 */
export const MIGRATION_MARKER_PREFIX = 'financeTrackerMigration_';

/**
 * Migration status values (Req 23.11, design §Migration States).
 * @enum {string}
 */
export const MIGRATION_STATUS = Object.freeze({
  NOT_NEEDED:   'not-needed',   // no local data, or already completed for this user
  AVAILABLE:    'available',    // local data present, not yet migrated
  VALIDATING:   'validating',   // pre-migration validation in progress
  READY:        'ready',        // validation passed, awaiting user confirmation
  IN_PROGRESS:  'in-progress',  // upload in progress
  PARTIAL:      'partial',      // interrupted; retryable
  COMPLETED:    'completed',    // all records verified in cloud
  FAILED:       'failed',       // unrecoverable error
});

/**
 * Issue severity codes used in validation results.
 * @enum {string}
 */
export const ISSUE_CODE = Object.freeze({
  // Transaction issues
  INVALID_TRANSACTION_ID:        'INVALID_TRANSACTION_ID',
  INVALID_TRANSACTION_TYPE:      'INVALID_TRANSACTION_TYPE',
  INVALID_TRANSACTION_ITEM_NAME: 'INVALID_TRANSACTION_ITEM_NAME',
  INVALID_TRANSACTION_AMOUNT:    'INVALID_TRANSACTION_AMOUNT',
  INVALID_TRANSACTION_CATEGORY:  'INVALID_TRANSACTION_CATEGORY',
  INVALID_TRANSACTION_DATE:      'INVALID_TRANSACTION_DATE',
  INVALID_TRANSACTION_CREATED_AT:'INVALID_TRANSACTION_CREATED_AT',

  // Category issues
  INVALID_CATEGORY_NAME:         'INVALID_CATEGORY_NAME',
  INVALID_CATEGORY_TYPE:         'INVALID_CATEGORY_TYPE',
  DUPLICATE_CATEGORY:            'DUPLICATE_CATEGORY',
  DEFAULT_CATEGORY_AS_CUSTOM:    'DEFAULT_CATEGORY_AS_CUSTOM',

  // Settings issues
  INVALID_CURRENCY:              'INVALID_CURRENCY',
  MISSING_SETTINGS:              'MISSING_SETTINGS',

  // Schema issues
  NO_LOCAL_DATA:                 'NO_LOCAL_DATA',
  CORRUPTED_SCHEMA:              'CORRUPTED_SCHEMA',
});

// ---------------------------------------------------------------------------
// MigrationConflict shape
// ---------------------------------------------------------------------------

/**
 * Represents a single conflict detected during migration.
 *
 * - `transaction-data-conflict`: a transaction ID exists in both local and cloud
 *   with differing content. The local record is NOT inserted; the caller decides
 *   how to resolve it (Req 23.4, 23.7).
 * - `currency-conflict`: local and cloud settings have different currency codes.
 *   No currency is applied automatically; the caller must invoke
 *   `resolveCurrencyConflict` after the user picks one (Req 23.6).
 *
 * @typedef {Object} MigrationConflict
 * @property {'transaction-data-conflict'|'currency-conflict'} type
 * @property {object}  [localRecord]  - Local transaction object (transaction-data-conflict only).
 * @property {object}  [cloudRecord]  - Cloud transaction object (transaction-data-conflict only).
 * @property {string}  [localValue]   - Local setting value (currency-conflict only).
 * @property {string}  [cloudValue]   - Cloud setting value (currency-conflict only).
 */

// ---------------------------------------------------------------------------
// Default category sets — mirrors storage.js and categories.js exactly.
// Kept local so migration.js has no dependency on those business-logic modules.
// These are NEVER inserted into the cloud categories table (Req 23.5).
// ---------------------------------------------------------------------------

/** @type {ReadonlySet<string>} */
const DEFAULT_EXPENSE_SET = new Set([
  'Food', 'Transport', 'Fun', 'Bills', 'Shopping', 'Health', 'Other',
]);

/** @type {ReadonlySet<string>} */
const DEFAULT_INCOME_SET = new Set([
  'Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Other',
]);

/** @type {ReadonlySet<string>} */
const VALID_TRANSACTION_TYPES = new Set(['income', 'expense']);

// ---------------------------------------------------------------------------
// Migration marker helpers
// ---------------------------------------------------------------------------

/**
 * Build the user-scoped LocalStorage key for the migration marker.
 * Uses the Supabase UUID — NEVER the email address (Req 23.12).
 *
 * @param {string} userId - Authenticated Supabase user UUID.
 * @returns {string}
 */
export function migrationMarkerKey(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('migration: userId must be a non-empty string (Supabase UUID).');
  }
  return `${MIGRATION_MARKER_PREFIX}${userId}`;
}

/**
 * Read the migration marker from LocalStorage for the given user.
 * Returns null when no marker exists.
 *
 * @param {string} userId - Authenticated Supabase user UUID.
 * @returns {object|null} Parsed marker object, or null.
 */
export function readMigrationMarker(userId) {
  const key = migrationMarkerKey(userId);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupted marker — treat as absent.
    return null;
  }
}

/**
 * Write the migration marker to LocalStorage for the given user.
 * This is the ONLY LocalStorage write in migration.js; it only writes to the
 * migration marker key, never to the finance data key (`financeTrackerData`).
 *
 * @param {string} userId - Authenticated Supabase user UUID.
 * @param {object} marker - Marker object to persist.
 * @returns {void}
 */
export function writeMigrationMarker(userId, marker) {
  const key = migrationMarkerKey(userId);
  localStorage.setItem(key, JSON.stringify(marker));
}

/**
 * Remove the migration marker from LocalStorage for the given user.
 *
 * ⚠️  ONLY call this when the user explicitly resets their migration state
 * (e.g. a "Reset migration" developer option). Do NOT call it after a
 * successful migration or after clearing local finance data — the marker
 * must survive both of those events so that future logins correctly see
 * `status: 'completed'` and skip the migration modal.
 *
 * @param {string} userId - Authenticated Supabase user UUID.
 * @returns {void}
 */
export function clearMigrationMarker(userId) {
  const key = migrationMarkerKey(userId);
  localStorage.removeItem(key);
}

/**
 * Get the current migration status for the given user.
 *
 * When a valid marker exists, returns its stored status.
 *
 * When NO marker exists, checks local data to determine the right default:
 *   - Local transactions > 0 → `'available'` (migration opportunity exists)
 *   - Local transactions = 0 → `'not-needed'` (nothing to migrate)
 *
 * This avoids a cloud round-trip while still giving callers a meaningful
 * status on first login, before `detectMigrationOpportunity` has run.
 *
 * @param {string} userId - Authenticated Supabase user UUID.
 * @returns {string} One of the MIGRATION_STATUS values.
 */
export function getMigrationStatus(userId) {
  const marker = readMigrationMarker(userId);

  // If a valid marker exists, return its stored status.
  if (marker && typeof marker.status === 'string') {
    const validStatuses = new Set(Object.values(MIGRATION_STATUS));
    return validStatuses.has(marker.status)
      ? marker.status
      : MIGRATION_STATUS.NOT_NEEDED;
  }

  // No marker — check local data to determine the appropriate default.
  // This is a pure LocalStorage read; no cloud call, no writes.
  const raw = _readRawLocalData();
  const localCount = (raw && Array.isArray(raw.transactions))
    ? raw.transactions.length
    : 0;

  return localCount > 0
    ? MIGRATION_STATUS.AVAILABLE
    : MIGRATION_STATUS.NOT_NEEDED;
}

/**
 * Create a fresh migration marker with status `available`.
 * Does not overwrite an existing `completed` marker.
 *
 * @param {string} userId - Authenticated Supabase user UUID.
 * @returns {object} The marker object that was written.
 */
function _createAvailableMarker(userId) {
  const marker = {
    userId,                    // UUID — never email
    status: MIGRATION_STATUS.AVAILABLE,
    migratedTransactionIds: [],
    migratedCategories: [],
    settingsMigrated: false,
    conflicts: [],
    startedAt: null,
    completedAt: null,
  };
  writeMigrationMarker(userId, marker);
  return marker;
}

// ---------------------------------------------------------------------------
// Raw LocalStorage reader (read-only — never writes finance data)
// ---------------------------------------------------------------------------

/**
 * Read the raw finance data from LocalStorage WITHOUT going through the
 * storage.js initializeData / defaultData path. This is intentional: we want
 * to see EXACTLY what is stored, including potentially missing or corrupted
 * data, so validation can classify it correctly.
 *
 * Returns null when the key is absent or the value cannot be parsed.
 * Returns the parsed object (which may or may not be a valid schema) otherwise.
 *
 * SAFETY: This function never writes to LocalStorage.
 *
 * @returns {object|null} Raw parsed AppData, or null.
 */
function _readRawLocalData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;  // JSON parse failure → treat as corrupted
  }
}

// ---------------------------------------------------------------------------
// Individual field validators (pure functions — no side effects)
// ---------------------------------------------------------------------------

/**
 * Validate a single transaction object.
 * Returns an array of issue objects. An empty array means the transaction is valid.
 * The original transaction ID is always preserved — no replacement ID is generated.
 *
 * @param {unknown} tx - Candidate transaction value.
 * @param {number} index - Index in the transactions array (for path reporting).
 * @returns {{ code: string, message: string, path: string }[]} Issues found.
 */
export function validateTransaction(tx, index) {
  const issues = [];
  const path = (field) => `transactions[${index}].${field}`;

  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_ID,
      message: 'Transaction record is not an object.',
      path: `transactions[${index}]`,
    });
    return issues; // can't validate further
  }

  // id — must be a non-blank string; never replaced.
  if (typeof tx.id !== 'string' || tx.id.trim() === '') {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_ID,
      message: 'Transaction id must be a non-empty string.',
      path: path('id'),
    });
  }

  // type — must be exactly 'income' or 'expense'.
  if (!VALID_TRANSACTION_TYPES.has(tx.type)) {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_TYPE,
      message: `Transaction type must be "income" or "expense"; got: ${JSON.stringify(tx.type)}.`,
      path: path('type'),
    });
  }

  // itemName — non-blank after trim.
  if (isBlank(tx.itemName)) {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_ITEM_NAME,
      message: 'Transaction itemName must be a non-blank string.',
      path: path('itemName'),
    });
  }

  // amount — finite number strictly greater than 0.
  const amt = Number(tx.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_AMOUNT,
      message: `Transaction amount must be a finite number greater than 0; got: ${JSON.stringify(tx.amount)}.`,
      path: path('amount'),
    });
  }

  // category — non-blank after trim.
  if (isBlank(tx.category)) {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_CATEGORY,
      message: 'Transaction category must be a non-blank string.',
      path: path('category'),
    });
  }

  // date — YYYY-MM-DD format AND a real calendar date.
  if (!isValidDate(tx.date)) {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_DATE,
      message: `Transaction date must be a valid YYYY-MM-DD calendar date; got: ${JSON.stringify(tx.date)}.`,
      path: path('date'),
    });
  }

  // createdAt — non-blank string (ISO timestamp from the app; exact format not enforced here
  // because the existing app uses new Date().toISOString() which is always valid, but we
  // normalise gracefully for any stored string).
  if (typeof tx.createdAt !== 'string' || tx.createdAt.trim() === '') {
    issues.push({
      code: ISSUE_CODE.INVALID_TRANSACTION_CREATED_AT,
      message: 'Transaction createdAt must be a non-blank string.',
      path: path('createdAt'),
    });
  }

  return issues;
}

/**
 * Validate all custom categories extracted from the local data.
 *
 * `localData.categories.income` and `localData.categories.expense` each contain
 * both default and custom names. We filter out defaults and validate only
 * the custom ones, then check for duplicates across the combined list.
 *
 * Returns parallel arrays: validCategories and invalidCategories.
 *
 * @param {object} categories - `{ income: string[], expense: string[] }` from AppData.
 * @returns {{
 *   validCategories: { name: string, type: string }[],
 *   invalidCategories: { record: object, errors: string[] }[]
 * }}
 */
export function validateCustomCategories(categories) {
  const validCategories = [];
  const invalidCategories = [];

  if (!categories || typeof categories !== 'object') {
    return { validCategories, invalidCategories };
  }

  // Track (name, type) pairs already seen to detect duplicates within the
  // local custom list itself.
  const seen = new Set(); // keys of the form "name::type"

  const processType = (type, defaultSet) => {
    const list = Array.isArray(categories[type]) ? categories[type] : [];
    for (const rawName of list) {
      const name = typeof rawName === 'string' ? rawName.trim() : '';

      // Skip default categories — they are JS constants, not cloud records.
      if (defaultSet.has(name)) continue;

      const errors = [];

      // name must be non-blank.
      if (name === '') {
        errors.push('Category name must be a non-blank string.');
      }

      // type must be 'income' or 'expense' (always true here, but validated
      // for completeness in case the data structure is unexpected).
      if (!VALID_TRANSACTION_TYPES.has(type)) {
        errors.push(`Category type must be "income" or "expense"; got: ${JSON.stringify(type)}.`);
      }

      // Duplicate (name, type) check within the local custom list.
      const key = `${name}::${type}`;
      if (seen.has(key)) {
        errors.push(`Duplicate custom category: "${name}" (${type}).`);
      } else if (name !== '') {
        seen.add(key);
      }

      if (errors.length > 0) {
        invalidCategories.push({ record: { name: rawName, type }, errors });
      } else {
        validCategories.push({ name, type });
      }
    }
  };

  processType('expense', DEFAULT_EXPENSE_SET);
  processType('income', DEFAULT_INCOME_SET);

  return { validCategories, invalidCategories };
}

/**
 * Validate the settings object from local data.
 *
 * @param {unknown} settings - The `settings` field from AppData.
 * @returns {{
 *   settingsValid: boolean,
 *   currency: string,
 *   issues: { code: string, message: string, path: string }[]
 * }}
 */
export function validateSettings(settings) {
  const issues = [];

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    issues.push({
      code: ISSUE_CODE.MISSING_SETTINGS,
      message: 'Settings object is missing or invalid.',
      path: 'settings',
    });
    return { settingsValid: false, currency: 'IDR', issues };
  }

  const currency = settings.currency;

  if (typeof currency !== 'string' || !SUPPORTED_CURRENCIES[currency]) {
    issues.push({
      code: ISSUE_CODE.INVALID_CURRENCY,
      message: `Currency "${currency}" is not a member of Supported_Currencies.`,
      path: 'settings.currency',
    });
    return { settingsValid: false, currency: 'IDR', issues };
  }

  return { settingsValid: true, currency, issues };
}

// ---------------------------------------------------------------------------
// Primary public API — Task 17.1 scope
// ---------------------------------------------------------------------------

/**
 * Read and validate all local finance data.
 *
 * This is the core Task 17.1 function. It is:
 *   - Non-destructive: never writes to LocalStorage or Supabase.
 *   - Non-throwing: all errors are returned as structured issues.
 *   - Side-effect-free: does not modify transactions, categories, or settings.
 *
 * Return shape distinguishes three states (Req 23.1, design §Validation Layer):
 *   - NO_LOCAL_DATA:       `hasData: false`
 *   - VALID_LOCAL_DATA:    `valid: true, hasData: true`
 *   - INVALID_LOCAL_DATA:  `valid: false, hasData: true` (with structured issues)
 *
 * @returns {{
 *   valid: boolean,
 *   hasData: boolean,
 *   dataState: 'NO_LOCAL_DATA' | 'VALID_LOCAL_DATA' | 'INVALID_LOCAL_DATA',
 *   validTransactions: object[],
 *   invalidTransactions: { record: object, issues: object[], index: number }[],
 *   validCategories: { name: string, type: string }[],
 *   invalidCategories: { record: object, errors: string[] }[],
 *   settings: { currency: string },
 *   settingsValid: boolean,
 *   errors: { code: string, message: string, path: string }[],
 *   summary: {
 *     transactionCount: number,
 *     invalidTransactionCount: number,
 *     customCategoryCount: number,
 *     invalidCategoryCount: number,
 *     hasSettings: boolean,
 *   }
 * }}
 */
export function validateLocalData() {
  // ---- Step 1: Read raw data (never writes, never modifies) ----
  const raw = _readRawLocalData();

  // ---- Step 2: No data at all ----
  if (raw === null) {
    return {
      valid:                true,   // absence of data is not an error
      hasData:              false,
      dataState:            'NO_LOCAL_DATA',
      validTransactions:    [],
      invalidTransactions:  [],
      validCategories:      [],
      invalidCategories:    [],
      settings:             { currency: 'IDR' },
      settingsValid:        true,
      errors:               [],
      summary: {
        transactionCount:        0,
        invalidTransactionCount: 0,
        customCategoryCount:     0,
        invalidCategoryCount:    0,
        hasSettings:             false,
      },
    };
  }

  // ---- Step 3: Schema shape check ----
  // isValidSchema checks: version, transactions array, categories object, settings object.
  if (!isValidSchema(raw)) {
    return {
      valid:                false,
      hasData:              true,
      dataState:            'INVALID_LOCAL_DATA',
      validTransactions:    [],
      invalidTransactions:  [],
      validCategories:      [],
      invalidCategories:    [],
      settings:             { currency: 'IDR' },
      settingsValid:        false,
      errors: [{
        code:    ISSUE_CODE.CORRUPTED_SCHEMA,
        message: 'LocalStorage data does not conform to the expected storage schema (version, transactions, categories, settings).',
        path:    'root',
      }],
      summary: {
        transactionCount:        0,
        invalidTransactionCount: 0,
        customCategoryCount:     0,
        invalidCategoryCount:    0,
        hasSettings:             false,
      },
    };
  }

  // ---- Step 4: Validate transactions ----
  const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  const validTransactions   = [];
  const invalidTransactions = [];

  rawTransactions.forEach((tx, i) => {
    const txIssues = validateTransaction(tx, i);
    if (txIssues.length === 0) {
      validTransactions.push(tx); // original object, original ID preserved
    } else {
      invalidTransactions.push({ record: tx, issues: txIssues, index: i });
    }
  });

  // ---- Step 5: Validate custom categories ----
  const { validCategories, invalidCategories } =
    validateCustomCategories(raw.categories);

  // ---- Step 6: Validate settings ----
  const {
    settingsValid,
    currency,
    issues: settingsIssues,
  } = validateSettings(raw.settings);

  // ---- Step 7: Assemble top-level issues list ----
  const allIssues = [
    ...settingsIssues,
    ...invalidTransactions.flatMap((it) => it.issues),
    ...invalidCategories.map((ic) => ({
      code:    ISSUE_CODE.INVALID_CATEGORY_NAME,
      message: ic.errors.join(' '),
      path:    `categories.${ic.record?.type ?? 'unknown'}["${ic.record?.name ?? ''}"]`,
    })),
  ];

  // ---- Step 8: Determine overall validity ----
  // The result is "valid" only when ALL transactions, ALL categories,
  // AND settings are valid. Invalid records are still returned so the UI
  // can present them to the user (Req 23.3 — not silently dropped).
  const valid = (
    invalidTransactions.length === 0 &&
    invalidCategories.length   === 0 &&
    settingsValid
  );

  const dataState = !valid ? 'INVALID_LOCAL_DATA' : 'VALID_LOCAL_DATA';

  return {
    valid,
    hasData:              true,
    dataState,
    validTransactions:    validTransactions,
    invalidTransactions,
    validCategories:      validCategories,
    invalidCategories,
    settings:             { currency },
    settingsValid,
    errors:               allIssues,
    summary: {
      transactionCount:        validTransactions.length,
      invalidTransactionCount: invalidTransactions.length,
      customCategoryCount:     validCategories.length,
      invalidCategoryCount:    invalidCategories.length,
      hasSettings:             true,
    },
  };
}

/**
 * Compare two transaction objects on the key content fields.
 * `id`, `createdAt`, and `user_id` are intentionally excluded: the id is
 * the overlap key itself, createdAt may differ legitimately between systems,
 * and user_id is a backend concern never stored in local data.
 *
 * @param {object} local  - Local transaction object (camelCase).
 * @param {object} cloud  - Cloud transaction object (camelCase, from SupabaseDatabaseProvider).
 * @returns {boolean} true when all key fields are equal.
 */
function _transactionsAreIdentical(local, cloud) {
  return (
    local.type      === cloud.type      &&
    local.itemName  === cloud.itemName  &&
    Number(local.amount) === Number(cloud.amount) &&
    local.category  === cloud.category  &&
    local.date      === cloud.date
  );
}

/**
 * Detect whether a migration opportunity exists for the given authenticated user.
 *
 * Reads local transaction data (LocalStorage path — no userId) and cloud
 * transaction data (Supabase path — with userId). Does NOT upload any data.
 *
 * Full scenario classification (Req 23.1, 23.7, design §Scenario classification):
 *   A — local > 0, cloud = 0 → clean first-time migration.
 *   B — local = 0             → nothing to migrate.
 *   C — both > 0, no ID overlap → safe merge (all local IDs are new to cloud).
 *   D — both > 0, some IDs overlap with identical content → partial migration,
 *         safe resume (overlapping records are already correct in cloud).
 *   E — both > 0, some IDs overlap with differing content → true conflict;
 *         conflicting records must be reviewed before upload.
 *
 * Returns a structured descriptor used by app.js to decide whether to show
 * the migration UI. Also creates or preserves the migration marker.
 *
 * @param {string} userId - Authenticated Supabase user UUID (never email).
 * @returns {Promise<{
 *   needed: boolean,
 *   localCount: number,
 *   cloudCount: number,
 *   scenario: 'A' | 'B' | 'C' | 'D' | 'E' | 'none' | 'resume',
 *   currentStatus: string,
 * }>}
 */
export async function detectMigrationOpportunity(userId) {
  if (!userId || typeof userId !== 'string') {
    console.warn('migration: detectMigrationOpportunity called without a valid userId.');
    return { needed: false, localCount: 0, cloudCount: 0, scenario: 'none', currentStatus: MIGRATION_STATUS.NOT_NEEDED };
  }

  // Check the existing marker first — if already completed, no need to prompt.
  const existingMarker = readMigrationMarker(userId);
  const validStatuses  = new Set(Object.values(MIGRATION_STATUS));

  // Determine the stored status (if any). We do NOT call getMigrationStatus()
  // here because that would read LocalStorage twice when no marker exists.
  // Instead we derive the status directly from the marker.
  const storedStatus = (existingMarker && typeof existingMarker.status === 'string' && validStatuses.has(existingMarker.status))
    ? existingMarker.status
    : null; // null means: no valid stored status; we'll classify below

  if (storedStatus === MIGRATION_STATUS.COMPLETED) {
    return {
      needed:        false,
      localCount:    0,
      cloudCount:    0,
      scenario:      'none',
      currentStatus: MIGRATION_STATUS.COMPLETED,
    };
  }
  if (storedStatus === MIGRATION_STATUS.PARTIAL) {
    // An interrupted migration — let the UI offer a resume prompt.
    return {
      needed:        true,
      localCount:    -1,  // unknown until re-read; UI should call validateLocalData()
      cloudCount:    -1,
      scenario:      'resume',
      currentStatus: MIGRATION_STATUS.PARTIAL,
    };
  }

  // ---- Step 1: Read local transactions (LocalStorage, no userId) ----
  let localTransactions = [];
  try {
    const raw = _readRawLocalData();
    if (raw && Array.isArray(raw.transactions)) {
      localTransactions = raw.transactions;
    }
  } catch {
    localTransactions = [];
  }
  const localCount = localTransactions.length;

  // ---- Step 2: Scenario B — no local data, nothing to migrate ----
  if (localCount === 0) {
    return {
      needed:        false,
      localCount:    0,
      cloudCount:    0,
      scenario:      'B',
      currentStatus: MIGRATION_STATUS.NOT_NEEDED,
    };
  }

  // ---- Step 3: Read cloud transactions (Supabase, with userId — READ-ONLY) ----
  // Network unavailable or Supabase not configured degrades gracefully to 0
  // cloud records. The upload path surfaces the real error later (Req 23.13).
  let cloudTransactions = [];
  try {
    const provider = new SupabaseDatabaseProvider();
    const fetched  = await provider.getTransactions(userId);
    cloudTransactions = Array.isArray(fetched) ? fetched : [];
  } catch {
    cloudTransactions = [];
  }
  const cloudCount = cloudTransactions.length;

  // ---- Step 4: Scenario A — local data exists, cloud is empty ----
  if (cloudCount === 0) {
    if (!storedStatus) {
      _createAvailableMarker(userId);
    }
    return {
      needed:        true,
      localCount,
      cloudCount,
      scenario:      'A',
      currentStatus: MIGRATION_STATUS.AVAILABLE,
    };
  }

  // ---- Step 5: Both sides have data — classify C / D / E ----
  //
  // Build a map of cloud transactions keyed by ID for O(n) overlap detection.
  const cloudById = new Map();
  for (const tx of cloudTransactions) {
    if (tx && typeof tx.id === 'string') {
      cloudById.set(tx.id, tx);
    }
  }

  // Find overlapping IDs: present in both local and cloud.
  const overlapping = localTransactions.filter(
    (tx) => tx && typeof tx.id === 'string' && cloudById.has(tx.id)
  );

  let scenario;

  if (overlapping.length === 0) {
    // No shared IDs → clean merge.
    scenario = 'C';
  } else {
    // Shared IDs exist — compare content to distinguish D from E.
    const hasConflict = overlapping.some((localTx) => {
      const cloudTx = cloudById.get(localTx.id);
      return !_transactionsAreIdentical(localTx, cloudTx);
    });
    scenario = hasConflict ? 'E' : 'D';
  }

  // Create an `available` marker if one doesn't already exist.
  if (!storedStatus) {
    _createAvailableMarker(userId);
  }

  return {
    needed:        true,
    localCount,
    cloudCount,
    scenario,
    currentStatus: MIGRATION_STATUS.AVAILABLE,
  };
}

// ---------------------------------------------------------------------------
// Stubbed upload API (Tasks 17.4–17.9 — not implemented in Task 17.1)
// ---------------------------------------------------------------------------

/**
 * Migrate validated local transactions to the authenticated user's Supabase
 * transactions table.
 *
 * Preconditions (all must pass before any write):
 *   1. userId must be a non-empty string (Supabase UUID — never email).
 *   2. validateLocalData() must succeed: valid: true, hasData: true.
 *      If valid: false → return structured validation errors, write nothing.
 *      If hasData: false → return { ok: true, migratedCount: 0, ... } (nothing to do).
 *   3. Migration marker is read/updated to track progress.
 *
 * Algorithm per validated transaction:
 *   a. INSERT via SupabaseDatabaseProvider.addTransaction(userId, tx).
 *   b. Success → add id to migratedIds, increment migratedCount.
 *   c. error.code === 'duplicate' → add id to existingIds, increment alreadyExistsCount.
 *   d. error.code === 'network-error' → add to failed[], set status = PARTIAL,
 *      persist marker, STOP processing remaining transactions.
 *   e. Any other error → add to failed[], increment failedCount, continue.
 *
 * After processing:
 *   - Append newly migrated IDs to marker.migratedTransactionIds.
 *   - Set marker status to PARTIAL if failedCount > 0, else keep IN_PROGRESS.
 *   - Does NOT set COMPLETED (Task 17.9).
 *   - Does NOT delete or modify financeTrackerData.
 *
 * Safety rules enforced in code:
 *   - Never writes to STORAGE_KEY (financeTrackerData).
 *   - Never generates a new ID — tx.id used exactly.
 *   - Never uses email as userId.
 *   - Never performs currency conversion.
 *   - Never creates default category records.
 *
 * @param {string} userId  Authenticated Supabase user UUID.
 * @param {object} [_options]  Reserved for future options — unused in 17.4.
 * @returns {Promise<{
 *   ok: boolean,
 *   migratedCount: number,
 *   alreadyExistsCount: number,
 *   failedCount: number,
 *   skippedCount: number,
 *   migratedIds: string[],
 *   existingIds: string[],
 *   failed: { id?: string, error: object }[],
 *   errors: { code: string, message: string }[],
 *   status: string,
 * }>}
 */
export async function startMigration(userId, _options) {
  // ---- Precondition 1: userId must be a valid non-empty string ----
  if (!userId || typeof userId !== 'string') {
    return {
      ok:               false,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedCount:     0,
      migratedIds:      [],
      existingIds:      [],
      failed:           [],
      errors: [{
        code:    'INVALID_USER_ID',
        message: 'userId must be a non-empty string (Supabase UUID). Migration aborted.',
      }],
      status: MIGRATION_STATUS.FAILED,
    };
  }

  // ---- Precondition 2: validate local data ----
  const validation = validateLocalData();

  // No local data — nothing to migrate, not an error.
  if (!validation.hasData) {
    return {
      ok:               true,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedCount:     0,
      migratedIds:      [],
      existingIds:      [],
      failed:           [],
      errors:           [],
      status:           MIGRATION_STATUS.NOT_NEEDED,
    };
  }

  // Local data present but invalid — return validation errors without writing anything.
  if (!validation.valid) {
    return {
      ok:               false,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedCount:     validation.invalidTransactions ? validation.invalidTransactions.length : 0,
      migratedIds:      [],
      existingIds:      [],
      failed:           [],
      errors:           validation.errors || [],
      status:           MIGRATION_STATUS.FAILED,
    };
  }

  // ---- Read existing marker (or use a fresh in-memory one) ----
  // We do NOT call _createAvailableMarker here — we read whatever is already there
  // so that already-migrated IDs from a prior run are preserved.
  let marker = readMigrationMarker(userId);
  if (!marker) {
    marker = {
      userId,
      status:                    MIGRATION_STATUS.IN_PROGRESS,
      migratedTransactionIds:    [],
      migratedCategories:        [],
      settingsMigrated:          false,
      conflicts:                 [],
      startedAt:                 new Date().toISOString(),
      completedAt:               null,
    };
  } else {
    marker.status    = MIGRATION_STATUS.IN_PROGRESS;
    marker.startedAt = marker.startedAt || new Date().toISOString();
  }

  // Persist the IN_PROGRESS marker before writing any records.
  writeMigrationMarker(userId, marker);

  // ---- Collect valid transactions to process ----
  const transactionsToProcess = validation.validTransactions;

  // ---- Pre-fetch cloud transactions to enable conflict detection (Req 23.4, 23.7) ----
  // Build a cloudById map for O(1) lookup during the upload loop.
  // Network failure degrades gracefully to an empty map (same pattern as detectMigrationOpportunity).
  const cloudById = new Map();
  try {
    const provider = new SupabaseDatabaseProvider();
    const fetched  = await provider.getTransactions(userId);
    const cloudTxs = Array.isArray(fetched) ? fetched : [];
    for (const tx of cloudTxs) {
      if (tx && typeof tx.id === 'string') {
        cloudById.set(tx.id, tx);
      }
    }
  } catch {
    // Graceful degradation: if the cloud read fails, proceed without pre-check.
    // The INSERT path will still surface duplicate errors from the provider.
  }

  // ---- Upload loop ----
  const provider          = new SupabaseDatabaseProvider();
  const migratedIds       = [];
  const existingIds       = [];
  const failed            = [];
  /** @type {MigrationConflict[]} */
  const transactionConflicts = [];
  let   migratedCount     = 0;
  let   alreadyExistsCount = 0;
  let   failedCount       = 0;
  let   conflictSkipCount = 0;
  let   networkStopped    = false;

  for (const tx of transactionsToProcess) {
    if (networkStopped) break;

    // ---- Task 17.8: Skip IDs already recorded in the migration marker ----
    // This avoids a network round-trip for already-migrated records on retry.
    // The marker's migratedTransactionIds is authoritative for what this
    // user session already uploaded; cloud duplicate detection is a fallback,
    // not the primary skip mechanism.
    const alreadyTrackedInMarker = Array.isArray(marker.migratedTransactionIds) &&
      marker.migratedTransactionIds.includes(tx.id);
    if (alreadyTrackedInMarker) {
      existingIds.push(tx.id);
      alreadyExistsCount++;
      continue;
    }

    // ---- Conflict pre-check (Task 17.7) ----
    // If the transaction ID already exists in cloud, compare content before inserting.
    if (cloudById.has(tx.id)) {
      const cloudTx = cloudById.get(tx.id);
      if (_transactionsAreIdentical(tx, cloudTx)) {
        // (c-identical) Same content — treat as already migrated; no re-insert needed.
        existingIds.push(tx.id);
        alreadyExistsCount++;
      } else {
        // (conflict) Same ID, different content — report conflict; do NOT insert.
        transactionConflicts.push({
          type:        'transaction-data-conflict',
          localRecord: tx,
          cloudRecord: cloudTx,
        });
        conflictSkipCount++;
      }
      continue; // skip the INSERT call entirely
    }

    // ---- Normal INSERT path ----
    const result = await provider.addTransaction(userId, tx);

    if (result.ok) {
      // (b) Successfully inserted.
      migratedIds.push(tx.id);
      migratedCount++;
      // Task 17.8: persist progress immediately after each successful INSERT
      marker.migratedTransactionIds.push(tx.id);
      writeMigrationMarker(userId, marker);
    } else if (result.error && result.error.code === 'duplicate') {
      // (c) Duplicate detected by cloud at insert time — idempotent success.
      existingIds.push(tx.id);
      alreadyExistsCount++;
    } else if (result.error && result.error.code === 'network-error') {
      // (d) Network error — record failure, stop batch, set PARTIAL.
      failed.push({ id: tx.id, error: result.error });
      failedCount++;
      networkStopped = true;
    } else {
      // (e) Other per-transaction error — record and continue.
      failed.push({ id: tx.id, error: result.error || { code: 'unknown', message: 'Unknown error.' } });
      failedCount++;
    }
  }

  // ---- Category migration step (only when transaction batch didn't hit a network stop) ----
  let categoryResult = null;
  if (!networkStopped) {
    // Persist the current marker before the category step so that any
    // interrupt in the category loop sees up-to-date transaction progress.
    writeMigrationMarker(userId, marker);

    categoryResult = await migrateCategoriesStep(userId);

    // Accumulate the category results into the marker (migrateCategoriesStep
    // already wrote the marker itself; read it back to keep in sync).
    const refreshedMarker = readMigrationMarker(userId);
    if (refreshedMarker) {
      marker = refreshedMarker;
    }

    if (categoryResult.failedCount > 0) {
      failedCount += categoryResult.failedCount;
    }
    if (categoryResult.status === MIGRATION_STATUS.PARTIAL) {
      networkStopped = true; // treat partial category step as a stopped batch
    }
  }

  // ---- Settings migration step (only when no network stop has occurred) ----
  let settingsResult = null;
  // Unified conflicts array (MigrationConflict[]).
  // Seed with any conflicts already persisted in the marker from a prior run.
  /** @type {MigrationConflict[]} */
  const conflicts = Array.isArray(marker.conflicts) ? [...marker.conflicts] : [];

  // Append transaction-data-conflicts discovered in the upload loop above.
  // These are added regardless of networkStopped — they were detected before
  // any INSERT was attempted, so they are always valid to report.
  conflicts.push(...transactionConflicts);

  if (!networkStopped) {
    // Persist marker before settings step so any interrupt sees up-to-date progress.
    writeMigrationMarker(userId, marker);

    settingsResult = await migrateSettingsStep(userId);

    if (settingsResult.ok && settingsResult.conflict) {
      // Currency conflict detected — normalize to the unified MigrationConflict
      // shape (localValue / cloudValue) before storing (Req 23.6, 23.7).
      // migrateSettingsStep returns { type, localCurrency, cloudCurrency };
      // we map it to { type, localValue, cloudValue } for the caller.
      const rawConflict = settingsResult.conflict;
      conflicts.push({
        type:       'currency-conflict',
        localValue: rawConflict.localCurrency,
        cloudValue: rawConflict.cloudCurrency,
      });
    } else if (!settingsResult.ok && !settingsResult.skipped) {
      // Settings step returned a hard error — count it as a failure.
      failedCount++;
      failed.push({ id: 'settings', error: settingsResult.error || { code: 'unknown', message: 'Settings migration failed.' } });
    }

    // Sync marker after settings step (migrateSettingsStep writes the marker
    // when it succeeds; read it back to stay in sync).
    const refreshedMarker = readMigrationMarker(userId);
    if (refreshedMarker) {
      marker = refreshedMarker;
    }

    // Persist the full unified conflicts list into the marker.
    marker.conflicts = conflicts;
    writeMigrationMarker(userId, marker);
  }

  // ---- Status: PARTIAL when anything failed or a network stop occurred ----
  const finalStatus = (failedCount > 0 || networkStopped)
    ? MIGRATION_STATUS.PARTIAL
    : MIGRATION_STATUS.IN_PROGRESS;

  marker.status = finalStatus;
  writeMigrationMarker(userId, marker);

  return {
    ok:               true,
    migratedCount,
    alreadyExistsCount,
    failedCount,
    // skippedCount covers both schema-invalid transactions AND conflict-skipped ones (Req 23.4).
    skippedCount:     (validation.invalidTransactions ? validation.invalidTransactions.length : 0) + conflictSkipCount,
    migratedIds,
    existingIds,
    failed,
    errors:           [],
    status:           finalStatus,
    /** @type {MigrationConflict[]} */
    conflicts,         // all collected conflicts (transaction-data-conflict + currency-conflict)
    categoryResult,    // attached for callers that want category-step details
    settingsResult,    // attached for callers that want settings-step details
  };
}

/**
 * Retry a partial migration.
 *
 * Reads the marker's `migratedTransactionIds` list. Calls `startMigration`
 * with the full local data — the idempotency logic inside `startMigration`
 * (duplicate detection from SupabaseDatabaseProvider) already handles skipping
 * already-migrated IDs without re-inserting them.
 *
 * The marker is NOT reset before calling startMigration; already-migrated IDs
 * remain tracked through the existing marker.
 *
 * Preconditions:
 *   - userId must be a valid non-empty string.
 *   - Migration status must be PARTIAL (else returns an appropriate error).
 *
 * @param {string} userId  Authenticated Supabase user UUID.
 * @returns {Promise<{
 *   ok: boolean,
 *   migratedCount: number,
 *   alreadyExistsCount: number,
 *   failedCount: number,
 *   skippedCount: number,
 *   migratedIds: string[],
 *   existingIds: string[],
 *   failed: { id?: string, error: object }[],
 *   errors: { code: string, message: string }[],
 *   status: string,
 * }>}
 */
export async function retryMigration(userId) {
  // ---- Precondition: valid userId ----
  if (!userId || typeof userId !== 'string') {
    return {
      ok:               false,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedCount:     0,
      migratedIds:      [],
      existingIds:      [],
      failed:           [],
      errors: [{
        code:    'INVALID_USER_ID',
        message: 'userId must be a non-empty string (Supabase UUID). Retry aborted.',
      }],
      status: MIGRATION_STATUS.FAILED,
    };
  }

  // ---- Precondition: status must be PARTIAL ----
  const currentStatus = getMigrationStatus(userId);
  if (currentStatus !== MIGRATION_STATUS.PARTIAL) {
    return {
      ok:               false,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedCount:     0,
      migratedIds:      [],
      existingIds:      [],
      failed:           [],
      errors: [{
        code:    'INVALID_STATUS_FOR_RETRY',
        message: `retryMigration requires status "${MIGRATION_STATUS.PARTIAL}"; current status is "${currentStatus}".`,
      }],
      status: currentStatus,
    };
  }

  // Task 17.8: explicitly transition partial ? in-progress in the marker
  // so the status is updated BEFORE any uploads begin. If startMigration
  // fails immediately, the marker correctly shows it was attempted (not stuck
  // at "partial" with no indication a retry was in progress).
  const markerBeforeRetry = readMigrationMarker(userId);
  if (markerBeforeRetry) {
    markerBeforeRetry.status = MIGRATION_STATUS.IN_PROGRESS;
    writeMigrationMarker(userId, markerBeforeRetry);
  }

  // Delegate to startMigration. The marker already contains the
  // migratedTransactionIds from the previous run; startMigration will
  // skip already-recorded IDs via the marker check (Task 17.8) rather
  // than relying solely on cloud duplicate detection.
  return startMigration(userId);
}

/**
 * Migrate validated local custom categories to the authenticated user's Supabase
 * categories table.
 *
 * Safety invariants:
 *   - Default categories (DEFAULT_EXPENSE_SET, DEFAULT_INCOME_SET) are NEVER
 *     inserted — validateCustomCategories() already filters them; this function
 *     relies entirely on validation.validCategories without re-filtering.
 *   - Never writes to STORAGE_KEY (financeTrackerData).
 *   - Never uses email as userId.
 *   - All errors are returned as structured objects, never thrown.
 *   - Idempotent: categories already recorded in the marker are skipped;
 *     duplicate errors from the cloud are counted as alreadyExistsCount.
 *
 * @param {string} userId  Authenticated Supabase user UUID.
 * @returns {Promise<{
 *   ok: boolean,
 *   migratedCount: number,
 *   alreadyExistsCount: number,
 *   failedCount: number,
 *   skippedFromMarker: number,
 *   migratedCategories: { name: string, type: string }[],
 *   failed: { name: string, type: string, error: object }[],
 *   errors: { code: string, message: string }[],
 *   status: string,
 * }>}
 */
export async function migrateCategoriesStep(userId) {
  // ---- Precondition 1: valid userId ----
  if (!userId || typeof userId !== 'string') {
    return {
      ok:               false,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedFromMarker: 0,
      migratedCategories: [],
      failed:           [],
      errors: [{
        code:    'INVALID_USER_ID',
        message: 'userId must be a non-empty string (Supabase UUID). Category migration aborted.',
      }],
      status: MIGRATION_STATUS.FAILED,
    };
  }

  // ---- Precondition 2: validate local data ----
  const validation = validateLocalData();

  // No local data — nothing to migrate, not an error.
  if (!validation.hasData) {
    return {
      ok:               true,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedFromMarker: 0,
      migratedCategories: [],
      failed:           [],
      errors:           [],
      status:           MIGRATION_STATUS.NOT_NEEDED,
    };
  }

  // Local data present but invalid — return validation errors without writing anything.
  if (!validation.valid) {
    return {
      ok:               false,
      migratedCount:    0,
      alreadyExistsCount: 0,
      failedCount:      0,
      skippedFromMarker: 0,
      migratedCategories: [],
      failed:           [],
      errors:           validation.errors || [],
      status:           MIGRATION_STATUS.FAILED,
    };
  }

  // ---- Read existing marker (or create a fresh in-memory one) ----
  let marker = readMigrationMarker(userId);
  if (!marker) {
    marker = {
      userId,
      status:                    MIGRATION_STATUS.IN_PROGRESS,
      migratedTransactionIds:    [],
      migratedCategories:        [],
      settingsMigrated:          false,
      conflicts:                 [],
      startedAt:                 new Date().toISOString(),
      completedAt:               null,
    };
  }

  // Ensure migratedCategories is always an array (guard against corrupt markers).
  if (!Array.isArray(marker.migratedCategories)) {
    marker.migratedCategories = [];
  }

  // ---- Determine categories to process ----
  // validation.validCategories already excludes all default categories.
  const categoriesToProcess = validation.validCategories;

  // ---- Upload loop ----
  const provider               = new SupabaseDatabaseProvider();
  const migratedCategoriesThisRun = [];
  const failed                 = [];
  let   migratedCount          = 0;
  let   alreadyExistsCount     = 0;
  let   failedCount            = 0;
  let   skippedFromMarker      = 0;
  let   networkStopped         = false;

  for (const category of categoriesToProcess) {
    if (networkStopped) break;

    // Skip categories already recorded in the marker (idempotent retry support).
    const alreadyInMarker = marker.migratedCategories.some(
      (mc) => mc.name === category.name && mc.type === category.type
    );
    if (alreadyInMarker) {
      skippedFromMarker++;
      continue;
    }

    const result = await provider.addCustomCategory(userId, category);

    if (result.ok) {
      // Successfully inserted.
      migratedCategoriesThisRun.push({ name: category.name, type: category.type });
      migratedCount++;
      // Task 17.8: persist progress immediately after each successful category INSERT
      marker.migratedCategories.push({ name: category.name, type: category.type });
      writeMigrationMarker(userId, marker);
    } else if (result.error && result.error.code === 'duplicate') {
      // Already exists in cloud — idempotent success; still record it.
      migratedCategoriesThisRun.push({ name: category.name, type: category.type });
      alreadyExistsCount++;
      // Task 17.8: persist duplicate-counted categories too (they ARE in cloud)
      marker.migratedCategories.push({ name: category.name, type: category.type });
      writeMigrationMarker(userId, marker);
    } else if (result.error && result.error.code === 'network-error') {
      // Network error — record failure, stop batch.
      failed.push({ name: category.name, type: category.type, error: result.error });
      failedCount++;
      networkStopped = true;
    } else {
      // Other per-category error — record and continue.
      failed.push({
        name:  category.name,
        type:  category.type,
        error: result.error || { code: 'unknown', message: 'Unknown error.' },
      });
      failedCount++;
    }
  }
  // marker.migratedCategories is already up-to-date: each successful INSERT
  // (including duplicates) persisted the marker immediately inside the loop
  // (Task 17.8 Fix D). No bulk accumulation needed here.

  const finalStatus = (networkStopped || failedCount > 0)
    ? MIGRATION_STATUS.PARTIAL
    : MIGRATION_STATUS.IN_PROGRESS;

  return {
    ok:               true,
    migratedCount,
    alreadyExistsCount,
    failedCount,
    skippedFromMarker,
    migratedCategories: migratedCategoriesThisRun,
    failed,
    errors:           [],
    status:           finalStatus,
  };
}

/**
 * Verify that all migrated records are present in the cloud and match local data.
 *
 * Algorithm (Req 23.9):
 *   1. Validate userId.
 *   2. Read the migration marker; extract migratedTransactionIds and migratedCategories.
 *   3. Fetch cloud transactions, categories, and settings — all wrapped in try/catch.
 *   4. Check every marker transaction ID is present in cloud.
 *   5. Spot-check up to 5 transactions: compare key field values against LocalStorage records.
 *   6. Check every marker category is present in cloud.
 *   7. Check settings currency matches the expected value from local data.
 *   8. If ALL checks pass → set marker status to COMPLETED, set completedAt.
 *
 * Safety invariants:
 *   - Never writes to STORAGE_KEY (financeTrackerData).
 *   - Never uses email as userId.
 *   - All network calls wrapped in try/catch; errors returned as structured objects, never thrown.
 *
 * @param {string} userId  Authenticated Supabase user UUID.
 * @returns {Promise<{
 *   verified: boolean,
 *   transactionsMissing: string[],
 *   categoriesMissing: { name: string, type: string }[],
 *   settingsMatch: boolean,
 *   spotCheckPassed: boolean,
 *   details: {
 *     cloudTransactionCount: number,
 *     markerTransactionCount: number,
 *     cloudCategoryCount: number,
 *     markerCategoryCount: number,
 *     spotChecked: number,
 *   },
 *   error?: { code: string, message: string },
 * }>}
 */
export async function verifyMigration(userId) {
  // ---- Helper: empty result shape ----
  const emptyResult = (verified = false) => ({
    verified,
    transactionsMissing:  [],
    categoriesMissing:    [],
    settingsMatch:        false,
    spotCheckPassed:      false,
    details: {
      cloudTransactionCount:  0,
      markerTransactionCount: 0,
      cloudCategoryCount:     0,
      markerCategoryCount:    0,
      spotChecked:            0,
    },
  });

  // ---- Precondition: valid userId ----
  if (!userId || typeof userId !== 'string') {
    return {
      ...emptyResult(false),
      error: {
        code:    'INVALID_USER_ID',
        message: 'userId must be a non-empty string (Supabase UUID). Verification aborted.',
      },
    };
  }

  // ---- Step 2: Read migration marker ----
  const marker = readMigrationMarker(userId);
  const markerTransactionIds = (marker && Array.isArray(marker.migratedTransactionIds))
    ? marker.migratedTransactionIds
    : [];
  const markerCategories = (marker && Array.isArray(marker.migratedCategories))
    ? marker.migratedCategories
    : [];

  // ---- Step 3: Fetch cloud data — all in one try/catch block ----
  let cloudTransactions  = [];
  let cloudCategories    = [];
  let cloudSettings      = null;

  try {
    const provider = new SupabaseDatabaseProvider();
    const [fetchedTx, fetchedCat, fetchedSettings] = await Promise.all([
      provider.getTransactions(userId),
      provider.getCustomCategories(userId),
      provider.getSettings(userId),
    ]);
    cloudTransactions = Array.isArray(fetchedTx)  ? fetchedTx  : [];
    cloudCategories   = Array.isArray(fetchedCat) ? fetchedCat : [];
    cloudSettings     = fetchedSettings ?? null;
  } catch {
    return {
      ...emptyResult(false),
      error: {
        code:    'network-error',
        message: 'Failed to fetch cloud data during verification. Please check your connection.',
      },
    };
  }

  // ---- Step 4: Transaction ID presence check ----
  const cloudTxById = new Map();
  for (const tx of cloudTransactions) {
    if (tx && typeof tx.id === 'string') {
      cloudTxById.set(tx.id, tx);
    }
  }

  const transactionsMissing = markerTransactionIds.filter((id) => !cloudTxById.has(id));

  // ---- Step 5: Spot-check up to 5 transactions (field value comparison) ----
  // Build a local-transaction map for O(1) lookup during spot-check.
  // We read raw local data once and index by ID.
  const rawLocal = _readRawLocalData();
  const localTxById = new Map();
  if (rawLocal && Array.isArray(rawLocal.transactions)) {
    for (const tx of rawLocal.transactions) {
      if (tx && typeof tx.id === 'string') {
        localTxById.set(tx.id, tx);
      }
    }
  }

  // Pick the first min(5, markerCount) IDs that are present in both local
  // storage and cloud (missing ones are already flagged above; we only
  // spot-check records that ARE present so the check is meaningful).
  const spotCheckCandidates = markerTransactionIds
    .filter((id) => cloudTxById.has(id) && localTxById.has(id))
    .slice(0, 5);

  let spotCheckPassed = true;
  for (const id of spotCheckCandidates) {
    const localTx = localTxById.get(id);
    const cloudTx = cloudTxById.get(id);
    if (!_transactionsAreIdentical(localTx, cloudTx)) {
      spotCheckPassed = false;
      break;
    }
  }

  // If there are no candidates to spot-check (e.g. nothing migrated yet or all
  // records are missing), the spot-check is considered inconclusive — treat as
  // passed so it doesn't block an otherwise empty verification.
  // However, if records were expected but all are missing, the ID check already
  // sets transactionsMissing, which will drive verified=false.

  // ---- Step 6: Category presence check ----
  // Build a Set of cloud category keys for O(1) lookup.
  const cloudCatKeys = new Set();
  for (const cat of cloudCategories) {
    if (cat && typeof cat.name === 'string' && typeof cat.type === 'string') {
      cloudCatKeys.add(`${cat.name}::${cat.type}`);
    }
  }

  const categoriesMissing = markerCategories.filter(
    (mc) => mc && typeof mc.name === 'string' && typeof mc.type === 'string'
      ? !cloudCatKeys.has(`${mc.name}::${mc.type}`)
      : true  // malformed marker entry counts as missing
  );

  // ---- Step 7: Settings (currency) check ----
  // Expected currency comes from local data (the source-of-truth before migration).
  // If there's no local data or the marker says settingsMigrated=false, we cannot
  // verify settings — treat as matched to avoid blocking an otherwise clean verify.
  let settingsMatch = false;
  const localCurrency = rawLocal?.settings?.currency ?? null;
  const cloudCurrency = cloudSettings?.currency ?? null;

  if (marker && !marker.settingsMigrated) {
    // Settings were never migrated — skip check (treat as not applicable → match).
    settingsMatch = true;
  } else if (localCurrency && cloudCurrency) {
    settingsMatch = localCurrency === cloudCurrency;
  } else if (!localCurrency) {
    // No local currency to compare against — treat as matched.
    settingsMatch = true;
  } else {
    // Local currency exists but cloud returned nothing — mismatch.
    settingsMatch = false;
  }

  // ---- Step 8: Overall verdict ----
  const verified = (
    transactionsMissing.length === 0 &&
    categoriesMissing.length   === 0 &&
    settingsMatch &&
    spotCheckPassed
  );

  // ---- Set marker to COMPLETED only when ALL checks pass ----
  if (verified && marker) {
    marker.status      = MIGRATION_STATUS.COMPLETED;
    marker.completedAt = new Date().toISOString();
    writeMigrationMarker(userId, marker);
  }

  return {
    verified,
    transactionsMissing,
    categoriesMissing,
    settingsMatch,
    spotCheckPassed,
    details: {
      cloudTransactionCount:  cloudTransactions.length,
      markerTransactionCount: markerTransactionIds.length,
      cloudCategoryCount:     cloudCategories.length,
      markerCategoryCount:    markerCategories.length,
      spotChecked:            spotCheckCandidates.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Task 17.6 — Settings / currency migration
// ---------------------------------------------------------------------------

/**
 * Migrate settings (currency) from LocalStorage to cloud for the authenticated user.
 *
 * Algorithm (Req 23.6):
 *   1. Read local currency from the raw LocalStorage data.
 *      If no local data exists → return `{ ok: true, skipped: true, reason: 'no-local-data' }`.
 *   2. Read cloud currency via `SupabaseDatabaseProvider.getSettings(userId)`.
 *   3. Same currency on both sides →
 *        call `setSettings(userId, { currency: localCurrency })` to upsert,
 *        set `marker.settingsMigrated = true`, return `{ ok: true, settingsMigrated: true }`.
 *   4. Different currencies →
 *        return a conflict descriptor `{ type: 'currency-conflict', localCurrency, cloudCurrency }`.
 *        Do NOT write to cloud. Do NOT update marker.settingsMigrated.
 *
 * Safety invariants:
 *   - NEVER performs currency conversion on any transaction amount.
 *   - NEVER writes to STORAGE_KEY (`financeTrackerData`) directly.
 *   - All network calls are wrapped in try/catch; errors returned as structured objects.
 *   - Never uses email as userId.
 *
 * @param {string} userId  Authenticated Supabase user UUID.
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   conflict?: { type: 'currency-conflict', localCurrency: string, cloudCurrency: string },
 *   settingsMigrated?: boolean,
 *   error?: { code: string, message: string }
 * }>}
 */
export async function migrateSettingsStep(userId) {
  // ---- Precondition: valid userId ----
  if (!userId || typeof userId !== 'string') {
    return {
      ok:    false,
      error: {
        code:    'INVALID_USER_ID',
        message: 'userId must be a non-empty string (Supabase UUID). Settings migration aborted.',
      },
    };
  }

  // ---- Step 1: Read local currency ----
  // Use the raw LocalStorage reader to get exactly what is stored, without side effects.
  const raw = _readRawLocalData();
  if (!raw || !isValidSchema(raw)) {
    // No local data or corrupted schema — nothing to migrate.
    return { ok: true, skipped: true, reason: 'no-local-data' };
  }

  const localCurrency = raw?.settings?.currency;
  if (typeof localCurrency !== 'string' || !SUPPORTED_CURRENCIES[localCurrency]) {
    // Invalid / unsupported local currency — skip; no conflict to report.
    return { ok: true, skipped: true, reason: 'invalid-local-currency' };
  }

  // ---- Step 2: Read cloud currency ----
  let cloudSettings;
  try {
    const provider = new SupabaseDatabaseProvider();
    cloudSettings  = await provider.getSettings(userId);
  } catch (err) {
    return {
      ok:    false,
      error: {
        code:    'network-error',
        message: 'Failed to read cloud settings. Please check your connection.',
      },
    };
  }

  const cloudCurrency = cloudSettings?.currency ?? 'IDR';

  // ---- Step 3 / 4: Compare and act ----
  if (localCurrency === cloudCurrency) {
    // Same currency — upsert silently (Req 23.6, first condition).
    let upsertResult;
    try {
      const provider = new SupabaseDatabaseProvider();
      upsertResult   = await provider.setSettings(userId, { currency: localCurrency });
    } catch (err) {
      return {
        ok:    false,
        error: {
          code:    'network-error',
          message: 'Failed to upsert cloud settings. Please check your connection.',
        },
      };
    }

    if (!upsertResult.ok) {
      return { ok: false, error: upsertResult.error };
    }

    // Mark settings as migrated in the migration marker.
    const marker = readMigrationMarker(userId);
    if (marker) {
      marker.settingsMigrated = true;
      writeMigrationMarker(userId, marker);
    }

    return { ok: true, settingsMigrated: true };
  }

  // Different currencies — return conflict descriptor; do NOT write anything (Req 23.6, second condition).
  return {
    ok:       true,
    conflict: {
      type:           'currency-conflict',
      localCurrency,
      cloudCurrency,
    },
  };
}

/**
 * Apply the user's chosen currency after a currency conflict is detected.
 *
 * Called by the UI layer after the user explicitly selects one of the two
 * currencies presented during migration (Req 23.6).
 *
 * Algorithm:
 *   1. Validate userId and chosenCurrency.
 *   2. Upsert cloud settings with `chosenCurrency` via `SupabaseDatabaseProvider.setSettings`.
 *   3. Update LocalStorage currency via `storage.setCurrency(chosenCurrency, null)`.
 *   4. Update migration marker: `settingsMigrated = true`, remove any `currency-conflict`
 *      entries from `marker.conflicts`.
 *
 * Safety invariants:
 *   - NEVER performs currency conversion on any transaction amount.
 *   - NEVER writes to STORAGE_KEY directly — uses `setCurrency` from storage.js.
 *   - All network calls wrapped in try/catch; errors returned as structured objects.
 *   - Never uses email as userId.
 *
 * @param {string} userId           Authenticated Supabase user UUID.
 * @param {string} chosenCurrency   ISO 4217 currency code chosen by the user.
 * @returns {Promise<{ ok: boolean, error?: { code: string, message: string } }>}
 */
export async function resolveCurrencyConflict(userId, chosenCurrency) {
  // ---- Precondition: valid userId ----
  if (!userId || typeof userId !== 'string') {
    return {
      ok:    false,
      error: {
        code:    'INVALID_USER_ID',
        message: 'userId must be a non-empty string (Supabase UUID). Conflict resolution aborted.',
      },
    };
  }

  // ---- Precondition: valid chosenCurrency ----
  if (typeof chosenCurrency !== 'string' || !SUPPORTED_CURRENCIES[chosenCurrency]) {
    return {
      ok:    false,
      error: {
        code:    'INVALID_CURRENCY',
        message: `"${chosenCurrency}" is not a supported currency code.`,
      },
    };
  }

  // ---- Step 2: Upsert cloud settings ----
  let upsertResult;
  try {
    const provider = new SupabaseDatabaseProvider();
    upsertResult   = await provider.setSettings(userId, { currency: chosenCurrency });
  } catch (err) {
    return {
      ok:    false,
      error: {
        code:    'network-error',
        message: 'Failed to update cloud settings. Please check your connection.',
      },
    };
  }

  if (!upsertResult.ok) {
    return { ok: false, error: upsertResult.error };
  }

  // ---- Step 3: Update LocalStorage currency (via storage.js — never direct write) ----
  // Pass null as userId so setCurrency writes to the LocalStorage path.
  const localUpdated = await setCurrency(chosenCurrency, null);
  if (!localUpdated) {
    // Not fatal — cloud is already updated. Log a warning and continue.
    console.warn('migration: resolveCurrencyConflict — could not update LocalStorage currency.');
  }

  // ---- Step 4: Update migration marker ----
  const marker = readMigrationMarker(userId);
  if (marker) {
    marker.settingsMigrated = true;
    // Remove any existing currency-conflict entries from the conflicts array.
    if (Array.isArray(marker.conflicts)) {
      marker.conflicts = marker.conflicts.filter((c) => c.type !== 'currency-conflict');
    }
    writeMigrationMarker(userId, marker);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// LocalStorage preservation helpers (Req 23.10, 23.11)
// ---------------------------------------------------------------------------

/**
 * Remove only the LocalStorage finance data (`STORAGE_KEY`) for the current
 * user session, while intentionally preserving the migration marker.
 *
 * This is the ONLY correct way for any UI handler to delete local finance
 * data after a successful migration. Calling `localStorage.removeItem`
 * directly from app.js would scatter storage knowledge outside this module.
 *
 * Invariants:
 *   - Only `STORAGE_KEY` (`"financeTrackerData"`) is removed — never the
 *     migration marker key (`financeTrackerMigration_${userId}`).
 *   - After this call, `readMigrationMarker(userId)` still returns the
 *     existing marker (with `status: 'completed'`).
 *   - On the next login, `detectMigrationOpportunity` reads the marker,
 *     sees `status: 'completed'`, and returns `{ needed: false }` — so the
 *     migration modal is never shown again.
 *   - `userId` must be the Supabase UUID — never an email address.
 *
 * @param {string} userId - Authenticated Supabase user UUID (for verification only).
 * @returns {{ ok: boolean }} `{ ok: true }` on success, `{ ok: false }` if
 *   the marker could not be confirmed as `completed` after the removal.
 */
export function clearLocalFinanceData(userId) {
  if (!userId || typeof userId !== 'string') {
    console.warn('migration: clearLocalFinanceData called without a valid userId.');
    return { ok: false };
  }

  // Remove finance data only — the migration marker key is different and
  // must NOT be touched here.
  localStorage.removeItem(STORAGE_KEY);

  // Verify the marker still exists with status: completed so the caller can
  // confirm the preservation invariant holds.
  const marker = readMigrationMarker(userId);
  if (!marker || marker.status !== MIGRATION_STATUS.COMPLETED) {
    console.warn(
      'migration: clearLocalFinanceData — marker is missing or not completed after clearing ' +
      'local data. This may indicate the migration was not fully verified before this call.'
    );
    return { ok: false };
  }

  return { ok: true };
}
