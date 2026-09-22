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
 * NOTE: Stub scaffolding for task 1.3. Real logic arrives in Phase 8 (task 8.1).
 */

import * as storage from "./storage.js";
import * as utils from "./utils.js";

/**
 * Default categories for the type merged with persisted custom ones (Req 8.4).
 * @param {"income"|"expense"} type
 * @returns {string[]}
 */
export function getCategories(type) {
  return [];
}

/**
 * Add a custom category. Rejects blank/duplicate; persists on success
 * (Req 8.2, 8.3).
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: true } | { ok: false, error: "duplicate" | "invalid" }}
 */
export function addCategory(name, type) {
  return { ok: false, error: "invalid" };
}

/**
 * Delete a custom category. Refused if in use or a default; never deletes
 * transactions (Req 8.6, 8.7, 8.8).
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: true } | { ok: false, error: "in-use" | "default" }}
 */
export function deleteCategory(name, type) {
  return { ok: false, error: "default" };
}

/**
 * Validate a candidate category name for a type.
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: boolean, error?: "duplicate" | "invalid" }}
 */
export function validateCategory(name, type) {
  return { ok: false };
}

/**
 * True if any transaction references the category of the given type (Req 8.7).
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {boolean}
 */
export function isCategoryInUse(name, type) {
  return false;
}
