# Technology & Constraints

## Allowed Technology (v1)
Use ONLY the following:
- HTML5
- CSS3
- Vanilla JavaScript (ES modules where appropriate)
- Browser Local Storage API
- Chart.js (only if charts are needed)

## Forbidden Technology (v1)
Do NOT use any of the following:
- React, Vue, Angular, Svelte
- Node.js backend
- PHP
- Any database server
- Any authentication server
- Any backend framework

The first version MUST work entirely on the client side.

## Deployment
- Must be deployable as a static website (GitHub Pages or similar).
- No build step should be required to run it; opening the hosted site must work.
- Users must not need to install anything.
- No backend server may be required.
- After the initial page load, the app must work offline. The only permitted
  network dependency is loading Chart.js from a CDN if charts are used.

## Data Storage Rules
- Use localStorage for the first version.
- Do NOT touch localStorage directly across the app. Route ALL reads and writes
  through a single dedicated storage module (storage.js).
- Use a single versioned storage structure so future migration to another storage
  backend is possible.
- Keep localStorage data backward-compatible where possible.
- All transactions and custom categories must persist across refresh and restart.

## Financial Model
Every transaction MUST contain these fields:
- id
- type          (either "income" or "expense")
- itemName
- amount
- category
- date
- createdAt

Balance calculation:
    Total Balance = Total Income - Total Expense

## Categories
Provide these default categories.

Expense defaults:
- Food, Transport, Fun, Bills, Shopping, Health, Other

Income defaults:
- Salary, Freelance, Business, Investment, Gift, Other

Rules:
- Users can create custom categories.
- Users can delete a custom category ONLY if no existing transaction uses it.
- Deleting a category must NEVER delete historical transaction data.

## Browser Support
Test and support modern versions of:
- Chrome, Firefox, Edge, Safari

Ensure the UI works on mobile screen sizes.
