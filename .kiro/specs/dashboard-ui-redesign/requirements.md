# Requirements Document

## Introduction

This feature is a design-and-presentation-only redesign of the existing Personal Finance Tracker web application. The application is already fully functional with Supabase authentication, cloud/local storage, RLS security, transaction CRUD, filtering, charting, monthly reporting, category management, and multi-currency support. The goal is to replace the current CSS and HTML structure with a modern, clean, finance-oriented dashboard aesthetic — while preserving every existing DOM ID, JavaScript module, business logic, data structure, authentication flow, and storage architecture without modification.

The redesign produces a new `index.html` and `css/styles.css`. No JavaScript files are changed except for the one small addition of a Daily_Summary rendering function in `app.js` and `dashboard.js` to support the new Daily Summary section. All auth, Supabase, RLS, migration, and storage logic remains untouched.

## Glossary

- **Dashboard**: The authenticated main page of the application containing all finance sections.
- **Design_System**: The set of CSS custom properties (design tokens), typography rules, spacing scale, and component patterns that define the visual language.
- **Section**: A visually distinct card-like container within the Dashboard corresponding to one functional area.
- **Overview_Section**: The section displaying Total_Balance, Total_Income, and Total_Expense summary cards.
- **Chart_Section**: The section containing the two Chart.js doughnut charts (expense by category, income by category).
- **Add_Transaction_Section**: The section containing the form for adding a new transaction.
- **Recent_Transactions_Section**: The section showing the most recent transactions (newest→oldest), limited to `RECENT_TRANSACTIONS_LIMIT` rows.
- **Daily_Summary_Section**: A new section showing today's income, expense, and net balance calculated from transactions whose date equals today's local calendar date (YYYY-MM-DD). Not affected by the Selected_Month.
- **Selected_Month_Section**: The section containing the month picker that controls the reporting scope.
- **Monthly_Summary_Section**: The section rendering monthly income, expense, net balance, and category breakdowns for the Selected_Month.
- **Transactions_Section**: The section showing the full transaction list with search/filter controls and delete capability, inside an internally scrollable container.
- **Manage_Categories_Section**: The section for adding and deleting custom categories.
- **Settings_Section**: The section containing the currency selector.
- **Internal_Scroll_Container**: An element within Transactions_Section that clips and scrolls its transaction rows without causing page-level horizontal overflow.
- **Today_Key**: The local calendar date string in "YYYY-MM-DD" format computed from `new Date()` using local year/month/day components (not UTC), used to filter transactions for Daily_Summary_Section.
- **CSS_Variable**: A CSS custom property declared in `:root` that forms part of the Design_System.
- **Preserved_ID**: Any HTML `id` attribute whose value is read by an existing JavaScript module and must not be renamed or removed.
- **RECENT_TRANSACTIONS_LIMIT**: The constant (currently 5) in `dashboard.js` that caps how many rows appear in Recent_Transactions_Section.

---

## Requirements

### Requirement 1: Design System & CSS Variables

**User Story:** As a developer, I want a consistent set of CSS custom properties, so that the entire application shares a cohesive visual language and future theming changes require only token updates.

#### Acceptance Criteria

