/*
 * app.js - UI glue / entry point (ES module).
 *
 * Single responsibility: bootstrap the app, hold the lightweight shared app
 * state (selectedMonth reporting scope + filterCriteria list scope), wire DOM
 * events, and orchestrate re-renders. The ONLY module that knows about all UI
 * modules; it also drives business logic and storage init.
 *
 * Layer: UI glue / entry point. May import everything - the storage layer, the
 * business logic layer, the UI render layer, and utils.
 *
 * Task 16.7: All render/action functions are now async and properly await the
 * async business logic layer (transactions.js, categories.js, storage.js).
 * Loading states and network-error handling added.
 */

import * as storage from "./storage.js";
import * as transactions from "./transactions.js";
import * as categories from "./categories.js";
import * as dashboard from "./dashboard.js";
import * as reports from "./reports.js";
import * as charts from "./charts.js";
import * as utils from "./utils.js";
import * as auth from "./auth.js";
import * as migration from "./migration.js";
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
 * Lightweight app state - the only mutable shared state.
 *  - selectedMonth: reporting scope (Dashboard month, Monthly_Summary, charts)
 *  - filterCriteria: list scope (drives only the Transaction_List)
 *  - selectedCurrency: active ISO 4217 currency code for all formatted money
 *    values; seeded from storage.getCurrency() at bootstrap (Req 18.5).
 */
/**
 * True when this page load was triggered by a Supabase password-recovery
 * redirect (#access_token=...&type=recovery in the URL hash). Read once,
 * synchronously, at module evaluation time — before any Supabase client is
 * created — so the hash cannot be consumed by the SDK before we inspect it.
 * Used by bootstrap() and the onAuthStateChange callback to suppress normal
 * dashboard initialisation during a recovery session.
 * @type {boolean}
 */
const isRecoveryRedirect = (
  typeof window !== 'undefined' &&
  window.location.hash.includes('type=recovery')
);

const state = {
  selectedMonth: currentMonthKey(),
  filterCriteria: { searchTerm: "", type: "all", category: "", month: "" },
  selectedCurrency: "IDR", // overwritten in initializeFinanceApplication() from storage.getCurrency()
  currentUser: null,
};

/* --------------------------------------------------------------------------
 * Loading state & error display helpers (task 16.7)
 * -------------------------------------------------------------------------- */

/**
 * Show a loading indicator inside the transaction list container.
 * Disables the transaction form's submit button to prevent concurrent submits.
 * @returns {void}
 */
function showListLoading() {
  const submitBtn = document.getElementById("transaction-submit-button");
  if (submitBtn) submitBtn.disabled = true;

  let indicator = document.getElementById("list-loading-indicator");
  if (!indicator) {
    const listEl = document.getElementById("transaction-list");
    if (listEl) {
      indicator = document.createElement("li");
      indicator.id = "list-loading-indicator";
      indicator.className = "list-loading";
      utils.safeText(indicator, "Loading\u2026");
      listEl.appendChild(indicator);
    }
  } else {
    indicator.hidden = false;
  }
}

/**
 * Hide the loading indicator and re-enable the submit button.
 * @returns {void}
 */
function hideListLoading() {
  const submitBtn = document.getElementById("transaction-submit-button");
  if (submitBtn) submitBtn.disabled = false;

  const indicator = document.getElementById("list-loading-indicator");
  if (indicator) indicator.hidden = true;
}

/**
 * Show a data-load error message near the transaction list.
 * Finds or creates a #data-load-error element.
 * @param {string} message
 * @returns {void}
 */
function showDataError(message) {
  let errorEl = document.getElementById("data-load-error");
  if (!errorEl) {
    const listSection = document.getElementById("transaction-list-section");
    if (listSection) {
      errorEl = document.createElement("p");
      errorEl.id = "data-load-error";
      errorEl.className = "data-load-error";
      errorEl.setAttribute("role", "alert");
      listSection.insertAdjacentElement("afterbegin", errorEl);
    }
  }
  if (errorEl) {
    utils.safeText(errorEl, message);
    errorEl.hidden = false;
  }
}

/**
 * Clear any displayed data-load error message.
 * @returns {void}
 */
function clearDataError() {
  const errorEl = document.getElementById("data-load-error");
  if (errorEl) {
    utils.safeText(errorEl, "");
    errorEl.hidden = true;
  }
}

/* --------------------------------------------------------------------------
 * Add-transaction form (task 3.3)
 *
 * Wires the transaction form to business logic: gathers field values, calls
 * transactions.addTransaction, renders inline per-field validation on failure,
 * and resets the form to its empty default state on success (Req 2.1, 2.13).
 * The Category options track the selected Transaction_Type (Req 2.3). Every
 * control has an associated <label> in index.html (Req 15.2).
 * -------------------------------------------------------------------------- */

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
 * (Req 2.4-2.8, 15.2). Falls back to the form-level message for any error whose
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
 * @returns {Promise<void>}
 */
async function resetTransactionForm(form) {
  form.reset();
  const typeEl = form.querySelector("#transaction-type");
  const categoryEl = form.querySelector("#transaction-category");
  const dateEl = form.querySelector("#transaction-date");

  if (dateEl) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }
  if (categoryEl) {
    await dashboard.renderCategoryOptions(
      categoryEl,
      typeEl ? typeEl.value : "expense",
      state.currentUser?.id ?? null
    );
  }
}

/**
 * Handle an add-transaction submission (Req 2.1, 2.13). Delegates all
 * validation and persistence to transactions.addTransaction (business logic);
 * this UI handler only maps the result to inline messages or a form reset.
 *
 * On success, calls renderAll() which triggers the full reporting-scope
 * re-render path: dashboard totals, Monthly_Summary, and both category charts
 * (expense + income) via renderReports() -> charts.updateExpenseChart /
 * updateIncomeChart. Charts update in-place via chart.update() - no
 * destroy/recreate, no duplicate instances (Req 6.3, 16.2).
 * @param {{ type: string, itemName: string, amount: string, category: string, date: string }} formData
 * @param {HTMLFormElement} form
 * @returns {Promise<{ ok: boolean }>}
 */
async function onAddTransaction(formData, form) {
  // A8: disable the submit button immediately to prevent double-submission.
  const submitBtn = document.getElementById("add-transaction-button");
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, "Adding\u2026");
  }

  try {
    const result = await transactions.addTransaction(formData, state.currentUser?.id ?? null);

    if (!result.ok) {
      // Invalid input: show inline messages, create nothing, keep field values.
      showTransactionFormErrors(form, result.errors);
      return { ok: false };
    }

    // A5: show success feedback in the form's status element.
    // Use the existing #transaction-form-error element (role="alert") which is
    // already styled and accessible; we add a success modifier class temporarily.
    const statusEl = document.getElementById("transaction-form-error");
    if (statusEl) {
      statusEl.className = "form-success";
      utils.safeText(statusEl, "Transaction added successfully.");
      // Auto-clear after 3 seconds so it does not become permanent noise.
      setTimeout(() => {
        if (statusEl.className === "form-success") {
          statusEl.className = "form-error";
          utils.safeText(statusEl, "");
        }
      }, 3000);
    }

    // Success: clear any stale validation errors and reset the form.
    clearTransactionFormErrors(form);
    await resetTransactionForm(form);

    // Reflect the new transaction across the reporting views and the list.
    await renderAll();
    return { ok: true };
  } finally {
    // A8: always restore the button regardless of success, error, or exception.
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, "Add transaction");
    }
  }
}

/**
 * Wire the add-transaction form's events: submit -> onAddTransaction, and
 * type change -> refresh the Category options for that type (Req 2.3). Seeds the
 * initial category options and a sensible default date on load.
 * @returns {Promise<void>}
 */
async function wireTransactionForm() {
  const form = document.getElementById("transaction-form");
  if (!form) return;

  // Idempotency guard: addEventListener does not deduplicate anonymous handlers,
  // so a second call to wireTransactionForm() would attach a second submit
  // listener and cause duplicate transactions. Stamp the form on first wire and
  // bail out on any subsequent call. The stamp is removed by clearFinanceUIDOM()
  // if charts.destroyCharts() / full teardown resets the DOM on logout, but the
  // form element itself persists in the DOM across sessions, so this guard is
  // the correct defence-in-depth layer here (Req 2.1 / 16.2).
  if (form.dataset.wired === "true") return;
  form.dataset.wired = "true";

  const typeEl = form.querySelector("#transaction-type");
  const categoryEl = form.querySelector("#transaction-category");
  const dateEl = form.querySelector("#transaction-date");

  // Seed initial category options for the default type and default the date.
  if (categoryEl) {
    await dashboard.renderCategoryOptions(
      categoryEl,
      typeEl ? typeEl.value : "expense",
      state.currentUser?.id ?? null
    );
  }
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }

  // Changing Transaction_Type updates the applicable Category options (Req 2.3).
  if (typeEl && categoryEl) {
    typeEl.addEventListener("change", () => {
      void dashboard.renderCategoryOptions(
        categoryEl,
        typeEl.value,
        state.currentUser?.id ?? null
      );
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
    void onAddTransaction(formData, form);
  });
}

