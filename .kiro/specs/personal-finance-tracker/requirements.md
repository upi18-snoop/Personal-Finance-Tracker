# Requirements Document

## Introduction

Personal Finance Tracker is a client-side-only web application that lets everyday users record income and expense transactions, monitor their balance, categorize transactions, analyze spending and income by category, and review monthly financial summaries. Version 1 runs entirely in the browser with no backend, persisting all data in the browser's localStorage, and is deployable as a static website (for example, on GitHub Pages).

The application is built with HTML5, CSS3, and Vanilla JavaScript (ES modules), uses the browser Local Storage API for persistence, and uses Chart.js for charts. No frontend framework, backend server, database, or authentication service is used in v1. After the initial page load (and, if charts are used, loading Chart.js from a CDN), the application must function offline.

This document specifies the functional and non-functional requirements for v1, expressed as EARS-format acceptance criteria. Certain capabilities (CSV export/import, JSON backup/restore, Google Sheets synchronization, additional currencies) are explicitly out of scope as v1 functional features and are captured only as future-readiness (architectural/extensibility) requirements so they can be added later without rewrites.

The App uses a configurable single-currency model. The user selects one currency for the entire application from Settings, and all Transactions are displayed in that Selected_Currency. The default Selected_Currency is IDR, which preserves existing data. Currency selection is a display and formatting concern only: there is no exchange-rate conversion and no per-Transaction currency. Transaction amounts remain plain numeric values regardless of the Selected_Currency, and changing the Selected_Currency changes only how amounts are formatted for display.

## Glossary

- **App**: The Personal Finance Tracker web application as a whole, running in the browser.
- **Transaction**: A single financial record with fields `id`, `type`, `itemName`, `amount`, `category`, `date`, and `createdAt`.
- **Transaction_Type**: The classification of a Transaction, either `income` or `expense`.
- **Income_Transaction**: A Transaction whose `type` is `income`.
- **Expense_Transaction**: A Transaction whose `type` is `expense`.
- **Total_Income**: The sum of `amount` across all Income_Transactions in the scope being reported.
- **Total_Expense**: The sum of `amount` across all Expense_Transactions in the scope being reported.
- **Total_Balance**: `Total_Income` minus `Total_Expense` across all Transactions.
- **Net_Balance**: `Total_Income` minus `Total_Expense` for a specific Selected_Month.
- **Category**: A named grouping for a Transaction. A Category is either a Default_Category or a Custom_Category, and applies to a specific Transaction_Type.
- **Default_Category**: A built-in Category provided by the App. Expense defaults: Food, Transport, Fun, Bills, Shopping, Health, Other. Income defaults: Salary, Freelance, Business, Investment, Gift, Other.
- **Custom_Category**: A Category created by the user.
- **Selected_Month**: The calendar month (year and month) currently chosen by the user for month-scoped views such as the Monthly_Summary.
- **Dashboard**: The primary view showing Total_Balance, Total_Income, Total_Expense, the Selected_Month, the spending chart, and recent Transactions.
- **Monthly_Summary**: The month-scoped report for the Selected_Month.
- **Spending_Chart**: A chart showing expense distribution by Category.
- **Income_Analysis**: A view or report showing income distribution by Category.
- **Storage_Module**: The single dedicated module (`storage.js`) that performs all reads and writes to localStorage.
- **Storage_Schema**: The single versioned data structure persisted in localStorage, containing a schema version, the Transactions, and the Custom_Categories.
- **Currency_Formatter**: The isolated utility responsible for formatting numeric amounts as currency strings using a currency code and an associated locale via `Intl.NumberFormat`.
- **Selected_Currency**: The single ISO 4217 currency code chosen by the user that applies to the entire App.
- **Supported_Currencies**: The fixed set of selectable currencies, identified by ISO 4217 codes: USD, EUR, GBP, IDR, JPY, CNY, SGD, AUD, CAD, CHF, MYR, THB, INR, KRW.
- **Currency_Setting**: The presentation-layer setting, exposed in Settings, where the user selects the Selected_Currency. The Currency_Setting is persisted in localStorage in `settings.currency` through the Storage_Module.
- **Settings**: The presentation-layer area of the App where the user configures preferences, including the Currency_Setting.
- **Empty_State**: The UI shown when there are no Transactions in the relevant scope.
- **Search_Term**: The text string entered by the user to match against Transaction item names in the Transaction_List.
- **Filter_Criteria**: The combined set of active filter and search inputs applied to the Transaction_List, consisting of the Search_Term, a Transaction_Type filter (one of `all`, `income`, `expense`), a Category filter, and a month filter.
- **Transaction_List**: The view that displays stored Transactions and to which the Filter_Criteria are applied. Applying Filter_Criteria affects only which Transactions are displayed in the Transaction_List and does not affect the Dashboard totals or the Monthly_Summary.
- **Filtered_Transaction_Set**: The subset of stored Transactions that satisfy all currently active Filter_Criteria, displayed in the Transaction_List.
- **Filtered_Empty_State**: The UI shown in the Transaction_List when Transactions exist but none satisfy the active Filter_Criteria.