1. THE Design_System SHALL define at minimum the following CSS_Variables in `:root`: `--color-primary`, `--color-primary-hover`, `--color-primary-contrast`, `--color-income`, `--color-expense`, `--color-error`, `--color-background`, `--color-surface`, `--color-surface-raised`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-focus`, `--color-success`, `--color-success-bg`, `--color-success-border`.
2. THE Design_System SHALL define a spacing scale using CSS_Variables: `--space-1` (4 px), `--space-2` (8 px), `--space-3` (12 px), `--space-4` (16 px), `--space-6` (24 px), `--space-8` (32 px), `--space-10` (40 px).
3. THE Design_System SHALL define typography CSS_Variables: `--font-family-base`, `--font-size-xs`, `--font-size-sm`, `--font-size-base`, `--font-size-md`, `--font-size-lg`, `--font-size-xl`, `--font-size-2xl`, `--font-weight-normal`, `--font-weight-medium`, `--font-weight-bold`, `--line-height-base`.
4. THE Design_System SHALL define shape CSS_Variables: `--radius-sm`, `--radius-md`, `--radius-lg`, `--shadow-card`, `--shadow-card-hover`, `--border-width`, `--control-min-height`.
5. WHEN `prefers-color-scheme: dark` is detected by the browser, THE Design_System SHALL NOT automatically switch to a dark theme in v1; all color tokens remain at their light-mode values.
6. THE Design_System SHALL ensure that all body text color on background and surface tokens meets a minimum contrast ratio of 4.5:1 for normal text per WCAG AA.

---

### Requirement 2: Global Layout & Typography

**User Story:** As a user, I want the app to have a clean, readable, modern layout with good vertical rhythm, so that I can scan financial data quickly on any device.

#### Acceptance Criteria

1. THE Dashboard SHALL use a single-column centered layout on viewports narrower than 768 px, with horizontal padding preventing content from touching the viewport edge.
2. WHEN the viewport width is 768 px or wider, THE Dashboard SHALL arrange the main content in a layout that makes better use of horizontal space (e.g. wider container or multi-column card grids within sections).
3. THE Dashboard SHALL apply consistent vertical spacing between Sections using the spacing scale.
4. THE Dashboard SHALL use the `--font-family-base` system font stack for all text.
5. THE Dashboard SHALL apply `[hidden] { display: none !important; }` so the JavaScript `hidden` attribute always collapses elements regardless of other CSS specificity.
6. WHEN horizontal content overflow occurs on any viewport width from 375 px to 1440 px, THE Dashboard SHALL prevent page-level horizontal scroll via `overflow-x: hidden` on `html` and `body`.
7. THE Dashboard SHALL render an `<header>` containing the application title and auth navigation (Sign in, Create account, signed-in badge with Log out), consistent with the existing HTML structure.
8. THE Dashboard SHALL render a `<footer>` containing the privacy statement section, consistent with the existing HTML structure.

---

### Requirement 3: Auth UI — Registration, Login, Password Reset, New Password

**User Story:** As a user, I want the authentication forms to be visually consistent with the new design system, so that the sign-in experience feels polished.

#### Acceptance Criteria

1. THE Auth_UI SHALL preserve all existing `id` attributes on auth form elements: `register-section`, `register-form`, `register-email`, `register-password`, `register-confirm-password`, `register-form-error`, `register-submit-button`, `register-success`, `register-success-message`, `register-back-button`, `login-section`, `login-form`, `login-email`, `login-password`, `login-form-error`, `login-submit-button`, `login-back-button`, `login-to-register-button`, `login-forgot-password-button`, `reset-password-section`, `reset-password-form`, `reset-email`, `reset-password-form-error`, `reset-password-submit-button`, `reset-password-success`, `reset-password-success-message`, `reset-password-back-button`, `new-password-section`, `new-password-form`, `new-password`, `confirm-new-password`, `new-password-error`, `new-password-submit`, `new-password-success`, `new-password-success-message`.
2. THE Auth_UI SHALL preserve all existing `data-field-error` attributes used for inline validation messages.
3. THE Auth_UI SHALL style auth sections as centered cards matching the new Design_System card appearance.
4. WHEN auth forms contain field-level errors, THE Auth_UI SHALL highlight the associated input with the `--color-error` border and display the error message below the field.
5. THE Auth_UI SHALL apply `--control-min-height` to all form inputs and buttons within auth forms to meet the 44 px minimum touch target.

---

### Requirement 4: Overview Section

**User Story:** As a user, I want to see my total balance, income, and expense prominently at the top of the dashboard, so that I can grasp my financial position at a glance.

#### Acceptance Criteria

1. THE Overview_Section SHALL display a primary "Total Balance" card containing the element with `id="total-balance-value"`.
2. THE Overview_Section SHALL display a "Total Income" card containing the element with `id="total-income-value"` and a "Total Expense" card containing the element with `id="total-expense-value"`.
3. THE Overview_Section SHALL display a "Transactions" count card containing the element with `id="transaction-count-value"`.
4. WHEN the viewport is narrower than 600 px, THE Overview_Section SHALL stack the four cards in a single column.
5. WHEN the viewport is 600 px or wider, THE Overview_Section SHALL arrange the four cards in a responsive grid (e.g. 2-up or 4-up) using CSS Grid or Flexbox, without horizontal overflow.
6. THE Overview_Section SHALL render financial amounts in a visually prominent font size using at minimum `--font-size-xl` for the balance value.
7. THE Overview_Section SHALL preserve all existing `id` attributes: `balance-section`, `balance-cards`, `card-total-balance`, `card-total-income`, `card-total-expense`, `card-transaction-count`, `total-balance-value`, `total-income-value`, `total-expense-value`, `transaction-count-value`.
8. THE Overview_Section SHALL apply the `hidden` attribute initially and reveal it when `renderGlobalEmptyState(true)` is called by the existing JavaScript, consistent with `DATA_SECTION_IDS` in `dashboard.js`.

---

### Requirement 5: Chart Section

**User Story:** As a user, I want to see my spending and income charts displayed in a clean, modern card, so that I can analyze my category distributions without visual noise.

#### Acceptance Criteria

1. THE Chart_Section SHALL contain both canvas elements with `id="expense-chart"` and `id="income-chart"` along with their associated accessible description paragraphs (`id="expense-chart-description"`, `id="income-chart-description"`) and empty-state paragraphs (`id="expense-chart-empty"`, `id="income-chart-empty"`) and container elements (`id="expense-chart-container"`, `id="income-chart-container"`).
2. THE Chart_Section SHALL wrap the two chart containers in an element with class `chart-row` so the responsive two-column breakpoint behavior already written in `app.js` and `charts.js` continues to function.
3. WHEN the viewport is narrower than 600 px, THE Chart_Section SHALL render the two charts stacked vertically with no horizontal overflow.
4. WHEN the viewport is 600 px or wider, THE Chart_Section SHALL render the two charts side-by-side in a two-column layout.
5. THE Chart_Section SHALL preserve the `id="charts-section"` attribute and the `hidden` attribute initial state, consistent with `DATA_SECTION_IDS`.
6. THE Chart_Section SHALL apply `overflow: hidden` to chart containers so Chart.js responsive resize does not temporarily expand beyond the viewport.
7. THE Chart_Section SHALL preserve all existing heading text ("Expenses by category", "Income by category") while applying the new typography scale.

---

### Requirement 6: Add Transaction Section

**User Story:** As a user, I want the Add Transaction form to look modern and polished while retaining all existing field IDs and behavior, so that adding a transaction feels seamless.

#### Acceptance Criteria

1. THE Add_Transaction_Section SHALL preserve all existing `id` attributes: `add-transaction-section`, `transaction-form`, `transaction-type`, `transaction-item-name`, `transaction-amount`, `transaction-category`, `transaction-date`, `add-transaction-button`, `transaction-form-error`, and all `data-field-error` slots.
2. THE Add_Transaction_Section SHALL preserve the `novalidate` attribute on the form and all `aria-describedby` associations.
3. THE Add_Transaction_Section SHALL apply `--control-min-height` to all inputs, selects, and the submit button.
4. WHEN the viewport is 600 px or wider, THE Add_Transaction_Section SHALL arrange form fields in a multi-column grid (2 or 3 columns) consistent with the existing responsive breakpoint.
5. THE Add_Transaction_Section SHALL display field-level validation error messages below each field using the `--color-error` token, preserving the `.field-error:empty { display: none }` behavior.
6. WHEN a transaction is successfully added, THE Add_Transaction_Section SHALL display a success message using `--color-income` styling, clearing automatically after 3 seconds (existing JS behavior preserved).

---

### Requirement 7: Recent Transactions Section

**User Story:** As a user, I want to see a compact list of my most recent transactions on the dashboard, so that I can quickly review recent activity without scrolling.

#### Acceptance Criteria

1. THE Recent_Transactions_Section SHALL render transactions as a compact list (not a table) using `<ul id="recent-transactions-list">`.
2. THE Recent_Transactions_Section SHALL display transactions ordered newest-to-oldest by `date` field, limited to `RECENT_TRANSACTIONS_LIMIT` rows, consistent with the existing `renderRecentTransactions` function in `dashboard.js`.
3. THE Recent_Transactions_Section SHALL show income rows with a left accent using `--color-income` and expense rows with `--color-expense`, so the type is distinguishable without color alone (sign prefix already applied by JS).
4. THE Recent_Transactions_Section SHALL preserve `id="recent-transactions-section"`, `id="recent-transactions-list"`, `id="recent-transactions-empty"`, and `id="view-all-transactions-button"`.
5. THE Recent_Transactions_Section SHALL preserve the `hidden` initial state, consistent with `DATA_SECTION_IDS`.
6. THE Recent_Transactions_Section SHALL display each row's item name, category, type label, date, and formatted amount using compact spacing (≤ 16 px vertical padding per row).
7. THE Recent_Transactions_Section SHALL render the "View all transactions →" link as a visible button below the list that scrolls to Transactions_Section when clicked (existing `app.js` behavior preserved).

---

### Requirement 8: Daily Summary Section

**User Story:** As a user, I want to see how much I have earned and spent today, so that I can track my daily financial activity at a glance.

#### Acceptance Criteria

1. THE Daily_Summary_Section SHALL display three values: today's total income, today's total expense, and today's net balance (income − expense), formatted with the active Selected_Currency.
2. THE Daily_Summary_Section SHALL compute Today_Key as the local calendar date by reading `new Date()` and constructing a "YYYY-MM-DD" string using local year/month/day, NOT `toISOString().slice(0,10)` (which is UTC-based and may differ by one day in timezones east of UTC).
3. THE Daily_Summary_Section SHALL filter transactions from the existing in-memory transaction set by comparing each transaction's `date` field to Today_Key using strict string equality, with no new database table, schema change, or additional storage key.
4. THE Daily_Summary_Section SHALL update its displayed values whenever `renderAll()` is called (i.e., after every add or delete transaction), so values stay current within the same session.
5. THE Daily_Summary_Section SHALL NOT be affected by changes to the Selected_Month (changing the month picker must NOT change the Daily_Summary_Section display).
6. THE Daily_Summary_Section SHALL include a visible date label showing today's formatted date (e.g., "25 Sep 2026") so users know which day is being summarized.
7. THE Daily_Summary_Section SHALL preserve mobile responsiveness: on viewports narrower than 600 px, the three value cards SHALL stack in a column; on wider viewports they SHALL arrange in a row or grid.
8. THE Daily_Summary_Section SHALL use new DOM element `id` values that do not conflict with any existing `id` in `index.html`: `daily-summary-section`, `daily-summary-date`, `daily-income-value`, `daily-expense-value`, `daily-net-value`.
9. WHEN no transactions exist for today, THE Daily_Summary_Section SHALL display zero-formatted values (e.g., "Rp 0") rather than blank or missing values.
10. THE Daily_Summary_Section SHALL be positioned in the Dashboard between Recent_Transactions_Section (above) and Selected_Month_Section (below) in the final section order.

---

### Requirement 9: Selected Month Section

**User Story:** As a user, I want a clean, compact month picker, so that I can navigate between months without it dominating the page.

#### Acceptance Criteria

1. THE Selected_Month_Section SHALL preserve `id="month-selector-section"`, `id="selected-month"`, and `id="selected-month-label"` so the existing `wireMonthSelector()` and `onSelectedMonthChange()` functions continue to work.
2. THE Selected_Month_Section SHALL apply compact styling to the `<input type="month">` element using the existing form field pattern, with a max-width that prevents it from stretching to the full container width on wide viewports.
3. THE Selected_Month_Section SHALL not include a section heading that visually competes with adjacent sections; a smaller or muted heading label is acceptable.

---

### Requirement 10: Monthly Summary Section

**User Story:** As a user, I want a clear, card-based monthly summary showing income, expense, and net balance for the selected month, so that I can understand monthly performance quickly.

#### Acceptance Criteria

1. THE Monthly_Summary_Section SHALL preserve `id="monthly-summary-section"`, `id="monthly-summary"`, `id="monthly-income-value"`, `id="monthly-expense-value"`, `id="monthly-net-value"`, `id="monthly-count-value"`, `id="expense-category-list"`, `id="income-category-list"`, `id="expense-category-breakdown"`, `id="income-category-breakdown"` so the existing `renderMonthlySummary` function continues to work.
2. THE Monthly_Summary_Section SHALL preserve the `hidden` initial state, consistent with `DATA_SECTION_IDS`.
3. WHEN the viewport is 600 px or wider, THE Monthly_Summary_Section SHALL arrange the income/expense/net summary lines in a row of small cards rather than stacking them vertically.
4. THE Monthly_Summary_Section SHALL display category breakdown lists with alternating or bordered rows for readability, preserving the existing `.category-breakdown__item` class structure used by `reports.js`.

---

### Requirement 11: Transactions Section (Full List with Scroll)

**User Story:** As a user, I want to browse, search, filter, and delete my full transaction history in a contained, scrollable area, so that the page does not grow unboundedly with many transactions.

#### Acceptance Criteria

1. THE Transactions_Section SHALL contain an Internal_Scroll_Container wrapping `<ul id="transaction-list">` and `<p id="transaction-list-empty">` with a `max-height` and `overflow-y: auto` so that when transactions exceed the visible area, only the container scrolls.
2. THE Transactions_Section SHALL place the search and filter controls (`id="filter-controls"`) OUTSIDE the Internal_Scroll_Container so they remain visible while the list scrolls.
3. THE Transactions_Section SHALL define the Internal_Scroll_Container `max-height` as `24rem` on mobile viewports (narrower than 600 px) and `32rem` on wider viewports.
4. THE Internal_Scroll_Container SHALL apply `overflow-x: hidden` to prevent horizontal scroll within the container on any viewport from 375 px to 1440 px.
5. THE Transactions_Section SHALL preserve all existing `id` attributes: `transaction-list-section`, `filter-controls`, `filter-search`, `filter-type`, `filter-category`, `filter-month`, `clear-filters-button`, `transaction-list`, `transaction-list-empty`.
6. THE Transactions_Section SHALL preserve the `hidden` initial state, consistent with `DATA_SECTION_IDS`.
7. WHEN a user presses the Tab key or uses a keyboard to interact with the Internal_Scroll_Container, THE Transactions_Section SHALL ensure the container is keyboard-accessible (scroll container receives focus or is navigable via its child elements).
8. THE Transactions_Section SHALL apply a visible scrollbar or scroll indicator so users can discover that more content is available.
9. WHEN filter controls are changed, THE Transactions_Section SHALL update only the transaction list rows within the Internal_Scroll_Container, preserving the existing `onFilterChange` → `renderTransactionList` → `renderTransactionListRows` call chain.

---

### Requirement 12: Manage Categories Section

**User Story:** As a user, I want the category management panel to be clearly organized and styled, so that I can add and delete custom categories without confusion.

#### Acceptance Criteria

1. THE Manage_Categories_Section SHALL preserve all existing `id` attributes: `category-management-section`, `category-form`, `category-name`, `category-type`, `add-category-button`, `category-form-error`, `category-list` so the existing `wireCategoryForm()` and `renderCategoryList()` functions continue to work.
2. THE Manage_Categories_Section SHALL visually distinguish expense category groups from income category groups using the `.category-list__group-heading` element class.
3. THE Manage_Categories_Section SHALL render default categories with a "(default)" badge and no delete button; custom categories SHALL have a styled delete button using the existing `.category-item__delete` pattern.
4. THE Manage_Categories_Section SHALL apply `--control-min-height` to all form inputs and buttons.

---

### Requirement 13: Settings Section

**User Story:** As a user, I want the settings panel to be clean and clearly labeled, so that changing the display currency is straightforward.

#### Acceptance Criteria

1. THE Settings_Section SHALL preserve all existing `id` attributes: `settings-section`, `settings-form`, `currency-select`, `currency-select-hint` so the existing `wireCurrencySelector()` and `onCurrencyChange()` functions continue to work.
2. THE Settings_Section SHALL display a hint below the currency select explaining that changing currency only affects display formatting, not stored amounts.
3. WHEN the viewport is 600 px or wider, THE Settings_Section SHALL constrain the settings form to a maximum width of 24 rem so the select does not stretch across the full desktop layout.

---

### Requirement 14: Dashboard Section Order

**User Story:** As a user, I want the dashboard sections arranged in a logical sequence that flows from summary to detail, so that I can read financial information from top to bottom naturally.

#### Acceptance Criteria

1. THE Dashboard SHALL render the authenticated content sections in this exact top-to-bottom order within `<main id="app-main">`:
   - Global_Empty_State (`id="global-empty-state"`)
   - Overview_Section (`id="balance-section"`)
   - Chart_Section (`id="charts-section"`)
   - Add_Transaction_Section (`id="add-transaction-section"`)
   - Recent_Transactions_Section (`id="recent-transactions-section"`)
   - Daily_Summary_Section (`id="daily-summary-section"`)
   - Selected_Month_Section (`id="month-selector-section"`)
   - Monthly_Summary_Section (`id="monthly-summary-section"`)
   - Transactions_Section (`id="transaction-list-section"`)
   - Manage_Categories_Section (`id="category-management-section"`)
   - Settings_Section (`id="settings-section"`)
2. THE Dashboard SHALL preserve the Migration_Modal (`id="migration-modal-overlay"`) as a sibling of `<main>` (outside the main flow), consistent with the existing HTML structure.
3. THE Dashboard SHALL preserve the Auth_Sections (`id="register-section"`, `id="login-section"`, `id="reset-password-section"`, `id="new-password-section"`) as siblings of `<main>`, shown/hidden by existing JavaScript.

---

### Requirement 15: Responsive Breakpoints

**User Story:** As a user on a mobile phone, tablet, or desktop, I want the dashboard to render correctly at any screen size, so that I can use the app comfortably on any device.

#### Acceptance Criteria

1. THE Dashboard SHALL be usable and visually correct at viewport widths of 375 px, 390 px, 600 px, 768 px, 1024 px, and 1440 px.
2. WHEN the viewport width is less than 600 px, THE Dashboard SHALL use a single-column layout for all card grids (balance cards, monthly summary cards, daily summary cards).
3. WHEN the viewport width is 600 px or wider, THE Dashboard SHALL switch balance cards, daily summary cards, and monthly summary cards to a multi-column layout via CSS Grid or Flexbox, with a minimum column width preventing cards from becoming too narrow.
4. WHEN the viewport width is 1024 px or wider, THE Dashboard SHALL allow the four Overview cards to sit on a single row (4-column grid).
5. THE Dashboard SHALL prevent all horizontal overflow on the listed viewport widths by using `min-width: 0` on flex/grid children, `overflow-wrap: break-word` on text containers, and `max-width: 100%` on inputs and selects.
6. WHEN the viewport width is 1024 px or wider, THE Dashboard SHALL widen the main container to make better use of space (e.g. max-width: 72 rem) while maintaining readable line lengths.

---

### Requirement 16: Accessibility

**User Story:** As a user who relies on keyboard navigation or a screen reader, I want all interactive elements to be accessible, so that I can use the full application without a mouse.

#### Acceptance Criteria

1. THE Dashboard SHALL associate every `<input>` and `<select>` with a visible `<label>` element using matching `for` / `id` pairs or `aria-label`.
2. THE Dashboard SHALL provide a visible focus indicator (outline or ring) on all interactive elements using `--color-focus` that is visible against both light and dark keyboard-focused states.
3. THE Dashboard SHALL assign `role="alert"` and `aria-live="polite"` to all inline error message elements so screen readers announce validation errors when they appear.
4. THE Dashboard SHALL assign appropriate `aria-label` attributes to the Delete buttons in the transaction list and category list (already handled by existing JS via `addDeleteControls()`; the HTML must not remove or override these).
5. THE Dashboard SHALL preserve the `role="dialog"` and `aria-modal="true"` attributes on the Migration Modal overlay.
6. THE Internal_Scroll_Container in Transactions_Section SHALL be accessible via keyboard scrolling. WHEN the container receives focus, THE Dashboard SHALL allow the user to scroll it with arrow keys (applied via `tabindex="0"` on the scroll container).
7. THE Dashboard SHALL preserve all `aria-labelledby`, `aria-describedby`, and `aria-live` attributes present on existing HTML elements.

---

### Requirement 17: Functional Preservation — No Architecture Changes

**User Story:** As a developer, I want the redesign to be purely presentational, so that the existing JavaScript architecture, business logic, storage layer, and authentication remain entirely unchanged.

#### Acceptance Criteria

1. THE Redesign SHALL NOT modify any JavaScript file except:
   - `app.js` — to add a call to `renderDailySummary()` inside `renderAll()` and to wire the Daily_Summary_Section.
   - `dashboard.js` — to add the `renderDailySummary(transactions, currency)` export function that renders Daily_Summary_Section DOM elements.
2. THE Redesign SHALL NOT modify `storage.js`, `transactions.js`, `categories.js`, `charts.js`, `reports.js`, `utils.js`, `auth.js`, `supabase.js`, `supabase-storage.js`, `config.js`, `migration.js`.
3. THE Redesign SHALL NOT alter the Supabase database schema, RLS policies, authentication flow, or any server-side configuration.
4. THE Redesign SHALL NOT introduce any new JavaScript library, CSS framework, or external dependency beyond the existing Chart.js CDN link.
5. THE Redesign SHALL NOT add any build step; the redesigned application SHALL run by opening `index.html` in a browser without a compilation step.
6. WHEN any existing JavaScript module reads a DOM element by `id`, THE Redesign SHALL ensure that element exists in the redesigned `index.html` with the same `id`, `type`, `name`, and relevant `data-*` attributes as before.
7. THE Redesign SHALL preserve the `<script type="module" src="js/app.js">` entry point in `index.html`.
8. THE Redesign SHALL preserve the Chart.js CDN `<script>` tag with `defer` attribute in `index.html`.

---

### Requirement 18: Card Component Pattern

**User Story:** As a developer, I want all sections to follow a consistent card component pattern, so that the visual language is uniform and maintainable.

#### Acceptance Criteria

1. THE Design_System SHALL define a base card pattern that applies `background-color: var(--color-surface)`, a `var(--border-width) solid var(--color-border)` border, `var(--radius-md)` border-radius, `var(--shadow-card)` box-shadow, and consistent padding using the spacing scale.
2. WHEN a card element is hovered on desktop, THE Design_System MAY apply a subtle `--shadow-card-hover` enhancement (this is optional and must not interfere with touch interactions).
3. THE Design_System SHALL define a section heading style using `--font-size-xl` and `--font-weight-bold` for primary section headings, and a smaller variant for subsection headings within cards.
4. THE Design_System SHALL apply the card pattern consistently to: Overview_Section (including individual balance cards), Chart_Section, Add_Transaction_Section, Recent_Transactions_Section, Daily_Summary_Section, Selected_Month_Section, Monthly_Summary_Section, Transactions_Section, Manage_Categories_Section, Settings_Section, and Auth_Card.

---

### Requirement 19: Transaction Row Appearance

**User Story:** As a user, I want transaction rows to clearly communicate income vs expense at a glance, so that I can scan my transaction history quickly.

#### Acceptance Criteria

1. THE Transaction_Row SHALL apply a colored left-side border: `--color-income` for income transactions and `--color-expense` for expense transactions (existing `.transaction-row--income` / `.transaction-row--expense` classes preserved).
2. THE Transaction_Row SHALL display the amount with the appropriate sign prefix ("+" for income, "−" for expense) and color (`u-text-income`, `u-text-expense` utility classes) as already applied by `dashboard.js`.
3. THE Transaction_Row SHALL display the item name, category, type label, formatted date, and amount, with the item name visually weighted (bold or medium weight) and secondary fields (category, type, date) styled in `--color-text-muted` at a smaller font size.
4. WHEN a Delete button is present on a transaction row (added dynamically by `addDeleteControls()` in `app.js`), THE Transaction_Row SHALL accommodate the button without causing horizontal overflow.
5. THE Transaction_Row SHALL apply `min-width: 0` and `overflow-wrap: break-word` to text cells to prevent long item names from causing horizontal overflow in either the Internal_Scroll_Container or the Recent Transactions list.

---

### Requirement 20: Global Empty State

**User Story:** As a new user with no transactions, I want to see a welcoming empty state that guides me to add my first transaction, so that the app does not feel broken on first use.

#### Acceptance Criteria

1. THE Global_Empty_State SHALL preserve `id="global-empty-state"` and `id="global-empty-state-message"` so the existing `renderGlobalEmptyState()` function in `dashboard.js` can show/hide it.
2. WHEN no transactions exist, THE Global_Empty_State SHALL be visible and all other data-dependent sections (defined in `DATA_SECTION_IDS` in `dashboard.js`) SHALL be hidden.
3. THE Global_Empty_State SHALL display the message "No transactions yet. Add your first income or expense." centered within its card with generous padding, styled in `--color-text-muted`.
4. THE Global_Empty_State SHALL use a dashed border or other visual treatment to indicate it is a placeholder state rather than content.
