/**
 * Transactions.gs — Transaction CRUD
 *
 * PURPOSE:
 *   All server-side logic for reading, adding, and deleting transactions.
 *   Transactions are the core data unit — every income, expense, and savings
 *   deposit is stored as a row in the Transactions sheet.
 *
 * SHEET: Transactions
 * COLUMNS: id | month_key | name | amount | type | category | note
 *
 * month_key format: "YYYY-MM" (e.g. "2026-03")
 *   Used to filter transactions to a specific month without full date parsing.
 *
 * CALLED BY:
 *   - Client via google.script.run.<functionName>(args)
 *   - Recurring.gs → addTransaction() when applying recurring items
 *   - Main.gs      → getTransactionsByMonth() + getAllTransactions() in getBootstrapData()
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const VALID_TYPES = ['income', 'expense', 'savings'];


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getTransactionsByMonth(monthKey)
 *
 * Returns all transactions for a given month as an array of objects.
 * Preserves insertion order (sheet row order) — newest-first reversal
 * is handled client-side in renderOverview(), not here.
 *
 * amount is cast to a number — Sheets can return numeric strings
 * depending on cell formatting.
 */
function getTransactionsByMonth(monthKey) {
  if (!monthKey) throw new Error('Transactions.gs: monthKey is required.');

  return getRowsByFilter(SHEET_NAMES.TRANSACTIONS, function(row) {
    return String(row.month_key).trim() === String(monthKey).trim();
  }).map(_castTransaction);
}

/**
 * getAllTransactions()
 *
 * Returns every transaction across all months.
 * Used by Report tab, multi-month analytics, and getAllMonthSummaries().
 */
function getAllTransactions() {
  return getAllRows(SHEET_NAMES.TRANSACTIONS).map(_castTransaction);
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addTransaction(monthKey, name, amount, type, category, note)
 *
 * Validates inputs, writes a new row, and returns the created transaction
 * object (including its generated id) so the client can push it into
 * AppState without a second server round-trip.
 *
 * Side-effect: if type === 'savings', calls updateSavingsGoalOnDeposit()
 * in Savings.gs to automatically credit the matching savings goal.
 * This is safe to call even before Savings.gs is implemented — the
 * function reference is guarded with a typeof check.
 */
function addTransaction(monthKey, name, amount, type, category, note) {
  // ── Validation ──────────────────────────────────────────────────────────
  if (!monthKey || !String(monthKey).match(/^\d{4}-\d{2}$/)) {
    throw new Error('Transactions.gs: monthKey must be in YYYY-MM format (e.g. "2026-03").');
  }
  if (!name || String(name).trim() === '') {
    throw new Error('Transactions.gs: Transaction name is required.');
  }

  var parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Transactions.gs: Amount must be a positive number.');
  }

  var normalisedType = String(type).trim().toLowerCase();
  if (VALID_TYPES.indexOf(normalisedType) === -1) {
    throw new Error(
      'Transactions.gs: type must be one of: ' + VALID_TYPES.join(', ') +
      '. Got: "' + type + '".'
    );
  }

  // ── Build the new row object ─────────────────────────────────────────────
  var tx = {
    id:        generateId(),
    month_key: String(monthKey).trim(),
    name:      String(name).trim(),
    amount:    parsedAmount,
    type:      normalisedType,
    category:  category ? String(category).trim() : 'Other',
    note:      note     ? String(note).trim()     : ''
  };

  appendRow(SHEET_NAMES.TRANSACTIONS, tx);

  // ── Side-effect: credit savings goal if applicable ───────────────────────
  // Guard with typeof so this still works before Savings.gs is deployed.
  if (normalisedType === 'savings' && typeof updateSavingsGoalOnDeposit === 'function') {
    try {
      updateSavingsGoalOnDeposit(tx.name, tx.amount);
    } catch (e) {
      // Log but do NOT rethrow — the transaction was saved successfully.
      // A savings goal matching failure should not roll back the transaction.
      Logger.log('Transactions.gs: updateSavingsGoalOnDeposit failed (non-fatal): ' + e.message);
    }
  }

  return tx;
}

/**
 * deleteTransaction(transactionId)
 *
 * Finds the row by id and deletes it.
 * Throws a clear error if the id is not found — helps surface bugs
 * where the client sends a stale id.
 */
function deleteTransaction(transactionId) {
  if (!transactionId) throw new Error('Transactions.gs: transactionId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.TRANSACTIONS, function(row) {
    return String(row.id) === String(transactionId);
  });

  if (rowIndex === -1) {
    throw new Error('Transactions.gs: Transaction "' + transactionId + '" not found.');
  }

  deleteRow(SHEET_NAMES.TRANSACTIONS, rowIndex);
  return { success: true };
}

/**
 * clearMonthTransactions(monthKey)
 *
 * Deletes ALL transactions for a given month.
 * Called by the client's "Clear Current Month" action in Settings.
 *
 * Deletes rows from the bottom up to avoid index-shift bugs —
 * deleteRow() shifts all rows below it up by 1, so iterating
 * top-down with a stale index array would skip rows or hit wrong ones.
 *
 * Returns { deleted: N } so the client can confirm how many were removed.
 */