## Requirements

### Requirement 1: Dashboard Overview

**User Story:** As a user, I want a dashboard that shows my balance, totals, current month, spending chart, and recent transactions, so that I can understand my financial situation at a glance.

#### Acceptance Criteria

1. WHEN the Dashboard is displayed, THE App SHALL display the Total_Balance, the Total_Income, and the Total_Expense.
2. WHEN the Dashboard is displayed, THE App SHALL display the Selected_Month.
3. WHEN the Dashboard is displayed, THE App SHALL display the Spending_Chart.
4. WHEN the Dashboard is displayed, THE App SHALL display a list of the most recent Transactions ordered from newest to oldest by `date`.
5. THE App SHALL compute Total_Balance as Total_Income minus Total_Expense.
6. WHEN a Transaction is added, THE App SHALL update the displayed Total_Balance, Total_Income, and Total_Expense to reflect the added Transaction.
7. WHEN a Transaction is deleted, THE App SHALL update the displayed Total_Balance, Total_Income, and Total_Expense to reflect the deleted Transaction.
8. WHERE monetary values are displayed on the Dashboard, THE App SHALL format each value using the Currency_Formatter.

### Requirement 2: Add Transaction

**User Story:** As a user, I want to add an income or expense with details, so that I can record my financial activity accurately.

#### Acceptance Criteria

1. THE App SHALL present an input form with fields for Transaction_Type, item name, amount, Category, and date.
2. THE App SHALL restrict the Transaction_Type field to the values `income` and `expense`.
3. WHEN the user changes the Transaction_Type, THE App SHALL present the Category options that apply to the selected Transaction_Type.
4. WHEN the user submits the form AND no Transaction_Type is selected, THEN THE App SHALL reject the submission and display a validation message indicating that a Transaction_Type is required.
5. WHEN the user submits the form AND the item name is empty or contains only whitespace, THEN THE App SHALL reject the submission and display a validation message indicating that the item name is required.
6. WHEN the user submits the form AND the amount is not a number greater than 0, THEN THE App SHALL reject the submission and display a validation message indicating that the amount must be greater than 0.
7. WHEN the user submits the form AND no Category is selected, THEN THE App SHALL reject the submission and display a validation message indicating that a Category is required.
8. WHEN the user submits the form AND the date is missing or not a valid calendar date, THEN THE App SHALL reject the submission and display a validation message indicating that a valid date is required.
9. WHEN the user submits the form AND all fields are valid, THEN THE App SHALL create a Transaction containing `id`, `type`, `itemName`, `amount`, `category`, `date`, and `createdAt`.
10. WHEN a Transaction is created, THE App SHALL add the Transaction to the transaction list.
11. WHEN a Transaction is created, THE App SHALL persist the Transaction through the Storage_Module.
12. WHEN a Transaction is created, THE App SHALL update the Dashboard totals and the Spending_Chart to reflect the new Transaction.
13. WHEN a Transaction is successfully created, THE App SHALL reset the input form to its empty default state.

