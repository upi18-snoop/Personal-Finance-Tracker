/*
 * app.js â€” UI glue / entry point (ES module).
 *
 * Single responsibility: bootstrap the app, hold the lightweight shared app
 * state (selectedMonth reporting scope + filterCriteria list scope), wire DOM
 * events, and orchestrate re-renders. The ONLY module that knows about all UI
 * modules; it also drives business logic and storage init.
 *
 * Layer: UI glue / entry point. May import everything â€” the storage layer, the
 * business logic layer, the UI render layer, and utils.
 *
 * NOTE: In task 1.3 bootstrap() only imports the module graph and logs
 * readiness. Real event wiring and render orchestration arrive across Phases
 * 3â€“8 (tasks 3.3, 3.5, 4.x, 5.2, 6.3, 6.4, 8.3, ...).
 */

import * as storage from "./storage.js";
import * as transactions from "./transactions.js";
import * as categories from "./categories.js";
import * as dashboard from "./dashboard.js";
import * as reports from "./reports.js";
import * as charts from "./charts.js";
import * as utils from "./utils.js";
import * as auth from "./auth.js";
const { getMonthKey } = utils;

/**
 * Current month as a "YYYY-MM" key (reporting scope default, Req 5.1).
 *
 * getMonthKey expects a "YYYY-MM-DD" date string (it rejects a full ISO
 * timestamp), so pass the date-only slice of today. Falls back to the same
 * slice defensively if getMonthKey ever returns "".
 * @returns {string}
 */
function currentMonthKey() {
  const today = new Date().toISOString().slice(0, 10);
  return getMonthKey(today) || today.slice(0, 7);
}

/**
 * Lightweight app state â€” the only mutable shared state.
 *  - selectedMonth: reporting scope (Dashboard month, Monthly_Summary, charts)
 *  - filterCriteria: list scope (drives only the Transaction_List)
 *  - selectedCurrency: active ISO 4217 currency code for all formatted money
 *    values; seeded from storage.getCurrency() at bootstrap (Req 18.5).
 */
const state = {
  selectedMonth: currentMonthKey(),
  filterCriteria: { searchTerm: "", type: "all", category: "", month: "" },
  selectedCurrency: "IDR", // overwritten in bootstrap() from storage.getCurrency()
  currentUser: null,
};

/* --------------------------------------------------------------------------
 * Add-transaction form (task 3.3)
 *
 * Wires the transaction form to business logic: gathers field values, calls
 * transactions.addTransaction, renders inline per-field validation on failure,
 * and resets the form to its empty default state on success (Req 2.1, 2.13).
 * The Category options track the selected Transaction_Type (Req 2.3). Every
 * control has an associated <label> in index.html (Req 15.2).
 * ------------------------------------------------------------------------ */

/**
 * Clear all inline validation messages (per-field + form-level) on the
 * transaction form so a fresh submission starts from a clean slate.
 * @param {HTMLFormElement} form
 * @returns {void}
 */
function clearTransactionFormErrors(form) {
  for (const el of form.querySelectorAll("[data-field-error]")) {
    utils.safeText(el, "");
  }
  const formError = document.getElementById("transaction-form-error");
  utils.safeText(formError, "");
}

/**
 * Render validation errors inline, each next to its associated field
 * (Req 2.4â€“2.8, 15.2). Falls back to the form-level message for any error whose
 * field has no dedicated slot.
 * @param {HTMLFormElement} form
 * @param {{ field: string, message: string }[]} errors
 * @returns {void}
 */
function showTransactionFormErrors(form, errors) {
  clearTransactionFormErrors(form);
  const unassigned = [];
  for (const error of errors) {
    const slot = form.querySelector(`[data-field-error="${error.field}"]`);
    if (slot) {
      utils.safeText(slot, error.message);
    } else {
      unassigned.push(error.message);
    }
  }
  if (unassigned.length > 0) {
    utils.safeText(
      document.getElementById("transaction-form-error"),
      unassigned.join(" ")
    );
  }
}

/**
 * Reset the transaction form to its empty default state after a successful add
 * (Req 2.13): clear text/number inputs, reset the type to its default, default
 * the date to today, and rebuild the category options for the default type.
 * @param {HTMLFormElement} form
 * @returns {void}
 */
function resetTransactionForm(form) {
  form.reset();
  const typeEl = form.querySelector("#transaction-type");
  const categoryEl = form.querySelector("#transaction-category");
  const dateEl = form.querySelector("#transaction-date");

  if (dateEl) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }
  if (categoryEl) {
    dashboard.renderCategoryOptions(categoryEl, typeEl ? typeEl.value : "expense");
  }
}

/**
 * Handle an add-transaction submission (Req 2.1, 2.13). Delegates all
 * validation and persistence to transactions.addTransaction (business logic);
 * this UI handler only maps the result to inline messages or a form reset.
 *
 * On success, calls `renderAll()` which triggers the full reporting-scope
 * re-render path: dashboard totals, Monthly_Summary, and both category charts
 * (expense + income) via `renderReports()` â†’ `charts.updateExpenseChart /
 * updateIncomeChart`. Charts update in-place via `chart.update()` â€” no
 * destroy/recreate, no duplicate instances (Req 6.3, 16.2).
 * @param {{ type: string, itemName: string, amount: string, category: string, date: string }} formData
 * @param {HTMLFormElement} form
 * @returns {{ ok: boolean }}
 */
function onAddTransaction(formData, form) {
  const result = transactions.addTransaction(formData);

  if (!result.ok) {
    // Invalid input: show inline messages, create nothing, keep field values.
    showTransactionFormErrors(form, result.errors);
    return { ok: false };
  }

  // Success: clear any stale errors and reset the form to its empty defaults.
  clearTransactionFormErrors(form);
  resetTransactionForm(form);

  // Reflect the new transaction across the reporting views and the list: the
  // dashboard totals (Total_Balance / Total_Income / Total_Expense) update to
  // include it (Req 1.6, 2.12) and the Transaction_List shows the new row.
  renderAll();
  return { ok: true };
}

/**
 * Wire the add-transaction form's events: submit â†’ onAddTransaction, and
 * type change â†’ refresh the Category options for that type (Req 2.3). Seeds the
 * initial category options and a sensible default date on load.
 * @returns {void}
 */
function wireTransactionForm() {
  const form = document.getElementById("transaction-form");
  if (!form) return;

  const typeEl = form.querySelector("#transaction-type");
  const categoryEl = form.querySelector("#transaction-category");
  const dateEl = form.querySelector("#transaction-date");

  // Seed initial category options for the default type and default the date.
  if (categoryEl) {
    dashboard.renderCategoryOptions(categoryEl, typeEl ? typeEl.value : "expense");
  }
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }

  // Changing Transaction_Type updates the applicable Category options (Req 2.3).
  if (typeEl && categoryEl) {
    typeEl.addEventListener("change", () => {
      dashboard.renderCategoryOptions(categoryEl, typeEl.value);
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = {
      type: typeEl ? typeEl.value : "",
      itemName: form.querySelector("#transaction-item-name")?.value ?? "",
      amount: form.querySelector("#transaction-amount")?.value ?? "",
      category: categoryEl ? categoryEl.value : "",
      date: dateEl ? dateEl.value : "",
    };
    onAddTransaction(formData, form);
  });
}

/* --------------------------------------------------------------------------
 * Transaction list (task 3.4)
 *
 * Orchestrates rendering of the Transaction_List. Reads the stored transactions
 * through the business logic layer (never localStorage) and hands them to the
 * render layer. For now it lists getTransactions() directly; filter-scope
 * application (filterTransactions over state.filterCriteria) is wired in
 * Phase 6 (task 6.3), at which point only this function changes.
 * ------------------------------------------------------------------------ */

/**
 * Render the Transaction_List for the current state (Req 3.1, 3.2, 4.1â€“4.13).
 * Applies the active filter scope (`state.filterCriteria`) via the pure
 * `filterTransactions` view function â€” a read-only operation that NEVER mutates
 * stored data (Req 4.12, 4.14). The dashboard totals and Monthly_Summary are
 * completely unaffected because this function does NOT call renderDashboard,
 * renderReports, or saveData (Req 4.12).
 *
 * When transactions exist in the store but none satisfy the active criteria,
 * the Filtered_Empty_State is shown with the exact message "No transactions
 * match your filters." in place of the list entries (Req 4.13).
 *
 * After the render layer writes the rows, attach per-row Delete controls so
 * the user can initiate deletion (Req 3.3).
 * @returns {void}
 */
function renderTransactionList() {
  const all = transactions.getTransactions();

  // Apply the filter scope: pure read-only view, no storage writes (Req 4.14).
  const filtered = transactions.filterTransactions(all, state.filterCriteria);

  // Determine the correct empty-state message (Req 4.13):
  //   - Transactions exist but none match â†’ Filtered_Empty_State message.
  //   - No transactions at all â†’ generic no-data message (dashboard.js default).
  const emptyMessage =
    all.length > 0 && filtered.length === 0
      ? "No transactions match your filters."
      : undefined;

  dashboard.renderTransactionListRows(filtered, emptyMessage, state.selectedCurrency);
  addDeleteControls();
}

