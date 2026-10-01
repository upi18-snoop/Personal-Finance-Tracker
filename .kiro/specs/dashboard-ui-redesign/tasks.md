# Implementation Plan: Dashboard UI Redesign

## Overview

Presentational redesign of the Personal Finance Tracker. All business logic, storage, authentication, and JavaScript modules remain untouched. Only four files change: `index.html`, `css/styles.css`, `js/dashboard.js`, and `js/app.js`. The work is strictly additive: sections are reordered, a new Daily Summary section is inserted, a scroll wrapper is added around the transaction list, CSS tokens and component styles are extended, and a single new synchronous render function (`renderDailySummary`) is added to `dashboard.js` and wired into `renderAll()` in `app.js`.

---

## Tasks

### Phase 1: HTML Structure — Reorganization

- [x] 1. Reorder existing `<section>` elements inside `<main id="app-main">` to match the required order
  - [x] 1.1 Move `#charts-section` from position 7 to position 3 (after `#balance-section`)
    - **Objective**: Physically relocate the `<section class="section charts-section" id="charts-section">` block in `index.html` so it appears immediately after `#balance-section` and before `#add-transaction-section`.
    - **File**: `index.html`
    - **Steps**:
      1. Locate the `<section ... id="charts-section">` block (currently between `#monthly-summary-section` and `#transaction-list-section`).
      2. Cut the entire block (opening `<section>` through its closing `</section>`).
      3. Paste it immediately after the closing `</section>` of `#balance-section` and before the opening `<section>` of `#add-transaction-section`.
    - **Must preserve**: `id="charts-section"`, `class="section charts-section"`, `aria-labelledby="charts-heading"`, `hidden` attribute, all inner content including `id="expense-chart-container"`, `id="income-chart-container"`, `id="expense-chart"`, `id="income-chart"`, `id="expense-chart-description"`, `id="income-chart-description"`, `id="expense-chart-empty"`, `id="income-chart-empty"`, `class="chart-row"`, heading text, `canvas` elements with their `role` and `aria-*` attributes.
    - **Validation**: Confirm the DOM order inside `<main>` is now: `#global-empty-state` → `#balance-section` → `#charts-section` → `#add-transaction-section`.
    - **Dependencies**: None.
    - _Requirements: 14.1, 5.1_

  - [x] 1.2 Move `#recent-transactions-section` from position 3 to position 5 (after `#add-transaction-section`)
    - **Objective**: Relocate `#recent-transactions-section` so it follows `#add-transaction-section`.
    - **File**: `index.html`
    - **Steps**:
      1. Locate `<section ... id="recent-transactions-section">` (currently at position 3, before `#add-transaction-section`).
      2. Cut the entire block.
      3. Paste it immediately after the closing `</section>` of `#add-transaction-section`.
    - **Must preserve**: `id="recent-transactions-section"`, `class="section recent-transactions-section"`, `aria-labelledby="recent-transactions-heading"`, `hidden` attribute, `id="recent-transactions-list"`, `id="recent-transactions-empty"`, `id="view-all-transactions-button"`, `class="recent-transactions__footer"`, `class="btn-link"` on the view-all button.
    - **Validation**: Confirm the order is now: `#balance-section` → `#charts-section` → `#add-transaction-section` → `#recent-transactions-section`.
    - **Dependencies**: 1.1.
    - _Requirements: 14.1, 7.1_

  - [x] 1.3 Move `#month-selector-section` from position 5 to position 7 (after the new `#daily-summary-section` placeholder position)
    - **Objective**: Relocate `#month-selector-section` so it comes after where `#daily-summary-section` will be inserted (task 2.1) and before `#monthly-summary-section`.
    - **File**: `index.html`
    - **Steps**:
      1. Locate `<section ... id="month-selector-section">` (currently at position 5).
      2. Cut the entire block.
      3. Paste it after the closing `</section>` of `#recent-transactions-section` (the Daily Summary section does not exist yet; it is inserted in task 2.1 at the correct position between the two).
      - **Note**: After task 2.1, `#daily-summary-section` will be inserted between `#recent-transactions-section` and `#month-selector-section`. Complete tasks in order: 1.1 → 1.2 → 1.3 → 1.4, then task 2.1 inserts at the correct gap.
    - **Must preserve**: `id="month-selector-section"`, `id="selected-month"`, `id="selected-month-label"`, `class="section month-selector-section"`, `aria-labelledby="month-selector-heading"`, all inner label/input structure, `type="month"` on the input, `data-role="selected-month"`.
    - **Validation**: Confirm order is: `#recent-transactions-section` → `#month-selector-section` → `#monthly-summary-section`.
    - **Dependencies**: 1.2.
    - _Requirements: 14.1, 9.1_

  - [x] 1.4 Move `#monthly-summary-section` from position 6 to position 8 (after `#month-selector-section`)
    - **Objective**: Relocate `#monthly-summary-section` to follow `#month-selector-section`.
    - **File**: `index.html`
    - **Steps**:
      1. Confirm `#monthly-summary-section` is now immediately after `#month-selector-section` (it should already be, since the other sections were cut away above it). If not, cut and paste after `#month-selector-section`.
    - **Must preserve**: `id="monthly-summary-section"`, `id="monthly-summary"`, `id="monthly-income-value"`, `id="monthly-expense-value"`, `id="monthly-net-value"`, `id="monthly-count-value"`, `id="expense-category-breakdown"`, `id="income-category-breakdown"`, `id="expense-category-list"`, `id="income-category-list"`, `hidden` attribute, all inner `data-role` attributes, all `aria-label` attributes on the breakdown divs.
    - **Validation**: Confirm order is: `#month-selector-section` → `#monthly-summary-section` → `#transaction-list-section`.
    - **Dependencies**: 1.3.
    - _Requirements: 14.1, 10.1_

