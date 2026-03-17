# Budget Tracker — Google Apps Script App
## Project Overview

A personal finance management web application built on Google Apps Script + Google Sheets.
Scaffolded from the `budget_tracker_ultimate.html` prototype into a full Apps Script project.

## Project Structure

```
budget-tracker/
├── README.md                        ← This file
├── appsscript.json                  ← Apps Script manifest (permissions, web app config)
│
├── src/
│   ├── server/                      ← All server-side Google Apps Script (.gs) files
│   │   ├── Main.gs                  ← doGet() entry point — serves the HTML shell
│   │   ├── Transactions.gs          ← CRUD for transactions
│   │   ├── Goals.gs                 ← Budget goals read/write
│   │   ├── Bills.gs                 ← Bills management + due-date logic
│   │   ├── Savings.gs               ← Savings goals read/write
│   │   ├── Debt.gs                  ← Debt tracker read/write
│   │   ├── NetWorth.gs              ← Net worth items read/write
│   │   ├── Recurring.gs             ← Recurring transactions logic
│   │   ├── Preferences.gs           ← User preferences (currency, dark mode, categories)
│   │   ├── Notifications.gs         ← MailApp bill/budget alert emails
│   │   ├── Triggers.gs              ← Time-based trigger setup (cron jobs)
│   │   ├── CSV.gs                   ← CSV export / import helpers
│   │   └── SheetHelper.gs           ← Low-level Sheets read/write utilities
│   │
│   └── client/                      ← All client-side files (HTML, CSS, JS)
│       ├── screens/                 ← One file per tab/screen in the app
│       │   ├── Overview.html        ← Transaction list + add form + summary metrics
│       │   ├── Charts.html          ← Bar chart + donut chart
│       │   ├── Categories.html      ← Category breakdown with progress bars
│       │   ├── Insights.html        ← Auto-generated spending insights
│       │   ├── Forecast.html        ← 6-month forecast + line chart
│       │   ├── MultiMonth.html      ← 6-month trend bar chart + summary table
│       │   ├── Report.html          ← Full printable PDF budget summary
│       │   ├── Goals.html           ← Monthly budget goals + progress
│       │   ├── Savings.html         ← Savings goals + total saved
│       │   ├── Debt.html            ← Debt tracker with payoff ETA
│       │   ├── NetWorth.html        ← Net worth snapshot (assets vs liabilities)
│       │   ├── Recurring.html       ← Recurring transaction management
│       │   ├── Templates.html       ← 50/30/20 and 70/20/10 budget templates
│       │   ├── Bills.html           ← Bill tracker with due-date alerts
│       │   └── Settings.html        ← Custom categories + danger zone
│       │
│       ├── components/              ← Reusable UI HTML snippets (included via HtmlService)
│       │   ├── Header.html          ← Top bar: month nav, currency selector, net balance
│       │   ├── Tabs.html            ← Tab navigation bar
│       │   ├── AlertBanner.html     ← Over-budget + bill-due alert banners
│       │   └── Metric.html          ← Reusable metric card (label + monospace value)
│       │
│       └── utils/                   ← Shared client-side JavaScript + CSS
│           ├── styles.css.html      ← Master stylesheet: CSS variables, design system, all shared styles
│           └── utils.js.html        ← Shared JS utilities: formatting, toast, server bridge, state
│
└── docs/
    └── ARCHITECTURE.md              ← Summary of the Apps Script architecture decisions
```

## Technology Stack

- **Runtime**: Google Apps Script (V8)
- **Data Store**: Google Sheets (8 named sheets)
- **Hosting**: Google Apps Script Web App URL
- **Auth**: Google OAuth (built-in)
- **Email**: MailApp (100 emails/day free)
- **Charts**: Chart.js (CDN, client-side)
- **Notifications**: Time-Based Triggers (Apps Script)

## Development Workflow

1. Open the Apps Script editor at script.google.com
2. Link the project to a Google Sheet (see `SheetHelper.gs`)
3. Edit `.gs` server files directly in the editor OR sync via clasp CLI
4. Edit client HTML/CSS/JS files and include them via `HtmlService.createTemplateFromFile()`
5. Deploy: Deploy → New Deployment → Web App → Execute as Me → Access: Anyone with link

## Sheet Schema

| Sheet Name     | Purpose                              |
|----------------|--------------------------------------|
| Transactions   | All income, expense, savings entries |
| Goals          | Per-category monthly spending limits |
| Bills          | Recurring bills with due days        |
| SavingsGoals   | Named savings targets + progress     |
| Debts          | Loans/credit cards + payments        |
| NetWorth       | Assets and liabilities snapshot      |
| Recurring      | Auto-applied monthly transactions    |
| Preferences    | Currency, dark mode, custom categories |