/* --------------------------------------------------------------------------
 * Filter / search controls â€” list scope (task 6.3)
 *
 * The filter scope is completely independent of the reporting scope. Changing
 * any filter criterion updates ONLY the Transaction_List â€” it never calls
 * renderDashboard, renderReports, or saveData â€” so the Dashboard totals and
 * Monthly_Summary are structurally guaranteed to be unaffected (Req 4.12, 4.14).
 *
 * All four controls (search, type, category, month) are wired to the single
 * `onFilterChange` handler. The category filter <select> is populated with the
 * full merged category list (defaults + custom) so the user can filter by any
 * known category. A blank "All categories" sentinel is prepended so no category
 * filter is active by default.
 * ------------------------------------------------------------------------ */

/**
 * The "all categories" sentinel value used in the category filter <select>.
 * An empty string means "no category filter active" (matches the FilterCriteria
 * contract in filterTransactions where category = "" means inactive, Req 4.6).
 * @type {string}
 */
const ALL_CATEGORIES_VALUE = "";

/**
 * Resolve the merged category list (defaults + custom) for populating the
 * filter category <select>. Reads from `dashboard.categoriesForType` for each
 * type (which already handles the fallback to defaults while categories.js is
 * still a stub), then deduplicates across types so the combined filter list
 * shows each category name once.
 * @returns {string[]}
 */