/* --------------------------------------------------------------------------
 * Transaction list (task 3.4)
 *
 * Orchestrates rendering of the Transaction_List. Reads the stored transactions
 * through the business logic layer (never localStorage) and hands them to the
 * render layer. Filter-scope application (filterTransactions over
 * state.filterCriteria) is applied here.
 * -------------------------------------------------------------------------- */

/**
 * Render the Transaction_List for the current state (Req 3.1, 3.2, 4.1-4.13).
 * Applies the active filter scope (state.filterCriteria) via the pure
 * filterTransactions view function - a read-only operation that NEVER mutates
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
 * @returns {Promise<void>}
 */
async function renderTransactionList() {
  showListLoading();
  try {
    clearDataError();
    const all = await transactions.getTransactions(state.currentUser?.id ?? null);

    // Apply the filter scope: pure read-only view, no storage writes (Req 4.14).
    const filtered = transactions.filterTransactions(all, state.filterCriteria);

    // Determine the correct empty-state message (Req 4.13):
    //   - Transactions exist but none match -> Filtered_Empty_State message.
    //   - No transactions at all -> generic no-data message (dashboard.js default).
    const emptyMessage =
      all.length > 0 && filtered.length === 0
        ? "No transactions match your filters."
        : undefined;

    dashboard.renderTransactionListRows(filtered, emptyMessage, state.selectedCurrency);
    addDeleteControls();
  } catch (err) {
    console.error("renderTransactionList: failed to load transactions", err?.name ?? 'unknown');
    showDataError("Could not load data. Please check your connection.");
  } finally {
    hideListLoading();
  }
}

/* --------------------------------------------------------------------------
 * Filter / search controls - list scope (task 6.3)
 *
 * The filter scope is completely independent of the reporting scope. Changing
 * any filter criterion updates ONLY the Transaction_List - it never calls
 * renderDashboard, renderReports, or saveData - so the Dashboard totals and
 * Monthly_Summary are structurally guaranteed to be unaffected (Req 4.12, 4.14).
 *
 * All four controls (search, type, category, month) are wired to the single
 * onFilterChange handler. The category filter <select> is populated with the
 * full merged category list (defaults + custom) so the user can filter by any
 * known category. A blank "All categories" sentinel is prepended so no category
 * filter is active by default.
 * -------------------------------------------------------------------------- */

/**
 * The "all categories" sentinel value used in the category filter <select>.
 * An empty string means "no category filter active" (matches the FilterCriteria
 * contract in filterTransactions where category = "" means inactive, Req 4.6).
 * @type {string}
 */
const ALL_CATEGORIES_VALUE = "";

/**
 * Resolve the merged category list (defaults + custom) for populating the
 * filter category <select>. Reads from dashboard.categoriesForType for each
 * type (which already handles the fallback to defaults while categories.js is
 * still a stub), then deduplicates across types so the combined filter list
 * shows each category name once.
 * @returns {Promise<string[]>}
 */
