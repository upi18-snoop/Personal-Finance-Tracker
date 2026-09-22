# Project Structure & Architecture

## Recommended Directory Layout
```
index.html
src/
  css/
    styles.css
  js/
    app.js           # App bootstrap / entry point, wires modules together
    storage.js       # ONLY module that touches localStorage; versioned schema
    transactions.js  # Transaction business logic (create, list, totals)
    categories.js    # Category business logic (defaults, custom, delete rules)
    dashboard.js     # Balance + summary UI rendering
    charts.js        # Chart.js integration (spending by category, etc.)
    reports.js       # Monthly financial summaries
    utils.js         # Shared helpers (id generation, formatting, validation)
```

## Architecture Principles
- Modular Vanilla JavaScript. Use ES modules where appropriate.
- Separate concerns cleanly:
  - Business logic (transactions, categories, reports)
  - UI rendering (dashboard, charts)
  - Storage (storage.js only)
- Keep modules small and focused; each module owns one responsibility.
- Do not duplicate business logic. Compute balances/totals in one place.
- All persistence goes through storage.js. No other module reads or writes
  localStorage directly.

## Layering
```
UI (dashboard.js, charts.js, reports.js)
        |
Business logic (transactions.js, categories.js)
        |
Storage (storage.js)  <-- only this layer talks to localStorage
```
UI calls business logic; business logic calls storage. Do not skip layers.

## Development Rules
Before implementing a major feature:
1. Understand the current architecture first.
2. Avoid unnecessary changes to unrelated files.
3. Keep modules small and focused.
4. Do not duplicate business logic.
5. Validate all user input.
6. Handle empty states gracefully.
7. Keep localStorage data backward-compatible where possible.
8. Test in modern Chrome, Firefox, Edge, and Safari.
9. Ensure the UI works on mobile screen sizes.

## Future Extensibility (design for, do not build yet)
Structure the code so these can be added later WITHOUT rewrites, but do NOT
implement them in v1 unless explicitly requested:
- Google Sheets synchronization
- CSV export/import
- JSON backup/restore
- Cloud storage
- Authentication
- Additional financial reports

The versioned storage schema and the isolated storage module are the main
enablers for this future work. Keep them clean.