function allCategoryOptions() {
  // Gather all categories across both types and deduplicate.
  const incomeCategories = dashboard.categoriesForType("income");
  const expenseCategories = dashboard.categoriesForType("expense");
  const seen = new Set();
  const result = [];
  for (const name of [...incomeCategories, ...expenseCategories]) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/**
 * Populate the category filter <select> with an "All categories" sentinel at
 * the top, followed by every category (defaults merged with custom). Re-call
 * this whenever the category set changes (Phase 8). Preserves the current
 * selection when it still exists; otherwise resets to "All categories".
 * @returns {void}
 */
function populateCategoryFilter() {
  const selectEl = document.getElementById("filter-category");
  if (!selectEl) return;

  const previous = selectEl.value;
  selectEl.replaceChildren();

  // "All categories" sentinel â€” means no category filter active.
  const allOpt = document.createElement("option");
  allOpt.value = ALL_CATEGORIES_VALUE;
  allOpt.textContent = "All categories";
  selectEl.appendChild(allOpt);

  for (const name of allCategoryOptions()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }

  // Restore prior selection if still present; else default to sentinel.
  selectEl.value = [...selectEl.options].some((o) => o.value === previous)
    ? previous
    : ALL_CATEGORIES_VALUE;
}

/**
 * Read the current filter control values and update `state.filterCriteria`,
 * then call `renderTransactionList()` ONLY (Req 4.9, 4.12). This is the full
 * extent of what a filter change does â€” no saveData, no dashboard re-render,
 * no report/chart re-render â€” so Dashboard totals and Monthly_Summary can
 * never move as a result of filtering (Req 4.12, 4.14).
 * @returns {void}
 */
function onFilterChange() {
  const searchEl = document.getElementById("filter-search");
  const typeEl = document.getElementById("filter-type");
  const categoryEl = document.getElementById("filter-category");
  const monthEl = document.getElementById("filter-month");

  state.filterCriteria = {
    searchTerm: searchEl ? searchEl.value : "",
    type: typeEl ? typeEl.value : "all",
    category: categoryEl ? categoryEl.value : "",
    month: monthEl ? monthEl.value : "",
  };

  // List scope only: never calls renderDashboard / renderReports / saveData.
  renderTransactionList();
}

/**
 * Reset all filter criteria to their defaults and re-render the Transaction_List
 * showing all stored transactions (Req 4.10, 4.11).
 *
 * Resets:
 *   - Search_Term â†’ "" (empty)
 *   - type filter â†’ "all"
 *   - Category filter â†’ "" (no category selected)
 *   - month filter â†’ "" (no month filter active)
 *
 * Also resets the filter form controls to match the cleared state, so the UI
 * reflects the defaults immediately. Calls `renderTransactionList()` which is
 * the list-scope render path (Req 4.12): Dashboard totals and Monthly_Summary
 * are untouched.
 * @returns {void}
 */
function onClearFilters() {
  // Reset the shared filter state to defaults (Req 4.10).
  state.filterCriteria = { searchTerm: "", type: "all", category: "", month: "" };

  // Reset the filter controls so the UI matches the cleared state.
  const searchEl = document.getElementById("filter-search");
  const typeEl = document.getElementById("filter-type");
  const categoryEl = document.getElementById("filter-category");
  const monthEl = document.getElementById("filter-month");

  if (searchEl) searchEl.value = "";
  if (typeEl) typeEl.value = "all";
  if (categoryEl) categoryEl.value = ALL_CATEGORIES_VALUE;
  if (monthEl) monthEl.value = "";

  // List scope only: show all stored transactions (Req 4.11).
  renderTransactionList();
}

/**
 * Wire all filter and search controls so any change triggers `onFilterChange`
 * immediately (Req 4.9). Uses `input` on the search field for live updates and
 * `change` on the selects/month picker. Also populates the category filter
 * <select> with the available categories. Wires the Clear Filters button to
 * `onClearFilters` (Req 4.10, 4.11).
 * @returns {void}
 */
function wireFilterControls() {
  populateCategoryFilter();

  const searchEl = document.getElementById("filter-search");
  const typeEl = document.getElementById("filter-type");
  const categoryEl = document.getElementById("filter-category");
  const monthEl = document.getElementById("filter-month");

  if (searchEl) {
    // Use "input" so the list updates on every keystroke (live search, Req 4.9).
    searchEl.addEventListener("input", onFilterChange);
  }
  if (typeEl) {
    typeEl.addEventListener("change", onFilterChange);
  }
  if (categoryEl) {
    categoryEl.addEventListener("change", onFilterChange);
  }
  if (monthEl) {
    monthEl.addEventListener("change", onFilterChange);
  }

  // Clear Filters button: reset all criteria and show all transactions (Req 4.10, 4.11).
  const clearBtn = document.getElementById("clear-filters-button");
  if (clearBtn) {
    clearBtn.addEventListener("click", onClearFilters);
  }
}

/* --------------------------------------------------------------------------
 * Reporting re-render orchestration (task 4.2)
 *
 * renderAll() re-renders every view affected by a reporting-scope change â€” a
 * transaction being added or deleted â€” for the current app state. Per the
 * design it eventually covers dashboard + reports + charts + the list; for now
 * only the dashboard and the Transaction_List exist, so those are what it
 * drives. Monthly_Summary (reports.renderMonthlySummary) and chart updates are
 * wired in when their phases land (tasks 5.x, 7.x); adding them here later is
 * additive and needs no change to the add/delete callers.
 *
 * Note the scope split: renderAll drives the reporting views (Total_Balance /
 * Total_Income / Total_Expense on the dashboard, Req 1.6/1.7). Filter changes
 * keep to the list scope (renderTransactionList only) and must NOT go through
 * renderAll, so totals never move on a filter change (Req 4.12).
 * ------------------------------------------------------------------------ */

/**
 * Currency formatter callback passed to chart update functions so the
 * accessible text descriptions show properly formatted amounts (Req 9, 9.6).
 * Always uses the current state.selectedCurrency so chart labels stay in sync
 * when the user changes currency (Req 18.7).
 * @param {number} amount
 * @returns {string}
 */
function formatMoney(amount) {
  return utils.formatCurrency(amount, state.selectedCurrency);
}

/**
 * Re-render the month-scoped reporting views for the current Selected_Month
 * (reporting scope): the Monthly_Summary and the category charts. This is the
 * single place the reporting scope (`state.selectedMonth`) is pushed into the
 * report/chart renderers, so both the reporting-affecting actions (add/delete
 * via renderAll) and a month change (onSelectedMonthChange) share one path.
 *
 * Chart update lifecycle (Req 6.3, 6.4, 6.5, 7.5, 7.6, 16.2):
 *   - `updateExpenseChart` and `updateIncomeChart` call `chart.update()` in-place on
 *     the existing Chart instances (no destroy/recreate on normal updates), so no
 *     duplicate chart objects are ever created and no memory leaks occur.
 *   - The instances were created once in `bootstrap()` via `charts.initCharts()`.
 *   - If an instance is somehow null (canvas absent at boot), `update*` lazily calls
 *     `initCharts()` which destroys any stale instance before creating a fresh one â€”
 *     the destroy-before-create contract is enforced inside `charts.js`.
 *
 * It deliberately does NOT touch the Transaction_List â€” that belongs to the
 * independent filter scope (Req 4.12 / 5.9).
 * @returns {void}
 */
function renderReports() {
  // Monthly_Summary for the Selected_Month (Req 5.3â€“5.8). Pass the active
  // Selected_Currency so all amounts are formatted consistently (Req 9.6, 18.7).
  reports.renderMonthlySummary(state.selectedMonth, state.selectedCurrency);

  // Category charts for the same reporting scope (Req 6.x / 7.x).
  // Pass the formatMoney callback so chart descriptions show formatted amounts.
  const monthlyTransactions = transactions.getTransactionsByMonth(state.selectedMonth);

  charts.updateExpenseChart(
    transactions.categoryTotals(monthlyTransactions, "expense"),
    formatMoney
  );
  charts.updateIncomeChart(
    transactions.categoryTotals(monthlyTransactions, "income"),
    formatMoney
  );
}

/**
 * Re-render the reporting views plus the Transaction_List for the current app
 * state (Req 1.6, 1.7, 2.12). Called after add and delete so the dashboard
 * Total_Balance / Total_Income / Total_Expense (and count) reflect the change.
 * @returns {void}
 */
function renderAll() {
  // Reporting scope: dashboard totals recomputed from the single source of
  // truth (transactions.calculateTotals) so a new/removed transaction is
  // reflected immediately (Req 1.6, 1.7).
  dashboard.renderDashboard(state);

  // Reporting scope: Monthly_Summary + charts for the Selected_Month.
  renderReports();

  // List scope: keep the Transaction_List in sync with the same change.
  renderTransactionList();
}

/* --------------------------------------------------------------------------
 * Delete transaction (task 3.5)
 *
 * A transaction is deleted only after an explicit confirmation interaction
 * (Req 3.3). Cancelling the confirmation retains the transaction unchanged
 * (Req 3.4); confirming removes it via the business logic layer, which persists
 * the updated set (Req 3.5, 3.6), after which the list is re-rendered.
 *
 * The list rows are produced by the render layer (dashboard.renderTransactionRow)
 * and carry a `data-id`. app.js owns the interaction: it adds the Delete button
 * to each row and handles clicks through a single delegated listener on the
 * list container.
 * ------------------------------------------------------------------------ */

/**
 * Add a labelled Delete button to any transaction row that does not already
 * have one (Req 3.3, 15.5). The button carries no id itself; the id is read
 * from the row's `data-id` when the click is handled, so a single delegated
 * listener on the list container drives every row.
 * @returns {void}
 */
function addDeleteControls() {
  const listEl = document.getElementById("transaction-list");
  if (!listEl) return;

  for (const row of listEl.querySelectorAll(".transaction-row")) {
    if (row.querySelector(".transaction-row__delete")) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "transaction-row__delete";
    button.dataset.action = "delete";
    utils.safeText(button, "Delete");

    // Descriptive accessible label indicating the action (Req 15.5). Include
    // the item name when available so the action is unambiguous for AT users.
    const nameEl = row.querySelector(".transaction-row__name");
    const itemName = nameEl ? nameEl.textContent : "";
    button.setAttribute(
      "aria-label",
      itemName ? `Delete transaction ${itemName}` : "Delete transaction"
    );

    row.appendChild(button);
  }
}

/**
 * Handle a request to delete the transaction with the given id (Req 3.3â€“3.6).
 * Requires a confirmation interaction first: on cancel the transaction is
 * retained unchanged and nothing is persisted (Req 3.4); on confirm the
 * deletion is delegated to the business logic layer (which persists the updated
 * set, Req 3.5/3.6) and the Transaction_List is re-rendered.
 *
 * On confirm + success, calls `renderAll()` which triggers the full reporting-scope
 * re-render path including both category charts via `renderReports()` â†’
 * `charts.updateExpenseChart / updateIncomeChart`. Charts update in-place via
 * `chart.update()` â€” no destroy/recreate, no duplicate instances (Req 6.4, 16.2).
 * @param {string} id
 * @returns {{ ok: boolean }}
 */
function onDeleteTransaction(id) {
  if (id == null || id === "") {
    return { ok: false };
  }

  // Confirmation interaction (Req 3.3). Cancel â†’ retain unchanged (Req 3.4).
  const confirmed = window.confirm(
    "Delete this transaction? This cannot be undone."
  );
  if (!confirmed) {
    return { ok: false };
  }

  // Confirmed â†’ remove + persist via business logic (Req 3.5, 3.6).
  const result = transactions.deleteTransaction(id);

  // Reflect the removal across the reporting views and the list: the dashboard
  // totals reverse the deleted transaction's contribution exactly (Req 1.7) and
  // the Transaction_List drops the row. (Report/chart re-renders join in 5.x/7.4.)
  if (result.ok) {
    renderAll();
  }
  return result;
}

/**
 * Wire deletion for the whole Transaction_List with a single delegated click
 * listener on the list container (Req 3.3). Clicking a row's Delete button
 * resolves the target transaction id from the enclosing row's `data-id` and
 * routes to onDeleteTransaction.
 * @returns {void}
 */
function wireTransactionListDeletion() {
  const listEl = document.getElementById("transaction-list");
  if (!listEl) return;

  listEl.addEventListener("click", (event) => {
    const trigger = event.target.closest('[data-action="delete"]');
    if (!trigger || !listEl.contains(trigger)) return;

    const row = trigger.closest(".transaction-row");
    const id = row ? row.dataset.id : undefined;
    if (id == null) return;

    onDeleteTransaction(id);
  });
}

/* --------------------------------------------------------------------------
 * Month selector â€” reporting scope (task 5.2)
 *
 * The Selected_Month drives the reporting scope only: the Monthly_Summary and
 * the category charts (and the Dashboard month label). Changing it recomputes
 * those views for the new month (Req 5.1) but must NOT touch the
 * Transaction_List, which lives in the independent filter scope (Req 5.9). So
 * onSelectedMonthChange goes through renderReports() (+ the dashboard month
 * label), never renderAll / renderTransactionList.
 * ------------------------------------------------------------------------ */

/**
 * Handle a change to the Selected_Month (Req 5.1, 5.9). Updates the reporting
 * scope in app state and recomputes the month-scoped reporting views â€” the
 * Monthly_Summary and category charts â€” for the new month, plus the Dashboard's
 * Selected_Month label. Deliberately leaves the Transaction_List untouched: the
 * list is driven by the separate filter scope, so a reporting-month change
 * never moves it (Req 5.9).
 *
 * Both category charts update in-place via `chart.update()` through
 * `renderReports()` â†’ `charts.updateExpenseChart / updateIncomeChart`. No
 * destroy/recreate occurs for a month change â€” no duplicate instances or leaks
 * (Req 6.5, 16.2).
 *
 * A blank month (e.g. the user clears the native picker) falls back to the
 * current month so the reporting scope always has a valid "YYYY-MM" key.
 * @param {string} month "YYYY-MM" month key from the selector.
 * @returns {void}
 */
function onSelectedMonthChange(month) {
  state.selectedMonth = utils.isBlank(month) ? currentMonthKey() : month;

  // Reporting scope only: Monthly_Summary + charts recomputed for the new month.
  renderReports();

  // Keep the Dashboard's Selected_Month label in sync (Req 1.2). This updates
  // the label/reporting cards without re-rendering the Transaction_List.
  dashboard.renderDashboard(state);
}

/**
 * Wire the month selector: default it to the current month on load (Req 5.1)
 * and route its change events to onSelectedMonthChange (Req 5.9). The control
 * and its associated <label> live in index.html (accessible, keyboard-operable
 * native <input type="month">).
 * @returns {void}
 */
function wireMonthSelector() {
  const monthEl = document.getElementById("selected-month");
  if (!monthEl) return;

  // Default the control to the current reporting month (state.selectedMonth was
  // seeded to the current month), so the UI and state agree on load (Req 5.1).
  monthEl.value = state.selectedMonth;

  monthEl.addEventListener("change", () => {
    onSelectedMonthChange(monthEl.value);
  });
}

/* --------------------------------------------------------------------------
 * Currency selector â€” Settings section (task 14.3)
 *
 * The currency selector is a presentation-only control: changing it updates
 * state.selectedCurrency, persists the choice via storage.setCurrency, and
 * re-renders all currency-formatted surfaces without touching any stored
 * transaction amounts (Req 18.6, 18.7).
 *
 * This mirrors the month-selector's reporting-scope pattern: changing the
 * currency triggers a full re-render of every formatted view, but no data is
 * mutated â€” it is purely a display preference (Req 9.3).
 * ------------------------------------------------------------------------ */

/**
 * Populate the currency `<select>` with one `<option>` per entry in
 * `SUPPORTED_CURRENCIES` (Req 18.1). Each option displays the currency code
 * and its human-readable label (e.g., "USD â€” US Dollar"). Option text is set
 * via textContent (never innerHTML). The active Selected_Currency is pre-selected.
 * @returns {void}
 */
function populateCurrencySelect() {
  const selectEl = document.getElementById("currency-select");
  if (!selectEl) return;

  selectEl.replaceChildren();

  for (const [code, meta] of Object.entries(utils.SUPPORTED_CURRENCIES)) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} â€” ${meta.label}`;
    selectEl.appendChild(opt);
  }

  // Reflect the persisted Selected_Currency in the control (Req 18.5).
  selectEl.value = state.selectedCurrency;
}

/**
 * Handle a currency change from the Settings selector (Req 18.6, 18.7).
 *
 * Persists the choice via storage.setCurrency (which validates the code â€”
 * unknown codes are rejected silently). Updates state.selectedCurrency and
 * triggers a full reporting-style re-render of every currency-formatted surface:
 * dashboard totals (Total_Balance / Total_Income / Total_Expense), the
 * Monthly_Summary, the category charts, and the Transaction_List. NO stored
 * transaction amounts are modified â€” this is presentation only (Req 9.3, 18.7).
 *
 * The render path is identical to what happens after a month change or
 * add/delete: renderAll() covers every formatted surface atomically so no
 * surface is left showing the previous currency.
 *
 * @param {string} code ISO 4217 currency code from SUPPORTED_CURRENCIES.
 * @returns {void}
 */
function onCurrencyChange(code) {
  // Validate + persist. setCurrency rejects unknown codes (returns false); in
  // that case we keep the current state.selectedCurrency unchanged.
  const accepted = storage.setCurrency(code);
  if (!accepted) return;

  state.selectedCurrency = code;

  // Re-render every currency-formatted surface (Req 18.7). renderAll is the
  // single atomic re-render path used for all reporting-scope changes so it
  // guarantees no surface is left showing the previous currency symbol.
  renderAll();
}

/**
 * Wire the Settings currency selector: populate its options from
 * SUPPORTED_CURRENCIES (Req 18.1), reflect the persisted Selected_Currency on
 * load (Req 18.5), and route changes to onCurrencyChange (Req 18.6, 18.7).
 * @returns {void}
 */
function wireCurrencySelector() {
  populateCurrencySelect();

  const selectEl = document.getElementById("currency-select");
  if (!selectEl) return;

  selectEl.addEventListener("change", () => {
    onCurrencyChange(selectEl.value);
  });
}

/* --------------------------------------------------------------------------
 * Category management (task 8.3)
 *
 * Renders the custom category list grouped by type (Expense then Income).
 * Default categories are shown with a "(default)" badge and no delete button â€”
 * they are read-only (Req 8.6). Custom categories show a labelled Delete button
 * so the user can remove them (Req 8.5).
 *
 * After any add or delete the category list is re-rendered, the transaction
 * form's category <select> is refreshed (so the new/removed category appears
 * immediately for the currently-selected type, Req 8.4), and the filter
 * category <select> is repopulated (so the filter also reflects the change).
 * ------------------------------------------------------------------------ */

/**
 * Default category sets mirrored from categories.js / storage.js.
 * Used only to decide whether a listed category is a default (and should show
 * the read-only badge instead of a delete button).
 */
const _DEFAULT_EXPENSE_NAMES = new Set([
  "Food", "Transport", "Fun", "Bills", "Shopping", "Health", "Other",
]);
const _DEFAULT_INCOME_NAMES = new Set([
  "Salary", "Freelance", "Business", "Investment", "Gift", "Other",
]);

/**
 * True if `name` is one of the built-in default categories for `type`.
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {boolean}
 */
function isDefaultCategory(name, type) {
  if (type === "expense") return _DEFAULT_EXPENSE_NAMES.has(name);
  if (type === "income") return _DEFAULT_INCOME_NAMES.has(name);
  return false;
}

/**
 * Build a single category list item `<li>` for the category management panel
 * (Req 8.5). Default categories get a "(default)" badge and no delete button;
 * custom categories get a labelled Delete button (Req 15.5).
 *
 * All user-provided text is written via `safeText` (never innerHTML).
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {HTMLLIElement}
 */
function buildCategoryItem(name, type) {
  const li = document.createElement("li");
  li.className = "category-item";
  li.dataset.name = name;
  li.dataset.type = type;

  const info = document.createElement("div");
  info.className = "category-item__info";

  const nameSpan = document.createElement("span");
  nameSpan.className = "category-item__name";
  utils.safeText(nameSpan, name);

  const typeSpan = document.createElement("span");
  typeSpan.className = "category-item__type";
  utils.safeText(typeSpan, type);

  info.append(nameSpan, typeSpan);
  li.appendChild(info);

  if (isDefaultCategory(name, type)) {
    // Default: read-only badge, no delete control.
    const badge = document.createElement("span");
    badge.className = "category-item__badge";
    utils.safeText(badge, "default");
    li.appendChild(badge);
  } else {
    // Custom: labelled delete button (Req 15.5 accessible label).
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "category-item__delete";
    deleteBtn.dataset.action = "delete-category";
    utils.safeText(deleteBtn, "Delete");
    deleteBtn.setAttribute("aria-label", `Delete category ${name}`);
    li.appendChild(deleteBtn);
  }

  return li;
}

/**
 * Render the category management list (Req 8.5). Groups categories under
 * "Expense" and "Income" headings; renders defaults first, then custom, within
 * each group (matching the storage order returned by `categories.getCategories`).
 *
 * The list element is `#category-list` in `index.html`. If it is absent this
 * is a no-op so the rest of the app is unaffected.
 * @returns {void}
 */
function renderCategoryList() {
  const listEl = document.getElementById("category-list");
  if (!listEl) return;

  listEl.replaceChildren();

  for (const type of ["expense", "income"]) {
    const heading = document.createElement("li");
    heading.className = "category-list__group-heading";
    utils.safeText(heading, type === "expense" ? "Expense categories" : "Income categories");
    listEl.appendChild(heading);

    const catNames = categories.getCategories(type);
    for (const name of catNames) {
      listEl.appendChild(buildCategoryItem(name, type));
    }
  }
}

/**
 * Refresh every UI surface that depends on the category set after an add or
 * delete: the category list panel, the transaction form's category dropdown
 * (for the currently-selected type), and the filter category dropdown.
 * @returns {void}
 */
function refreshCategoryUI() {
  renderCategoryList();

  // Refresh the transaction form's category options for the current type so
  // a newly-added custom category is immediately available (Req 8.4).
  const typeEl = document.getElementById("transaction-type");
  const categoryEl = document.getElementById("transaction-category");
  if (typeEl && categoryEl) {
    dashboard.renderCategoryOptions(categoryEl, typeEl.value);
  }

  // Repopulate the filter category <select> so the new/removed category is
  // reflected in the filter panel too.
  populateCategoryFilter();
}

/**
 * Handle adding a custom category (Req 8.2, 8.3). Delegates validation and
 * persistence to `categories.addCategory`; maps the result to an inline message
 * or resets the form on success.
 *
 * Error messages (Req 8.2):
 *   - duplicate: "A category with that name already exists"
 *   - invalid (blank): "Category name is required"
 * @param {{ name: string, type: string }} formData
 * @param {HTMLFormElement} form
 * @returns {{ ok: boolean }}
 */
function onAddCategory(formData, form) {
  const errorEl = document.getElementById("category-form-error");
  utils.safeText(errorEl, "");

  const type = formData.type === "income" ? "income" : "expense";
  const result = categories.addCategory(formData.name, type);

  if (!result.ok) {
    const message =
      result.error === "duplicate"
        ? "A category with that name already exists"
        : "Category name is required";
    utils.safeText(errorEl, message);
    return { ok: false };
  }

  // Success: reset the form and refresh all category-dependent UI surfaces.
  form.reset();
  refreshCategoryUI();
  return { ok: true };
}

/**
 * Handle deleting a custom category (Req 8.6, 8.7). Delegates to
 * `categories.deleteCategory`; refuses with an inline message when the
 * category is in use (Req 8.7). Transactions are NEVER deleted (Req 8.8 is
 * enforced in the business logic layer; this UI layer simply shows the reason).
 *
 * Error messages:
 *   - in-use: "Category is in use by existing transactions and cannot be deleted"
 *   - default: "Default categories cannot be deleted"
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {{ ok: boolean }}
 */
function onDeleteCategory(name, type) {
  const errorEl = document.getElementById("category-form-error");
  utils.safeText(errorEl, "");

  const result = categories.deleteCategory(name, type);

  if (!result.ok) {
    const message =
      result.error === "in-use"
        ? "Category is in use by existing transactions and cannot be deleted"
        : "Default categories cannot be deleted";
    utils.safeText(errorEl, message);
    return { ok: false };
  }

  // Success: refresh all category-dependent UI surfaces.
  refreshCategoryUI();
  return { ok: true };
}

/**
 * Wire the category management form: submit â†’ onAddCategory, and delegated
 * click on the category list â†’ onDeleteCategory (Req 8.5, 8.6, 8.7, 15.2).
 * The form inputs already have associated `<label>` elements in `index.html`
 * (Req 15.2). Uses event delegation on `#category-list` so dynamically-added
 * rows are covered without re-wiring.
 * @returns {void}
 */
function wireCategoryForm() {
  const form = document.getElementById("category-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nameEl = form.querySelector("#category-name");
    const typeEl = form.querySelector("#category-type");
    onAddCategory(
      {
        name: nameEl ? nameEl.value : "",
        type: typeEl ? typeEl.value : "expense",
      },
      form
    );
  });

  // Delegated delete: a single listener on the list handles every delete button
  // (present and future), reading the name/type from the enclosing <li>.
  const listEl = document.getElementById("category-list");
  if (!listEl) return;

  listEl.addEventListener("click", (event) => {
    const trigger = event.target.closest('[data-action="delete-category"]');
    if (!trigger || !listEl.contains(trigger)) return;

    const row = trigger.closest(".category-item");
    if (!row) return;

    const name = row.dataset.name;
    const type = row.dataset.type;
    if (!name || !type) return;

    onDeleteCategory(name, type);
  });
}

