/*
 * transactions.js — Business logic layer.
 *
 * Single responsibility: transaction CRUD and money math — addTransaction,
 * deleteTransaction, getTransactions, getTransactionsByMonth, calculateTotals
 * (the single source of truth for balance math), the pure filterTransactions
 * view function, and categoryTotals.
 *
 * Layer: Business logic. Imports storage.js and utils.js ONLY. Knows nothing
 * about the DOM.
 *
 * Async update (task 16.6):
 *   All storage-touching functions are now async and accept an optional userId
 *   parameter (default null). A null userId routes to the LocalStorage path in
 *   storage.js; a truthy userId routes to the Supabase path. The new storage
 *   CRUD API (storage.addTransaction, storage.deleteTransaction,
 *   storage.getTransactions) is used for persistence so the business layer no
 *   longer needs to load-mutate-save the full schema.
 *
 *   Pure functions (calculateTotals, filterTransactions, categoryTotals) are
 *   unchanged and remain synchronous.
 */

import * as storage from "./storage.js";
import * as utils from "./utils.js";

/**
 * The two permitted Transaction_Type values (Req 2.2).
 * @type {readonly ["income", "expense"]}
 */
const TRANSACTION_TYPES = ["income", "expense"];

/**
 * Validate input and, on success, create + persist a Transaction (Req 2.4–2.11).
 *
 * Validation (all checked; every failure is reported so the UI can show each
 * inline message, Req 2.4–2.8):
 *   - `type` must be exactly "income" or "expense" (Req 2.2, 2.4).
 *   - `itemName` must be non-blank (Req 2.5).
 *   - `amount` must be a finite number greater than 0 (Req 2.6).
 *   - `category` must be selected / non-blank (Req 2.7).
 *   - `date` must be a valid calendar date (Req 2.8).
 *
 * On any failure it returns `{ ok: false, errors }` and makes NO change to
 * stored state. On success it builds a Transaction with a unique `id` and a
 * `createdAt` timestamp (Req 2.9), persists it via storage.addTransaction
 * (Req 2.10, 2.11), and returns `{ ok: true, transaction }`.
 *
 * @param {object} input TransactionInput { type, itemName, amount, category, date }
 * @param {string|null} [userId=null]
 * @returns {Promise<{ ok: true, transaction: object } | { ok: false, errors: object[] }>}
 */
export async function addTransaction(input, userId = null) {
  const source = input && typeof input === "object" ? input : {};
  const errors = [];

  // Transaction_Type: restricted to the whitelist (Req 2.2, 2.4).
  const type = source.type;
  if (!TRANSACTION_TYPES.includes(type)) {
    errors.push({ field: "type", message: "Transaction type is required" });
  }

  // Item name: non-blank (Req 2.5).
  const itemNameRaw = source.itemName;
  if (utils.isBlank(itemNameRaw)) {
    errors.push({ field: "itemName", message: "Item name is required" });
  }

  // Amount: a number strictly greater than 0 (Req 2.6). Accept numeric strings
  // from form inputs, but reject blanks, NaN, and non-positive values.
  const amount = normalizeAmount(source.amount);
  if (amount === null) {
    errors.push({ field: "amount", message: "Amount must be greater than 0" });
  }

  // Category: selected / non-blank (Req 2.7).
  const categoryRaw = source.category;
  if (utils.isBlank(categoryRaw)) {
    errors.push({ field: "category", message: "Category is required" });
  }

  // Date: a valid calendar date (Req 2.8).
  const date = typeof source.date === "string" ? source.date.trim() : source.date;
  if (!utils.isValidDate(date)) {
    errors.push({ field: "date", message: "A valid date is required" });
  }

  // Any failure → reject with no state change (Req 2.4–2.8).
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build the well-formed Transaction (Req 2.9). Item name is trimmed so the
  // stored value is clean; amount is the normalized number.
  const transaction = {
    id: utils.generateId(),
    type,
    itemName: itemNameRaw.trim(),
    amount,
    category: categoryRaw.trim(),
    date,
    createdAt: new Date().toISOString(),
  };

  // Persist via the storage CRUD API (Req 2.10, 2.11).
  const result = await storage.addTransaction(userId, transaction);
  if (!result.ok) {
    return { ok: false, errors: [{ field: "storage", message: "Failed to save transaction" }] };
  }

  return { ok: true, transaction };
}

/**
 * Coerce a raw amount into a finite number strictly greater than 0, or null if
 * it is not a valid positive amount (Req 2.6). Accepts numbers and numeric
 * strings (form inputs); rejects blanks, NaN, Infinity, and values <= 0.
 * @param {unknown} raw
 * @returns {number|null}
 */
