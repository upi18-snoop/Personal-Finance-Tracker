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
 * SUPPORTED_CURRENCIES — single source of truth for the selectable ISO 4217
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
  // ── Non-Asian (existing, preserved) ──────────────────────────────────────
  USD: { locale: "en-US",  label: "US Dollar"              },
  EUR: { locale: "de-DE",  label: "Euro"                   },
  GBP: { locale: "en-GB",  label: "British Pound"          },
  AUD: { locale: "en-AU",  label: "Australian Dollar"      },
  CAD: { locale: "en-CA",  label: "Canadian Dollar"        },
  CHF: { locale: "de-CH",  label: "Swiss Franc"            },

  // ── East Asia ─────────────────────────────────────────────────────────────
  CNY: { locale: "zh-CN",  label: "Chinese Yuan"           },
  HKD: { locale: "zh-HK",  label: "Hong Kong Dollar"       },
  JPY: { locale: "ja-JP",  label: "Japanese Yen"           },
  KRW: { locale: "ko-KR",  label: "South Korean Won"       },
  MNT: { locale: "mn-MN",  label: "Mongolian Tögrög"       },
  MOP: { locale: "zh-MO",  label: "Macanese Pataca"        },
  TWD: { locale: "zh-TW",  label: "New Taiwan Dollar"      },

  // ── Southeast Asia ────────────────────────────────────────────────────────
  BND: { locale: "ms-BN",  label: "Brunei Dollar"          },
  IDR: { locale: "id-ID",  label: "Indonesian Rupiah"      },
  KHR: { locale: "km-KH",  label: "Cambodian Riel"         },
  LAK: { locale: "lo-LA",  label: "Lao Kip"                },
  MMK: { locale: "my-MM",  label: "Myanmar Kyat"           },
  MYR: { locale: "ms-MY",  label: "Malaysian Ringgit"      },
  PHP: { locale: "fil-PH", label: "Philippine Peso"        },
  SGD: { locale: "en-SG",  label: "Singapore Dollar"       },
  THB: { locale: "th-TH",  label: "Thai Baht"              },
  VND: { locale: "vi-VN",  label: "Vietnamese Dong"        },

  // ── South Asia ────────────────────────────────────────────────────────────
  BDT: { locale: "bn-BD",  label: "Bangladeshi Taka"       },
  BTN: { locale: "dz-BT",  label: "Bhutanese Ngultrum"     },
  INR: { locale: "en-IN",  label: "Indian Rupee"           },
  LKR: { locale: "si-LK",  label: "Sri Lankan Rupee"       },
  MVR: { locale: "dv-MV",  label: "Maldivian Rufiyaa"      },
  NPR: { locale: "ne-NP",  label: "Nepalese Rupee"         },
  PKR: { locale: "ur-PK",  label: "Pakistani Rupee"        },

  // ── Central Asia ──────────────────────────────────────────────────────────
  KGS: { locale: "ky-KG",  label: "Kyrgyzstani Som"        },
  KZT: { locale: "kk-KZ",  label: "Kazakhstani Tenge"      },
  UZS: { locale: "uz-UZ",  label: "Uzbekistani Som"        },

  // ── West Asia / Middle East ───────────────────────────────────────────────
  AED: { locale: "ar-AE",  label: "UAE Dirham"             },
  AMD: { locale: "hy-AM",  label: "Armenian Dram"          },
  AZN: { locale: "az-AZ",  label: "Azerbaijani Manat"      },
  BHD: { locale: "ar-BH",  label: "Bahraini Dinar"         },
  GEL: { locale: "ka-GE",  label: "Georgian Lari"          },
  ILS: { locale: "he-IL",  label: "Israeli New Shekel"     },
  IQD: { locale: "ar-IQ",  label: "Iraqi Dinar"            },
  IRR: { locale: "fa-IR",  label: "Iranian Rial"           },
  JOD: { locale: "ar-JO",  label: "Jordanian Dinar"        },
  KWD: { locale: "ar-KW",  label: "Kuwaiti Dinar"          },
  OMR: { locale: "ar-OM",  label: "Omani Rial"             },
  QAR: { locale: "ar-QA",  label: "Qatari Riyal"           },
  SAR: { locale: "ar-SA",  label: "Saudi Riyal"            },
  YER: { locale: "ar-YE",  label: "Yemeni Rial"            },
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
    // Do not force fraction digits — let Intl.NumberFormat use each currency's
    // natural decimal count (0 for IDR/JPY/KRW/VND, 2 for USD/EUR/SGD, 3 for KWD/BHD/OMR).
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
