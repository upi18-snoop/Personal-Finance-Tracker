# Product Overview

## What This Is
Personal Finance Tracker is a simple, modern, mobile-friendly web application for
managing personal finances. Users record income and expenses, monitor their
balance, analyze spending by category, and review monthly financial summaries.

The application is built for public use and is structured to be hosted on GitHub
Pages or any other static hosting service. The first version runs entirely on the
client side with no backend.

## Core Features (v1)
- Record income and expense transactions
- Track total balance (Total Income - Total Expense)
- Categorize transactions using default and custom categories
- Analyze spending by category
- Review monthly financial summaries
- Persist all data locally so it survives browser refresh and restart

## Target Users
First-time and everyday users who want a fast, readable, no-friction way to track
money. No installation, no account, no server required. Open the hosted site and
start using it.

## Product Principles
- Simple, clean, modern, responsive, mobile-friendly interface
- Easy for first-time users; usable on desktop and mobile browsers
- Prioritize fast interaction and readability
- Avoid unnecessary animations and complicated interactions
- Handle empty states gracefully
- Validate all user input
- Must remain functional offline after the initial page load (except loading the
  Chart.js library from a CDN, if used)

## Data Integrity Rules
- Never delete historical transaction data when a category is deleted
- Custom categories may only be deleted if no existing transaction uses them
- All transactions and custom categories must persist after the browser closes

## Explicitly Out of Scope for v1
These are future possibilities and must NOT be built or allowed to complicate v1
unless explicitly requested:
- Google Sheets synchronization
- CSV export/import
- JSON backup/restore
- Cloud storage
- Authentication
- Additional advanced financial reports