function normalizeAmount(raw) {
  if (typeof raw === "string" && raw.trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Remove the transaction with the given id and persist the updated set
 * (Req 3.5, 3.6). Delegates to storage.deleteTransaction which finds and
 * removes the transaction atomically. Returns `{ ok: true }` when the
 * transaction was found and removed, `{ ok: false }` when the id was absent.
 *
 * @param {string} id
 * @param {string|null} [userId=null]
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteTransaction(id, userId = null) {
  const result = await storage.deleteTransaction(userId, id);
  return result.ok ? { ok: true } : { ok: false };
}

/**
 * All stored transactions, unmodified (Req 3.1). Reads through the storage
 * layer (never localStorage directly). Returns the stored array; callers that
 * need to sort/filter should copy first (the reporting/list views do).
 *
 * @param {string|null} [userId=null]
 * @returns {Promise<object[]>}
 */
export async function getTransactions(userId = null) {
  const transactions = await storage.getTransactions(userId);
  return Array.isArray(transactions) ? transactions : [];
}

/**
 * Transactions whose date falls within the "YYYY-MM" month (Req 5.2). Reads the
 * full stored set and keeps only the transactions whose `date` lands in the
 * given month, using utils.isInMonth so month membership is decided in exactly
 * one place. Returns a NEW array (filter never mutates the stored set); an empty
 * or non-string monthKey matches nothing.
 *
 * @param {string} monthKey
 * @param {string|null} [userId=null]
 * @returns {Promise<object[]>}
 */
export async function getTransactionsByMonth(monthKey, userId = null) {
  const all = await getTransactions(userId);
  return all.filter((tx) => tx && utils.isInMonth(tx.date, monthKey));
}

/**
 * Money math — the SINGLE source of truth (Req 1.5). Pure and synchronous;
 * callers are expected to pass the already-loaded transactions array.
 *
 * @param {object[]} [transactions=[]]
 * @returns {{ totalIncome: number, totalExpense: number, balance: number, count: number }}
 */
export function calculateTotals(transactions = []) {
  const list = Array.isArray(transactions) ? transactions : [];

  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of list) {
    const amount = Number(tx && tx.amount);
    if (!Number.isFinite(amount)) continue;
    if (tx.type === "income") {
      totalIncome += amount;
    } else if (tx.type === "expense") {
      totalExpense += amount;
    }
  }

  // The ONLY place balance math is computed (Req 1.5, design Property 1).
  return {
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    count: list.length,
  };
}

/**
 * Pure, read-only view for the Transaction_List (Req 4). Returns a NEW array;
 * never mutates its input and never writes to storage (Req 4.14).
 *
 * Applies all active criteria as a logical AND (Req 4.8):
 *   - `searchTerm`: case-insensitive substring match on `itemName` (Req 4.2).
 *     Criteria is inactive when the term is blank/absent.
 *   - `type`: "all" matches every transaction (Req 4.5); "income" keeps only
 *     Income_Transactions (Req 4.3); "expense" keeps only Expense_Transactions
 *     (Req 4.4).
 *   - `category`: exact match on the `category` field (Req 4.6). Inactive when
 *     blank/absent (i.e., "" means no category filter).
 *   - `month`: "YYYY-MM" membership check via utils.isInMonth (Req 4.7).
 *     Inactive when blank/absent.
 *
 * The input `transactions` array is never mutated, reordered, or written back
 * (Req 4.14).
 *
 * @param {object[]} transactions
 * @param {object} criteria FilterCriteria { searchTerm, type, category, month }
 * @returns {object[]}
 */
export function filterTransactions(transactions, criteria) {
  const list = Array.isArray(transactions) ? transactions : [];
  const c = criteria && typeof criteria === "object" ? criteria : {};

  // Normalize each criterion so we can test for "active" cleanly.
  const searchTerm = typeof c.searchTerm === "string" ? c.searchTerm.trim().toLowerCase() : "";
  const typeFilter = typeof c.type === "string" ? c.type : "all";
  const categoryFilter = typeof c.category === "string" ? c.category.trim() : "";
  const monthFilter = typeof c.month === "string" ? c.month.trim() : "";

  return list.filter((tx) => {
    if (!tx) return false;

    // 1. Search term — case-insensitive substring match on itemName (Req 4.2).
    if (searchTerm !== "") {
      const name = typeof tx.itemName === "string" ? tx.itemName.toLowerCase() : "";
      if (!name.includes(searchTerm)) return false;
    }

    // 2. Transaction_Type filter (Req 4.3–4.5).
    if (typeFilter === "income" && tx.type !== "income") return false;
    if (typeFilter === "expense" && tx.type !== "expense") return false;
    // typeFilter === "all" passes everything (Req 4.5).

    // 3. Category equality (Req 4.6).
    if (categoryFilter !== "" && tx.category !== categoryFilter) return false;

    // 4. Month membership — uses the same isInMonth helper as reporting scope
    //    so the comparison is consistent everywhere (Req 4.7).
    if (monthFilter !== "" && !utils.isInMonth(tx.date, monthFilter)) return false;

    return true;
  });
}

/**
 * Sum amounts grouped by category for a single type (Req 6.2, 7.3). Iterates the
 * given transactions, keeps only those matching `type`, and accumulates their
 * amounts into a Map keyed by category. Non-finite amounts are skipped so bad
 * data cannot corrupt a total. This function does NOT drop zero-total entries —
 * with positive-only amounts (Req 2.6) no key can sum to zero, and callers are
 * responsible for dropping any zero-total categories (Req 6.2, 7.3).
 *
 * Pure and synchronous; callers pass the already-loaded transactions array.
 *
 * @param {object[]} transactions
 * @param {"income"|"expense"} type
 * @returns {Map<string, number>}
 */
export function categoryTotals(transactions, type) {
  const list = Array.isArray(transactions) ? transactions : [];
  const totals = new Map();

  for (const tx of list) {
    if (!tx || tx.type !== type) continue;

    const amount = Number(tx.amount);
    if (!Number.isFinite(amount)) continue;

    const category = tx.category;
    totals.set(category, (totals.get(category) || 0) + amount);
  }

  return totals;
}