async function allCategoryOptions() {
  // Gather all categories across both types and deduplicate.
  const userId = state.currentUser?.id ?? null;
  const [incomeCategories, expenseCategories] = await Promise.all([
    dashboard.categoriesForType("income", userId),
    dashboard.categoriesForType("expense", userId),
  ]);
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
 * @returns {Promise<void>}
 */
async function populateCategoryFilter() {
  const selectEl = document.getElementById("filter-category");
  if (!selectEl) return;

  const previous = selectEl.value;
  selectEl.replaceChildren();

  // "All categories" sentinel - means no category filter active.
  const allOpt = document.createElement("option");
  allOpt.value = ALL_CATEGORIES_VALUE;
  allOpt.textContent = "All categories";
  selectEl.appendChild(allOpt);

  for (const name of await allCategoryOptions()) {
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
 * Read the current filter control values and update state.filterCriteria,
 * then call renderTransactionList() ONLY (Req 4.9, 4.12). This is the full
 * extent of what a filter change does - no saveData, no dashboard re-render,
 * no report/chart re-render - so Dashboard totals and Monthly_Summary can
 * never move as a result of filtering (Req 4.12, 4.14).
 * @returns {Promise<void>}
 */
async function onFilterChange() {
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
  await renderTransactionList();
}

/**
 * Reset all filter criteria to their defaults and re-render the Transaction_List
 * showing all stored transactions (Req 4.10, 4.11).
 * @returns {Promise<void>}
 */
async function onClearFilters() {
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
  await renderTransactionList();
}

/**
 * Wire all filter and search controls so any change triggers onFilterChange
 * immediately (Req 4.9). Uses input on the search field for live updates and
 * change on the selects/month picker. Also populates the category filter
 * <select> with the available categories. Wires the Clear Filters button to
 * onClearFilters (Req 4.10, 4.11).
 * @returns {Promise<void>}
 */
async function wireFilterControls() {
  await populateCategoryFilter();

  const searchEl = document.getElementById("filter-search");
  const typeEl = document.getElementById("filter-type");
  const categoryEl = document.getElementById("filter-category");
  const monthEl = document.getElementById("filter-month");

  if (searchEl) {
    // Use "input" so the list updates on every keystroke (live search, Req 4.9).
    searchEl.addEventListener("input", () => void onFilterChange());
  }
  if (typeEl) {
    typeEl.addEventListener("change", () => void onFilterChange());
  }
  if (categoryEl) {
    categoryEl.addEventListener("change", () => void onFilterChange());
  }
  if (monthEl) {
    monthEl.addEventListener("change", () => void onFilterChange());
  }

  // Clear Filters button: reset all criteria and show all transactions (Req 4.10, 4.11).
  const clearBtn = document.getElementById("clear-filters-button");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => void onClearFilters());
  }
}

/* --------------------------------------------------------------------------
 * Reporting re-render orchestration (task 4.2)
 * -------------------------------------------------------------------------- */

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
 * single place the reporting scope (state.selectedMonth) is pushed into the
 * report/chart renderers, so both the reporting-affecting actions (add/delete
 * via renderAll) and a month change (onSelectedMonthChange) share one path.
 *
 * It deliberately does NOT touch the Transaction_List - that belongs to the
 * independent filter scope (Req 4.12 / 5.9).
 * @returns {Promise<void>}
 */
async function renderReports() {
  const userId = state.currentUser?.id ?? null;

  // Monthly_Summary for the Selected_Month (Req 5.3-5.8). Pass the active
  // Selected_Currency so all amounts are formatted consistently (Req 9.6, 18.7).
  await reports.renderMonthlySummary(state.selectedMonth, state.selectedCurrency, userId);

  // Category charts for the same reporting scope (Req 6.x / 7.x).
  const monthlyTransactions = await transactions.getTransactionsByMonth(
    state.selectedMonth,
    userId
  );

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
 * @returns {Promise<void>}
 */
async function renderAll() {
  const userId = state.currentUser?.id ?? null;

  try {
    clearDataError();

    // Reporting scope: dashboard totals recomputed from the single source of
    // truth (transactions.calculateTotals) so a new/removed transaction is
    // reflected immediately (Req 1.6, 1.7).
    await dashboard.renderDashboard(state, userId);

    // Reporting scope: Monthly_Summary + charts for the Selected_Month.
    await renderReports();

    // List scope: keep the Transaction_List in sync with the same change.
    await renderTransactionList();
  } catch (err) {
    console.error("renderAll: failed to render", err?.name ?? 'unknown');
    showDataError("Could not load data. Please check your connection.");
  }
}

/* --------------------------------------------------------------------------
 * Delete transaction (task 3.5)
 * -------------------------------------------------------------------------- */

/**
 * Add a labelled Delete button to any transaction row that does not already
 * have one (Req 3.3, 15.5). The button carries no id itself; the id is read
 * from the row's data-id when the click is handled, so a single delegated
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
 * Handle a request to delete the transaction with the given id (Req 3.3-3.6).
 * Requires a confirmation interaction first: on cancel the transaction is
 * retained unchanged and nothing is persisted (Req 3.4); on confirm the
 * deletion is delegated to the business logic layer (which persists the updated
 * set, Req 3.5/3.6) and the Transaction_List is re-rendered.
 * @param {string} id
 * @returns {Promise<{ ok: boolean }>}
 */
async function onDeleteTransaction(id) {
  if (id == null || id === "") {
    return { ok: false };
  }

  // Confirmation interaction (Req 3.3). Cancel -> retain unchanged (Req 3.4).
  const confirmed = window.confirm(
    "Delete this transaction? This cannot be undone."
  );
  if (!confirmed) {
    return { ok: false };
  }

  // Confirmed -> remove + persist via business logic (Req 3.5, 3.6).
  const result = await transactions.deleteTransaction(id, state.currentUser?.id ?? null);

  // Reflect the removal across the reporting views and the list.
  if (result.ok) {
    await renderAll();
  }
  return result;
}

/**
 * Wire deletion for the whole Transaction_List with a single delegated click
 * listener on the list container (Req 3.3). Clicking a row's Delete button
 * resolves the target transaction id from the enclosing row's data-id and
 * routes to onDeleteTransaction.
 * @returns {void}
 */
function wireTransactionListDeletion() {
  const listEl = document.getElementById("transaction-list");
  if (!listEl) return;

  // Idempotency guard: mirrors the pattern used in wireTransactionForm().
  // If initializeFinanceApplication() runs twice (e.g. SIGNED_OUT then SIGNED_IN
  // during session restoration resets financeAppInitialized), a second call would
  // attach a second delegated click listener and produce two confirmation dialogs
  // per Delete click. Stamping the list element prevents that.
  if (listEl.dataset.wired === "true") return;
  listEl.dataset.wired = "true";

  listEl.addEventListener("click", (event) => {
    const trigger = event.target.closest('[data-action="delete"]');
    if (!trigger || !listEl.contains(trigger)) return;

    const row = trigger.closest(".transaction-row");
    const id = row ? row.dataset.id : undefined;
    if (id == null) return;

    void onDeleteTransaction(id);
  });
}

/* --------------------------------------------------------------------------
 * Month selector - reporting scope (task 5.2)
 * -------------------------------------------------------------------------- */

/**
 * Handle a change to the Selected_Month (Req 5.1, 5.9). Updates the reporting
 * scope in app state and recomputes the month-scoped reporting views -
 * the Monthly_Summary and category charts - for the new month, plus the
 * Dashboard's Selected_Month label. Deliberately leaves the Transaction_List
 * untouched: the list is driven by the separate filter scope, so a reporting-
 * month change never moves it (Req 5.9).
 *
 * A blank month (e.g. the user clears the native picker) falls back to the
 * current month so the reporting scope always has a valid "YYYY-MM" key.
 * @param {string} month "YYYY-MM" month key from the selector.
 * @returns {Promise<void>}
 */
async function onSelectedMonthChange(month) {
  state.selectedMonth = utils.isBlank(month) ? currentMonthKey() : month;

  // Reporting scope only: Monthly_Summary + charts recomputed for the new month.
  await renderReports();

  // Keep the Dashboard's Selected_Month label in sync (Req 1.2). This updates
  // the label/reporting cards without re-rendering the Transaction_List.
  await dashboard.renderDashboard(state, state.currentUser?.id ?? null);
}

/**
 * Wire the month selector: default it to the current month on load (Req 5.1)
 * and route its change events to onSelectedMonthChange (Req 5.9).
 * @returns {void}
 */
function wireMonthSelector() {
  const monthEl = document.getElementById("selected-month");
  if (!monthEl) return;

  // Default the control to the current reporting month (state.selectedMonth was
  // seeded to the current month), so the UI and state agree on load (Req 5.1).
  monthEl.value = state.selectedMonth;

  monthEl.addEventListener("change", () => void onSelectedMonthChange(monthEl.value));
}

/* --------------------------------------------------------------------------
 * Currency selector - Settings section (task 14.3)
 * -------------------------------------------------------------------------- */

/**
 * Populate the currency <select> with one <option> per entry in
 * SUPPORTED_CURRENCIES (Req 18.1). Each option displays the currency code
 * and its human-readable label. The active Selected_Currency is pre-selected.
 * @returns {void}
 */
function populateCurrencySelect() {
  const selectEl = document.getElementById("currency-select");
  if (!selectEl) return;

  selectEl.replaceChildren();

  for (const [code, meta] of Object.entries(utils.SUPPORTED_CURRENCIES)) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} \u2013 ${meta.label}`;
    selectEl.appendChild(opt);
  }

  // Reflect the persisted Selected_Currency in the control (Req 18.5).
  selectEl.value = state.selectedCurrency;
}

/**
 * Handle a currency change from the Settings selector (Req 18.6, 18.7).
 *
 * Persists the choice via storage.setCurrency (which validates the code -
 * unknown codes are rejected silently). Updates state.selectedCurrency and
 * triggers a full reporting-style re-render of every currency-formatted surface.
 * NO stored transaction amounts are modified - this is presentation only
 * (Req 9.3, 18.7).
 *
 * @param {string} code ISO 4217 currency code from SUPPORTED_CURRENCIES.
 * @returns {Promise<void>}
 */
async function onCurrencyChange(code) {
  // Validate + persist. setCurrency rejects unknown codes (returns false); in
  // that case we keep the current state.selectedCurrency unchanged.
  const accepted = await storage.setCurrency(code, state.currentUser?.id ?? null);
  if (!accepted) return;

  state.selectedCurrency = code;

  // Re-render every currency-formatted surface (Req 18.7).
  await renderAll();
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

  selectEl.addEventListener("change", () => void onCurrencyChange(selectEl.value));
}

/* --------------------------------------------------------------------------
 * Category management (task 8.3)
 * -------------------------------------------------------------------------- */

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
 * True if name is one of the built-in default categories for type.
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
 * Build a single category list item <li> for the category management panel
 * (Req 8.5). Default categories get a "(default)" badge and no delete button;
 * custom categories get a labelled Delete button (Req 15.5).
 *
 * All user-provided text is written via safeText (never innerHTML).
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
 * each group (matching the storage order returned by categories.getCategories).
 *
 * The list element is #category-list in index.html. If it is absent this
 * is a no-op so the rest of the app is unaffected.
 * @returns {Promise<void>}
 */
async function renderCategoryList() {
  const listEl = document.getElementById("category-list");
  if (!listEl) return;

  listEl.replaceChildren();

  const userId = state.currentUser?.id ?? null;

  for (const type of ["expense", "income"]) {
    const heading = document.createElement("li");
    heading.className = "category-list__group-heading";
    utils.safeText(heading, type === "expense" ? "Expense categories" : "Income categories");
    listEl.appendChild(heading);

    const catNames = await categories.getCategories(type, userId);
    for (const name of catNames) {
      listEl.appendChild(buildCategoryItem(name, type));
    }
  }
}

/**
 * Refresh every UI surface that depends on the category set after an add or
 * delete: the category list panel, the transaction form's category dropdown
 * (for the currently-selected type), and the filter category dropdown.
 * @returns {Promise<void>}
 */
async function refreshCategoryUI() {
  await renderCategoryList();

  // Refresh the transaction form's category options for the current type so
  // a newly-added custom category is immediately available (Req 8.4).
  const typeEl = document.getElementById("transaction-type");
  const categoryEl = document.getElementById("transaction-category");
  if (typeEl && categoryEl) {
    await dashboard.renderCategoryOptions(
      categoryEl,
      typeEl.value,
      state.currentUser?.id ?? null
    );
  }

  // Repopulate the filter category <select> so the new/removed category is
  // reflected in the filter panel too.
  await populateCategoryFilter();
}

/**
 * Handle adding a custom category (Req 8.2, 8.3). Delegates validation and
 * persistence to categories.addCategory; maps the result to an inline message
 * or resets the form on success.
 *
 * Error messages (Req 8.2):
 *   - duplicate: "A category with that name already exists"
 *   - invalid (blank): "Category name is required"
 * @param {{ name: string, type: string }} formData
 * @param {HTMLFormElement} form
 * @returns {Promise<{ ok: boolean }>}
 */
async function onAddCategory(formData, form) {
  const errorEl = document.getElementById("category-form-error");
  utils.safeText(errorEl, "");

  const type = formData.type === "income" ? "income" : "expense";
  const result = await categories.addCategory(
    formData.name,
    type,
    state.currentUser?.id ?? null
  );

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
  await refreshCategoryUI();
  return { ok: true };
}

/**
 * Handle deleting a custom category (Req 8.6, 8.7). Delegates to
 * categories.deleteCategory; refuses with an inline message when the
 * category is in use (Req 8.7). Transactions are NEVER deleted (Req 8.8 is
 * enforced in the business logic layer; this UI layer simply shows the reason).
 * @param {string} name
 * @param {"income"|"expense"} type
 * @returns {Promise<{ ok: boolean }>}
 */
async function onDeleteCategory(name, type) {
  const errorEl = document.getElementById("category-form-error");
  utils.safeText(errorEl, "");

  const result = await categories.deleteCategory(
    name,
    type,
    state.currentUser?.id ?? null
  );

  if (!result.ok) {
    const message =
      result.error === "in-use"
        ? "Category is in use by existing transactions and cannot be deleted"
        : "Default categories cannot be deleted";
    utils.safeText(errorEl, message);
    return { ok: false };
  }

  // Success: refresh all category-dependent UI surfaces.
  await refreshCategoryUI();
  return { ok: true };
}

/**
 * Wire the category management form: submit -> onAddCategory, and delegated
 * click on the category list -> onDeleteCategory (Req 8.5, 8.6, 8.7, 15.2).
 * Uses event delegation on #category-list so dynamically-added rows are
 * covered without re-wiring.
 * @returns {void}
 */
function wireCategoryForm() {
  const form = document.getElementById("category-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nameEl = form.querySelector("#category-name");
    const typeEl = form.querySelector("#category-type");
    void onAddCategory(
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

    void onDeleteCategory(name, type);
  });
}

/* --------------------------------------------------------------------------
 * Registration (task 15.3)
 * -------------------------------------------------------------------------- */

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
  if (state.currentUser) {
    showProtectedApp();
  }
}

/**
 * Reset the registration form to its empty default state.
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
 * @param {{ email: string, password: string, confirmPassword: string }} values
 * @returns {{ field: string, message: string }[]}
 */
function validateRegisterForm(values) {
  const errors = [];

  if (!values.email || values.email.trim() === "") {
    errors.push({ field: "email", message: "Email address is required." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.push({ field: "email", message: "Please enter a valid email address." });
  }

  if (!values.password || values.password.length === 0) {
    errors.push({ field: "password", message: "Password is required." });
  } else if (values.password.length < 8) {
    // Phase 18.2 (Req 25.11): raised from 6 to 8 to match auth.js signUp pre-validation.
    errors.push({ field: "password", message: "Password must be at least 8 characters." });
  }

  if (!values.confirmPassword || values.confirmPassword.length === 0) {
    errors.push({ field: "confirmPassword", message: "Please confirm your password." });
  } else if (values.password !== values.confirmPassword) {
    errors.push({ field: "confirmPassword", message: "Passwords do not match." });
  }

  return errors;
}

/**
 * Display inline validation errors on the registration form.
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

  const validationErrors = validateRegisterForm(values);
  if (validationErrors.length > 0) {
    showRegisterErrors(validationErrors);
    return;
  }

  clearRegisterErrors();
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, "Creating account\u2026");
  }

  (async () => {
    const result = await auth.signUp(values.email, values.password);

    if (result.ok) {
      showRegisterSuccess("Account created successfully! You can now sign in.");
      return;
    }

    if (result.error && result.error.code === "email-not-confirmed") {
      showRegisterSuccess(
        "Almost there! We\u2019ve sent a confirmation email to " +
        values.email.trim() +
        ". Please check your inbox and click the link to activate your account, then come back to sign in."
      );
      return;
    }

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
      return "Password must be at least 8 characters.";
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
 * -------------------------------------------------------------------------- */

/**
 * Show the login section and hide the finance dashboard.
 * @returns {void}
 */
function showLoginView() {
  const loginSection = document.getElementById("login-section");
  const appMain = document.getElementById("app-main");
  const registerSection = document.getElementById("register-section");
  const newPasswordSection = document.getElementById("new-password-section");
  if (loginSection) loginSection.hidden = false;
  if (appMain) appMain.hidden = true;
  if (registerSection) registerSection.hidden = true;
  if (newPasswordSection) newPasswordSection.hidden = true;
  resetLoginForm();
}

/**
 * Hide the login section and restore the finance dashboard.
 * @returns {void}
 */
function hideLoginView() {
  const loginSection = document.getElementById("login-section");
  if (loginSection) loginSection.hidden = true;
  resetLoginForm();
  if (state.currentUser) {
    showProtectedApp();
  }
}

/**
 * Reset the login form to its empty default state.
 * @returns {void}
 */
function resetLoginForm() {
  const form = document.getElementById("login-form");
  if (form) form.reset();
  clearLoginErrors();
  const successEl = document.getElementById("login-success");
  if (successEl) successEl.hidden = true;
  const submitBtn = document.getElementById("login-submit-button");
  if (submitBtn) {
    submitBtn.disabled = false;
    utils.safeText(submitBtn, "Sign in");
  }
}

/**
 * Clear all inline validation messages on the login form.
 * @returns {void}
 */
function clearLoginErrors() {
  const form = document.getElementById("login-form");
  if (!form) return;
  for (const el of form.querySelectorAll("[data-field-error]")) {
    utils.safeText(el, "");
  }
  utils.safeText(document.getElementById("login-form-error"), "");
}

/**
 * Validate login form input before calling auth.signIn().
 * @param {{ email: string, password: string }} values
 * @returns {{ field: string, message: string }[]}
 */
function validateLoginForm(values) {
  const errors = [];

  if (!values.email || values.email.trim() === "") {
    errors.push({ field: "email", message: "Email address is required." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.push({ field: "email", message: "Please enter a valid email address." });
  }

  if (!values.password || values.password.length === 0) {
    errors.push({ field: "password", message: "Password is required." });
  }

  return errors;
}

/**
 * Display inline validation errors on the login form.
 * @param {{ field: string, message: string }[]} errors
 * @returns {void}
 */
function showLoginErrors(errors) {
  clearLoginErrors();
  const form = document.getElementById("login-form");
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
      document.getElementById("login-form-error"),
      unassigned.join(" ")
    );
  }
}

/**
 * Map a normalized auth error to a user-friendly login message.
 * @param {{ code: string, message: string } | undefined} error
 * @returns {string}
 */
function getLoginErrorMessage(error) {
  if (!error) return "Sign-in failed. Please try again.";
  switch (error.code) {
    case "invalid-credentials":
      return "Incorrect email or password. Please try again.";
    case "invalid-email":
      return "Please enter a valid email address.";
    case "email-not-confirmed":
      return "Please confirm your email address before signing in. Check your inbox for the confirmation link.";
    case "user-not-found":
      return "No account found with this email address.";
    case "rate-limited":
      return "Too many attempts. Please wait a moment and try again.";
    case "network-error":
      return "Network error. Please check your connection and try again.";
    case "not-configured":
      return "Authentication is not configured yet. Please add your Supabase credentials to js/config.js.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

/**
 * Update the header UI to reflect a signed-in state (UI-only).
 * @param {string} email The authenticated user's email address.
 * @returns {void}
 */
function showSignedInState(email) {
  const signedInBadge = document.getElementById("auth-signed-in");
  const signedInEmail = document.getElementById("auth-signed-in-email");
  const showLoginBtn = document.getElementById("show-login-button");
  const showRegisterBtn = document.getElementById("show-register-button");

  if (signedInEmail) utils.safeText(signedInEmail, email);
  if (signedInBadge) signedInBadge.hidden = false;
  if (showLoginBtn) showLoginBtn.hidden = true;
  if (showRegisterBtn) showRegisterBtn.hidden = true;
}

/**
 * Update the header to reflect a signed-out state.
 * @returns {void}
 */
function showSignedOutState() {
  state.currentUser = null;

  const signedInBadge = document.getElementById("auth-signed-in");
  const signedInEmail = document.getElementById("auth-signed-in-email");
  const showLoginBtn = document.getElementById("show-login-button");
  const showRegisterBtn = document.getElementById("show-register-button");

  if (signedInBadge) signedInBadge.hidden = true;
  if (signedInEmail) utils.safeText(signedInEmail, "");
  if (showLoginBtn) showLoginBtn.hidden = false;
  if (showRegisterBtn) showRegisterBtn.hidden = false;
}

/**
 * Handle a logout request (task 15.5, Req 19.3; hardened task 18.9, Req 32.1–32.6).
 *
 * Teardown sequence:
 *   1. auth.signOut()  — attempt session end; errors are swallowed so teardown always
 *                        completes regardless of network failures (Req 32.5).
 *   2. clearAuthenticatedSessionState() — single shared teardown helper: sets
 *                        state.currentUser = null first, hides #app-main, resets
 *                        financeAppInitialized, closes migration modal, clears DOM
 *                        (Req 32.1, 32.2, 32.3, 32.4, 32.6).
 *   3. showSignedOutState() — updates header to signed-out appearance.
 *                        NOTE: also sets state.currentUser = null internally —
 *                        intentional belt-and-suspenders redundancy with step 2.
 *   4. showLoginView()  — reveal the login form.
 *
 * @returns {void}
 */
function onLogout() {
  (async () => {
    // Attempt session end; proceed with teardown regardless of result (Req 32.5).
    await auth.signOut().catch(() => {});
    clearAuthenticatedSessionState();   // single shared teardown helper
    // showSignedOutState() also sets state.currentUser = null — intentional
    // belt-and-suspenders redundancy with clearAuthenticatedSessionState() above.
    showSignedOutState();               // update header
    showLoginView();                    // show login form
  })();
}

/**
 * Wire the logout button to onLogout (task 15.5, Req 19.3).
 * @returns {void}
 */
function wireLogoutButton() {
  const logoutBtn = document.getElementById("logout-button");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", onLogout);
  }
}

/**
 * Handle login form submission (task 15.4).
 * @param {Event} event
 * @returns {void}
 */
function onLoginSubmit(event) {
  event.preventDefault();

  const form = document.getElementById("login-form");
  if (!form) return;

  const emailEl = document.getElementById("login-email");
  const passwordEl = document.getElementById("login-password");
  const submitBtn = document.getElementById("login-submit-button");

  const values = {
    email: emailEl ? emailEl.value : "",
    password: passwordEl ? passwordEl.value : "",
  };

  const validationErrors = validateLoginForm(values);
  if (validationErrors.length > 0) {
    showLoginErrors(validationErrors);
    return;
  }

  clearLoginErrors();
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, "Signing in\u2026");
  }

  (async () => {
    const result = await auth.signIn(values.email, values.password);

    if (result.ok) {
      // Login succeeded — onAuthStateChange handles showing the dashboard.
      // Reset the button now so it is never left in loading state if the login
      // section becomes visible again (e.g. after subsequent logout).
      if (submitBtn) {
        submitBtn.disabled = false;
        utils.safeText(submitBtn, "Sign in");
      }
      return;
    }

    const errorMessage = getLoginErrorMessage(result.error);
    utils.safeText(document.getElementById("login-form-error"), errorMessage);
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, "Sign in");
    }
  })();
}

/**
 * Wire the login form and navigation buttons (task 15.4).
 * @returns {void}
 */
function wireLoginForm() {
  const form = document.getElementById("login-form");
  if (form) {
    form.addEventListener("submit", onLoginSubmit);
  }

  const showLoginBtn = document.getElementById("show-login-button");
  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", showLoginView);
  }

  const backBtn = document.getElementById("login-back-button");
  if (backBtn) {
    backBtn.addEventListener("click", hideLoginView);
  }

  const toRegisterBtn = document.getElementById("login-to-register-button");
  if (toRegisterBtn) {
    toRegisterBtn.addEventListener("click", () => {
      hideLoginView();
      showRegisterView();
    });
  }

  const forgotBtn = document.getElementById("login-forgot-password-button");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", showResetPasswordView);
  }
}

/* --------------------------------------------------------------------------
 * Password Reset (task 15.6)
 * -------------------------------------------------------------------------- */

/**
 * Show the password-reset section and hide the finance dashboard and login.
 * @returns {void}
 */
function showResetPasswordView() {
  const resetSection = document.getElementById("reset-password-section");
  const appMain = document.getElementById("app-main");
  const loginSection = document.getElementById("login-section");
  if (resetSection) resetSection.hidden = false;
  if (appMain) appMain.hidden = true;
  if (loginSection) loginSection.hidden = true;
  resetResetPasswordForm();
}

/**
 * Hide the password-reset section and show the login view.
 * @returns {void}
 */
function hideResetPasswordView() {
  const resetSection = document.getElementById("reset-password-section");
  if (resetSection) resetSection.hidden = true;
  resetResetPasswordForm();
  showLoginView();
}

/**
 * Reset the password-reset form to its empty default state.
 * @returns {void}
 */
function resetResetPasswordForm() {
  const form = document.getElementById("reset-password-form");
  if (form) form.reset();
  clearResetPasswordErrors();
  const successEl = document.getElementById("reset-password-success");
  if (successEl) successEl.hidden = true;
  const submitBtn = document.getElementById("reset-password-submit-button");
  if (submitBtn) {
    submitBtn.disabled = false;
    utils.safeText(submitBtn, "Send reset email");
  }
}

/**
 * Clear all inline validation and error messages on the password-reset form.
 * @returns {void}
 */
function clearResetPasswordErrors() {
  const form = document.getElementById("reset-password-form");
  if (!form) return;
  for (const el of form.querySelectorAll("[data-field-error]")) {
    utils.safeText(el, "");
  }
  utils.safeText(document.getElementById("reset-password-form-error"), "");
}

/**
 * Validate the password-reset form input.
 * @param {{ email: string }} values
 * @returns {{ field: string, message: string }[]}
 */
function validateResetPasswordForm(values) {
  const errors = [];

  if (!values.email || values.email.trim() === "") {
    errors.push({ field: "email", message: "Email address is required." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.push({ field: "email", message: "Please enter a valid email address." });
  }

  return errors;
}

/**
 * Display inline validation errors on the password-reset form.
 * @param {{ field: string, message: string }[]} errors
 * @returns {void}
 */
function showResetPasswordErrors(errors) {
  clearResetPasswordErrors();
  const form = document.getElementById("reset-password-form");
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
      document.getElementById("reset-password-form-error"),
      unassigned.join(" ")
    );
  }
}

/**
 * Map a normalized auth error to a user-friendly password-reset message.
 * @param {{ code: string, message: string } | undefined} error
 * @returns {string}
 */
function getResetPasswordErrorMessage(error) {
  if (!error) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "invalid-email":
      return "Please enter a valid email address.";
    case "rate-limited":
      return "Too many attempts. Please wait a moment and try again.";
    case "network-error":
      return "Network error. Please check your connection and try again.";
    case "not-configured":
      return "Authentication is not configured yet. Please add your Supabase credentials to js/config.js.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Handle password-reset form submission (task 15.6, Req 19.4).
 * @param {Event} event
 * @returns {void}
 */
function onResetPasswordSubmit(event) {
  event.preventDefault();

  const form = document.getElementById("reset-password-form");
  if (!form) return;

  const emailEl = document.getElementById("reset-email");
  const submitBtn = document.getElementById("reset-password-submit-button");

  const values = {
    email: emailEl ? emailEl.value : "",
  };

  const validationErrors = validateResetPasswordForm(values);
  if (validationErrors.length > 0) {
    showResetPasswordErrors(validationErrors);
    return;
  }

  clearResetPasswordErrors();
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, "Sending\u2026");
  }

  (async () => {
    const result = await auth.resetPassword(values.email);

    if (result.ok) {
      const successEl = document.getElementById("reset-password-success");
      const successMsg = document.getElementById("reset-password-success-message");
      if (successMsg) {
        utils.safeText(
          successMsg,
          "If an account exists for this email, a password reset link has been sent. Please check your inbox (and spam folder)."
        );
      }
      if (successEl) successEl.hidden = false;
      return;
    }

    const errorMessage = getResetPasswordErrorMessage(result.error);
    utils.safeText(document.getElementById("reset-password-form-error"), errorMessage);
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, "Send reset email");
    }
  })();
}

/**
 * Wire the password-reset form and navigation buttons (task 15.6).
 * @returns {void}
 */
function wireResetPasswordForm() {
  const form = document.getElementById("reset-password-form");
  if (form) {
    form.addEventListener("submit", onResetPasswordSubmit);
  }

  const backBtn = document.getElementById("reset-password-back-button");
  if (backBtn) {
    backBtn.addEventListener("click", hideResetPasswordView);
  }
}

/* --------------------------------------------------------------------------
 * New-password (PASSWORD_RECOVERY) flow
 *
 * Shown exclusively when Supabase fires the PASSWORD_RECOVERY auth event,
 * which occurs after the user clicks a password-reset link. The dashboard
 * and finance application are never initialised during this flow.
 * -------------------------------------------------------------------------- */

/**
 * Show the new-password section; hide all other auth sections and app-main.
 * @returns {void}
 */
function showNewPasswordView() {
  const section = document.getElementById("new-password-section");
  const appMain = document.getElementById("app-main");
  const loginSection = document.getElementById("login-section");
  const registerSection = document.getElementById("register-section");
  const resetSection = document.getElementById("reset-password-section");
  if (section) section.hidden = false;
  if (appMain) appMain.hidden = true;
  if (loginSection) loginSection.hidden = true;
  if (registerSection) registerSection.hidden = true;
  if (resetSection) resetSection.hidden = true;
}

/**
 * Hide the new-password section and clear its form state.
 * @returns {void}
 */
function hideNewPasswordView() {
  const section = document.getElementById("new-password-section");
  if (section) section.hidden = true;
  resetNewPasswordForm();
}

/**
 * Clear all fields, errors, and the success state on the new-password form.
 * @returns {void}
 */
function resetNewPasswordForm() {
  const form = document.getElementById("new-password-form");
  if (form) form.reset();
  utils.safeText(document.getElementById("new-password-field-error"), "");
  utils.safeText(document.getElementById("confirm-new-password-error"), "");
  utils.safeText(document.getElementById("new-password-error"), "");
  const successEl = document.getElementById("new-password-success");
  if (successEl) successEl.hidden = true;
  const submitBtn = document.getElementById("new-password-submit");
  if (submitBtn) {
    submitBtn.disabled = false;
    utils.safeText(submitBtn, "Set new password");
  }
}

/**
 * Handle new-password form submission during a PASSWORD_RECOVERY session.
 * Validates inputs, calls auth.updatePassword(), shows success or errors,
 * then signs the user out and returns them to the login view.
 * @param {Event} event
 * @returns {void}
 */
function onNewPasswordSubmit(event) {
  event.preventDefault();

  const newPasswordEl = document.getElementById("new-password");
  const confirmEl = document.getElementById("confirm-new-password");
  const submitBtn = document.getElementById("new-password-submit");
  const fieldErrorEl = document.getElementById("new-password-field-error");
  const confirmErrorEl = document.getElementById("confirm-new-password-error");
  const formErrorEl = document.getElementById("new-password-error");

  // Clear previous messages.
  utils.safeText(fieldErrorEl, "");
  utils.safeText(confirmErrorEl, "");
  utils.safeText(formErrorEl, "");

  const newPassword = newPasswordEl ? newPasswordEl.value : "";
  const confirmPassword = confirmEl ? confirmEl.value : "";

  // Validate new password.
  if (!newPassword || newPassword.length === 0) {
    utils.safeText(fieldErrorEl, "Please enter a new password.");
    if (newPasswordEl) newPasswordEl.focus();
    return;
  }
  if (newPassword.length < 8) {
    utils.safeText(fieldErrorEl, "Password must be at least 8 characters.");
    if (newPasswordEl) newPasswordEl.focus();
    return;
  }

  // Validate confirmation.
  if (!confirmPassword || confirmPassword.length === 0) {
    utils.safeText(confirmErrorEl, "Please confirm your new password.");
    if (confirmEl) confirmEl.focus();
    return;
  }
  if (newPassword !== confirmPassword) {
    utils.safeText(confirmErrorEl, "Passwords do not match.");
    if (confirmEl) confirmEl.focus();
    return;
  }

  // Disable submit while request is in flight.
  if (submitBtn) {
    submitBtn.disabled = true;
    utils.safeText(submitBtn, "Saving\u2026");
  }

  (async () => {
    const result = await auth.updatePassword(newPassword);

    if (result.ok) {
      // Show success message.
      const successEl = document.getElementById("new-password-success");
      const successMsg = document.getElementById("new-password-success-message");
      if (successMsg) {
        utils.safeText(successMsg, "Password updated successfully! Signing you out\u2026");
      }
      if (successEl) successEl.hidden = false;

      // Sign out the recovery session so the user must sign in with the new
      // password, preventing accidental session re-use.
      await auth.signOut().catch(() => {});

      // Brief pause so the success message is visible before navigating away.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      hideNewPasswordView();
      showSignedOutState();
      showLoginView();
      return;
    }

    // Error path.
    const message = result.error?.message || "Could not update password. Please try again.";
    utils.safeText(formErrorEl, message);
    if (submitBtn) {
      submitBtn.disabled = false;
      utils.safeText(submitBtn, "Set new password");
    }
  })();
}

/**
 * Wire the new-password form submit listener exactly once.
 * Uses the same dataset.wired idempotency guard pattern as wireTransactionForm()
 * and wireTransactionListDeletion() (Req 2.1 / 16.2).
 * @returns {void}
 */
function wireNewPasswordForm() {
  const form = document.getElementById("new-password-form");
  if (!form) return;

  if (form.dataset.wired === "true") return;
  form.dataset.wired = "true";

  form.addEventListener("submit", onNewPasswordSubmit);
}

/* --------------------------------------------------------------------------
 * Session persistence & auth state (task 15.7)
 * -------------------------------------------------------------------------- */

/**
 * Initialise authentication session detection and state synchronization
 * (task 15.7, Req 19.5, 19.6).
 * @returns {Promise<void>}
 */
async function initAuthSession() {
  // Register the auth-state listener first so we never miss a state change.
  auth.onAuthStateChange((event, user) => {
    // PASSWORD_RECOVERY must be intercepted before the generic signed-in branch
    // so the recovery session never triggers dashboard initialisation (Req 26.x).
    if (event === 'PASSWORD_RECOVERY') {
      showNewPasswordView();
      return;
    }

    if (user && !isRecoveryRedirect) {
      state.currentUser = user;
      showSignedInState(user.email);
      showProtectedApp();
      void initializeFinanceApplication(); // no-op if already initialized
      // Close any open auth sections so the finance app is immediately visible.
      const loginSection = document.getElementById("login-section");
      const registerSection = document.getElementById("register-section");
      const resetSection = document.getElementById("reset-password-section");
      if (loginSection) loginSection.hidden = true;
      if (registerSection) registerSection.hidden = true;
      if (resetSection) resetSection.hidden = true;
    } else {
      // Handles SIGNED_OUT, SESSION_EXPIRED, and TOKEN_REFRESHED→null uniformly
      // through the single shared teardown helper (Req 26.1–26.4, 32.1–32.6).
      clearAuthenticatedSessionState();
      // showSignedOutState() also sets state.currentUser = null — intentional
      // belt-and-suspenders redundancy with clearAuthenticatedSessionState().
      showSignedOutState();
      showLoginView();
    }
  });

  try {
    const user = await auth.getCurrentUser();
    if (user) {
      state.currentUser = user;
      showSignedInState(user.email);
    }
    return state.currentUser;
  } catch (err) {
    console.warn("auth: session detection failed - continuing signed out.", err?.name ?? 'unknown');
    state.currentUser = null;
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Session teardown helpers (task 18.3)
 *
 * clearFinanceUIDOM() and clearAuthenticatedSessionState() are the single
 * teardown path shared by explicit logout (onLogout) and every signed-out
 * auth event (SIGNED_OUT, SESSION_EXPIRED, TOKEN_REFRESHED→null).
 * -------------------------------------------------------------------------- */

/**
 * Wipe all Finance_UI DOM content so no previous user's data remains visible
 * after sign-out or session expiry (Req 32.3, 32.6).
 *
 * Called exclusively from clearAuthenticatedSessionState(). Each DOM operation
 * is guarded by a null check so missing elements are silently skipped.
 * @returns {void}
 */
function clearFinanceUIDOM() {
  // Transaction list rows.
  const txList = document.getElementById("transaction-list");
  if (txList) txList.replaceChildren();

  // Dashboard balance / summary numbers.
  const totalBalance = document.getElementById("total-balance-value");
  const totalIncome = document.getElementById("total-income-value");
  const totalExpense = document.getElementById("total-expense-value");
  const txCount = document.getElementById("transaction-count-value");
  if (totalBalance) utils.safeText(totalBalance, "");
  if (totalIncome)  utils.safeText(totalIncome, "");
  if (totalExpense) utils.safeText(totalExpense, "");
  if (txCount)      utils.safeText(txCount, "");

  // Category management list.
  const catList = document.getElementById("category-list");
  if (catList) catList.replaceChildren();

  // Monthly summary section.
  const monthlySummary = document.getElementById("monthly-summary");
  if (monthlySummary) monthlySummary.replaceChildren();

  // Destroy Chart.js instances so they can be cleanly recreated on next login.
  charts.destroyCharts();

  // Clear any data-load error banner.
  clearDataError();
}

/**
 * Single teardown helper used by both explicit logout and every signed-out auth
 * event (SIGNED_OUT, SESSION_EXPIRED, TOKEN_REFRESHED→null). Centralises the
 * teardown sequence so there is only one implementation (Req 26.1–26.4, 32.1–32.6).
 *
 * Order is intentional:
 *   1. Clear identity first — all subsequent operations see null user (Req 26.1).
 *   2. Hide Finance_UI — no authenticated content visible (Req 26.2, 32.2).
 *   3. Reset init guard — next login triggers full re-initialization (Req 26.3).
 *   4. Close migration modal — no orphaned overlay after logout (Req 32.2).
 *   5. Wipe Finance_UI DOM — no prior user's data in any panel (Req 32.6).
 *
 * The caller is responsible for step 6: show login/signed-out UI.
 * @returns {void}
 */
function clearAuthenticatedSessionState() {
  state.currentUser = null;    // 1. clear identity first
  hideProtectedApp();          // 2. hide #app-main
  financeAppInitialized = false; // 3. reset init guard
  hideMigrationModal();        // 4. close migration modal if open
  clearFinanceUIDOM();         // 5. wipe Finance_UI DOM content
  // Caller handles step 6: show login / signed-out UI.
}

/* --------------------------------------------------------------------------
 * Finance application initialization guard (task 15.8)
 * -------------------------------------------------------------------------- */

/**
 * True once initializeFinanceApplication() has run successfully.
 * @type {boolean}
 */
let financeAppInitialized = false;

/**
 * Show the protected finance app (app-main).
 * @returns {void}
 */
function showProtectedApp() {
  const appMain = document.getElementById("app-main");
  if (appMain) appMain.hidden = false;
}

/**
 * Hide the protected finance app (app-main).
 * @returns {void}
 */
function hideProtectedApp() {
  const appMain = document.getElementById("app-main");
  if (appMain) appMain.hidden = true;
}

/**
 * Initialize all finance-specific application state: storage, event wiring,
 * category list, currency selector, and initial render.
 *
 * Guarded by financeAppInitialized so it is safe to call multiple times -
 * only the first call does real work (Req 10.4, 18.5).
 * @returns {Promise<void>}
 */
async function initializeFinanceApplication() {
  if (financeAppInitialized) return;
  financeAppInitialized = true;

  const userId = state.currentUser?.id ?? null;

  // Ensure a valid persisted schema exists before any read/write (Req 10.4).
  await storage.initializeData(userId);

  // Seed the active currency from the persisted setting (Req 18.5). Must happen
  // before renderAll so the first paint already shows the correct currency symbol.
  state.selectedCurrency = await storage.getCurrency(userId);

  await wireTransactionForm();

  // Delegated delete handling for the Transaction_List (task 3.5, Req 3.3).
  wireTransactionListDeletion();

  // A4: wire the View all transactions button in the Recent Transactions section.
  const viewAllBtn = document.getElementById("view-all-transactions-button");
  if (viewAllBtn) {
    viewAllBtn.addEventListener("click", () => {
      const listSection = document.getElementById("transaction-list-section");
      if (listSection) listSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Month selector: default to the current month and re-render reports/charts
  // on change - reporting scope only, never the list (task 5.2, Req 5.1/5.9).
  wireMonthSelector();

  // Filter/search controls for the Transaction_List (task 6.3, Req 4.1, 4.9).
  // Wired before renderAll so the category filter is populated on first paint.
  await wireFilterControls();

  // Initialise the Chart.js canvases once (task 7.1, Req 6.1, 15.6).
  charts.initCharts();

  // Category management UI (task 8.3, Req 8.5).
  wireCategoryForm();
  await renderCategoryList();

  // Settings: currency selector (task 14.3, Req 18.1, 18.5, 18.6).
  wireCurrencySelector();

  // Initial paint of every current view for the persisted state.
  await renderAll();

  // Wire migration UI buttons once (task 17.10).
  wireMigrationUI();

  // Check for migration opportunity and show modal if needed (task 17.10, Req 23.2).
  if (state.currentUser?.id) {
    await checkAndShowMigrationUI(state.currentUser.id);
  }

  console.info(
    "Personal Finance Tracker: finance application initialized.",
    { selectedMonth: state.selectedMonth }
  );
}

/* --------------------------------------------------------------------------
 * Migration UI (task 17.10)
 *
 * Orchestrates the migration modal: detects opportunity after login, presents
 * the available/partial state, walks the user through validation → confirmation
 * → upload → verification, and handles currency conflicts. All migration logic
 * is delegated to migration.js exports — this section only handles UI state
 * transitions and user interaction (Req 23.2–23.9).
 * -------------------------------------------------------------------------- */

/**
 * Show the migration modal overlay and move focus inside it.
 * @returns {void}
 */
function showMigrationModal() {
  const overlay = document.getElementById("migration-modal-overlay");
  if (!overlay) return;
  overlay.hidden = false;
  // Move focus to the modal heading for keyboard/AT users.
  const heading = document.getElementById("migration-modal-heading");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }
}

/**
 * Hide the migration modal overlay.
 * @returns {void}
 */
function hideMigrationModal() {
  const overlay = document.getElementById("migration-modal-overlay");
  if (overlay) overlay.hidden = true;
}

/**
 * Hide all migration state containers, then show the one matching `stateName`.
 * Valid state names: available | validating | ready | conflict | in-progress |
 * partial | completed | failed
 * @param {string} stateName
 * @returns {void}
 */
function showMigrationState(stateName) {
  const modal = document.querySelector(".migration-modal");
  if (!modal) return;
  for (const el of modal.querySelectorAll(".migration-state")) {
    el.hidden = true;
  }
  const target = document.getElementById(`migration-state-${stateName}`);
  if (target) target.hidden = false;
}

/**
 * Update the counts in the available state.
 * @param {number} localCount
 * @param {number} cloudCount
 * @returns {void}
 */
function populateMigrationAvailableState(localCount, cloudCount) {
  const localEl = document.getElementById("migration-local-count");
  const cloudEl = document.getElementById("migration-cloud-count");
  utils.safeText(localEl, String(localCount >= 0 ? localCount : "—"));
  utils.safeText(cloudEl, String(cloudCount >= 0 ? cloudCount : "—"));
}

/**
 * Populate the ready state with validation results.
 * Shows valid/invalid counts and an expandable list of invalid record details.
 * All text is written via safeText — never innerHTML (Req security).
 * @param {{
 *   validTransactions: object[],
 *   invalidTransactions: { record: object, issues: object[], index: number }[],
 *   summary: { transactionCount: number, invalidTransactionCount: number },
 * }} validationResult
 * @returns {void}
 */
function populateMigrationReadyState(validationResult) {
  const { validTransactions, invalidTransactions, summary } = validationResult;
  const validCount   = validTransactions.length;
  const invalidCount = summary ? summary.invalidTransactionCount : (invalidTransactions ? invalidTransactions.length : 0);

  // Update the ready-state description.
  const descEl = document.getElementById("migration-ready-description");
  if (descEl) {
    let msg = `${validCount} transaction${validCount !== 1 ? "s" : ""} ready to import.`;
    if (invalidCount > 0) {
      msg += ` ${invalidCount} invalid record${invalidCount !== 1 ? "s" : ""} will be skipped.`;
    }
    utils.safeText(descEl, msg);
  }

  // Update the confirm button label to show the count.
  const confirmBtn = document.getElementById("migration-confirm-button");
  if (confirmBtn) {
    utils.safeText(confirmBtn, `Confirm import (${validCount})`);
  }

  // Populate and show the invalid details if any exist.
  const detailsEl = document.getElementById("migration-invalid-details");
  const listEl    = document.getElementById("migration-invalid-list");

  if (detailsEl && listEl) {
    if (invalidCount > 0 && invalidTransactions && invalidTransactions.length > 0) {
      listEl.replaceChildren();
      for (const { record, issues, index } of invalidTransactions) {
        const li = document.createElement("li");

        // First line: record index + id snippet.
        const idSnippet = (record && record.id)
          ? String(record.id).slice(0, 16)
          : "unknown";
        const header = document.createElement("strong");
        utils.safeText(header, `Record #${index + 1} (id: ${idSnippet}…)`);
        li.appendChild(header);

        // Issue lines.
        if (Array.isArray(issues)) {
          for (const issue of issues) {
            const p = document.createElement("p");
            p.style.cssText = "margin:2px 0 0 8px;font-size:0.8125rem;color:var(--color-error)";
            utils.safeText(p, `${issue.path ?? ""}: ${issue.message ?? ""}`);
            li.appendChild(p);
          }
        }
        listEl.appendChild(li);
      }
      detailsEl.hidden = false;
    } else {
      detailsEl.hidden = true;
    }
  }
}