---

### Phase 2: HTML Structure — Daily Summary Section

- [x] 2. Insert the new Daily Summary section into `index.html`
  - [x] 2.1 Insert `#daily-summary-section` at position 6 (between `#recent-transactions-section` and `#month-selector-section`)
    - **Objective**: Add the new Daily Summary section HTML block at the correct position in `<main>`.
    - **File**: `index.html`
    - **Steps**:
      1. Locate the closing `</section>` of `#recent-transactions-section`.
      2. Insert the following block immediately after it and before the opening `<section>` of `#month-selector-section`:
      ```html
      <!-- Daily summary: today's income, expense, net balance (Req 8) -->
      <section class="section daily-summary-section" id="daily-summary-section"
               aria-labelledby="daily-summary-heading">
        <h2 class="section-heading" id="daily-summary-heading">Today</h2>
        <p class="daily-summary__date" id="daily-summary-date"></p>
        <div class="daily-summary-cards">
          <article class="daily-summary-card daily-summary-card--income">
            <h3 class="daily-summary-card__label">Income Today</h3>
            <p class="daily-summary-card__value u-text-income"
               id="daily-income-value"></p>
          </article>
          <article class="daily-summary-card daily-summary-card--expense">
            <h3 class="daily-summary-card__label">Expense Today</h3>
            <p class="daily-summary-card__value u-text-expense"
               id="daily-expense-value"></p>
          </article>
          <article class="daily-summary-card">
            <h3 class="daily-summary-card__label">Net Today</h3>
            <p class="daily-summary-card__value" id="daily-net-value"></p>
          </article>
        </div>
      </section>
      ```
    - **New IDs introduced** (must not collide with any existing ID): `daily-summary-section`, `daily-summary-heading`, `daily-summary-date`, `daily-income-value`, `daily-expense-value`, `daily-net-value`.
    - **Validation**:
      - Confirm the six new IDs do not appear anywhere else in `index.html`.
      - Confirm the section is positioned between `#recent-transactions-section` and `#month-selector-section`.
      - Confirm the section has `aria-labelledby="daily-summary-heading"`.
      - Confirm `.daily-summary-card--income` and `.daily-summary-card--expense` modifier classes are present.
      - Confirm `u-text-income` is on `#daily-income-value` and `u-text-expense` is on `#daily-expense-value`.
    - **Dependencies**: 1.2, 1.3.
    - _Requirements: 8.1, 8.2, 8.6, 8.7, 8.8, 14.1_

---

### Phase 3: HTML Structure — Transaction List Scroll Wrapper