/* --------------------------------------------------------------------------
 * Registration (task 15.3)
 *
 * Self-contained registration form handler. Does NOT modify the bootstrap,
 * renderAll, or any existing finance functionality. The registration section
 * (#register-section) is shown/hidden independently of the finance dashboard.
 * Task 15.8 will add the full authentication guard; this task only handles
 * the registration form interaction.
 * ------------------------------------------------------------------------ */

/**
 * Show the registration section and hide the finance dashboard main content.
 * @returns {void}
 */
function showRegisterView() {
  const registerSection = document.getElementById("register-section");
  const appMain = document.getElementById("app-main");
  if (registerSection) registerSection.hidden = false;
  if (appMain) appMain.hidden = true;
}

/**
 * Hide the registration section and restore the finance dashboard.
 * @returns {void}
 */
function hideRegisterView() {
  const registerSection = document.getElementById("register-section");
  if (registerSection) registerSection.hidden = true;
  resetRegisterForm();
  // Only show app-main if the user is authenticated.
  // If signed out, keep app-main hidden â€” the auth buttons in the header remain accessible.
  if (state.currentUser) {
    showProtectedApp();
  }
}

/**
 * Reset the registration form to its empty default state.
 * Clears all field values, validation messages, and the success block.
 * @returns {void}
 */
