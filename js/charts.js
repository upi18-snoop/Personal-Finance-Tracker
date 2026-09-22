/*
 * charts.js — UI / render layer (Chart.js).
 *
 * Single responsibility: own all Chart.js instances (expense-by-category and
 * income-by-category). Exposes init/update/destroy so charts update without
 * duplicates or leaks (Req 16.2). No other module manipulates chart objects.
 *
 * Layer: UI / render. Uses Chart.js (loaded from CDN in index.html as
 * window.Chart) and utils.js. MUST NOT import storage.js — UI never touches
 * localStorage directly (Req 10.2, 13.5).
 *
 * Chart.js is a global (window.Chart) loaded via a <script> tag in index.html;
 * it is NOT imported as an ES module.
 */

import { safeText } from "./utils.js";

/* --------------------------------------------------------------------------
 * Color palette — cycles when there are more categories than colors.
 * 10 distinct, accessible colors suitable for doughnut segments.
 * -------------------------------------------------------------------------- */
const CHART_COLORS = [
  "#1c6b4c", // brand green
  "#2196f3", // blue
  "#ff9800", // amber
  "#e91e63", // pink
  "#9c27b0", // purple
  "#00bcd4", // cyan
  "#ff5722", // deep-orange
  "#607d8b", // blue-grey
  "#8bc34a", // light-green
  "#ffc107", // yellow
];

/**
 * Assign background colors cycling through the palette.
 * @param {number} count
 * @returns {string[]}
 */
function buildColors(count) {
  return Array.from({ length: count }, (_, i) => CHART_COLORS[i % CHART_COLORS.length]);
}

/* --------------------------------------------------------------------------
 * Module-level Chart instances and canvas contexts.
 * Only this module reads or writes these references (Req 16.2).
 * -------------------------------------------------------------------------- */

/** @type {import("chart.js").Chart | null} */
let expenseChart = null;

/** @type {import("chart.js").Chart | null} */
let incomeChart = null;

/* --------------------------------------------------------------------------
 * initCharts() — Req 6.1, 15.6
 * -------------------------------------------------------------------------- */

/**
 * Acquire chart canvas contexts once and create the initial Chart instances
 * (Req 6.1, 15.6). Idempotent: destroys any existing instances before
 * reinitialising so calling initCharts() more than once is safe.
 *
 * Guards:
 *  - If Chart.js (window.Chart) is not available yet, logs a warning and
 *    returns early. App.js calls initCharts() after the DOM is ready; the CDN
 *    script is deferred so Chart should be available by then.
 *  - If either canvas element is absent from the DOM, logs a warning and
 *    returns early.
 *
 * Sets accessible text descriptions on the description paragraphs using
 * textContent, never innerHTML (Req 15.6 / security).
 *
 * @returns {void}
 */
export function initCharts() {
  // Destroy any existing instances first (idempotency).
  destroyCharts();

  // Guard: Chart.js must be available as a global.
  if (typeof window === "undefined" || typeof window.Chart === "undefined") {
    console.warn("charts.js: Chart.js is not available — charts will not render.");
    return;
  }

  const expenseCanvas = document.getElementById("expense-chart");
  const incomeCanvas = document.getElementById("income-chart");

  // Guard: both canvases must be present in the DOM.
  if (!expenseCanvas || !incomeCanvas) {
    console.warn("charts.js: chart canvas elements not found in DOM.");
    return;
  }

  const ChartCtor = window.Chart;

  /** Shared default options for both doughnut charts. */
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" },
      tooltip: { enabled: true },
    },
  };

  expenseChart = new ChartCtor(expenseCanvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{ data: [], backgroundColor: [] }],
    },
    options: commonOptions,
  });

  incomeChart = new ChartCtor(incomeCanvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{ data: [], backgroundColor: [] }],
    },
    options: commonOptions,
  });

  // Accessible text descriptions for screen readers (Req 15.6).
  const expenseDesc = document.getElementById("expense-chart-description");
  const incomeDesc = document.getElementById("income-chart-description");
  safeText(expenseDesc, "Expense distribution by category");
  safeText(incomeDesc, "Income distribution by category");
}

/* --------------------------------------------------------------------------
 * destroyCharts()
 * -------------------------------------------------------------------------- */

/**
 * Destroy existing chart instances to prevent duplicates/leaks (Req 16.2).
 * Sets module-level variables back to null after destruction.
 * @returns {void}
 */