- [x] 3. Wrap `#transaction-list` and `#transaction-list-empty` in an internal scroll container inside `#transaction-list-section`
  - [x] 3.1 Add `.transaction-list-scroll` div wrapper around `#transaction-list` and `#transaction-list-empty`
    - **Objective**: Insert a `<div class="transaction-list-scroll">` around only the list and empty-state elements so that the filter controls remain outside the scrollable area.
    - **File**: `index.html`
    - **Steps**:
      1. Locate the `<ul class="transaction-list" id="transaction-list"></ul>` and `<p class="empty-state" id="transaction-list-empty" hidden></p>` lines inside `#transaction-list-section`.
      2. Wrap both elements together (and only these two) with:
         ```html
         <div class="transaction-list-scroll" tabindex="0"
              aria-label="Transaction list, scrollable">
           <ul class="transaction-list" id="transaction-list"></ul>
           <p class="empty-state" id="transaction-list-empty" hidden></p>
         </div>
         ```
      3. Confirm that `<form class="filter-controls" id="filter-controls">` remains **outside and before** the new wrapper div.
    - **Must preserve**: `id="transaction-list"`, `id="transaction-list-empty"`, `id="filter-controls"` (untouched, outside wrapper), `hidden` on `#transaction-list-empty`, `class="transaction-list"`, `class="empty-state"`.
    - **Must NOT change**: Any `id`, `class`, or attribute on `#filter-controls` or its children.
    - **Validation**:
      - Confirm `#transaction-list` and `#transaction-list-empty` are both direct children of `.transaction-list-scroll`.
      - Confirm `.transaction-list-scroll` is NOT inside `#filter-controls`.
      - Confirm `.transaction-list-scroll` has `tabindex="0"` and `aria-label="Transaction list, scrollable"`.
      - Confirm `#filter-controls` is still a direct child of `#transaction-list-section` and appears before `.transaction-list-scroll`.
    - **Dependencies**: 1.4.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 16.6_

---

### Phase 4: CSS — Token Extensions

- [x] 4. Extend the `:root` block in `css/styles.css` with new CSS custom properties
  - [x] 4.1 Append new design tokens to the existing `:root` declaration
    - **Objective**: Add alias and new tokens required by Requirements 1.1–1.4 without renaming or removing any existing token.
    - **File**: `css/styles.css`
    - **Steps**:
      1. Locate the closing `}` of the existing `:root { ... }` block.
      2. Append the following declarations **inside** the `:root` block, before the closing brace:
         ```css
         /* Req 1.1 — color alias */
         --color-background: var(--color-bg);
         --color-surface-raised: #fafbfc;

         /* Req 1.2 — spacing scale aliases */
         --space-1:  0.25rem;   /*  4px */
         --space-2:  0.5rem;    /*  8px */
         --space-3:  0.75rem;   /* 12px */
         --space-4:  1rem;      /* 16px */
         --space-6:  1.5rem;    /* 24px */
         --space-8:  2rem;      /* 32px */
         --space-10: 2.5rem;    /* 40px */

         /* Req 1.3 — typography aliases */
         --font-size-xs: 0.75rem;   /* 12px */
         --font-size-md: 1rem;      /* 16px — alias for --font-size-base */

         /* Req 1.4 — shape tokens */
         --radius-lg: 12px;
         --shadow-card-hover: 0 4px 12px rgba(18, 26, 33, 0.14);
         ```
      3. Confirm that `--font-weight-normal: 400` is already declared in the existing `:root` block (it is — it exists in the current file). Do not add a duplicate.
    - **Must NOT touch**: Any existing token (`--color-bg`, `--space-2xs`, `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--font-size-base`, `--font-size-sm`, `--font-size-lg`, `--font-size-xl`, `--font-size-2xl`, `--radius-sm`, `--radius-md`, `--shadow-card`, `--color-primary`, etc.).
    - **Validation**:
      - Open DevTools on the page and confirm `getComputedStyle(document.documentElement).getPropertyValue('--space-1')` returns `0.25rem`.
      - Confirm all existing tokens are still resolving (spot-check `--color-primary`, `--space-md`, `--font-size-base`).
      - Confirm no existing CSS rule changed its computed value.
    - **Dependencies**: None (CSS-only, no HTML dependency).
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

---

### Phase 5: CSS — Daily Summary Component Styles

