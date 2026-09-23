/*
 * app.js — UI glue / entry point (ES module).
 *
 * Single responsibility: bootstrap the app, hold the lightweight shared app
 * state (selectedMonth reporting scope + filterCriteria list scope), wire DOM
 * events, and orchestrate re-renders. The ONLY module that knows about all UI
 * modules; it also drives business logic and storage init.
 *
 * Layer: UI glue / entry point. May import everything — the storage layer, the
 * business logic layer, the UI render layer, and utils.
 *
 * NOTE: In task 1.3 bootstrap() only imports the module graph and logs
 * readiness. Real event wiring and render orchestration arrive across Phases
 * 3–8 (tasks 3.3, 3.5, 4.x, 5.2, 6.3, 6.4, 8.3, ...).
 */

import * as storage from "./storage.js";
import * as transactions from "./transactions.js";
import * as categories from "./categories.js";
import * as dashboard from "./dashboard.js";
import * as reports from "./reports.js";
import * as charts from "./charts.js";
import * as utils from "./utils.js";
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
 * Lightweight app state — the only mutable shared state.
 *  - selectedMonth: reporting scope (Dashboard month, Monthly_Summary, charts)
 *  - filterCriteria: list scope (drives only the Transaction_List)
 *  - selectedCurrency: active ISO 4217 currency code for all formatted money
 *    values; seeded from storage.getCurrency() at bootstrap (Req 18.5).
 */
const state = {
  selectedMonth: currentMonthKey(),
  filterCriteria: { searchTerm: "", type: "all", category: "", month: "" },
  selectedCurrency: "IDR", // overwritten in bootstrap() from storage.getCurrency()
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
 * (Req 2.4–2.8, 15.2). Falls back to the form-level message for any error whose
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
 * (expense + income) via `renderReports()` → `charts.updateExpenseChart /
 * updateIncomeChart`. Charts update in-place via `chart.update()` — no
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
 * Wire the add-transaction form's events: submit → onAddTransaction, and
 * type change → refresh the Category options for that type (Req 2.3). Seeds the
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
 * Render the Transaction_List for the current state (Req 3.1, 3.2, 4.1–4.13).
 * Applies the active filter scope (`state.filterCriteria`) via the pure
 * `filterTransactions` view function — a read-only operation that NEVER mutates
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
  //   - Transactions exist but none match → Filtered_Empty_State message.
  //   - No transactions at all → generic no-data message (dashboard.js default).
  const emptyMessage =
    all.length > 0 && filtered.length === 0
      ? "No transactions match your filters."
      : undefined;

  dashboard.renderTransactionListRows(filtered, emptyMessage, state.selectedCurrency);
  addDeleteControls();
}

/* --------------------------------------------------------------------------
 * Filter / search controls — list scope (task 6.3)
 *
 * The filter scope is completely independent of the reporting scope. Changing
 * any filter criterion updates ONLY the Transaction_List — it never calls
 * renderDashboard, renderReports, or saveData — so the Dashboard totals and
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

  // "All categories" sentinel — means no category filter active.
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
 * extent of what a filter change does — no saveData, no dashboard re-render,
 * no report/chart re-render — so Dashboard totals and Monthly_Summary can
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
 *   - Search_Term → "" (empty)
 *   - type filter → "all"
 *   - Category filter → "" (no category selected)
 *   - month filter → "" (no month filter active)
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
 * renderAll() re-renders every view affected by a reporting-scope change — a
 * transaction being added or deleted — for the current app state. Per the
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
 *     `initCharts()` which destroys any stale instance before creating a fresh one —
 *     the destroy-before-create contract is enforced inside `charts.js`.
 *
 * It deliberately does NOT touch the Transaction_List — that belongs to the
 * independent filter scope (Req 4.12 / 5.9).
 * @returns {void}
 */
