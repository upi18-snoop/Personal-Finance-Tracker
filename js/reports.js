/*
 * reports.js — UI / render layer.
 *
 * Single responsibility: render the Monthly_Summary for the Selected_Month —
 * monthly income/expense/net balance, monthly transaction count, and the
 * expense-by-category and income-by-category breakdowns.
 *
 * Layer: UI / render. Imports transactions.js and utils.js. MUST NOT import
 * storage.js — UI never touches localStorage directly (Req 10.2, 13.5).
 *
 * Implemented scope (tasks 5.3, 5.4):
 *   - renderMonthlySummary(monthKey, currency): shows the monthly Total_Income,
 *     Total_Expense, Net_Balance, and transaction count for the Selected_Month
 *     (Req 5.3–5.6). All money math is read from calculateTotals() over the
 *     month slice from getTransactionsByMonth() — reports never sums money
 *     itself — and every monetary value is formatted through the
 *     Currency_Formatter with the active Selected_Currency (Req 9.6).
 *   - renderCategoryBreakdown(listElementId, totalsMap, currency): renders
 *     expense-by-category and income-by-category breakdowns for the
 *     Selected_Month (Req 5.7, 5.8, 7.2, 7.4). Only nonzero categories are
 *     shown; amounts are formatted via the Currency_Formatter. DOM writes use
 *     safeText exclusively — never innerHTML.
 */

import * as transactions from "./transactions.js";
import * as utils from "./utils.js";

/**
 * Write a formatted monetary value into a Monthly_Summary element, prefixed
 * with a short label so the value is self-describing (Req 5.3–5.5). The amount
 * is formatted only through utils.formatCurrency with the active
 * Selected_Currency (Req 9.6) and written via safeText (never innerHTML).
 * A missing element is simply skipped.
 * @param {string} elementId
 * @param {string} label
 * @param {number} amount
 * @param {string} currency
 * @returns {void}
 */
function renderMoneyLine(elementId, label, amount, currency) {
  const el = document.getElementById(elementId);
  if (!el) return;
  utils.safeText(el, `${label}: ${utils.formatCurrency(amount, currency)}`);
}

/**
 * Render a category breakdown list for the Selected_Month (Req 5.7, 5.8, 7.2, 7.4).
 *
 * Clears the <ul> identified by `listElementId`, then populates it from
 * `totalsMap` (a Map<string, number> of category → total). Categories whose
 * total is <= 0 are excluded (Req 6.2, 7.3). Each nonzero category becomes a
 * <li class="category-breakdown__item"> containing two <span> children: one for
 * the category name and one for the formatted amount. Amounts are formatted via
 * utils.formatCurrency with the active Selected_Currency (Req 7.4, 9.6). All
 * DOM text is written with safeText — never innerHTML. When there are no nonzero
 * categories, a single <li class="category-breakdown__item--empty"> reads "No
 * data for this month."
 *
 * @param {string} listElementId id of the target <ul> element.
 * @param {Map<string, number>} totalsMap category → total from categoryTotals().
 * @param {string} currency Active Selected_Currency for formatting.
 * @returns {void}
 */
function renderCategoryBreakdown(listElementId, totalsMap, currency) {
  const listEl = document.getElementById(listElementId);
  if (!listEl) return;

  // Clear previous render.
  listEl.textContent = "";

  // Collect nonzero entries (guard against zero even though addTransaction
  // enforces positive amounts — Req 6.2, 7.3).
  const nonzeroEntries = [];
  for (const [category, total] of totalsMap) {
    if (total > 0) {
      nonzeroEntries.push([category, total]);
    }
  }

  if (nonzeroEntries.length === 0) {
    // Empty state: single item row with a descriptive message.
    const emptyItem = document.createElement("li");
    emptyItem.className = "category-breakdown__item--empty";
    utils.safeText(emptyItem, "No data for this month.");
    listEl.appendChild(emptyItem);
    return;
  }

  // Sort descending by total so the largest category appears first.
  nonzeroEntries.sort((a, b) => b[1] - a[1]);

  for (const [category, total] of nonzeroEntries) {
    const item = document.createElement("li");
    item.className = "category-breakdown__item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "category-breakdown__name";
    utils.safeText(nameSpan, category);

    const amountSpan = document.createElement("span");
    amountSpan.className = "category-breakdown__amount";
    utils.safeText(amountSpan, utils.formatCurrency(total, currency));

    item.appendChild(nameSpan);
    item.appendChild(amountSpan);
    listEl.appendChild(item);
  }
}

/**
 * Render the Monthly_Summary for the given "YYYY-MM" month key (Req 5.3–5.8).
 *
 * Reads the month slice via transactions.getTransactionsByMonth(monthKey) and
 * derives the monthly Total_Income, Total_Expense, Net_Balance (income − expense
 * for the month), and transaction count from transactions.calculateTotals()
 * over that slice — the single source of truth for money math (Req 1.5). This
 * module never sums money itself. Each monetary value is formatted through the
 * Currency_Formatter with the active Selected_Currency (Req 9.6); the count is a
 * plain integer. Every DOM write is guarded so a missing element is skipped.
 *
 * Also renders the expense-by-category (Req 5.7) and income-by-category (Req 5.8)
 * breakdowns via renderCategoryBreakdown(), showing only nonzero categories with
 * amounts formatted through the Currency_Formatter.
 *
 * @param {string} monthKey "YYYY-MM" month key (the Selected_Month).
 * @param {string} [currency="IDR"] Active Selected_Currency for formatting.
 * @param {string|null} [userId=null] Optional user ID for async storage routing.
 * @returns {Promise<void>}
 */
export async function renderMonthlySummary(monthKey, currency = "IDR", userId = null) {
  // Month slice + totals from the single source of truth (Req 5.2, 1.5).
  const monthSlice = await transactions.getTransactionsByMonth(monthKey, userId);
  const totals = transactions.calculateTotals(monthSlice);

  // Monthly income / expense / net balance, each formatted via the
  // Currency_Formatter with the Selected_Currency (Req 5.3–5.5, 9.6).
  renderMoneyLine("monthly-income-value", "Income", totals.totalIncome, currency);
  renderMoneyLine("monthly-expense-value", "Expense", totals.totalExpense, currency);
  renderMoneyLine("monthly-net-value", "Net balance", totals.balance, currency);

  // Monthly transaction count — a plain integer, not a monetary value (Req 5.6).
  const countEl = document.getElementById("monthly-count-value");
  if (countEl) {
    utils.safeText(countEl, `Transactions: ${totals.count}`);
  }

  // Category breakdowns for the Selected_Month (Req 5.7, 5.8).
  const expenseTotals = transactions.categoryTotals(monthSlice, "expense");
  const incomeTotals = transactions.categoryTotals(monthSlice, "income");

  renderCategoryBreakdown("expense-category-list", expenseTotals, currency);
  renderCategoryBreakdown("income-category-list", incomeTotals, currency);
}