/**
 * Populate the conflict state's currency <select> with the two options.
 * @param {string} localCurrency  ISO 4217 code from local data.
 * @param {string} cloudCurrency  ISO 4217 code from cloud data.
 * @returns {void}
 */
function populateMigrationConflictState(localCurrency, cloudCurrency) {
  const select = document.getElementById("migration-currency-select");
  if (!select) return;

  select.replaceChildren();

  const localMeta = utils.SUPPORTED_CURRENCIES[localCurrency];
  const cloudMeta = utils.SUPPORTED_CURRENCIES[cloudCurrency];

  const localOpt = document.createElement("option");
  localOpt.value = localCurrency;
  const localLabel = localMeta ? `${localCurrency} – ${localMeta.label} (local)` : `${localCurrency} (local)`;
  utils.safeText(localOpt, localLabel);

  const cloudOpt = document.createElement("option");
  cloudOpt.value = cloudCurrency;
  const cloudLabel = cloudMeta ? `${cloudCurrency} – ${cloudMeta.label} (cloud)` : `${cloudCurrency} (cloud)`;
  utils.safeText(cloudOpt, cloudLabel);

  select.appendChild(localOpt);
  select.appendChild(cloudOpt);

  // Update the description message.
  const descEl = document.getElementById("migration-conflict-description");
  if (descEl) {
    utils.safeText(
      descEl,
      `Your local currency (${localCurrency}) differs from your cloud currency (${cloudCurrency}). Choose which one to keep:`
    );
  }
}