function renderReports() {
  // Monthly_Summary for the Selected_Month (Req 5.3–5.8). Pass the active
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
 * Handle a request to delete the transaction with the given id (Req 3.3–3.6).
 * Requires a confirmation interaction first: on cancel the transaction is
 * retained unchanged and nothing is persisted (Req 3.4); on confirm the
 * deletion is delegated to the business logic layer (which persists the updated
 * set, Req 3.5/3.6) and the Transaction_List is re-rendered.
 *
 * On confirm + success, calls `renderAll()` which triggers the full reporting-scope
 * re-render path including both category charts via `renderReports()` →
 * `charts.updateExpenseChart / updateIncomeChart`. Charts update in-place via
 * `chart.update()` — no destroy/recreate, no duplicate instances (Req 6.4, 16.2).
 * @param {string} id
 * @returns {{ ok: boolean }}
 */
function onDeleteTransaction(id) {
  if (id == null || id === "") {
    return { ok: false };
  }

  // Confirmation interaction (Req 3.3). Cancel → retain unchanged (Req 3.4).
  const confirmed = window.confirm(
    "Delete this transaction? This cannot be undone."
  );
  if (!confirmed) {
    return { ok: false };
  }

  // Confirmed → remove + persist via business logic (Req 3.5, 3.6).
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
 * Month selector — reporting scope (task 5.2)
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
 * scope in app state and recomputes the month-scoped reporting views — the
 * Monthly_Summary and category charts — for the new month, plus the Dashboard's
 * Selected_Month label. Deliberately leaves the Transaction_List untouched: the
 * list is driven by the separate filter scope, so a reporting-month change
 * never moves it (Req 5.9).
 *
 * Both category charts update in-place via `chart.update()` through
 * `renderReports()` → `charts.updateExpenseChart / updateIncomeChart`. No
 * destroy/recreate occurs for a month change — no duplicate instances or leaks
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
 * Currency selector — Settings section (task 14.3)
 *
 * The currency selector is a presentation-only control: changing it updates
 * state.selectedCurrency, persists the choice via storage.setCurrency, and
 * re-renders all currency-formatted surfaces without touching any stored
 * transaction amounts (Req 18.6, 18.7).
 *
 * This mirrors the month-selector's reporting-scope pattern: changing the
 * currency triggers a full re-render of every formatted view, but no data is
 * mutated — it is purely a display preference (Req 9.3).
 * ------------------------------------------------------------------------ */

/**
 * Populate the currency `<select>` with one `<option>` per entry in
 * `SUPPORTED_CURRENCIES` (Req 18.1). Each option displays the currency code
 * and its human-readable label (e.g., "USD — US Dollar"). Option text is set
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
    opt.textContent = `${code} — ${meta.label}`;
    selectEl.appendChild(opt);
  }

  // Reflect the persisted Selected_Currency in the control (Req 18.5).
  selectEl.value = state.selectedCurrency;
}

/**
 * Handle a currency change from the Settings selector (Req 18.6, 18.7).
 *
 * Persists the choice via storage.setCurrency (which validates the code —
 * unknown codes are rejected silently). Updates state.selectedCurrency and
 * triggers a full reporting-style re-render of every currency-formatted surface:
 * dashboard totals (Total_Balance / Total_Income / Total_Expense), the
 * Monthly_Summary, the category charts, and the Transaction_List. NO stored
 * transaction amounts are modified — this is presentation only (Req 9.3, 18.7).
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
 * Default categories are shown with a "(default)" badge and no delete button —
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
 * Wire the category management form: submit → onAddCategory, and delegated
 * click on the category list → onDeleteCategory (Req 8.5, 8.6, 8.7, 15.2).
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

/**
 * Bootstrap the app on load. Initializes storage, then wires the UI event
 * handlers implemented so far (task 3.3 wires the add-transaction form). Render
 * orchestration for dashboard/reports/charts is added in later phases.
 * @returns {void}
 */
function bootstrap() {
  // Ensure a valid persisted schema exists before any read/write (Req 10.4).
  storage.initializeData();

  // Seed the active currency from the persisted setting (Req 18.5). Must happen
  // before renderAll so the first paint already shows the correct currency symbol.
  state.selectedCurrency = storage.getCurrency();

  wireTransactionForm();

  // Delegated delete handling for the Transaction_List (task 3.5, Req 3.3).
  wireTransactionListDeletion();

  // Month selector: default to the current month and re-render reports/charts
  // on change — reporting scope only, never the list (task 5.2, Req 5.1/5.9).
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
  // happens via renderCategoryList() inside wireCategoryForm setup — called
  // explicitly here so the panel is populated on first paint.
  wireCategoryForm();
  renderCategoryList();

  // Settings: currency selector (task 14.3, Req 18.1, 18.5, 18.6). Populates
  // the <select> from SUPPORTED_CURRENCIES and wires the change event. Must be
  // called after state.selectedCurrency is seeded so the selector reflects the
  // persisted currency on first paint (Req 18.5).
  wireCurrencySelector();

  // Initial paint of every current view for the persisted state: the Dashboard
  // (totals, count, Selected_Month, recent transactions — task 4.1,
  // Req 1.1/1.2/1.4/1.5/1.8) and the Transaction_List (Req 3.1). renderAll is
  // also the single re-render path used on add/delete (task 4.2).
  renderAll();

  console.info(
    "Personal Finance Tracker: module graph loaded, app ready.",
    { selectedMonth: state.selectedMonth }
  );
}

// Run bootstrap once the DOM is ready. The module script is deferred, so the
// DOM may already be parsed by the time this executes.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