### Requirement 3: Transaction List

**User Story:** As a user, I want to view and delete my transactions, so that I can review my records and remove incorrect entries.

#### Acceptance Criteria

1. THE App SHALL display all stored Transactions, showing for each Transaction its item name, amount, Category, Transaction_Type, and date.
2. WHERE a Transaction is an Expense_Transaction, THE App SHALL display its amount with a visual treatment distinct from the visual treatment used for Income_Transaction amounts.
3. WHEN the user initiates deletion of a Transaction, THE App SHALL require a confirmation interaction before deleting the Transaction.
4. WHEN the user cancels the confirmation interaction, THE App SHALL retain the Transaction unchanged.
5. WHEN the user confirms deletion of a Transaction, THE App SHALL remove the Transaction from the transaction list.
6. WHEN a Transaction is deleted, THE App SHALL persist the updated transaction set through the Storage_Module.
7. WHEN a Transaction is deleted, THE App SHALL update the Total_Balance, the Monthly_Summary values, and the Spending_Chart to reflect the deletion.

### Requirement 4: Transaction Filtering and Search

**User Story:** As a user, I want to search and filter my transactions by name, type, category, and month, so that I can quickly find specific records without changing my overall totals.

#### Acceptance Criteria

1. THE App SHALL provide a Search_Term input, a Transaction_Type filter with the options `all`, `income`, and `expense`, a Category filter, and a month filter for the Transaction_List.
2. WHEN the user enters a Search_Term, THE App SHALL include in the Filtered_Transaction_Set only Transactions whose item name contains the Search_Term using a case-insensitive substring match.
3. WHEN the Transaction_Type filter is set to `income`, THE App SHALL include in the Filtered_Transaction_Set only Income_Transactions.
4. WHEN the Transaction_Type filter is set to `expense`, THE App SHALL include in the Filtered_Transaction_Set only Expense_Transactions.
5. WHEN the Transaction_Type filter is set to `all`, THE App SHALL include Transactions of both Transaction_Type values in the Filtered_Transaction_Set.
6. WHEN the user selects a Category in the Category filter, THE App SHALL include in the Filtered_Transaction_Set only Transactions whose Category matches the selected Category.
7. WHEN the user selects a month in the month filter, THE App SHALL include in the Filtered_Transaction_Set only Transactions whose `date` falls within the selected month.
8. WHERE more than one of the Search_Term, Transaction_Type filter, Category filter, and month filter is active, THE App SHALL include in the Filtered_Transaction_Set only Transactions that satisfy all active Filter_Criteria together as a logical AND.
9. WHEN any element of the Filter_Criteria changes, THE App SHALL recompute the Filtered_Transaction_Set and update the Transaction_List immediately to display the recomputed Filtered_Transaction_Set.
10. THE App SHALL provide a Clear Filters action that resets the Search_Term to empty, the Transaction_Type filter to `all`, the Category filter to no selected Category, and the month filter to its default.
11. WHEN the user activates the Clear Filters action, THE App SHALL display all stored Transactions in the Transaction_List.
12. THE App SHALL apply the Filter_Criteria only to the Transaction_List and SHALL NOT alter the Total_Balance, the Total_Income, the Total_Expense, or the Monthly_Summary as a result of applying the Filter_Criteria.
13. IF Transactions exist AND no Transaction satisfies the active Filter_Criteria, THEN THE App SHALL display the Filtered_Empty_State with the message "No transactions match your filters." in place of the Transaction_List entries.
14. THE App SHALL treat filtering and searching as a read-only operation over the stored Transactions and SHALL NOT modify, delete, or reorder any stored Transaction as a result of applying the Filter_Criteria.