/**
 * Populate the completed state with the migration result.
 * Only shows the "Clear local data" button when `verified === true`.
 * @param {number} migratedCount
 * @param {boolean} verified
 * @returns {void}
 */
function populateMigrationCompletedState(migratedCount, verified) {
  const msgEl = document.getElementById("migration-completed-message");
  if (msgEl) {
    utils.safeText(
      msgEl,
      `✓ Import complete! ${migratedCount} transaction${migratedCount !== 1 ? "s" : ""} migrated.`
    );
  }

  const clearBtn = document.getElementById("migration-clear-local-button");
  if (clearBtn) {
    clearBtn.hidden = !verified;
  }

  // Reset the "cleared" message if the completed state is shown again.
  const clearedMsg = document.getElementById("migration-local-cleared-message");
  if (clearedMsg) clearedMsg.hidden = true;
}

/**
 * Populate the failed state with a human-readable error message.
 * @param {string} errorMessage
 * @returns {void}
 */
function populateMigrationFailedState(errorMessage) {
  const msgEl = document.getElementById("migration-failed-message");
  if (msgEl) {
    utils.safeText(msgEl, errorMessage || "Migration failed. Please try again.");
  }
}

/**
 * Run the upload flow after the user confirms (or resumes/retries).
 * Handles the in-progress → conflict/partial/completed/failed state transitions.
 * @param {"start"|"retry"} mode  "start" for first run, "retry" for resume/retry.
 * @param {string} userId  Authenticated Supabase user UUID.
 * @returns {Promise<void>}
 */
