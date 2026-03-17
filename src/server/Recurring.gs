/**
 * Recurring.gs — Recurring Transactions
 *
 * PURPOSE:
 *   Manage a list of transactions that are automatically applied when the user
 *   navigates to a new month (e.g. salary income, rent expense).
 *   Prevents manual re-entry of the same transactions every month.
 *
 * SHEET: Recurring
 * COLUMNS: id | name | amount | type | category
 *
 * TRIGGER: applyRecurringToMonth() is also called by Triggers.gs on the 1st of each month.
 *
 * CALLED BY: client via google.script.run, and Triggers.gs
 */


/**
 * getAllRecurring()
 *
 * TODO: Return all recurring transaction templates as { id, name, amount, type, category }
 * TODO: Cast amount to number
 */
function getAllRecurring() {
  // TODO: Implement
}


/**
 * addRecurring(name, amount, type, category)
 *
 * TODO: Validate — name required, amount > 0, type in ['income','expense','savings']
 * TODO: Append row and return the new recurring object
 */
function addRecurring(name, amount, type, category) {
  // TODO: Implement
}


/**
 * deleteRecurring(recurringId)
 *
 * TODO: Find and delete the row with matching recurringId
 * TODO: Return { success: true }
 */
function deleteRecurring(recurringId) {
  // TODO: Implement
}


/**
 * applyRecurringToMonth(monthKey)
 *
 * TODO: For each recurring transaction, check if a transaction with the same
 *       name and type already exists in Transactions for the given monthKey.
 * TODO: If it does NOT exist, call Transactions.addTransaction() to create it
 *       (with note = 'auto' to mark it as auto-applied).
 * TODO: If it DOES exist, skip it (idempotent — safe to call multiple times).
 * TODO: Return { applied: N, skipped: M } summary
 *
 * NOTE: This is called from two places:
 *   1. Client-side month navigation (via google.script.run) — ensures data exists before render
 *   2. Triggers.gs monthly cron — fires on the 1st of each month automatically
 */
function applyRecurringToMonth(monthKey) {
  // TODO: Implement
}
