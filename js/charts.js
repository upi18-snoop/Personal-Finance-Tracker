/*
 * charts.js — UI / render layer (Chart.js).
 *
 * Single responsibility: own all Chart.js instances (expense-by-category and
 * income-by-category). Exposes init/update/destroy so charts update without
 * duplicates or leaks (Req 16.2). No other module manipulates chart objects.
 *
 * Layer: UI / render. Uses Chart.js (loaded from CDN in index.html) and may use
 * utils.js. MUST NOT import storage.js — UI never touches localStorage directly
 * (Req 10.2, 13.5).
 *
 * NOTE: Stub scaffolding for task 1.3. Real Chart.js wiring arrives in Phase 7
 * (tasks 7.1, 7.2, 7.4, 7.5).
 */

/**
 * Acquire chart canvas contexts once and create the initial Chart instances
 * (Req 6.1, 15.6).
 * @returns {void}
 */
export function initCharts() {
  // no-op stub
}

/**
 * Update the expense-by-category chart from a category-total map; zero-total
 * categories are excluded by callers (Req 6.2).
 * @param {Map<string, number>} categoryTotals
 * @returns {void}
 */
export function updateExpenseChart(categoryTotals) {
  // no-op stub
}

/**
 * Update the income-by-category chart from a category-total map; zero-total
 * categories are excluded by callers (Req 7.3).
 * @param {Map<string, number>} categoryTotals
 * @returns {void}
 */
export function updateIncomeChart(categoryTotals) {
  // no-op stub
}

/**
 * Destroy existing chart instances to prevent duplicates/leaks (Req 16.2).
 * @returns {void}
 */
export function destroyCharts() {
  // no-op stub
}
