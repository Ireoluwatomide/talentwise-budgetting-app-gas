# Budget Tracker — Setup & Development Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Google Account | Any | Hosts the Apps Script + Google Sheet |
| Node.js | 18+ | Required to run clasp CLI |
| clasp | Latest | Syncs local files ↔ Apps Script editor |
| VS Code | Any | Recommended editor (clasp has a VS Code extension) |

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it **"Budget Tracker Data"**.
3. Create **8 sheet tabs** (click the + at the bottom) with these exact names:

   | Tab Name | Purpose |
      |----------|---------|
   | `Transactions` | All income, expense, savings entries |
   | `Goals` | Per-category monthly spending limits |
   | `Bills` | Recurring bills with due days |
   | `SavingsGoals` | Named savings targets + progress |
   | `Debts` | Loans and credit cards |
   | `NetWorth` | Assets and liabilities |
   | `Recurring` | Auto-applied monthly transactions |
   | `Preferences` | Currency, dark mode, custom categories |

   > **TIP:** Once `initSheets()` in `SheetHelper.gs` is implemented, you can run it
   > from the Apps Script editor to create all tabs + headers automatically.
   > You only need to create the spreadsheet manually first.

4. Copy the spreadsheet URL — you'll need the Sheet ID (the long string between `/d/` and `/edit`).

---

## Step 2 — Create the Apps Script Project

**Option A — Bound script (recommended):**
1. In your Google Sheet, go to **Extensions → Apps Script**.
2. This creates a script project bound to the sheet.
3. Bound scripts get `SpreadsheetApp.getActiveSpreadsheet()` automatically — no Sheet ID needed in code.