async function runMigrationUpload(mode, userId) {
  showMigrationState("in-progress");

  let result;
  try {
    result = mode === "retry"
      ? await migration.retryMigration(userId)
      : await migration.startMigration(userId);
  } catch (err) {
    console.error("migration: upload failed unexpectedly", err?.name ?? 'unknown');
    populateMigrationFailedState("An unexpected error occurred during import. Please try again.");
    showMigrationState("failed");
    return;
  }

  if (!result.ok) {
    const errMsg = (result.errors && result.errors.length > 0)
      ? result.errors.map((e) => e.message).join(" ")
      : "Import failed. Please try again.";
    populateMigrationFailedState(errMsg);
    showMigrationState("failed");
    return;
  }

  // Check for currency conflicts in the result.
  if (Array.isArray(result.conflicts)) {
    const currencyConflict = result.conflicts.find((c) => c.type === "currency-conflict");
    if (currencyConflict) {
      // Store migration counts on the DOM for the apply button to retrieve.
      const overlay = document.getElementById("migration-modal-overlay");
      if (overlay) {
        overlay.dataset.pendingMigratedCount = String(result.migratedCount);
      }
      populateMigrationConflictState(currencyConflict.localValue, currencyConflict.cloudValue);
      showMigrationState("conflict");
      return;
    }
  }

  // Partial result — some records failed.
  if (
    result.status === migration.MIGRATION_STATUS.PARTIAL ||
    result.failedCount > 0
  ) {
    showMigrationState("partial");
    return;
  }

  // All good — run verification.
  await finishMigrationWithVerification(userId, result.migratedCount);
}