export function destroyCharts() {
  if (expenseChart !== null) {
    expenseChart.destroy();
    expenseChart = null;
  }
  if (incomeChart !== null) {
    incomeChart.destroy();
    incomeChart = null;
  }
}

/* --------------------------------------------------------------------------
 * _applyChartData() — shared update path
 * -------------------------------------------------------------------------- */

/**
 * Apply category totals to a Chart instance, toggling the canvas / empty-state
 * visibility accordingly.
 *
 * @param {Chart} chart           The Chart.js instance to update.
 * @param {Map<string, number>}  categoryTotals Map of category → total amount.
 * @param {HTMLElement|null}     canvasEl       The <canvas> element.
 * @param {HTMLElement|null}     emptyEl        The empty-state <p> element.
 * @param {HTMLElement|null}     descEl         The accessible description <p>.
 * @param {string}               emptyMessage   Message when there is no data.
 * @param {string}               descPrefix     Prefix for the accessible summary.
 * @param {Function|null}        formatMoney    Optional callback (amount) → string.
 * @returns {void}
 */
function _applyChartData(
  chart,
  categoryTotals,
  canvasEl,
  emptyEl,
  descEl,
  emptyMessage,
  descPrefix,
  formatMoney
) {
  // Filter out zero-total entries (Req 6.2 / 7.3 — callers should also filter,
  // but we guard here for safety).
  const entries = [...categoryTotals.entries()].filter(([, v]) => v > 0);

  if (entries.length === 0) {
    // Empty state: hide the canvas, show the empty-state message.
    if (canvasEl) canvasEl.hidden = true;
    if (emptyEl) {
      safeText(emptyEl, emptyMessage);
      emptyEl.hidden = false;
    }
    safeText(descEl, descPrefix);
    return;
  }

  // Data present: hide empty state, show canvas.
  if (canvasEl) canvasEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;

  const labels = entries.map(([label]) => label);
  const data = entries.map(([, value]) => value);
  const backgroundColor = buildColors(entries.length);

  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.data.datasets[0].backgroundColor = backgroundColor;
  chart.update();

  // Build an accessible text summary for screen readers (Req 15.6).
  const formatter = typeof formatMoney === "function" ? formatMoney : String;
  const summary = entries.map(([label, value]) => `${label}: ${formatter(value)}`).join(", ");
  safeText(descEl, `${descPrefix} — ${summary}`);
}

/* --------------------------------------------------------------------------
 * updateExpenseChart() — Req 6.2
 * -------------------------------------------------------------------------- */

/**
 * Update the expense-by-category chart from a category-total Map (Req 6.2).
 * If the chart has not been initialised yet, calls initCharts() first.
 * Zero-total categories are excluded from the rendered chart.
 * Shows the empty state when there is no data for the period.
 *
 * @param {Map<string, number>} categoryTotals
 * @param {Function} [formatMoney] Optional formatter (amount) → string.
 * @returns {void}
 */
export function updateExpenseChart(categoryTotals, formatMoney) {
  if (expenseChart === null) initCharts();
  if (expenseChart === null) return; // initCharts failed (Chart.js unavailable)

  _applyChartData(
    expenseChart,
    categoryTotals instanceof Map ? categoryTotals : new Map(),
    document.getElementById("expense-chart"),
    document.getElementById("expense-chart-empty"),
    document.getElementById("expense-chart-description"),
    "No expense data for this period.",
    "Expense distribution by category",
    formatMoney
  );
}

/* --------------------------------------------------------------------------
 * updateIncomeChart() — Req 7.3
 * -------------------------------------------------------------------------- */

/**
 * Update the income-by-category chart from a category-total Map (Req 7.3).
 * If the chart has not been initialised yet, calls initCharts() first.
 * Zero-total categories are excluded from the rendered chart.
 * Shows the empty state when there is no data for the period.
 *
 * @param {Map<string, number>} categoryTotals
 * @param {Function} [formatMoney] Optional formatter (amount) → string.
 * @returns {void}
 */
export function updateIncomeChart(categoryTotals, formatMoney) {
  if (incomeChart === null) initCharts();
  if (incomeChart === null) return; // initCharts failed (Chart.js unavailable)

  _applyChartData(
    incomeChart,
    categoryTotals instanceof Map ? categoryTotals : new Map(),
    document.getElementById("income-chart"),
    document.getElementById("income-chart-empty"),
    document.getElementById("income-chart-description"),
    "No income data for this period.",
    "Income distribution by category",
    formatMoney
  );
}
