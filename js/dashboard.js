/*
 * dashboard.js — UI / render layer.
 *
 * Single responsibility: render Total_Balance, Total_Income, Total_Expense,
 * transaction count, the Selected_Month label, recent transactions
 * (newest→oldest), and the global empty state. Reads computed values from the
 * business logic layer; never computes money math itself.
 *
 * Layer: UI / render. Imports transactions.js and utils.js. MUST NOT import
 * storage.js — UI never touches localStorage directly (Req 10.2, 13.5).
 *
 * NOTE: Stub scaffolding for task 1.3. Real rendering arrives in Phase 4
 * (tasks 4.1, 4.2).
 */

import * as transactions from "./transactions.js";
import * as categories from "./categories.js";
import * as utils from "./utils.js";

/**
 * Default category lists mirroring storage.js `defaultData()` (Req 2.3, 8.4).
 *
 * Phase 8's `categories.getCategories(type)` is the eventual single source of
 * type-scoped options (defaults merged with custom). Until it is implemented it
 * returns an empty array, so we fall back to these defaults here so the
 * transaction form always offers valid categories. When `getCategories`
 * returns a non-empty list we prefer it, so this helper needs no change once
 * Phase 8 lands (task 8.3 wires custom categories through the same path).
 * @type {{ income: string[], expense: string[] }}
 */
const DEFAULT_CATEGORIES = {
  income: ["Salary", "Freelance", "Business", "Investment", "Gift", "Other"],
  expense: ["Food", "Transport", "Fun", "Bills", "Shopping", "Health", "Other"],
};

/**
 * Resolve the selectable categories for a Transaction_Type (Req 2.3, 8.4).
 * Returns a Promise that resolves to the category list. Prefers
 * `categories.getCategories(type)` (async since task 16.6); falls back to the
 * built-in defaults if the result is empty.
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<string[]>}
 */
export async function categoriesForType(type, userId = null) {
  const key = type === "income" ? "income" : "expense";
  try {
    const fromLogic = await categories.getCategories(key, userId);
    if (Array.isArray(fromLogic) && fromLogic.length > 0) {
      return fromLogic;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_CATEGORIES[key];
}

/**
 * Populate the transaction form's Category `<select>` with the options that
 * apply to the given Transaction_Type (Req 2.3). Rebuilds the option list from
 * scratch each call so switching type replaces the previous type's categories.
 * Option text is written via textContent (safe) — category names are never
 * injected as HTML. Preserves the current selection when it is still valid.
 * @param {HTMLSelectElement} selectEl
 * @param {"income"|"expense"} type
 * @param {string|null} [userId=null]
 * @returns {Promise<void>}
 */
export async function renderCategoryOptions(selectEl, type, userId = null) {
  if (!selectEl) return;
  const options = await categoriesForType(type, userId);
  const previous = selectEl.value;

  selectEl.replaceChildren();
  for (const name of options) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    selectEl.appendChild(option);
  }

  // Keep the prior choice selected if it still exists for the new type;
  // otherwise fall back to the first available option.
  if (options.includes(previous)) {
    selectEl.value = previous;
  } else if (options.length > 0) {
    selectEl.value = options[0];
  }
}

/**
 * Section IDs that contain meaningful data-dependent content. These are hidden
 * when no transactions exist (Req 11.1) and revealed once the first transaction
 * is added (Req 11.3). The add-transaction form, month selector, and category
 * management panel are intentionally excluded so the user can still interact
 * with them on a fresh app.
 * @type {readonly string[]}
 */
const DATA_SECTION_IDS = [
  "balance-section",
  "recent-transactions-section",
  "monthly-summary-section",
  "charts-section",
  "transaction-list-section",
];

/**
 * Render the global Empty_State when there are no transactions (Req 11.1,
 * 11.3). Shows `#global-empty-state` and hides the data-dependent sections
 * when `hasTransactions` is false; reverses both when `hasTransactions` is
 * true so the first transaction replaces the empty state with populated views.
 *
 * This is the single place the global empty state is toggled. `renderDashboard`
 * calls it after computing totals so the decision is always based on the live
 * transaction count — never a stale snapshot.
 *
 * @param {boolean} hasTransactions
 * @returns {void}
 */
export function renderGlobalEmptyState(hasTransactions) {
  const emptyEl = document.getElementById("global-empty-state");
  if (emptyEl) {
    emptyEl.hidden = hasTransactions;
  }

  for (const id of DATA_SECTION_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = !hasTransactions;
    }
  }
}

/**
 * Maximum number of transactions shown in the Recent Transactions list. The
 * acceptance requirement is ordering newest→oldest (Req 1.4); capping keeps the
 * dashboard glanceable without changing that ordering.
 * @type {number}
 */
