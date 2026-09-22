/*
 * utils.js — Shared leaf layer.
 *
 * Single responsibility: pure helpers used across every layer — currency
 * formatting (the Currency_Formatter), id generation, date parsing/validation,
 * month-key helpers, blank-string checks, and safe DOM text writing.
 *
 * Layer: Shared leaf. Imports NOTHING app-specific (no DOM state, no storage,
 * no business logic). Any layer may import from here.
 */

/**
 * Currency_Formatter (Req 9). The only place currency strings are produced.
 *
 * Produces Indonesian-style currency strings such as "Rp 1.500.000": a period
 * as the thousands separator and the "Rp" symbol followed by a single space
 * (Req 9.2). Parameterized by `currency` so future currencies can be added
 * without changing any caller (Req 9.5).
 *
 * `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' })` yields
 * "Rp1.500.000" or "Rp 1.500.000" depending on the runtime, and includes a
 * fractional part. We format without fraction digits and normalize the output
 * so there is exactly one space after the "Rp" symbol.
 *
 * @param {number} amount
 * @param {string} [currency="IDR"]
 * @returns {string}
 */
export function formatCurrency(amount, currency = "IDR") {
  const value = Number(amount);
  const safeValue = Number.isFinite(value) ? value : 0;

  const formatted = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safeValue);

  // Normalize so there is exactly one ASCII space after the leading currency
  // symbol, regardless of whether the runtime inserted no space, a regular
  // space, or a non-breaking space (U+00A0). We capture the symbol as the run
  // of non-digit, non-minus, non-whitespace characters, drop any whitespace the
  // runtime placed after it, and re-join with a single ASCII space.
  return formatted.replace(/^(-?)([^\d\s-]+)\s*/u, "$1$2 ");
}

/**
 * Generate a unique id for a transaction/category.
 * @returns {string}
 */
export function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * True only for a real calendar date string (Req 2.8).
 *
 * Accepts ISO-style "YYYY-MM-DD" strings and validates that the parsed date
 * actually corresponds to the given calendar day (rejecting values like
 * "2024-02-30" that overflow into the next month).
 *
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDate(dateStr) {
  if (typeof dateStr !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Reduce a date string to its "YYYY-MM" month key for grouping/comparison.
 * Returns "" for an invalid date.
 * @param {string} dateStr
 * @returns {string}
 */
export function getMonthKey(dateStr) {
  if (!isValidDate(dateStr)) return "";
  return dateStr.trim().slice(0, 7);
}

/**
 * True if the date falls within the given "YYYY-MM" month key.
 * @param {string} dateStr
 * @param {string} monthKey
 * @returns {boolean}
 */
export function isInMonth(dateStr, monthKey) {
  const key = getMonthKey(dateStr);
  return key !== "" && key === monthKey;
}

/**
 * True if the string is empty or whitespace-only (Req 2.5).
 * @param {string} str
 * @returns {boolean}
 */
export function isBlank(str) {
  return typeof str !== "string" || str.trim().length === 0;
}

/**
 * Safely set a node's text. Uses textContent, never innerHTML (Req 15 / security).
 * @param {HTMLElement} node
 * @param {string} value
 * @returns {void}
 */
export function safeText(node, value) {
  if (!node) return;
  node.textContent = value == null ? "" : String(value);
}