### Requirement 5: Monthly Summary

**User Story:** As a user, I want a summary for a selected month, so that I can understand my income and spending for that specific period.

#### Acceptance Criteria

1. THE App SHALL allow the user to select a Selected_Month.
2. WHEN a Selected_Month is chosen, THE App SHALL compute the Monthly_Summary using only Transactions whose `date` falls within the Selected_Month.
3. WHEN the Monthly_Summary is displayed, THE App SHALL display the Total_Income for the Selected_Month.
4. WHEN the Monthly_Summary is displayed, THE App SHALL display the Total_Expense for the Selected_Month.
5. WHEN the Monthly_Summary is displayed, THE App SHALL display the Net_Balance for the Selected_Month.
6. WHEN the Monthly_Summary is displayed, THE App SHALL display the number of Transactions in the Selected_Month.
7. WHEN the Monthly_Summary is displayed, THE App SHALL display the expense breakdown by Category for the Selected_Month.
8. WHEN the Monthly_Summary is displayed, THE App SHALL display the income breakdown by Category for the Selected_Month.
9. WHEN the Selected_Month changes, THE App SHALL recompute and redisplay the Monthly_Summary for the new Selected_Month.

### Requirement 6: Spending Analysis

**User Story:** As a user, I want a chart of my expenses by category, so that I can see where my money goes.

#### Acceptance Criteria

1. THE App SHALL display a Spending_Chart representing the distribution of Expense_Transaction amounts grouped by Category.
2. THE App SHALL exclude from the Spending_Chart any Category whose total expense in the reported scope is 0.
3. WHEN a Transaction is added, THE App SHALL update the Spending_Chart to reflect the change.
4. WHEN a Transaction is deleted, THE App SHALL update the Spending_Chart to reflect the change.
5. WHEN the Selected_Month changes, THE App SHALL update the Spending_Chart to reflect the Transactions in the new Selected_Month.
6. WHERE the set of Custom_Categories changes in a future version, THE App SHALL update the Spending_Chart to reflect the current Categories.
7. IF there are no Expense_Transactions in the reported scope, THEN THE App SHALL display an Empty_State in place of the Spending_Chart instead of rendering an empty or broken chart.

### Requirement 7: Income Analysis

**User Story:** As a user, I want to analyze my income by category, so that I can understand my sources of income.

#### Acceptance Criteria

1. THE App SHALL display an Income_Analysis representing the distribution of Income_Transaction amounts grouped by Category.
2. WHEN the Income_Analysis is displayed, THE App SHALL display, for each Category with income greater than 0, the Category name and the total income amount for that Category.
3. THE App SHALL exclude from the Income_Analysis any Category whose total income in the reported scope is 0.
4. WHERE monetary values are displayed in the Income_Analysis, THE App SHALL format each value using the Currency_Formatter.
5. WHEN a Transaction is added, THE App SHALL update the Income_Analysis to reflect the change.
6. WHEN a Transaction is deleted, THE App SHALL update the Income_Analysis to reflect the change.
7. IF there are no Income_Transactions in the reported scope, THEN THE App SHALL display an Empty_State in place of the Income_Analysis.

### Requirement 8: Custom Categories

**User Story:** As a user, I want to create and manage custom categories, so that I can organize transactions in a way that fits my needs.

#### Acceptance Criteria

1. THE App SHALL allow the user to create a Custom_Category by providing a Category name and an associated Transaction_Type.
2. WHEN the user creates a Custom_Category AND a Category with the same name already exists for the same Transaction_Type, THEN THE App SHALL reject the creation and display a validation message indicating that a Category with that name already exists.
3. WHEN the user creates a Custom_Category with a valid unique name, THE App SHALL persist the Custom_Category through the Storage_Module.
4. WHEN the user creates a Transaction, THE App SHALL make the applicable Custom_Categories selectable alongside the Default_Categories for the selected Transaction_Type.
5. THE App SHALL display the list of existing Custom_Categories to the user.
6. WHEN the user requests deletion of a Custom_Category AND no existing Transaction references that Custom_Category, THEN THE App SHALL delete the Custom_Category and persist the change through the Storage_Module.
7. IF the user requests deletion of a Custom_Category AND at least one existing Transaction references that Custom_Category, THEN THE App SHALL prevent the deletion and display a message explaining that the Category is in use.
8. WHEN any Category is deleted, THE App SHALL retain all existing Transaction records unchanged.