/**
 * Run verifyMigration and transition to the completed or failed state.
 * @param {string} userId
 * @param {number} migratedCount  Count to display in the completed message.
 * @returns {Promise<void>}
 */
async function finishMigrationWithVerification(userId, migratedCount) {
  let verification;
  try {
    verification = await migration.verifyMigration(userId);
  } catch (err) {
    console.error("migration: verification failed", err?.name ?? 'unknown');
    verification = { verified: false };
  }

  populateMigrationCompletedState(migratedCount, verification.verified === true);
  showMigrationState("completed");
}

/**
 * Detect a migration opportunity and show the modal if needed.
 * Called after initializeFinanceApplication() completes.
 * No migration starts without explicit user action (Req 23.2).
 * @param {string} userId  Authenticated Supabase user UUID.
 * @returns {Promise<void>}
 */
async function checkAndShowMigrationUI(userId) {
  if (!userId) return;

  let opportunity;
  try {
    opportunity = await migration.detectMigrationOpportunity(userId);
  } catch (err) {
    console.warn("migration: detectMigrationOpportunity failed", err?.name ?? 'unknown');
    return;
  }

  if (!opportunity.needed) return;
  if (opportunity.currentStatus === migration.MIGRATION_STATUS.COMPLETED) return;

  showMigrationModal();

  if (opportunity.currentStatus === migration.MIGRATION_STATUS.PARTIAL) {
    showMigrationState("partial");
  } else {
    populateMigrationAvailableState(opportunity.localCount, opportunity.cloudCount);
    showMigrationState("available");
  }
}