function resetRegisterForm() {
  const form = document.getElementById("register-form");
  if (form) form.reset();
  clearRegisterErrors();
  const successEl = document.getElementById("register-success");
  if (successEl) successEl.hidden = true;
  const submitBtn = document.getElementById("register-submit-button");
  if (submitBtn) {
    submitBtn.disabled = false;
    utils.safeText(submitBtn, "Create account");
  }
}

/**
 * Clear all inline validation messages on the registration form.
 * @returns {void}
 */
function clearRegisterErrors() {
  const form = document.getElementById("register-form");
  if (!form) return;
  for (const el of form.querySelectorAll("[data-field-error]")) {
    utils.safeText(el, "");
  }
  utils.safeText(document.getElementById("register-form-error"), "");
}

/**
 * Validate registration form input.
 * Returns an array of { field, message } errors. Empty array means valid.
 *
 * Rules:
 *   - email: required, must contain '@' and '.' after '@'
 *   - password: required, minimum 6 characters (Supabase default minimum)
 *   - confirmPassword: required, must match password
 *
 * @param {{ email: string, password: string, confirmPassword: string }} values
 * @returns {{ field: string, message: string }[]}
 */
function validateRegisterForm(values) {
  const errors = [];

  // Email validation
  if (!values.email || values.email.trim() === "") {
    errors.push({ field: "email", message: "Email address is required." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.push({ field: "email", message: "Please enter a valid email address." });
  }

  // Password validation â€” Supabase default minimum is 6 characters
  if (!values.password || values.password.length === 0) {
    errors.push({ field: "password", message: "Password is required." });
  } else if (values.password.length < 6) {
    errors.push({ field: "password", message: "Password must be at least 6 characters." });
  }

  // Confirm password
  if (!values.confirmPassword || values.confirmPassword.length === 0) {
    errors.push({ field: "confirmPassword", message: "Please confirm your password." });
  } else if (values.password !== values.confirmPassword) {
    errors.push({ field: "confirmPassword", message: "Passwords do not match." });
  }

  return errors;
}

/**
 * Display inline validation errors on the registration form.
 * Unrecognized field names fall through to the form-level error element.
 * @param {{ field: string, message: string }[]} errors
 * @returns {void}
 */
function showRegisterErrors(errors) {
  clearRegisterErrors();
  const form = document.getElementById("register-form");
  if (!form) return;
  const unassigned = [];
  for (const error of errors) {
    const slot = form.querySelector(`[data-field-error="${error.field}"]`);
    if (slot) {
      utils.safeText(slot, error.message);
    } else {
      unassigned.push(error.message);
    }
  }
  if (unassigned.length > 0) {
    utils.safeText(
      document.getElementById("register-form-error"),
      unassigned.join(" ")
    );
  }
}

/**
 * Show the success state after a successful registration.
 * Hides the form submit button and displays the result message.
 * @param {string} message
 * @returns {void}
 */
function showRegisterSuccess(message) {
  const successEl = document.getElementById("register-success");
  const successMsg = document.getElementById("register-success-message");
  if (successMsg) utils.safeText(successMsg, message);
  if (successEl) successEl.hidden = false;
}

/**
 * Handle registration form submission (task 15.3).
 *
 * Flow:
 *   1. Read form values.
 *   2. Run client-side validation.
 *   3. If invalid: show inline errors, do not call auth.signUp().
 *   4. If valid: disable button, show loading state, call auth.signUp().
 *   5. On success: show appropriate success message (session available or
 *      email confirmation required).
 *   6. On error: show normalized error message, re-enable button.
 *
 * Passwords are NEVER logged, stored, or returned to callers.
 *
 * @param {Event} event
 * @returns {void}
 */
function onRegisterSubmit(event) {
  event.preventDefault();

  const form = document.getElementById("register-form");
  if (!form) return;

  const emailEl = document.getElementById("register-email");
  const passwordEl = document.getElementById("register-password");
  const confirmEl = document.getElementById("register-confirm-password");
  const submitBtn = document.getElementById("register-submit-button");

  const values = {
    email: emailEl ? emailEl.value : "",
    password: passwordEl ? passwordEl.value : "",
    confirmPassword: confirmEl ? confirmEl.value : "",
  };

  // 1. Client-side validation â€” do not call Supabase with bad input.
  const validationErrors = validateRegisterForm(values);
  if (validationErrors.length > 0) {
    showRegisterErrors(validationErrors);
    return;
  }

  // 2. Clear previous errors and enter loading state.
  clearRegisterErrors();
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, "Creating account\u2026");
  }

  // 3. Delegate to auth.js â€” the only layer that knows about Supabase.
  //    Use a void-returning async IIFE so we don't need to make the handler async.
  (async () => {
    const result = await auth.signUp(values.email, values.password);

    if (result.ok) {
      // Case A: session returned immediately (email confirmation disabled in project).
      showRegisterSuccess(
        "Account created successfully! You can now sign in."
      );
      return;
    }

    // Case B: email confirmation required â€” auth.js returns email-not-confirmed
    // when Supabase creates the account but does not return a session yet.
    if (result.error && result.error.code === "email-not-confirmed") {
      showRegisterSuccess(
        "Almost there! We\u2019ve sent a confirmation email to " +
        values.email.trim() +
        ". Please check your inbox and click the link to activate your account, then come back to sign in."
      );
      return;
    }

    // Case C: provider error â€” show normalized message, re-enable button.
    const errorMessage = getRegisterErrorMessage(result.error);
    utils.safeText(document.getElementById("register-form-error"), errorMessage);
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, "Create account");
    }
  })();
}

/**
 * Map a normalized auth error to a user-friendly registration message.
 * Passwords are never included in error messages.
 * @param {{ code: string, message: string } | undefined} error
 * @returns {string}
 */
function getRegisterErrorMessage(error) {
  if (!error) return "Registration failed. Please try again.";
  switch (error.code) {
    case "email-in-use":
      return "An account with this email address already exists. Try signing in instead.";
    case "invalid-email":
      return "Please enter a valid email address.";
    case "weak-password":
      return "Password must be at least 6 characters.";
    case "rate-limited":
      return "Too many attempts. Please wait a moment and try again.";
    case "network-error":
      return "Network error. Please check your connection and try again.";
    case "not-configured":
      return "Authentication is not configured yet. Please add your Supabase credentials to js/config.js.";
    default:
      return "Registration failed. Please try again.";
  }
}

/**
 * Wire the registration form and navigation buttons (task 15.3).
 * Attaches to #register-form, #show-register-button, #register-back-button.
 * @returns {void}
 */
function wireRegisterForm() {
  const form = document.getElementById("register-form");
  if (form) {
    form.addEventListener("submit", onRegisterSubmit);
  }

  const showBtn = document.getElementById("show-register-button");
  if (showBtn) {
    showBtn.addEventListener("click", showRegisterView);
  }

  const backBtn = document.getElementById("register-back-button");
  if (backBtn) {
    backBtn.addEventListener("click", hideRegisterView);
  }
}


/* --------------------------------------------------------------------------
 * Login (task 15.4)
 *
 * Self-contained login form handler. Mirrors the registration pattern from
 * task 15.3. Does NOT modify bootstrap, renderAll, or any existing finance
 * functionality. The login section (#login-section) is shown/hidden
 * independently of the finance dashboard.
 *
 * Flow:
 *   Login form → app.js (onLoginSubmit) → auth.signIn() → Supabase Auth
 *
 * No direct Supabase calls are made from this module.
 * Task 15.8 will add the full auth guard; this task only handles the login
 * form interaction and the immediate signed-in indication.
 * ------------------------------------------------------------------------ */

/**
 * Show the login section and hide the finance dashboard.
 * @returns {void}
 */
