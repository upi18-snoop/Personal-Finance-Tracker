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
 * SUPPORTED_CURRENCIES — single source of truth for the 14 selectable ISO 4217
 * currency codes (Req 9.1). Maps each code to its default locale and a human-
 * readable label for the Settings UI.
 *
 * The `locale` entry is the BCP 47 locale tag that Intl.NumberFormat should use
 * when a caller does not supply an explicit locale, ensuring that each currency
 * defaults to its most natural formatting convention.
 *
 * @type {Record<string, { locale: string, label: string }>}
 */
export const SUPPORTED_CURRENCIES = {
  USD: { locale: "en-US",  label: "US Dollar"        },
  EUR: { locale: "de-DE",  label: "Euro"              },
  GBP: { locale: "en-GB",  label: "British Pound"     },
  IDR: { locale: "id-ID",  label: "Indonesian Rupiah" },
  JPY: { locale: "ja-JP",  label: "Japanese Yen"      },
  CNY: { locale: "zh-CN",  label: "Chinese Yuan"      },
  SGD: { locale: "en-SG",  label: "Singapore Dollar"  },
  AUD: { locale: "en-AU",  label: "Australian Dollar" },
  CAD: { locale: "en-CA",  label: "Canadian Dollar"   },
  CHF: { locale: "de-CH",  label: "Swiss Franc"       },
  MYR: { locale: "ms-MY",  label: "Malaysian Ringgit" },
  THB: { locale: "th-TH",  label: "Thai Baht"         },
  INR: { locale: "en-IN",  label: "Indian Rupee"      },
  KRW: { locale: "ko-KR",  label: "South Korean Won"  },
};

/**
 * Currency_Formatter (Req 9). The only place currency strings are produced.
 *
 * Formats `amount` as a currency string for the given `currency` code and
 * `locale` (Req 9.3, 9.4). No locale is hard-coded — when the caller omits
 * `locale`, the default locale for `currency` is resolved from
 * `SUPPORTED_CURRENCIES` (IDR → "id-ID", USD → "en-US", etc.).
 *
 * Backward-compatible: existing callers that pass only `amount` or
 * `(amount, "IDR")` still receive "Rp 1.500.000"-style output because IDR
 * defaults to the "id-ID" locale (Req 9.2 implicit, no regression).
 *
 * The output is normalized so there is exactly one ASCII space after the
 * leading currency symbol regardless of what the runtime inserts (no space,
 * regular space U+0020, or non-breaking space U+00A0).
 *
 * @param {number} amount
 * @param {string} [currency="IDR"]
 * @param {string} [locale] - BCP 47 locale tag; defaults to the locale mapped
 *   in SUPPORTED_CURRENCIES for the given currency, or "en-US" as a last
 *   resort for unknown codes.
 * @returns {string}
 */
export function formatCurrency(amount, currency = "IDR", locale) {
  const value = Number(amount);
  const safeValue = Number.isFinite(value) ? value : 0;

  // Resolve locale: caller-supplied → SUPPORTED_CURRENCIES map → en-US fallback
  const resolvedLocale =
    locale ||
    (SUPPORTED_CURRENCIES[currency] && SUPPORTED_CURRENCIES[currency].locale) ||
    "en-US";

  const formatted = new Intl.NumberFormat(resolvedLocale, {
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