/**
 * Wire all migration modal button event handlers once.
 * Called from initializeFinanceApplication().
 * @returns {void}
 */
function wireMigrationUI() {
  // ---- ESC key to dismiss (accessibility) ----
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const overlay = document.getElementById("migration-modal-overlay");
      if (overlay && !overlay.hidden) {
        hideMigrationModal();
      }
    }
  });

  // ---- Import button (available state) ----
  const importBtn = document.getElementById("migration-import-button");
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      showMigrationState("validating");
      // Validate on next tick so the spinner renders first.
      setTimeout(() => {
        let validationResult;
        try {
          validationResult = migration.validateLocalData();
        } catch (err) {
          console.error("migration: validateLocalData failed", err?.name ?? 'unknown');
          populateMigrationFailedState("Could not validate local data. Please try again.");
          showMigrationState("failed");
          return;
        }
        populateMigrationReadyState(validationResult);
        showMigrationState("ready");
      }, 0);
    });
  }

  // ---- Skip button (available state) ----
  const skipBtn = document.getElementById("migration-skip-button");
  if (skipBtn) {
    skipBtn.addEventListener("click", hideMigrationModal);
  }

  // ---- Confirm button (ready state) ----
  const confirmBtn = document.getElementById("migration-confirm-button");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      const userId = state.currentUser?.id ?? null;
      if (!userId) { hideMigrationModal(); return; }
      void runMigrationUpload("start", userId);
    });
  }

  // ---- Cancel button (ready state) ----
  const cancelBtn = document.getElementById("migration-cancel-button");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", hideMigrationModal);
  }

  // ---- Conflict Apply button ----
  const conflictApplyBtn = document.getElementById("migration-conflict-apply-button");
  if (conflictApplyBtn) {
    conflictApplyBtn.addEventListener("click", () => {
      const userId = state.currentUser?.id ?? null;
      if (!userId) { hideMigrationModal(); return; }

      const select = document.getElementById("migration-currency-select");
      const chosenCurrency = select ? select.value : null;
      if (!chosenCurrency) { hideMigrationModal(); return; }

      showMigrationState("in-progress");

      (async () => {
        const resolveResult = await migration.resolveCurrencyConflict(userId, chosenCurrency);
        if (!resolveResult.ok) {
          const errMsg = resolveResult.error ? resolveResult.error.message : "Could not apply currency. Please try again.";
          populateMigrationFailedState(errMsg);
          showMigrationState("failed");
          return;
        }

        // Update the app's active currency if the user chose a different one.
        if (utils.SUPPORTED_CURRENCIES[chosenCurrency]) {
          state.selectedCurrency = chosenCurrency;
          await renderAll();
        }

        // Retrieve the migrated count stored before the conflict was detected.
        const overlay = document.getElementById("migration-modal-overlay");
        const pendingCount = overlay
          ? parseInt(overlay.dataset.pendingMigratedCount ?? "0", 10)
          : 0;

        await finishMigrationWithVerification(userId, pendingCount);
      })();
    });
  }

  // ---- Conflict Cancel button ----
  const conflictCancelBtn = document.getElementById("migration-conflict-cancel-button");
  if (conflictCancelBtn) {
    conflictCancelBtn.addEventListener("click", hideMigrationModal);
  }

  // ---- Resume button (partial state) ----
  const resumeBtn = document.getElementById("migration-resume-button");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      const userId = state.currentUser?.id ?? null;
      if (!userId) { hideMigrationModal(); return; }
      void runMigrationUpload("retry", userId);
    });
  }

  // ---- Partial skip button ----
  const partialSkipBtn = document.getElementById("migration-partial-skip-button");
  if (partialSkipBtn) {
    partialSkipBtn.addEventListener("click", hideMigrationModal);
  }

  // ---- Done button (completed state) ----
  const doneBtn = document.getElementById("migration-done-button");
  if (doneBtn) {
    doneBtn.addEventListener("click", hideMigrationModal);
  }

  // ---- Clear local data button (completed state, verified only) ----
  const clearLocalBtn = document.getElementById("migration-clear-local-button");
  if (clearLocalBtn) {
    clearLocalBtn.addEventListener("click", () => {
      const confirmed = window.confirm(
        "This will permanently delete your local finance data from this browser. " +
        "Your data is safely stored in the cloud. Continue?"
      );
      if (!confirmed) return;

      // Delegate to migration.clearLocalFinanceData so that:
      //   1. Only STORAGE_KEY is removed — never the migration marker.
      //   2. The marker (status: 'completed') survives and prevents the
      //      migration modal from appearing on the next login.
      const userId = state.currentUser?.id ?? null;
      if (!userId) return;
      migration.clearLocalFinanceData(userId);

      clearLocalBtn.hidden = true;

      const clearedMsg = document.getElementById("migration-local-cleared-message");
      if (clearedMsg) clearedMsg.hidden = false;
    });
  }

  // ---- Retry button (failed state) ----
  const retryBtn = document.getElementById("migration-retry-button");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      const userId = state.currentUser?.id ?? null;
      if (!userId) { hideMigrationModal(); return; }
      void runMigrationUpload("retry", userId);
    });
  }

  // ---- Failed skip button ----
  const failedSkipBtn = document.getElementById("migration-failed-skip-button");
  if (failedSkipBtn) {
    failedSkipBtn.addEventListener("click", hideMigrationModal);
  }
}

/* --------------------------------------------------------------------------
 * Bootstrap
 * -------------------------------------------------------------------------- */

/**
 * Bootstrap the app on load (task 15.8 - protected bootstrap / auth guard).
 *
 * Flow:
 *   1. Wire auth forms (always available regardless of auth state).
 *   2. Hide app-main to prevent flash of unauthenticated finance content.
 *   3. Await initAuthSession() - registers the auth-state listener AND
 *      returns the current user (or null).
 *   4. If user: show protected app and initialize finance application.
 *   5. If no user: keep app-main hidden; auth UI remains accessible.
 *
 * @returns {Promise<void>}
 */
async function bootstrap() {
  // Wire all auth UI first - these work regardless of auth state.
  wireRegisterForm();
  wireLoginForm();
  wireLogoutButton();
  wireResetPasswordForm();
  wireNewPasswordForm();

  // Show loading state while auth resolves.
  const authLoadingEl = document.getElementById("auth-loading");
  if (authLoadingEl) authLoadingEl.hidden = false;

  // Hide the protected app during auth resolution to prevent flash of finance data.
  hideProtectedApp();


  // isRecoveryRedirect is a module-level constant (see top of state section).
  // Resolve authentication state.

  const user = await initAuthSession();

  // Auth resolved - hide loading state.
  if (authLoadingEl) authLoadingEl.hidden = true;

  if (user && !isRecoveryRedirect) {
    showSignedInState(user.email);
    showProtectedApp();
    await initializeFinanceApplication();
  } else {
    showSignedOutState();
    showLoginView();
    // hideProtectedApp() already called above; auth UI is already available.
  }

  console.info(
    "Personal Finance Tracker: module graph loaded, app ready.",
    { authenticated: !!user }
  );
}

// Run bootstrap once the DOM is ready. The module script is deferred, so the
// DOM may already be parsed by the time this executes.

// ---------------------------------------------------------------------------
// Global error suppression handlers (Task 18.8 — Req 31.8)
// Installed before bootstrap() runs so no unhandled rejection or uncaught
// error can escape with raw details during or after initialization.
// Both handlers log a static message to preserve DevTools debugging
// capability without leaking stack traces, error messages, or SDK internals.
// ---------------------------------------------------------------------------

window.addEventListener('unhandledrejection', (event) => {
  // (a) Prevent default browser error reporting which may expose raw details.
  event.preventDefault();
  // (b) Log a static message only — never event.reason or any derived value.
  console.warn('app: unhandled promise rejection (suppressed for security)');
  // (c) Never write event.reason to any DOM element, never call alert().
});

window.onerror = function () {
  // (a) Log only a static message — never the raw error arguments.
  console.warn('app: uncaught error (suppressed for security)');
  // (b) Return true to suppress the default browser error dialog.
  return true;
  // (c) Never write raw error details to DOM or call alert().
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void bootstrap());
} else {
  void bootstrap();
}