const RECENT_TRANSACTIONS_LIMIT = 5;

/**
 * Write a formatted monetary value into a balance-card value element, if the
 * element exists (Req 1.8). Every money value on the dashboard is formatted
 * through the Currency_Formatter and written with `safeText` (never innerHTML).
 * @param {string} elementId
 * @param {number} amount
 * @param {string} [currency="IDR"] Active Selected_Currency for formatting (Req 9.6).
 * @returns {void}
 */
function renderMoneyValue(elementId, amount, currency = "IDR") {
  const el = document.getElementById(elementId);
  if (!el) return;
  utils.safeText(el, utils.formatCurrency(amount, currency));
}

/**
 * Render the dashboard (balance/income/expense/count, month, recents) for the
 * current app state (Req 1.1, 1.2, 1.4, 1.5, 1.8).
 *
 * Money math is NOT computed here: the totals come straight from
 * `transactions.calculateTotals()`, the single source of truth (Req 1.5), and
 * every monetary value is formatted through the Currency_Formatter (Req 1.8).
 * The Total_Balance, Total_Income, and Total_Expense are written into the
 * balance cards; the raw transaction count is written as-is (not a money
 * value); the Selected_Month label reflects `state.selectedMonth` (Req 1.2).
 * Each DOM write is guarded so a missing element is simply skipped. Finally the
 * recent-transactions list is rendered newest→oldest (Req 1.4).
 *
 * @param {object} state App state (reads `state.selectedMonth`, `state.selectedCurrency`).
 * @param {string|null} [userId=null] Optional user ID for async storage routing.
 * @returns {Promise<void>}
 */
export async function renderDashboard(state, userId = null) {
  const currency = (state && state.selectedCurrency) ? state.selectedCurrency : "IDR";
  const allTransactions = await transactions.getTransactions(userId);

  // Totals from the single source of truth — dashboard never sums money itself.
  const totals = transactions.calculateTotals(allTransactions);

  // Global empty state: show the Empty_State when there are no transactions and
  // hide the data-dependent sections; reveal them once transactions exist
  // (Req 11.1, 11.3). This is the authoritative call-site for this toggle so
  // it fires on every re-render triggered by add/delete.
  renderGlobalEmptyState(totals.count > 0);

  // Balance cards, every money value formatted via the Currency_Formatter with
  // the active Selected_Currency (Req 9.6).
  renderMoneyValue("total-balance-value", totals.balance, currency);
  renderMoneyValue("total-income-value", totals.totalIncome, currency);
  renderMoneyValue("total-expense-value", totals.totalExpense, currency);

  // Transaction count is a plain integer, not a monetary value.
  const countEl = document.getElementById("transaction-count-value");
  if (countEl) {
    utils.safeText(countEl, String(totals.count));
  }

  // Selected_Month label (Req 1.2).
  const monthEl = document.getElementById("selected-month-label");
  if (monthEl) {
    const selectedMonth = state && state.selectedMonth ? state.selectedMonth : "";
    utils.safeText(monthEl, selectedMonth);
  }

  // Recent transactions, newest→oldest (Req 1.4).
  renderRecentTransactions(allTransactions, currency);
}

/**
 * Render the recent transactions list, ordered newest→oldest by `date`
 * (Req 1.4). Sorts a COPY of the input so the caller's array is never mutated
 * or reordered, reuses `renderTransactionRow` to build each row (so recent rows
 * match the Transaction_List styling and money formatting), and limits the
 * output to the most recent few. When there are no transactions, the list is
 * cleared and its empty-state element (if present) is revealed instead.
 *
 * @param {object[]} transactionList
 * @param {string} [currency="IDR"] Active Selected_Currency for formatting (Req 9.6).
 * @returns {void}
 */
export function renderRecentTransactions(transactionList, currency = "IDR") {
  const listEl = document.getElementById("recent-transactions-list");
  if (!listEl) return;
  const list = Array.isArray(transactionList) ? transactionList : [];

  // Sort a copy newest→oldest by date; do not mutate the input (Req 1.4).
  const recent = list
    .slice()
    .sort((a, b) => {
      const dateA = a && a.date ? a.date : "";
      const dateB = b && b.date ? b.date : "";
      if (dateA < dateB) return 1;
      if (dateA > dateB) return -1;
      return 0;
    })
    .slice(0, RECENT_TRANSACTIONS_LIMIT);

  listEl.replaceChildren();
  for (const transaction of recent) {
    listEl.appendChild(renderTransactionRow(transaction, currency));
  }

  // Toggle the recent-transactions empty state when there is nothing to show.
  const emptyEl = document.getElementById("recent-transactions-empty");
  if (emptyEl) {
    if (recent.length === 0) {
      utils.safeText(emptyEl, "No transactions yet. Add one to see recent activity.");
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
    }
  }
}