function showLoginView() {
  const loginSection = document.getElementById('login-section');
  const appMain = document.getElementById('app-main');
  const registerSection = document.getElementById('register-section');
  if (loginSection) loginSection.hidden = false;
  if (appMain) appMain.hidden = true;
  if (registerSection) registerSection.hidden = true;
}

/**
 * Hide the login section and restore the finance dashboard.
 * Also resets the login form so stale state is not visible on next open.
 * @returns {void}
 */
function hideLoginView() {
  const loginSection = document.getElementById('login-section');
  if (loginSection) loginSection.hidden = true;
  resetLoginForm();
  // Only show app-main if the user is authenticated.
  // If signed out, keep app-main hidden â€” the auth buttons in the header remain accessible.
  if (state.currentUser) {
    showProtectedApp();
  }
}

/**
 * Reset the login form to its empty default state.
 * Clears all field values, validation messages, and the success block.
 * @returns {void}
 */
function resetLoginForm() {
  const form = document.getElementById('login-form');
  if (form) form.reset();
  clearLoginErrors();
  const successEl = document.getElementById('login-success');
  if (successEl) successEl.hidden = true;
  const submitBtn = document.getElementById('login-submit-button');
  if (submitBtn) {
    submitBtn.disabled = false;
    utils.safeText(submitBtn, 'Sign in');
  }
}

/**
 * Clear all inline validation messages on the login form.
 * @returns {void}
 */
function clearLoginErrors() {
  const form = document.getElementById('login-form');
  if (!form) return;
  for (const el of form.querySelectorAll('[data-field-error]')) {
    utils.safeText(el, '');
  }
  utils.safeText(document.getElementById('login-form-error'), '');
}

/**
 * Validate login form input before calling auth.signIn().
 * Returns an array of { field, message } errors. Empty array means valid.
 *
 * Rules:
 *   - email: required, must pass basic format check
 *   - password: required (non-empty)
 *
 * @param {{ email: string, password: string }} values
 * @returns {{ field: string, message: string }[]}
 */
function validateLoginForm(values) {
  const errors = [];

  if (!values.email || values.email.trim() === '') {
    errors.push({ field: 'email', message: 'Email address is required.' });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.push({ field: 'email', message: 'Please enter a valid email address.' });
  }

  if (!values.password || values.password.length === 0) {
    errors.push({ field: 'password', message: 'Password is required.' });
  }

  return errors;
}

/**
 * Display inline validation errors on the login form.
 * Unrecognized field names fall through to the form-level error element.
 * @param {{ field: string, message: string }[]} errors
 * @returns {void}
 */
function showLoginErrors(errors) {
  clearLoginErrors();
  const form = document.getElementById('login-form');
  if (!form) return;
  const unassigned = [];
  for (const error of errors) {
    const slot = form.querySelector(`[data-field-error="${error.field}"]`);
    if (slot) {
      utils.safeText(slot, error.message);
    } else {
      unassigned.push(error.message);
    }
  }
  if (unassigned.length > 0) {
    utils.safeText(
      document.getElementById('login-form-error'),
      unassigned.join(' ')
    );
  }
}

/**
 * Map a normalized auth error to a user-friendly login message.
 * Passwords are never included in error messages.
 * @param {{ code: string, message: string } | undefined} error
 * @returns {string}
 */
function getLoginErrorMessage(error) {
  if (!error) return 'Sign-in failed. Please try again.';
  switch (error.code) {
    case 'invalid-credentials':
      return 'Incorrect email or password. Please try again.';
    case 'invalid-email':
      return 'Please enter a valid email address.';
    case 'email-not-confirmed':
      return 'Please confirm your email address before signing in. Check your inbox for the confirmation link.';
    case 'user-not-found':
      return 'No account found with this email address.';
    case 'rate-limited':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'network-error':
      return 'Network error. Please check your connection and try again.';
    case 'not-configured':
      return 'Authentication is not configured yet. Please add your Supabase credentials to js/config.js.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

/**
 * Update the header to reflect a signed-in state.
 * Shows the authenticated email and hides the Sign in / Create account buttons.
 * Passwords are never stored, logged, or shown — only the email is displayed.
 *
 * This is the basic signed-in indication for Task 15.4. The full authenticated
 * header (with a logout button) is implemented in Task 15.5.
 *
 * @param {string} email  The authenticated user's email address.
 * @returns {void}
 */
function showSignedInState(email) {
  const signedInBadge = document.getElementById('auth-signed-in');
  const signedInEmail = document.getElementById('auth-signed-in-email');
  const showLoginBtn = document.getElementById('show-login-button');
  const showRegisterBtn = document.getElementById('show-register-button');

  if (signedInEmail) utils.safeText(signedInEmail, email);
  if (signedInBadge) signedInBadge.hidden = false;
  if (showLoginBtn) showLoginBtn.hidden = true;
  if (showRegisterBtn) showRegisterBtn.hidden = true;

  // Track the current user in state.
  state.currentUser = { email };
}

/**
 * Update the header to reflect a signed-out state.
 * Hides the authenticated email badge, shows the Sign in / Create account
 * buttons, and clears the stored current user.
 * @returns {void}
 */
function showSignedOutState() {
  state.currentUser = null;

  const signedInBadge = document.getElementById('auth-signed-in');
  const signedInEmail = document.getElementById('auth-signed-in-email');
  const showLoginBtn = document.getElementById('show-login-button');
  const showRegisterBtn = document.getElementById('show-register-button');

  if (signedInBadge) signedInBadge.hidden = true;
  if (signedInEmail) utils.safeText(signedInEmail, '');
  if (showLoginBtn) showLoginBtn.hidden = false;
  if (showRegisterBtn) showRegisterBtn.hidden = false;
}

/**
 * Handle a logout request (task 15.5, Req 19.3).
 *
 * Always navigates back to the login view regardless of whether auth.signOut()
 * succeeds — a network error must not trap the user in a signed-in state. The
 * Supabase session token in localStorage is cleared by supabase-js on signOut;
 * locally we clear state.currentUser and hide the finance dashboard so no
 * financial data remains visible in the DOM.
 *
 * Uses the void-returning async IIFE pattern consistent with onLoginSubmit and
 * onRegisterSubmit to avoid making the click handler itself async.
 * @returns {void}
 */
function onLogout() {
  (async () => {
    // Call the auth layer — the only layer that knows about Supabase.
    // We deliberately ignore the result: the local session is cleared either way.
    await auth.signOut();

    // Clear the in-memory current user and restore the header nav to its
    // signed-out appearance (login/register buttons visible, email badge hidden).
    showSignedOutState();

    // Hide the finance dashboard so no financial data is visible after logout.
    const appMain = document.getElementById('app-main');
    if (appMain) appMain.hidden = true;

    // Navigate to the login view.
    showLoginView();
  })();
}

/**
 * Wire the logout button to onLogout (task 15.5, Req 19.3).
 * The button lives inside #auth-signed-in which is hidden by default, so it
 * is only reachable when a user is signed in.
 * @returns {void}
 */
function wireLogoutButton() {
  const logoutBtn = document.getElementById('logout-button');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', onLogout);
  }
}

/**
 * Handle login form submission (task 15.4).
 *
 * Flow:
 *   1. Read form values.
 *   2. Run client-side validation (empty/format checks).
 *   3. If invalid: show inline errors, do not call auth.signIn().
 *   4. If valid: disable button, show loading state, call auth.signIn().
 *   5. On success: show success state and display the authenticated email.
 *   6. On error: show normalized error message, re-enable button.
 *
 * Passwords are NEVER logged, stored, or returned to callers.
 *
 * @param {Event} event
 * @returns {void}
 */
function onLoginSubmit(event) {
  event.preventDefault();

  const form = document.getElementById('login-form');
  if (!form) return;

  const emailEl = document.getElementById('login-email');
  const passwordEl = document.getElementById('login-password');
  const submitBtn = document.getElementById('login-submit-button');

  const values = {
    email: emailEl ? emailEl.value : '',
    password: passwordEl ? passwordEl.value : '',
  };

  // 1. Client-side validation — do not call Supabase with invalid input.
  const validationErrors = validateLoginForm(values);
  if (validationErrors.length > 0) {
    showLoginErrors(validationErrors);
    return;
  }

  // 2. Clear previous errors and enter loading state.
  clearLoginErrors();
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, 'Signing in\u2026');
  }

  // 3. Delegate to auth.js — the only layer that knows about Supabase.
  //    Use a void-returning async IIFE to avoid making the handler async.
  (async () => {
    // NOTE: password variable is not referenced after this call and is never
    // stored, logged, or propagated anywhere in the response.
    const result = await auth.signIn(values.email, values.password);

    if (result.ok) {
      // Login succeeded: show success message and basic signed-in indication.
      const successEl = document.getElementById('login-success');
      const successMsg = document.getElementById('login-success-message');
      if (successMsg) {
        utils.safeText(
          successMsg,
          'Signed in as ' + result.user.email + '. Welcome back!'
        );
      }
      if (successEl) successEl.hidden = false;

      // Update header to show the authenticated email.
      // The onAuthStateChange callback (registered in initAuthSession) handles
      // showing the protected app and initializing the finance application (task 15.8).
      showSignedInState(result.user.email);

      return;
    }

    // Login failed: map to a user-friendly message and re-enable the button.
    const errorMessage = getLoginErrorMessage(result.error);
    utils.safeText(document.getElementById('login-form-error'), errorMessage);
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, 'Sign in');
    }
  })();
}