function clearMonthTransactions(monthKey) {
  if (!monthKey) throw new Error('Transactions.gs: monthKey is required.');

  var sheet   = getSheet(SHEET_NAMES.TRANSACTIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { deleted: 0 };

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var mkIdx   = headers.indexOf('month_key');

  if (mkIdx === -1) {
    throw new Error('Transactions.gs: "month_key" column not found in Transactions sheet.');
  }

  // Collect matching row indices (1-indexed sheet rows), reversed for safe deletion.
  var toDelete = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][mkIdx]).trim() === String(monthKey).trim()) {
      toDelete.push(i + 1); // +1: array is 0-indexed, sheet rows are 1-indexed
    }
  }

  // Delete bottom-up so row indices remain valid as we go.
  toDelete.reverse().forEach(function(rowIdx) {
    sheet.deleteRow(rowIdx);
  });

  return { deleted: toDelete.length };
}


// ─── AGGREGATIONS ─────────────────────────────────────────────────────────────

/**
 * getMonthSummary(monthKey)
 *
 * Returns aggregated stats for a single month.
 * Used by the Overview metric cards and getBootstrapData().
 *
 * Return shape: { income, expenses, savings, balance }
 *   balance = income - expenses - savings
 */
function getMonthSummary(monthKey) {
  var txs = getTransactionsByMonth(monthKey);
  return _computeSummary(monthKey, txs);
}

/**
 * getAllMonthSummaries()
 *
 * Returns one summary object per distinct month_key that has at least
 * one transaction, sorted chronologically (oldest first).
 *
 * Used by: Multi-Month chart, Forecast tab, Report tab, Insights tab.
 *
 * Return shape: [{ monthKey, income, expenses, savings, balance }, ...]
 */
function getAllMonthSummaries() {
  var all = getAllTransactions();

  // Group transactions by month_key.
  var groups = {};
  all.forEach(function(tx) {
    var key = tx.month_key;
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  });

  // Compute summary per group and sort chronologically.
  return Object.keys(groups)
    .sort() // "YYYY-MM" strings sort correctly as plain strings
    .map(function(key) {
      return _computeSummary(key, groups[key]);
    });
}

/**
 * getCategoryBreakdown(monthKey)
 *
 * Returns expense spending grouped by category for a given month.
 * Only type:'expense' transactions are included — income and savings
 * are excluded from the breakdown.
 *
 * Return shape (sorted descending by amount):
 *   [{ category, amount, percentOfTotal }, ...]
 */
function getCategoryBreakdown(monthKey) {
  var txs = getTransactionsByMonth(monthKey);

  // Sum expenses per category.
  var totals = {};
  var grandTotal = 0;

  txs.forEach(function(tx) {
    if (tx.type !== 'expense') return;
    var cat = tx.category || 'Other';
    totals[cat] = (totals[cat] || 0) + tx.amount;
    grandTotal  += tx.amount;
  });

  if (grandTotal === 0) return [];

  return Object.keys(totals)
    .map(function(cat) {
      return {
        category:       cat,
        amount:         totals[cat],
        percentOfTotal: Math.round((totals[cat] / grandTotal) * 100)
      };
    })
    .sort(function(a, b) { return b.amount - a.amount; }); // descending
}


// ─── CSV IMPORT BRIDGE ────────────────────────────────────────────────────────

/**
 * importTransactionsFromCSV(csvString, monthKey)
 *
 * Thin bridge to CSV.gs — keeps this file focused on CRUD logic.
 * Parses the CSV string and calls addTransaction() for each valid row.
 *
 * Returns { imported: N, errors: [...] } summary.
 * Implemented fully in Phase 6 (feat/csv-export-import).
 * Stub is here so getBootstrapData() can reference the function signature.
 */
function importTransactionsFromCSV(csvString, monthKey) {
  // Full implementation in Branch 16 (feat/csv-export-import).
  // CSV.gs parseCSV() + validateImportRow() will be called here.
  throw new Error('importTransactionsFromCSV: Not yet implemented. Coming in Phase 6.');
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castTransaction(row)
 *
 * Normalises a raw row object from getAllRows():
 *   - Casts amount to a float
 *   - Trims all string fields
 *   - Ensures note defaults to '' not null/undefined
 *
 * Private — only called within this file.
 */
function _castTransaction(row) {
  return {
    id:        String(row.id        || '').trim(),
    month_key: String(row.month_key || '').trim(),
    name:      String(row.name      || '').trim(),
    amount:    parseFloat(row.amount) || 0,
    type:      String(row.type      || '').trim().toLowerCase(),
    category:  String(row.category  || 'Other').trim(),
    note:      String(row.note      || '').trim()
  };
}

/**
 * _computeSummary(monthKey, txs)
 *
 * Reduces a transactions array into a summary object.
 * Extracted to avoid duplicating the reduce logic between
 * getMonthSummary() and getAllMonthSummaries().
 */
function _computeSummary(monthKey, txs) {
  var income   = 0;
  var expenses = 0;
  var savings  = 0;

  txs.forEach(function(tx) {
    var amt = parseFloat(tx.amount) || 0;
    if      (tx.type === 'income')  income   += amt;
    else if (tx.type === 'expense') expenses += amt;
    else if (tx.type === 'savings') savings  += amt;
  });

  return {
    monthKey: monthKey,
    income:   income,
    expenses: expenses,
    savings:  savings,
    balance:  income - expenses - savings
  };
}