### Requirement 9: Currency Formatting

**User Story:** As a user, I want amounts shown in my Selected_Currency with locale-appropriate formatting, so that the figures are easy to read.

#### Acceptance Criteria

1. THE App SHALL support a single Selected_Currency chosen by the user from the Supported_Currencies set (USD, EUR, GBP, IDR, JPY, CNY, SGD, AUD, CAD, CHF, MYR, THB, INR, KRW).
2. THE App SHALL use IDR as the default Selected_Currency.
3. WHEN the Currency_Formatter formats a numeric amount, THE App SHALL produce a string using the Selected_Currency and an associated locale via `Intl.NumberFormat` (for example, `formatCurrency(1500, "USD", "en-US")`, `formatCurrency(1500, "EUR", "de-DE")`, `formatCurrency(1500000, "IDR", "id-ID")`).
4. THE Currency_Formatter SHALL NOT hard-code Indonesian locale formatting.
5. THE App SHALL perform all currency formatting through the Currency_Formatter module and SHALL NOT format currency in other modules.
6. WHERE a monetary value is displayed anywhere in the App, including Dashboard totals, the Total_Balance, the Transaction display, the Monthly_Summary, and chart tooltips and labels where currency appears, THE App SHALL format that value using the Currency_Formatter with the Selected_Currency.
7. WHEN the Selected_Currency changes, THE App SHALL keep each Transaction amount as its stored numeric value and SHALL NOT perform any exchange-rate conversion.
8. WHEN the Selected_Currency changes, THE App SHALL preserve all existing stored numeric Transaction amounts unchanged and SHALL change only the display formatting.

### Requirement 10: Data Persistence

**User Story:** As a user, I want my data saved locally, so that it remains available after I refresh or restart the browser.

#### Acceptance Criteria

1. THE App SHALL persist all Transactions and all Custom_Categories using the browser localStorage through the Storage_Module.
2. THE App SHALL route all reads from and writes to localStorage through the Storage_Module and SHALL NOT read or write localStorage from any other module.
3. THE App SHALL store all persisted data in a single Storage_Schema that includes a schema version identifier.
4. WHEN the App starts AND persisted data exists in the Storage_Schema, THE App SHALL load the stored Transactions and Custom_Categories.
5. WHEN the App starts AND no persisted data exists, THE App SHALL initialize an empty valid Storage_Schema.
6. IF the persisted data is missing, unreadable, or does not conform to the expected Storage_Schema, THEN THE App SHALL start with a valid default state and SHALL continue operating without an unhandled error.
7. WHEN the browser is refreshed or restarted, THE App SHALL display the Transactions and Custom_Categories that were previously persisted.

### Requirement 11: Empty State Handling

**User Story:** As a first-time user, I want a friendly message when there is no data, so that I know how to get started and do not see broken visuals.

#### Acceptance Criteria

1. IF there are no Transactions, THEN THE App SHALL display an Empty_State with the message "No transactions yet. Add your first income or expense."
2. IF there are no Transactions, THEN THE App SHALL NOT render a broken or empty Spending_Chart on the Dashboard.
3. WHEN the first Transaction is added, THE App SHALL replace the Empty_State with the populated views.

### Requirement 12: Responsive Design

**User Story:** As a user on any device, I want the app to adapt to my screen, so that it is comfortable to use on desktop, tablet, and mobile.

#### Acceptance Criteria