- [x] 5. Add Daily Summary component CSS to `css/styles.css`
  - [x] 5.1 Add `.daily-summary__date` style
    - **Objective**: Style the date label below the section heading.
    - **File**: `css/styles.css`
    - **Steps**: Append the following rule after the existing component blocks (after the global empty state block or at the end of the file, before the final media queries):
      ```css
      /* ==========================================================================
         Daily Summary section (Req 8)
         ========================================================================== */

      .daily-summary__date {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        margin-bottom: var(--space-md);
      }
      ```
    - **Dependencies**: 4.1.
    - _Requirements: 8.6_

  - [x] 5.2 Add `.daily-summary-cards` layout and `.daily-summary-card` base styles
    - **Objective**: Mobile-first single-column card layout for the three daily value cards.
    - **File**: `css/styles.css`
    - **Steps**: Append immediately after 5.1:
      ```css
      .daily-summary-cards {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }

      .daily-summary-card {
        border: var(--border-width) solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-sm) var(--space-md);
        min-width: 0;
      }

      .daily-summary-card--income {
        border-left: 4px solid var(--color-income);
      }

      .daily-summary-card--expense {
        border-left: 4px solid var(--color-expense);
      }

      .daily-summary-card__label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-muted);
        margin-bottom: var(--space-2xs);
      }

      .daily-summary-card__value {
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-bold);
        font-variant-numeric: tabular-nums;
        margin: 0;
      }
      ```
    - **Dependencies**: 5.1.
    - _Requirements: 8.1, 8.7, 19.1_

  - [x] 5.3 Add responsive breakpoint for Daily Summary cards (≥600px row layout)
    - **Objective**: Switch the three daily cards to a horizontal row on wider viewports.
    - **File**: `css/styles.css`
    - **Steps**: Locate the `@media (min-width: 600px)` block (already exists). Add the following rules **inside** that block:
      ```css
      /* Daily summary: switch to horizontal row on wider viewports (Req 8.7, 15.2) */
      .daily-summary-cards {
        flex-direction: row;
        gap: var(--space-md);
      }

      .daily-summary-card {
        flex: 1;
      }
      ```
    - **Must NOT change**: Any existing rule already inside the `@media (min-width: 600px)` block.
    - **Dependencies**: 5.2.
    - _Requirements: 8.7, 15.2, 15.3_

---

### Phase 6: CSS — Transaction Scroll Container Styles

- [x] 6. Add `.transaction-list-scroll` CSS to `css/styles.css`
  - [x] 6.1 Add base scroll container styles
    - **Objective**: Define the internal scroll container that clips `#transaction-list` to a max-height.
    - **File**: `css/styles.css`
    - **Steps**: Append the following block after the Daily Summary styles (after task 5):
      ```css
      /* ==========================================================================
         Transaction list internal scroll container (Req 11)
         ========================================================================== */

      .transaction-list-scroll {
        max-height: 24rem;       /* mobile default — Req 11.3 */
        overflow-y: auto;
        overflow-x: hidden;      /* no horizontal scroll — Req 11.4 */
        border: var(--border-width) solid var(--color-border);
        border-radius: var(--radius-sm);
        /* Scrollbar hint so users discover scrollable content — Req 11.8 */
        scrollbar-width: thin;
        scrollbar-color: var(--color-border) transparent;
      }

      /* WebKit scrollbar styling */
      .transaction-list-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .transaction-list-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .transaction-list-scroll::-webkit-scrollbar-thumb {
        background-color: var(--color-border);
        border-radius: 3px;
      }

      /* Keyboard focus indicator on the scroll container — Req 11.7, 16.6 */
      .transaction-list-scroll:focus-visible {
        outline: 2px solid var(--color-focus);
        outline-offset: 2px;
      }
      ```
    - **Dependencies**: 3.1.
    - _Requirements: 11.1, 11.3, 11.4, 11.8, 16.6_

  - [x] 6.2 Add ≥600px max-height override for scroll container
    - **Objective**: Increase the scroll container max-height on wider viewports (Req 11.3).
    - **File**: `css/styles.css`
    - **Steps**: Inside the existing `@media (min-width: 600px)` block, append:
      ```css
      /* Transaction scroll container: taller on wider viewports — Req 11.3 */
      .transaction-list-scroll {
        max-height: 32rem;
      }
      ```
    - **Dependencies**: 6.1.
    - _Requirements: 11.3_

---

### Phase 7: CSS — Overview Card Enhancements