/**
 * Wire the login form and navigation buttons (task 15.4).
 * Attaches to #login-form, #show-login-button, #login-back-button,
 * and #login-to-register-button.
 * @returns {void}
 */
function wireLoginForm() {
  const form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', onLoginSubmit);
  }

  // "Sign in" button in the header opens the login view.
  const showLoginBtn = document.getElementById('show-login-button');
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', showLoginView);
  }

  // "← Back to app" closes the login view without doing anything.
  const backBtn = document.getElementById('login-back-button');
  if (backBtn) {
    backBtn.addEventListener('click', hideLoginView);
  }

  // "Create account" link inside the login view switches to the register view.
  const toRegisterBtn = document.getElementById('login-to-register-button');
  if (toRegisterBtn) {
    toRegisterBtn.addEventListener('click', () => {
      hideLoginView();
      showRegisterView();
    });
  }

  // "Forgot password?" link inside the login view switches to the reset view.
  const forgotBtn = document.getElementById('login-forgot-password-button');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', showResetPasswordView);
  }
}

/* --------------------------------------------------------------------------
 * Password Reset (task 15.6)
 *
 * Self-contained password-reset form handler. Provides the "Forgot password?"
 * flow: user enters their email, auth.resetPassword() sends a Supabase
 * password-reset email, and a confirmation message is shown.
 *
 * Architecture:
 *   Password Reset UI → app.js (onResetPasswordSubmit) → auth.resetPassword() → Supabase Auth
 *
 * No direct Supabase calls are made from this module.
 * Security: passwords are never logged, stored, or returned. The success
 * message deliberately does not reveal whether the email is registered.
 * ------------------------------------------------------------------------ */

/**
 * Show the password-reset section and hide the finance dashboard and login.
 * @returns {void}
 */
function showResetPasswordView() {
  const resetSection = document.getElementById('reset-password-section');
  const appMain = document.getElementById('app-main');
  const loginSection = document.getElementById('login-section');
  if (resetSection) resetSection.hidden = false;
  if (appMain) appMain.hidden = true;
  if (loginSection) loginSection.hidden = true;
  // Clear any stale state from a previous visit to this form.
  resetResetPasswordForm();
}

/**
 * Hide the password-reset section and show the login view.
 * Called by the "Back to sign in" button.
 * @returns {void}
 */
function hideResetPasswordView() {
  const resetSection = document.getElementById('reset-password-section');
  if (resetSection) resetSection.hidden = true;
  resetResetPasswordForm();
  showLoginView();
}

/**
 * Reset the password-reset form to its empty default state.
 * Clears all field values, validation messages, and the success block.
 * Re-enables the submit button so a returning user can try again.
 * @returns {void}
 */
function resetResetPasswordForm() {
  const form = document.getElementById('reset-password-form');
  if (form) form.reset();
  clearResetPasswordErrors();
  const successEl = document.getElementById('reset-password-success');
  if (successEl) successEl.hidden = true;
  const submitBtn = document.getElementById('reset-password-submit-button');
  if (submitBtn) {
    submitBtn.disabled = false;
    utils.safeText(submitBtn, 'Send reset email');
  }
}

/**
 * Clear all inline validation and error messages on the password-reset form.
 * @returns {void}
 */
function clearResetPasswordErrors() {
  const form = document.getElementById('reset-password-form');
  if (!form) return;
  for (const el of form.querySelectorAll('[data-field-error]')) {
    utils.safeText(el, '');
  }
  utils.safeText(document.getElementById('reset-password-form-error'), '');
}

/**
 * Validate the password-reset form input before calling auth.resetPassword().
 * Returns an array of { field, message } errors. Empty array means valid.
 *
 * Rules:
 *   - email: required, must pass basic format check
 *
 * @param {{ email: string }} values
 * @returns {{ field: string, message: string }[]}
 */
function validateResetPasswordForm(values) {
  const errors = [];

  if (!values.email || values.email.trim() === '') {
    errors.push({ field: 'email', message: 'Email address is required.' });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.push({ field: 'email', message: 'Please enter a valid email address.' });
  }

  return errors;
}

/**
 * Display inline validation errors on the password-reset form.
 * Unrecognized field names fall through to the form-level error element.
 * @param {{ field: string, message: string }[]} errors
 * @returns {void}
 */
function showResetPasswordErrors(errors) {
  clearResetPasswordErrors();
  const form = document.getElementById('reset-password-form');
  if (!form) return;
  const unassigned = [];
  for (const error of errors) {
    const slot = form.querySelector(`[data-field-error="${error.field}"]`);
    if (slot) {
      utils.safeText(slot, error.message);
    } else {
      unassigned.push(error.message);
    }
  }
  if (unassigned.length > 0) {
    utils.safeText(
      document.getElementById('reset-password-form-error'),
      unassigned.join(' ')
    );
  }
}

/**
 * Map a normalized auth error to a user-friendly password-reset message.
 * Does not reveal whether the email address is registered (security best
 * practice — the success message also uses neutral language for the same reason).
 * Passwords are never included in error messages.
 * @param {{ code: string, message: string } | undefined} error
 * @returns {string}
 */
function getResetPasswordErrorMessage(error) {
  if (!error) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'invalid-email':
      return 'Please enter a valid email address.';
    case 'rate-limited':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'network-error':
      return 'Network error. Please check your connection and try again.';
    case 'not-configured':
      return 'Authentication is not configured yet. Please add your Supabase credentials to js/config.js.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Handle password-reset form submission (task 15.6, Req 19.4).
 *
 * Flow:
 *   1. Read form values.
 *   2. Run client-side validation (empty / format checks).
 *   3. If invalid: show inline errors, do not call auth.resetPassword().
 *   4. If valid: disable button, show loading state, call auth.resetPassword().
 *   5. On success: show confirmation message (neutral — does not reveal
 *      whether the email is registered, per security best practice).
 *   6. On error: show normalized message, re-enable button.
 *
 * The redirect URL is derived from window.location.origin inside auth.js, so
 * it works correctly on both localhost and GitHub Pages without hard-coding.
 * Passwords are NEVER logged, stored, or returned to callers.
 *
 * @param {Event} event
 * @returns {void}
 */
function onResetPasswordSubmit(event) {
  event.preventDefault();

  const form = document.getElementById('reset-password-form');
  if (!form) return;

  const emailEl = document.getElementById('reset-email');
  const submitBtn = document.getElementById('reset-password-submit-button');

  const values = {
    email: emailEl ? emailEl.value : '',
  };

  // 1. Client-side validation — do not call Supabase with invalid input.
  const validationErrors = validateResetPasswordForm(values);
  if (validationErrors.length > 0) {
    showResetPasswordErrors(validationErrors);
    return;
  }

  // 2. Clear previous errors and enter loading state.
  //    Disable the button to prevent duplicate submissions.
  clearResetPasswordErrors();
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, 'Sending\u2026');
  }

  // 3. Delegate to auth.js — the only layer that knows about Supabase.
  //    The redirect URL is derived from window.location.origin inside auth.js.
  //    Use a void-returning async IIFE to avoid making the handler async.
  (async () => {
    const result = await auth.resetPassword(values.email);

    if (result.ok) {
      // Success: show a neutral confirmation that does not reveal whether the
      // email is registered (security best practice, Req 19.4).
      const successEl = document.getElementById('reset-password-success');
      const successMsg = document.getElementById('reset-password-success-message');
      if (successMsg) {
        utils.safeText(
          successMsg,
          'If an account exists for this email, a password reset link has been sent. Please check your inbox (and spam folder).'
        );
      }
      if (successEl) successEl.hidden = false;
      // Keep the button disabled after success so the user cannot re-submit
      // (they should wait for the email rather than spam the endpoint).
      return;
    }

    // Error: map to a user-friendly message and re-enable the button.
    const errorMessage = getResetPasswordErrorMessage(result.error);
    utils.safeText(document.getElementById('reset-password-form-error'), errorMessage);
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, 'Send reset email');
    }
  })();
}

/**
 * Wire the password-reset form and navigation buttons (task 15.6).
 * Attaches to #reset-password-form and #reset-password-back-button.
 * The "Forgot password?" entry point in the login form is wired in wireLoginForm().
 * @returns {void}
 */
function wireResetPasswordForm() {
  const form = document.getElementById('reset-password-form');
  if (form) {
    form.addEventListener('submit', onResetPasswordSubmit);
  }

  // "← Back to sign in" returns to the login view and clears reset state.
  const backBtn = document.getElementById('reset-password-back-button');
  if (backBtn) {
    backBtn.addEventListener('click', hideResetPasswordView);
  }
}

