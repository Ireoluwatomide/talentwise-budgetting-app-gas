/**
 * Transactions.gs — Transaction CRUD
 *
 * PURPOSE:
 *   All server-side logic for reading, adding, and deleting transactions.
 *   Transactions are the core data unit: every income, expense, and savings deposit
 *   is stored as a row in the Transactions sheet.
 *
 * SHEET: Transactions
 * COLUMNS: id | month_key | name | amount | type | category | note
 *
 * month_key format: "YYYY-MM" (e.g. "2026-03")
 *   Used to filter transactions to a specific month without date parsing.
 *
 * CALLED BY: client via google.script.run.<functionName>(args)
 */


/**
 * getTransactionsByMonth(monthKey)
 *
 * TODO: Return all transactions for the given monthKey as an array of objects.
 * TODO: Use SheetHelper.getRowsByFilter() filtering where row.month_key === monthKey
 * TODO: Sort by insertion order (sheet row order) — no additional sorting needed
 * TODO: Return empty array if no transactions exist for the month
 */
function getTransactionsByMonth(monthKey) {
  // TODO: Implement
}


/**
 * getAllTransactions()
 *
 * TODO: Return every transaction across all months.
 *       Used by the Report tab and multi-month analytics.
 * TODO: Use SheetHelper.getAllRows(SHEET_NAMES.TRANSACTIONS)
 */
function getAllTransactions() {
  // TODO: Implement
}


/**
 * addTransaction(monthKey, name, amount, type, category, note)
 *
 * TODO: Validate inputs — name and amount are required; type must be 'income'|'expense'|'savings'
 * TODO: Generate a new id via SheetHelper.generateId()
 * TODO: Append a new row to the Transactions sheet via SheetHelper.appendRow()
 * TODO: If type === 'savings', call Savings.gs → updateSavingsGoalOnDeposit(name, amount)
 *       to credit the matching savings goal automatically
 * TODO: Return the newly created transaction object (with id) so the client can update state
 */
function addTransaction(monthKey, name, amount, type, category, note) {
  // TODO: Implement
}


/**
 * deleteTransaction(transactionId)
 *
 * TODO: Find the sheet row with the matching id
 * TODO: Delete that row via SheetHelper.deleteRow()
 * TODO: Return { success: true } or throw a descriptive error
 */
function deleteTransaction(transactionId) {
  // TODO: Implement
}


/**
 * getMonthSummary(monthKey)
 *
 * TODO: Return aggregated stats for the month — used by the Overview metrics row:
 *         { income, expenses, savings, balance }
 *       income  = sum of all type:'income' transactions
 *       expenses = sum of all type:'expense' transactions
 *       savings = sum of all type:'savings' transactions
 *       balance = income - expenses - savings
 *
 * TODO: Use getTransactionsByMonth() and reduce over the result
 */
function getMonthSummary(monthKey) {
  // TODO: Implement
}


/**
 * getAllMonthSummaries()
 *
 * TODO: Return an array of { monthKey, income, expenses, savings, balance } for every
 *       month that has at least one transaction.
 *       Used by Multi-Month, Report, Forecast, and Insights tabs.
 *
 * TODO: Group getAllTransactions() by month_key, then compute stats per group
 */
function getAllMonthSummaries() {
  // TODO: Implement
}


/**
 * getCategoryBreakdown(monthKey)
 *
 * TODO: Return spending by category for the given month, as an array of
 *         { category, amount, percentOfTotal }
 *       Only include type:'expense' transactions.
 * TODO: Sort descending by amount
 */
function getCategoryBreakdown(monthKey) {
  // TODO: Implement
}


/**
 * importTransactionsFromCSV(csvString, monthKey)
 *
 * TODO: Parse the CSV string (comma-separated, first row = headers)
 * TODO: For each valid data row, call addTransaction() with mapped fields
 * TODO: Return { imported: N, errors: [...] } summary
 * TODO: Delegate to CSV.gs for parsing logic — keep this function thin
 */
function importTransactionsFromCSV(csvString, monthKey) {
  // TODO: Delegate to CSV.gs parseCSV() then loop addTransaction()
}