1. WHILE the App is viewed on a desktop, tablet, or mobile phone screen size, THE App SHALL present a usable layout appropriate to that screen size.
2. WHILE the App is viewed on a mobile phone screen size, THE App SHALL present interactive controls that are operable by touch.
3. WHILE the App is viewed on a mobile phone screen size, THE App SHALL lay out content so that no horizontal scrolling is required to access primary content and controls.

### Requirement 13: Data Backup Future-Readiness

**User Story:** As a maintainer, I want the architecture to be ready for future backup and sync features, so that they can be added later without rewrites.

#### Acceptance Criteria

1. THE App SHALL store all persisted data in a single versioned Storage_Schema accessed only through the Storage_Module, so that CSV export/import, JSON backup/restore, and Google Sheets synchronization can be added in a future version.
2. THE App SHALL NOT implement Google Sheets synchronization in v1.
3. THE App SHALL NOT implement CSV export/import in v1.
4. THE App SHALL NOT implement JSON backup/restore in v1.
5. THE App SHALL isolate persistence behind the Storage_Module so that a future storage backend can be added without changing business logic or UI modules.

### Requirement 14: Privacy

**User Story:** As a privacy-conscious user, I want my financial data to stay on my device, so that my information is not exposed to external servers.

#### Acceptance Criteria

1. THE App SHALL store all financial data only in the user's browser localStorage in v1.
2. THE App SHALL NOT transmit financial data to any external server in v1.
3. THE App SHALL display a clear statement to the user that financial data is stored only in the user's browser and is not sent to external servers.
4. WHERE charts are used, THE App SHALL limit external network usage to loading the Chart.js library from a CDN and SHALL NOT send financial data as part of that request.

### Requirement 15: Accessibility

**User Story:** As a user relying on assistive technology or keyboard navigation, I want accessible controls and content, so that I can use the app effectively.

#### Acceptance Criteria

1. THE App SHALL use semantic HTML elements for its structure and controls.
2. THE App SHALL associate a descriptive label with every input control in the transaction and category forms.
3. THE App SHALL make all interactive controls operable using the keyboard.
4. THE App SHALL provide text and background color combinations that meet a readable contrast level.
5. THE App SHALL give each actionable button a descriptive accessible label indicating its action.
6. WHERE a chart is displayed, THE App SHALL provide an accessible text description of the data represented by the chart.

### Requirement 16: Performance

**User Story:** As a user with many transactions, I want the app to stay fast, so that it remains pleasant to use as my data grows.

#### Acceptance Criteria

1. WHEN the App is loaded, THE App SHALL become interactive without requiring a build step.
2. WHEN a Transaction is added or deleted, THE App SHALL update the affected views without recreating unchanged charts.
3. WHILE at least several thousand Transactions are stored, THE App SHALL remain responsive to user interactions such as adding, deleting, and viewing Transactions.
4. WHEN updating a view, THE App SHALL update only the affected portions of the DOM rather than rebuilding unaffected portions.

### Requirement 17: Document Completeness and Consistency

**User Story:** As a maintainer, I want every feature to have explicit, testable acceptance criteria and consistent terminology, so that the specification can be implemented and verified reliably.

#### Acceptance Criteria

1. THE requirements document SHALL provide explicit acceptance criteria for every feature area described in the Introduction.
2. THE requirements document SHALL use terms consistently as defined in the Glossary.
3. THE requirements document SHALL define every system name used in an acceptance criterion in the Glossary.
4. THE requirements document SHALL remain internally consistent, with no acceptance criterion contradicting another.

### Requirement 18: Currency Selection

**User Story:** As a user, I want to choose my currency in Settings, so that all amounts display in my preferred currency.

#### Acceptance Criteria