/* --------------------------------------------------------------------------
 * Session persistence & auth state (task 15.7)
 *
 * Detects an existing Supabase session on page load and registers a single
 * auth-state listener to keep state.currentUser and the header UI synchronized
 * whenever authentication state changes (Req 19.5, 19.6).
 *
 * Architecture:
 *   initAuthSession() → auth.getCurrentUser() / auth.onAuthStateChange()
 *                     → showSignedInState() / showSignedOutState()
 *
 * Security invariants:
 *   - No tokens, passwords, or session objects are stored manually.
 *   - Supabase Auth manages session persistence internally.
 *   - state.currentUser is runtime UI state, not an auth store.
 *   - The listener is registered exactly once; no duplicate listeners.
 * ------------------------------------------------------------------------ */

/**
 * Initialise authentication session detection and state synchronization
 * (task 15.7, Req 19.5, 19.6).
 *
 * Step 1: Register one auth-state listener via auth.onAuthStateChange() so
 * that future sign-in, sign-out, token-refresh, and session-restore events
 * keep state.currentUser and the header UI in sync automatically.
 *
 * Step 2: Detect any existing Supabase session via auth.getCurrentUser().
 * If a user is returned, restore the signed-in state. If not, keep the
 * signed-out state. Fails safely — an error from getCurrentUser() is caught
 * and logged; the application continues normally in a signed-out state.
 *
 * This function must be called ONCE during bootstrap(). It must NOT be called
 * more than once (which would register duplicate listeners).
 *
 * Passwords are never stored, logged, or returned. Tokens are never stored
 * manually — Supabase Auth manages session persistence internally.
 *
 * @returns {Promise<void>}
 */
async function initAuthSession() {
  // ── Step 1: register the auth-state listener first ──────────────────────
  // Registering before the initial getCurrentUser() call ensures we never
  // miss a state change that fires during or shortly after initialisation.
  //
  // The listener is registered exactly once here. It must not be registered
  // again elsewhere in the application to avoid duplicate state updates.
  auth.onAuthStateChange((event, user) => {
    // user is the normalized { id, email } object from auth.js, or null.
    if (user) {
      // A user is now signed in (SIGNED_IN, TOKEN_REFRESHED, INITIAL_SESSION
      // with an active session, USER_UPDATED, etc.).
      state.currentUser = user;
      showSignedInState(user.email);
      showProtectedApp();
      initializeFinanceApplication(); // no-op if already initialized
      // Close any open auth sections so the finance app is immediately visible.
      const loginSection = document.getElementById('login-section');
      const registerSection = document.getElementById('register-section');
      const resetSection = document.getElementById('reset-password-section');
      if (loginSection) loginSection.hidden = true;
      if (registerSection) registerSection.hidden = true;
      if (resetSection) resetSection.hidden = true;
    } else {
      // No authenticated user (SIGNED_OUT, INITIAL_SESSION with no session).
      state.currentUser = null;
      showSignedOutState();
      hideProtectedApp();
    }
  });

  // ── Step 2: detect an existing session on this page load ─────────────────
  // auth.getCurrentUser() verifies the JWT with Supabase (not just the local
  // cache) and returns null when configuration uses placeholders, when there
  // is no active session, or when the token has expired.
  //
  // Note: when Supabase IS configured, onAuthStateChange will also fire an
  // INITIAL_SESSION event covering the same scenario. The explicit
  // getCurrentUser() call below acts as an immediate, synchronous-feeling
  // paint for the signed-in state without waiting for the async listener
  // callback, and is the safe no-op when config uses placeholders (since
  // onAuthStateChange also fires 'INITIAL_SESSION'+null via queueMicrotask
  // in that case, which would call showSignedOutState() — matching state).
  try {
    const user = await auth.getCurrentUser();
    if (user) {
      // Existing authenticated session: restore signed-in UI.
      state.currentUser = user;
      showSignedInState(user.email);
    }
    // No user → keep state.currentUser = null (already the default).
    return state.currentUser;
  } catch (err) {
    // Fail safely: an unexpected error from getCurrentUser() must not crash
    // the application. Keep the signed-out state and log a warning.
    console.warn('auth: session detection failed — continuing signed out.', err);
    state.currentUser = null;
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Finance application initialization guard (task 15.8)
 *
 * Prevents storage init, event wiring, and rendering from executing more than
 * once. The flag is checked in initializeFinanceApplication() so repeated calls
 * from the auth-state callback (e.g., TOKEN_REFRESHED events) are no-ops.
 * ------------------------------------------------------------------------ */

/**
 * True once initializeFinanceApplication() has run successfully.
 * Ensures all finance wiring + storage init happen exactly once per session.
 * @type {boolean}
 */
let financeAppInitialized = false;

/**
 * Show the protected finance app (app-main).
 * @returns {void}
 */
function showProtectedApp() {
  const appMain = document.getElementById('app-main');
  if (appMain) appMain.hidden = false;
}

/**
 * Hide the protected finance app (app-main).
 * Called before auth resolves to prevent flash of unauthenticated finance data,
 * and on sign-out to remove finance data from the DOM.
 * @returns {void}
 */
function hideProtectedApp() {
  const appMain = document.getElementById('app-main');
  if (appMain) appMain.hidden = true;
}

/**
 * Initialize all finance-specific application state: storage, event wiring,
 * category list, currency selector, and initial render.
 *
 * Guarded by `financeAppInitialized` so it is safe to call multiple times â€”
 * only the first call does real work (Req 10.4, 18.5).
 * @returns {void}
 */
function initializeFinanceApplication() {
  if (financeAppInitialized) return;
  financeAppInitialized = true;

  // Ensure a valid persisted schema exists before any read/write (Req 10.4).
  storage.initializeData();

  // Seed the active currency from the persisted setting (Req 18.5). Must happen
  // before renderAll so the first paint already shows the correct currency symbol.
  state.selectedCurrency = storage.getCurrency();

  wireTransactionForm();

  // Delegated delete handling for the Transaction_List (task 3.5, Req 3.3).
  wireTransactionListDeletion();

  // Month selector: default to the current month and re-render reports/charts
  // on change â€” reporting scope only, never the list (task 5.2, Req 5.1/5.9).
  wireMonthSelector();

  // Filter/search controls for the Transaction_List (task 6.3, Req 4.1, 4.9).
  // Wired before renderAll so the category filter is populated on first paint.
  wireFilterControls();

  // Initialise the Chart.js canvases once (task 7.1, Req 6.1, 15.6). Called
  // after the DOM is ready and before renderAll so the first renderReports()
  // call finds live chart instances to update.
  charts.initCharts();

  // Category management UI (task 8.3, Req 8.5). Wire the add-category form and
  // the delegated delete on the category list. Initial render of the list
  // happens via renderCategoryList() inside wireCategoryForm setup â€” called
  // explicitly here so the panel is populated on first paint.
  wireCategoryForm();
  renderCategoryList();

  // Settings: currency selector (task 14.3, Req 18.1, 18.5, 18.6). Populates
  // the <select> from SUPPORTED_CURRENCIES and wires the change event. Must be
  // called after state.selectedCurrency is seeded so the selector reflects the
  // persisted currency on first paint (Req 18.5).
  wireCurrencySelector();

  // Initial paint of every current view for the persisted state: the Dashboard
  // (totals, count, Selected_Month, recent transactions â€” task 4.1,
  // Req 1.1/1.2/1.4/1.5/1.8) and the Transaction_List (Req 3.1). renderAll is
  // also the single re-render path used on add/delete (task 4.2).
  renderAll();

  console.info(
    "Personal Finance Tracker: finance application initialized.",
    { selectedMonth: state.selectedMonth }
  );
}

/**
 * Bootstrap the app on load (task 15.8 â€” protected bootstrap / auth guard).
 *
 * Wires auth UI first, hides the protected finance app, then awaits auth
 * resolution before deciding whether to initialize the finance application.
 * This prevents any flash of finance data before the auth state is known.
 *
 * Flow:
 *   1. Wire auth forms (always available regardless of auth state).
 *   2. Hide app-main to prevent flash of unauthenticated finance content.
 *   3. Await initAuthSession() â€” registers the auth-state listener AND
 *      returns the current user (or null).
 *   4. If user: show protected app and initialize finance application.
 *   5. If no user: keep app-main hidden; auth UI remains accessible.
 *
 * @returns {Promise<void>}
 */
async function bootstrap() {
  // Wire all auth UI first â€” these work regardless of auth state.
  wireRegisterForm();
  wireLoginForm();
  wireLogoutButton();
  wireResetPasswordForm();

  // Hide the protected app during auth resolution to prevent flash of finance data.
  hideProtectedApp();

  // Resolve authentication state. initAuthSession() registers the auth-state
  // listener AND returns the current user (or null). Must complete before
  // deciding whether to initialize the finance app.
  const user = await initAuthSession();

  if (user) {
    showSignedInState(user.email);
    showProtectedApp();
    initializeFinanceApplication();
  } else {
    showSignedOutState();
    // hideProtectedApp() already called above; auth UI is already available.
  }

  console.info(
    "Personal Finance Tracker: module graph loaded, app ready.",
    { authenticated: !!user }
  );
}

// Run bootstrap once the DOM is ready. The module script is deferred, so the
// DOM may already be parsed by the time this executes.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}