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
 */
const state = {
  selectedMonth: currentMonthKey(),
  filterCriteria: { searchTerm: "", type: "all", category: "", month: "" },
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

  dashboard.renderTransactionListRows(filtered, emptyMessage);
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
 * accessible text descriptions show properly formatted amounts (Req 9).
 * @param {number} amount
 * @returns {string}
 */
function formatMoney(amount) {
  return utils.formatCurrency(amount);
}

/**
 * Re-render the month-scoped reporting views for the current Selected_Month
 * (reporting scope): the Monthly_Summary and the category charts. This is the
 * single place the reporting scope (`state.selectedMonth`) is pushed into the
 * report/chart renderers, so both the reporting-affecting actions (add/delete
 * via renderAll) and a month change (onSelectedMonthChange) share one path.
 *
 * It deliberately does NOT touch the Transaction_List — that belongs to the
 * independent filter scope (Req 4.12 / 5.9).
 * @returns {void}
 */
function renderReports() {
  // Monthly_Summary for the Selected_Month (Req 5.3–5.8). reports takes the
  // "YYYY-MM" month key.
  reports.renderMonthlySummary(state.selectedMonth);

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

/**
 * Bootstrap the app on load. Initializes storage, then wires the UI event
 * handlers implemented so far (task 3.3 wires the add-transaction form). Render
 * orchestration for dashboard/reports/charts is added in later phases.
 * @returns {void}
 */
function bootstrap() {
  // Ensure a valid persisted schema exists before any read/write (Req 10.4).
  storage.initializeData();

  // Referencing the not-yet-wired namespaces keeps the module graph live and
  // verifies layering until their phases land.
  void categories;

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