1. THE App SHALL provide a Currency_Setting UI in Settings that allows the user to select one Selected_Currency from the Supported_Currencies.
2. WHEN the user selects a currency in the Currency_Setting, THE App SHALL persist the Selected_Currency in localStorage through the Storage_Module in `settings.currency`.
3. WHEN the App starts, THE App SHALL load the persisted Selected_Currency from `settings.currency` through the Storage_Module.
4. IF the persisted Selected_Currency is absent or is not a member of the Supported_Currencies, THEN THE App SHALL use IDR as the Selected_Currency.
5. WHEN the Selected_Currency changes, THE App SHALL update the displayed formatting of the Dashboard totals, the Total_Balance, the Transaction display in the Transaction_List, the Monthly_Summary, and chart tooltips and labels where currency is displayed, using the new Selected_Currency.
6. WHEN the Selected_Currency changes, THE App SHALL NOT modify any stored numeric Transaction amount.
7. THE App SHALL treat the Currency_Setting as a presentation-layer concern and SHALL NOT perform any exchange-rate conversion in response to a Selected_Currency change.

---

## Phase 15 — Authentication Extension

> **Scope note:** Requirements 1–18 above describe the original v1 client-side-only scope
> (LocalStorage, no authentication, no cloud database). Requirements 19–22 below are the
> explicitly approved Phase 15+ extension: optional user authentication via Supabase. The
> extended roadmap is:
>
> - **Phase 15 — Authentication** (Supabase Auth, email/password flows)
> - **Phase 16 — Cloud Database** (Supabase PostgreSQL, per-user data)
> - **Phase 17 — LocalStorage ? Cloud Migration** (controlled data migration)
> - **Phase 18 — Security / Session Hardening**
>
> Phase 15 is additive. All Phase 1–14 functionality remains in place and unchanged.

### Requirement 19 — Authentication

The application SHALL support optional user authentication through Supabase Auth.

#### 19.1 Registration

Users SHALL be able to create an account using email and password.

#### 19.2 Login

Registered users SHALL be able to authenticate using email and password.

#### 19.3 Logout

Authenticated users SHALL be able to sign out.

#### 19.4 Password Reset

Users SHALL be able to request a password reset using their email address.

#### 19.5 Session Persistence

The application SHALL recognize an existing authenticated Supabase session when the application loads.

#### 19.6 Authentication State

The application SHALL be able to determine whether the current user is authenticated.

---

### Requirement 20 — User Identity and Data Isolation

Future cloud-stored financial data SHALL be associated with the authenticated user's immutable
Supabase user ID (`user.id`).

The application SHALL NOT use email addresses as the permanent ownership key.

Future database security policies (Row-Level Security) SHALL enforce that users can only access their
own financial records.

> **Note:** This requirement is architectural. It does not require database implementation in Phase
> 15. It is documented here to constrain how Phase 16 must be designed.

---

### Requirement 21 — Local Data Migration

When cloud storage is introduced (Phase 17), the application SHALL provide a controlled migration
path for existing LocalStorage financial data.

Migration SHALL:

- require explicit user consent before any data is moved
- validate local data before migration begins
- verify successful cloud persistence before deleting local data
- avoid accidental data loss
- handle potential conflicts when cloud data already exists

> **Note:** Migration is NOT implemented in Phase 15.

---

### Requirement 22 — Authentication Privacy and Security

The application SHALL:

- never store plaintext passwords (delegated to Supabase Auth)
- never expose service-role credentials or database passwords in client-side code
- never log authentication tokens
- rely on Supabase Auth for authentication session management
- use secure provider/database rules for future data isolation (Phase 16+)

---

## Requirement Coverage Matrix (Phase 15+)

| Requirement | Description                        | Phase(s)    | Status         |
|-------------|------------------------------------|-------------|----------------|
| 1–18        | Original v1 Finance Tracker        | Phase 1–14  | Implemented    |
| 19          | Authentication                     | Phase 15    | In progress    |
| 20          | User Identity & Data Isolation     | Phase 16    | Not implemented |
| 21          | Local Data Migration               | Phase 17    | Not implemented |
| 22          | Authentication Privacy & Security  | Phase 15–18 | In progress    |