**Option B — Standalone script:**
1. Go to [script.google.com](https://script.google.com) → New project.
2. In `SheetHelper.gs`, you'll need to use `SpreadsheetApp.openById('YOUR_SHEET_ID')` instead of `getActiveSpreadsheet()`.

---

## Step 3 — Set Up clasp (Local Development)

```bash
# Install clasp globally
npm install -g @google/clasp

# Enable Apps Script API (required once):
# Go to https://script.google.com/home/usersettings
# Toggle "Google Apps Script API" ON

# Log in
clasp login
# This opens a browser tab — approve the OAuth permissions

# Get your Script ID:
# In the Apps Script editor → Project Settings (gear icon) → Script ID
# Paste it into .clasp.json → "scriptId"

# Push all local files to Apps Script
clasp push

# Verify by opening the editor
clasp open
```

> **Note:** On first push, clasp will upload all `.gs` and `.html` files.
> The Apps Script editor will show them all as flat files — the folder path
> becomes part of the filename (e.g. `src/client/screens/Overview`).

---

## Step 4 — Run One-Time Sheet Initialisation

1. In the Apps Script editor, open `SheetHelper.gs`.
2. Select the function `initSheets` from the function dropdown.
3. Click **▶ Run**.
4. Approve any permission prompts (the script needs Sheets access).
5. Check your Google Sheet — all 8 tabs should now have their header rows.

---

## Step 5 — Install Time-Based Triggers

1. In the Apps Script editor, open `Triggers.gs`.
2. Select `installTriggers` from the function dropdown.
3. Click **▶ Run**.
4. Verify: go to **Triggers** (clock icon in the left sidebar) — you should see 2 triggers:
    - `dailyAlertHandler` — runs daily at 8 AM
    - `monthlyHandler` — runs on day 1 of each month at 6 AM

> **Note:** Run `removeTriggers()` before re-running `installTriggers()` to avoid duplicates.

---

## Step 6 — Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear ⚙ next to "Select type" → choose **Web app**.
3. Fill in:
    - **Description:** `v1.0`
    - **Execute as:** `Me` (your Google account)
    - **Who has access:** `Anyone` (requires Google login) or `Anyone with the link` (public)
4. Click **Deploy**.
5. Copy the Web App URL — this is your app's live URL.

> To update after code changes: `clasp push` → **Deploy → Manage deployments → New version**.

---

## Step 7 — Test the Email Alerts

1. Open `Notifications.gs` in the editor.
2. Select `sendTestEmail` from the dropdown.
3. Click **▶ Run**.
4. Check your Gmail inbox — you should receive a test alert email.

If no email arrives:
- Check **Executions** (left sidebar) for error logs
- Verify MailApp permission was granted during setup

---

## Development Workflow (Day-to-Day)

```bash
# Make changes locally in VS Code

# Push to Apps Script
clasp push

# Test in browser (opens the deployed web app)
clasp open

# Pull any changes made directly in the browser editor
clasp pull
```

---

## File Structure Quick Reference

```
src/server/          ← All business logic (.gs files)
  SheetHelper.gs     ← IMPLEMENT FIRST — all others depend on it
  Preferences.gs     ← IMPLEMENT SECOND — categories/currency needed early
  Transactions.gs    ← Core data module
  Goals.gs           ← Budget limits
  Bills.gs           ← Bill tracking
  Savings.gs         ← Savings goals
  Debt.gs            ← Debt tracker
  NetWorth.gs        ← Net worth
  Recurring.gs       ← Auto transactions
  CSV.gs             ← Import/export
  Notifications.gs   ← Email alerts
  Triggers.gs        ← Cron setup
  Main.gs            ← IMPLEMENT LAST — ties everything together

src/client/
  Index.html                   ← Root page shell (doGet serves this)
  utils/styles.css.html        ← Master stylesheet
  utils/utils.js.html          ← Shared JS (AppState, callServer, fmt, toast...)
  components/Header.html       ← Top bar
  components/Tabs.html         ← Tab strip
  components/AlertBanner.html  ← Alert zones
  components/Metric.html       ← makeMetric() helper
  screens/Overview.html        ← Default tab
  screens/Charts.html
  screens/Categories.html
  screens/Insights.html
  screens/Forecast.html
  screens/MultiMonth.html
  screens/Report.html
  screens/Goals.html
  screens/Savings.html
  screens/Debt.html
  screens/NetWorth.html
  screens/Recurring.html
  screens/Templates.html
  screens/Bills.html
  screens/Settings.html
```

---

## Recommended Implementation Order

Work through the files in this sequence to always have a testable app at each step:

| Step | File(s) | Milestone |
|------|---------|-----------|
| 1 | `SheetHelper.gs` + `initSheets()` | Sheet tabs created with headers |
| 2 | `Preferences.gs` | Categories and currency stored |
| 3 | `Transactions.gs` | Can add/read/delete transactions |
| 4 | `Main.gs` (basic `doGet`) | App loads in browser (blank shell) |
| 5 | `styles.css.html` + `utils.js.html` | Design system + AppState working |
| 6 | `Index.html` + `Header.html` + `Tabs.html` | Header and tabs render |
| 7 | `Overview.html` | Transactions list + add form working |
| 8 | `Goals.gs` + `Goals.html` | Budget goals + progress bars |
| 9 | `Bills.gs` + `Bills.html` + `AlertBanner.html` | Bill alerts firing |
| 10 | `Charts.html` | Bar + donut charts rendering |
| 11 | `Savings.gs` + `Savings.html` | Savings goals |
| 12 | `Debt.gs` + `Debt.html` | Debt tracker |
| 13 | `NetWorth.gs` + `NetWorth.html` | Net worth snapshot |
| 14 | `Recurring.gs` + `Recurring.html` | Auto transactions |
| 15 | `CSV.gs` | Export + import working |
| 16 | `MultiMonth.html` + `Forecast.html` | Multi-month charts |
| 17 | `Categories.html` + `Insights.html` | Analytics tabs |
| 18 | `Report.html` | Printable report |
| 19 | `Templates.html` + `Settings.html` | Budget templates + settings |
| 20 | `Notifications.gs` + `Triggers.gs` | Email alerts + cron jobs |

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| `SpreadsheetApp.getActiveSpreadsheet()` returns null | Script is standalone, not bound | Use `openById()` or bind to the sheet |
| `google.script.run` silently fails | Server function threw an exception | Add `.withFailureHandler(console.error)` temporarily |
| Charts don't render | Canvas not visible when `renderCharts()` called | Ensure 50ms delay in `switchTab()` before calling chart render |
| Duplicate triggers | `installTriggers()` run more than once | Run `removeTriggers()` first, then `installTriggers()` |
| `include()` file not found | Filename mismatch (clasp path vs Apps Script name) | Check exact filename in Apps Script editor matches the string in `include()` |
| CSV import fails silently | Malformed CSV or wrong column order | Check browser console + Apps Script Executions log |
| Dark mode flickers on load | AppState.darkMode applied after first render | Apply `.dark` class in the boot script before calling `renderAll()` |

---

## Phase 2 — Migration to React + Supabase

When you're ready to migrate (see Architecture doc):

1. All server function signatures (`addTransaction`, `getMonthSummary`, etc.) map directly to Supabase SDK calls.
2. The client screen files (`Overview.html`, etc.) port directly to React components — the logic is identical, only `callServer()` is replaced with `supabase.from().insert()` etc.
3. `AppState` becomes a Zustand store.
4. `showToast()` can be replaced with a proper toast library (react-hot-toast, sonner).
5. Chart.js stays — it works in React with a `useEffect` + `useRef` pattern.