- [x] 7. Add ID-scoped CSS rules to visually enhance the Overview balance cards
  - [x] 7.1 Increase Total Balance value font size and add income/expense colors
    - **Objective**: Make the Total Balance value more visually prominent (Req 4.6) and add semantic color to the income/expense cards.
    - **File**: `css/styles.css`
    - **Steps**: Append the following block after the transaction scroll container styles (after task 6):
      ```css
      /* ==========================================================================
         Overview card enhancements (Req 4.6, 19.1)
         ========================================================================== */

      /* Total Balance: larger value for visual prominence */
      #card-total-balance .balance-card__value {
        font-size: var(--font-size-2xl);
        color: var(--color-text);
      }

      /* Income/Expense cards: semantic accent colors */
      #card-total-income .balance-card__value {
        color: var(--color-income);
      }

      #card-total-expense .balance-card__value {
        color: var(--color-expense);
      }
      ```
    - **Must NOT change**: `.balance-card__value` base rule (still applies to `#card-transaction-count`), `#card-total-balance` element itself.
    - **Validation**:
      - Confirm `#card-total-balance .balance-card__value` renders at `font-size: 28px` (1.75rem).
      - Confirm `#card-total-income .balance-card__value` text color matches `--color-income` (#1c6b4c).
      - Confirm `#card-total-expense .balance-card__value` text color matches `--color-expense` (#b3261e).
      - Confirm `#card-transaction-count .balance-card__value` is NOT affected.
    - **Dependencies**: 4.1.
    - _Requirements: 4.6, 18.1, 19.1_

---

### Phase 8: JavaScript — `dashboard.js` Daily Summary Implementation

- [x] 8. Add `todayLocalKey()` and `renderDailySummary()` to `js/dashboard.js`
  - [x] 8.1 Add `todayLocalKey()` private helper function
    - **Objective**: Implement a function that returns the current local calendar date as `"YYYY-MM-DD"` using local year/month/day components (NOT `toISOString()` which is UTC-based).
    - **File**: `js/dashboard.js`
    - **Steps**:
      1. Find the bottom of the `js/dashboard.js` file, after the last exported function (`renderTransactionListRows`).
      2. Append the following private (non-exported) function:
         ```javascript
         /**
          * Compute today's local calendar date as "YYYY-MM-DD" using local
          * year/month/day components — never toISOString() which is UTC-based
          * and may return the previous day in timezones east of UTC (Req 8.2).
          * @returns {string}
          */
         function todayLocalKey() {
           const d = new Date();
           const y = d.getFullYear();
           const m = String(d.getMonth() + 1).padStart(2, '0');
           const day = String(d.getDate()).padStart(2, '0');
           return `${y}-${m}-${day}`;
         }
         ```
    - **Validation**: Function must NOT call `toISOString()`. Must use `getFullYear()`, `getMonth()`, `getDate()`. Must pad month and day with `padStart(2, '0')`.
    - **Dependencies**: None.
    - _Requirements: 8.2_

  - [x] 8.2 Add `renderDailySummary()` exported function
    - **Objective**: Implement the exported render function that filters today's transactions and writes income, expense, net, and date to the DOM.
    - **File**: `js/dashboard.js`
    - **Steps**:
      1. Immediately after the `todayLocalKey()` function added in 8.1, append:
         ```javascript
         /**
          * Render the Daily Summary section with today's income, expense, and net
          * balance. Reads from the already-fetched allTransactions array; performs
          * no I/O of any kind (Req 8.3, 8.4, 17.1).
          *
          * @param {object[]} transactionList  Full in-memory transaction array.
          * @param {string}   [currency="IDR"] Active Selected_Currency.
          * @returns {void}
          */
         export function renderDailySummary(transactionList, currency = "IDR") {
           const list = Array.isArray(transactionList) ? transactionList : [];
           const cur  = (currency && currency.trim()) ? currency : "IDR";
           const todayKey = todayLocalKey();

           // Filter to today's transactions only — strict string equality (Req 8.3).
           const todayTxs = list.filter(tx => tx && tx.date === todayKey);

           let income  = 0;
           let expense = 0;
           for (const tx of todayTxs) {
             const amt = Number(tx.amount) || 0;
             if (tx.type === "income")  income  += amt;
             if (tx.type === "expense") expense += amt;
           }
           const net = income - expense;

           // DOM writes — all via safeText + formatCurrency (Req 8.1).
           // Each write is null-guarded: missing element is silently skipped.
           const incomeEl  = document.getElementById("daily-income-value");
           const expenseEl = document.getElementById("daily-expense-value");
           const netEl     = document.getElementById("daily-net-value");
           const dateEl    = document.getElementById("daily-summary-date");

           if (incomeEl)  utils.safeText(incomeEl,  utils.formatCurrency(income,  cur));
           if (expenseEl) utils.safeText(expenseEl, utils.formatCurrency(expense, cur));
           if (netEl)     utils.safeText(netEl,     utils.formatCurrency(net,     cur));
           if (dateEl)    utils.safeText(dateEl,    utils.formatDate(todayKey));
         }
         ```
    - **Constraints**:
      - Function must be `export function` (not `async`).
      - Must NOT call `transactions.getTransactions()`, `storage.*`, `supabase.*`, or `localStorage.*`.
      - Must NOT read `state.selectedMonth`.
      - All DOM writes must use `utils.safeText()` (never `innerHTML`).
      - All monetary values must pass through `utils.formatCurrency()`.
      - Date label must use `utils.formatDate()`.
      - All four DOM element lookups must be null-guarded (`if (el) ...`).
    - **Validation**:
      - Confirm function signature is `export function renderDailySummary(transactionList, currency = "IDR")`.
      - Confirm `todayLocalKey()` is called (not an inline date computation).
      - Confirm filter condition is `tx.date === todayKey` (strict equality, not loose, not a Date comparison).
      - Confirm `income` and `expense` are initialized to `0` before the loop (guarantees zero output for empty arrays, Req 8.9).
      - Confirm `net = income - expense` (Req 8.1).
      - Confirm no `await`, no `async`, no `fetch`, no `localStorage`, no `supabase` references.
    - **Dependencies**: 8.1, 2.1 (DOM elements must exist).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.9, 17.1_

  - [x] 8.3 Add `"daily-summary-section"` to `DATA_SECTION_IDS` array in `dashboard.js`
    - **Objective**: Include the Daily Summary section in the set of data-dependent sections that `renderGlobalEmptyState()` shows/hides based on transaction count.
    - **File**: `js/dashboard.js`
    - **Steps**:
      1. Locate the `DATA_SECTION_IDS` constant declaration:
         ```javascript
         const DATA_SECTION_IDS = [
           "balance-section",
           "recent-transactions-section",
           "monthly-summary-section",
           "charts-section",
           "transaction-list-section",
         ];
         ```
      2. Add `"daily-summary-section"` to the array. Recommended position: after `"recent-transactions-section"` to reflect the DOM order, but any position within the array is functionally equivalent:
         ```javascript
         const DATA_SECTION_IDS = [
           "balance-section",
           "recent-transactions-section",
           "daily-summary-section",      // ← added
           "monthly-summary-section",
           "charts-section",
           "transaction-list-section",
         ];
         ```
    - **Must NOT change**: Any other entry in the array. The `renderGlobalEmptyState()` function implementation must not be modified.
    - **Validation**:
      - Confirm `"daily-summary-section"` is in the array.
      - Confirm all original five IDs are still present.
      - Confirm `renderGlobalEmptyState` is unchanged except that it now iterates over six IDs instead of five.
    - **Dependencies**: 2.1 (the element `id="daily-summary-section"` must exist in the HTML).
    - _Requirements: 4.8, 20.2, 17.1_

---

### Phase 9: JavaScript — `app.js` `renderAll()` Integration

- [x] 9. Wire `renderDailySummary` into `renderAll()` in `js/app.js`
  - [x] 9.1 Add synchronous call to `dashboard.renderDailySummary()` inside `renderAll()`
    - **Objective**: Call `renderDailySummary` with the already-fetched `allTransactions` and the active currency, after `renderDashboard` completes, preserving the single-fetch optimization.
    - **File**: `js/app.js`
    - **Steps**:
      1. Locate the `renderAll()` function. Find this exact line inside the `try` block:
         ```javascript
         await dashboard.renderDashboard(state, userId, allTransactions);
         ```
      2. Insert the following line **immediately after** it (on the next line):
         ```javascript
         dashboard.renderDailySummary(allTransactions, state.selectedCurrency);
         ```
      3. The final sequence inside the `try` block must be:
         ```javascript
         const allTransactions = await transactions.getTransactions(userId);

         await dashboard.renderDashboard(state, userId, allTransactions);
         dashboard.renderDailySummary(allTransactions, state.selectedCurrency); // ← NEW

         await renderReports(allTransactions);
         await renderTransactionList(allTransactions);
         ```
    - **Constraints**:
      - No `await` before `renderDailySummary` (it is synchronous).
      - `allTransactions` must be the same variable already fetched by `transactions.getTransactions(userId)` — no additional fetch.
      - The call must NOT be placed inside `renderReports()`, `renderTransactionList()`, or `renderDashboard()`.
      - No other change to `renderAll()` or any other function in `app.js`.
    - **Validation**:
      - Confirm `transactions.getTransactions(userId)` is called exactly once in `renderAll()`.
      - Confirm `dashboard.renderDailySummary` is called with `allTransactions` (not a new fetch result) and `state.selectedCurrency`.
      - Confirm no `await` precedes the `renderDailySummary` call.
      - Confirm `renderReports` and `renderTransactionList` calls are unchanged.
      - Confirm no other function in `app.js` was modified.
    - **Dependencies**: 8.2 (function must be exported from `dashboard.js`).
    - _Requirements: 8.4, 17.1, 17.2_

---

### Phase 10: Verification

- [x] 10. Final integration verification — confirm all changes work together correctly
  - [x] 10.1 Verify HTML section order and IDs
    - **Objective**: Confirm `index.html` sections are in the correct final order and all required IDs are present.
    - **File**: `index.html`
    - **Steps**:
      1. Inspect the DOM order inside `<main id="app-main">` and confirm this exact order:
         1. `#global-empty-state`
         2. `#balance-section`
         3. `#charts-section`
         4. `#add-transaction-section`
         5. `#recent-transactions-section`
         6. `#daily-summary-section`
         7. `#month-selector-section`
         8. `#monthly-summary-section`
         9. `#transaction-list-section`
         10. `#category-management-section`
         11. `#settings-section`
      2. Confirm the following IDs exist exactly once in the document:
         - All auth section IDs (register-section, login-section, reset-password-section, new-password-section and all their inner IDs)
         - All overview IDs (balance-section, balance-cards, card-total-balance, card-total-income, card-total-expense, card-transaction-count, total-balance-value, total-income-value, total-expense-value, transaction-count-value)
         - All charts IDs (charts-section, expense-chart-container, income-chart-container, expense-chart, income-chart, expense-chart-description, income-chart-description, expense-chart-empty, income-chart-empty)
         - All add-transaction IDs (add-transaction-section, transaction-form, transaction-type, transaction-item-name, transaction-amount, transaction-category, transaction-date, add-transaction-button, transaction-form-error)
         - All recent-transactions IDs (recent-transactions-section, recent-transactions-list, recent-transactions-empty, view-all-transactions-button)
         - All daily-summary IDs (daily-summary-section, daily-summary-date, daily-income-value, daily-expense-value, daily-net-value)
         - All month-selector IDs (month-selector-section, selected-month, selected-month-label)
         - All monthly-summary IDs (monthly-summary-section, monthly-summary, monthly-income-value, monthly-expense-value, monthly-net-value, monthly-count-value, expense-category-breakdown, income-category-breakdown, expense-category-list, income-category-list)
         - All transaction-list IDs (transaction-list-section, filter-controls, filter-search, filter-type, filter-category, filter-month, clear-filters-button, transaction-list, transaction-list-empty)
         - All category-management IDs (category-management-section, category-form, category-name, category-type, add-category-button, category-form-error, category-list)
         - All settings IDs (settings-section, settings-form, currency-select, currency-select-hint)
         - Migration modal (migration-modal-overlay)
         - Header IDs (show-register-button, show-login-button, auth-signed-in, auth-signed-in-email, logout-button)
         - Global empty state (global-empty-state, global-empty-state-message)
      3. Confirm `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" defer>` is present.
      4. Confirm `<script type="module" src="js/app.js">` is present.
      5. Confirm migration modal is a sibling of `<main>` (not inside it).
    - **Dependencies**: 1.1, 1.2, 1.3, 1.4, 2.1, 3.1.
    - _Requirements: 14.1, 14.2, 14.3, 17.6, 17.7, 17.8_

  - [x] 10.2 Verify scroll wrapper structure
    - **Objective**: Confirm `#transaction-list` and `#transaction-list-empty` are inside `.transaction-list-scroll`, and `#filter-controls` is outside.
    - **Steps**:
      1. In `index.html`, confirm the structure of `#transaction-list-section` is:
         ```
         #transaction-list-section
           #filter-controls (outside the scroll wrapper)
           .transaction-list-scroll[tabindex="0"]
             #transaction-list
             #transaction-list-empty
         ```
      2. Confirm `.transaction-list-scroll` has `tabindex="0"` and `aria-label="Transaction list, scrollable"`.
      3. Confirm `#filter-controls` has NO scroll container as an ancestor inside `#transaction-list-section`.
    - **Dependencies**: 3.1.
    - _Requirements: 11.1, 11.2, 16.6_

  - [x] 10.3 Verify CSS tokens and new component classes
    - **Objective**: Confirm all new CSS tokens resolve and all new component classes are defined.
    - **Steps**:
      1. Confirm `:root` contains: `--color-background`, `--color-surface-raised`, `--space-1` through `--space-10`, `--font-size-xs`, `--font-size-md`, `--radius-lg`, `--shadow-card-hover`.
      2. Confirm all existing tokens are still present and unchanged.
      3. Confirm these classes exist in `styles.css`: `.daily-summary__date`, `.daily-summary-cards`, `.daily-summary-card`, `.daily-summary-card--income`, `.daily-summary-card--expense`, `.daily-summary-card__label`, `.daily-summary-card__value`, `.transaction-list-scroll`.
      4. Confirm `@media (min-width: 600px)` contains `.daily-summary-cards { flex-direction: row; }` and `.transaction-list-scroll { max-height: 32rem; }`.
      5. Confirm `#card-total-balance .balance-card__value`, `#card-total-income .balance-card__value`, and `#card-total-expense .balance-card__value` rules exist.
    - **Dependencies**: 4.1, 5.1, 5.2, 5.3, 6.1, 6.2, 7.1.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.6_

  - [x] 10.4 Verify `dashboard.js` additions
    - **Objective**: Confirm `todayLocalKey`, `renderDailySummary`, and the updated `DATA_SECTION_IDS` are correct.
    - **Steps**:
      1. Confirm `todayLocalKey` is defined (as a private function, not exported) and uses `getFullYear()`/`getMonth()`/`getDate()` — not `toISOString()`.
      2. Confirm `renderDailySummary` is exported.
      3. Confirm `renderDailySummary` is NOT `async`.
      4. Confirm `DATA_SECTION_IDS` contains `"daily-summary-section"` plus all five original IDs.
      5. Confirm no other function in `dashboard.js` was modified.
      6. Confirm `renderDailySummary` has no `fetch`, `localStorage`, `supabase`, or `storage` references.
    - **Dependencies**: 8.1, 8.2, 8.3.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.9, 17.1_

  - [x] 10.5 Verify `app.js` addition
    - **Objective**: Confirm `renderAll()` calls `renderDailySummary` exactly once, synchronously, with the pre-loaded array.
    - **Steps**:
      1. Locate `renderAll()` in `app.js`.
      2. Confirm `transactions.getTransactions(userId)` is called exactly once and the result is stored in `allTransactions`.
      3. Confirm `dashboard.renderDailySummary(allTransactions, state.selectedCurrency)` appears immediately after `await dashboard.renderDashboard(...)`.
      4. Confirm no `await` precedes `renderDailySummary`.
      5. Confirm no other change was made to `app.js`.
    - **Dependencies**: 9.1.
    - _Requirements: 8.4, 17.1, 17.2_

  - [x] 10.6 Checkpoint — open in browser and confirm baseline functionality
    - **Objective**: Open the application using the existing local development server and confirm the app loads correctly. Do not introduce a new server, build step, or dependency.
    - **Steps**:
      1. Open the application using the existing local development server in a modern browser.
      2. Confirm the page loads without JavaScript errors in the console.
      3. Sign in using the existing authentication flow and confirm the dashboard renders with sections in the correct order.
      4. Confirm the Daily Summary section appears between Recent Transactions and Selected Month.
      5. Add a transaction dated today. Confirm the Daily Summary values update.
      6. Add a transaction dated yesterday. Confirm the Daily Summary values do NOT change.
      7. Change the Selected Month. Confirm the Daily Summary does NOT change (only Monthly Summary changes).
      8. Scroll the transaction list. Confirm only the list scrolls (filter controls remain visible).
      9. Confirm no horizontal scroll appears at 375 px viewport width.
      10. Confirm all four Overview cards render in a row at ≥1024 px.
    - Ensure all tests pass, ask the user if questions arise.
    - **Dependencies**: All previous tasks.
    - _Requirements: 8.4, 8.5, 11.1, 14.1, 15.1_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (none in this plan — all tasks are required for the feature to be complete and correct).
- All phases are ordered to minimize re-editing the same file: complete Phases 1–3 (HTML) before Phases 4–7 (CSS) before Phases 8–9 (JS).
- Within Phase 1, complete subtasks 1.1 → 1.2 → 1.3 → 1.4 in order — each depends on the previous.
- The `index.html` reorganization (Phase 1) is a cut-and-paste operation, not a rewrite. All existing content is preserved.
- `renderDailySummary` must remain a synchronous render function with no external I/O, storage access, database access, or transaction fetching. It may perform DOM writes through the existing safe rendering utilities. Do not add `async`/`await` to it under any circumstances — this would break the call site in `app.js` (which intentionally does not `await` it) and would introduce a second storage read.
- The single-fetch optimization in `renderAll()` — one `getTransactions()` call, result shared across all four render functions — must be preserved. `renderDailySummary` receives the already-loaded array as a parameter.
- No files other than `index.html`, `css/styles.css`, `js/dashboard.js`, and `js/app.js` may be modified.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "5.1", "8.2"] },
    { "id": 2, "tasks": ["1.3", "5.2"] },
    { "id": 3, "tasks": ["1.4", "5.3", "6.1"] },
    { "id": 4, "tasks": ["2.1", "6.2", "7.1"] },
    { "id": 5, "tasks": ["3.1", "8.3"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 8, "tasks": ["10.6"] }
  ]
}
```