/**
 * Build a single Transaction_List row `<li>` element for one transaction
 * (Req 3.1, 3.2, 15.4).
 *
 * Renders every required field — item name, amount, Category, Transaction_Type,
 * and date — and gives Expense_Transaction amounts a visual treatment distinct
 * from Income_Transaction amounts: expenses are colored red and signed with a
 * leading "-", income green and signed with a leading "+". The distinction is
 * carried by both color AND sign so it survives for color-blind users (Req 3.2,
 * 15.4).
 *
 * All user-provided text (item name, Category) is written via `safeText`
 * (textContent), never innerHTML, so a crafted item name cannot inject markup.
 * The monetary value is formatted only through `utils.formatCurrency` with the
 * active Selected_Currency (Req 9, 9.6).
 *
 * @param {object} transaction Transaction { id, type, itemName, amount, category, date }
 * @param {string} [currency="IDR"] Active Selected_Currency for formatting (Req 9.6).
 * @returns {HTMLLIElement}
 */
export function renderTransactionRow(transaction, currency = "IDR") {
  const isIncome = transaction && transaction.type === "income";

  const row = document.createElement("li");
  row.className = "transaction-row";
  row.classList.add(isIncome ? "transaction-row--income" : "transaction-row--expense");
  if (transaction && transaction.id != null) {
    row.dataset.id = String(transaction.id);
  }

  // Item name (user-provided → safeText).
  const name = document.createElement("span");
  name.className = "transaction-row__name";
  utils.safeText(name, transaction ? transaction.itemName : "");

  // Category (user-provided → safeText).
  const category = document.createElement("span");
  category.className = "transaction-row__category";
  utils.safeText(category, transaction ? transaction.category : "");

  // Transaction_Type label (Req 3.1).
  const type = document.createElement("span");
  type.className = "transaction-row__type";
  utils.safeText(type, isIncome ? "Income" : "Expense");

  // Date (Req 3.1).
  const date = document.createElement("span");
  date.className = "transaction-row__date";
  utils.safeText(date, transaction ? transaction.date : "");

  // Amount — the only visually distinct field (Req 3.2). Color via class,
  // sign via a leading +/- prefix; value formatted through the Currency_Formatter
  // with the active Selected_Currency (Req 9.6).
  const amount = document.createElement("span");
  amount.className = "transaction-row__amount";
  amount.classList.add(isIncome ? "u-text-income" : "u-text-expense");
  const sign = isIncome ? "+" : "-";
  const rawAmount = transaction ? transaction.amount : 0;
  utils.safeText(amount, `${sign}${utils.formatCurrency(rawAmount, currency)}`);

  row.append(name, category, type, date, amount);
  return row;
}

/**
 * Render the Transaction_List: replace the list's contents with a row per
 * transaction (Req 3.1, 3.2). When there are no transactions, the list is
 * cleared and the empty-state element (if present) is revealed instead.
 *
 * This is a pure render sink: it takes the transactions to display and writes
 * them to the DOM. Deciding WHICH transactions to show (all, filtered, or
 * filtered-empty) is the caller's responsibility (`app.renderTransactionList`).
 *
 * The optional `emptyMessage` parameter lets the caller supply a context-aware
 * message: "No transactions yet." for an empty store, or "No transactions match
 * your filters." for the Filtered_Empty_State (Req 4.13).
 *
 * @param {object[]} transactionList
 * @param {string} [emptyMessage] - Message shown when the list is empty.
 * @param {string} [currency="IDR"] Active Selected_Currency for formatting (Req 9.6).
 * @returns {void}
 */
export function renderTransactionListRows(transactionList, emptyMessage, currency = "IDR") {
  const listEl = document.getElementById("transaction-list");
  if (!listEl) return;
  const list = Array.isArray(transactionList) ? transactionList : [];

  listEl.replaceChildren();
  for (const transaction of list) {
    listEl.appendChild(renderTransactionRow(transaction, currency));
  }

  // Toggle the empty-state element. The caller may supply a context-aware
  // message (e.g. "No transactions match your filters." for the
  // Filtered_Empty_State, Req 4.13); fall back to the generic no-data message.
  const emptyEl = document.getElementById("transaction-list-empty");
  if (emptyEl) {
    if (list.length === 0) {
      utils.safeText(
        emptyEl,
        emptyMessage ?? "No transactions yet. Add one above to get started."
      );
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
    }
  }
}
