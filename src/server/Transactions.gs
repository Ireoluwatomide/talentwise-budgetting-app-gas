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

  // Normalise the incoming monthKey too, in case the caller passes an ISO date.
  var normKey = _normaliseMonthKey(monthKey);

  return getUserRowsByFilter('TRANSACTIONS', function(row) {
    return _normaliseMonthKey(String(row.month_key)) === normKey;
  }).map(_castTransaction);
}

/**
 * getAllTransactions()
 *
 * Returns every transaction across all months.
 * Used by Report tab, multi-month analytics, and getAllMonthSummaries().
 */
function getAllTransactions() {
  return getUserAllRows('Transactions').map(_castTransaction);
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
 *
 * MATCHING STRATEGY (updated):
 *   The auto-credit is now matched by CATEGORY, not by transaction name.
 *   The user selects a savings category (e.g. "Emergency Fund") from the
 *   typed dropdown, and the goal with that same name receives the credit.
 *   This is more reliable than name-matching because the category is
 *   always a known value from the predefined list.
 *
 * This side-effect is safe to call before Savings.gs is implemented — the
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
    month_key: String(monthKey).trim(),   // always store as "YYYY-MM"
    name:      String(name).trim(),
    amount:    parsedAmount,
    type:      normalisedType,
    category:  category ? String(category).trim() : 'Other Expense',
    note:      note     ? String(note).trim()     : ''
  };

  getUserAppendRow('TRANSACTIONS', tx);

  // ── Side-effect: credit savings goal if applicable ───────────────────────
  // Matched by CATEGORY (e.g. "Emergency Fund") rather than by name.
  // The category is the typed dropdown value selected by the user —
  // it is always a known, consistent string, making it a more reliable
  // match key than the free-text transaction name.
  //
  // Guard with typeof so this still works before Savings.gs is deployed.
  if (normalisedType === 'savings' && typeof updateSavingsGoalOnDeposit === 'function') {
    try {
      updateSavingsGoalOnDeposit(tx.category, tx.amount); // ← category, not name
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

  var rowIndex = getUserFindRowIndex('TRANSACTIONS', function(row) {
    return String(row.id) === String(transactionId);
  });

  if (rowIndex === -1) {
    throw new Error('Transactions.gs: Transaction "' + transactionId + '" not found.');
  }

  getUserDeleteRow('TRANSACTIONS', rowIndex);
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

  var normKey = _normaliseMonthKey(monthKey);
  var sheet   = getSheet(getUserSheetName('Transactions'));
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { deleted: 0 };

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var mkIdx   = headers.indexOf('month_key');

  if (mkIdx === -1) {
    throw new Error('Transactions.gs: "month_key" column not found in Transactions sheet.');
  }

  var toDelete = [];
  for (var i = 1; i < data.length; i++) {
    var rawKey = data[i][mkIdx];
    // Normalise the stored key before comparing so ISO dates still match
    if (_normaliseMonthKey(String(rawKey)) === normKey) {
      toDelete.push(i + 1);
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
  return _computeSummary(_normaliseMonthKey(monthKey), txs);
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
    var key = tx.month_key; // already normalised by _castTransaction
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
    var cat = tx.category || 'Other Expense';
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
 * _normaliseMonthKey(raw)
 *
 * Converts any month_key format to "YYYY-MM".
 *
 * Google Sheets auto-converts "2026-03" to a Date cell. SheetHelper reads
 * it back as a JS Date and converts it to ISO: "2026-03-31T23:00:00.000Z".
 * This function extracts just the "YYYY-MM" portion regardless of input format.
 *
 * Handles:
 *   "2026-03"                    → "2026-03"  (already correct, pass through)
 *   "2026-03-31T23:00:00.000Z"   → "2026-03"  (ISO date string)
 *   "2026-03-01T00:00:00.000Z"   → "2026-03"  (ISO date string, start of month)
 *   Date object                  → "2026-03"  (shouldn't happen but guard anyway)
 */
function _normaliseMonthKey(raw) {
  if (!raw) return '';

  var str = String(raw).trim();

  // Already in correct format "YYYY-MM"
  if (/^\d{4}-\d{2}$/.test(str)) return str;

  // ISO date string: "2026-03-31T23:00:00.000Z" or "2026-03-01T00:00:00.000Z"
  // The month stored is always the end-of-month date in WAT (UTC+1), so the
  // ISO UTC string may show the last day of the previous month at 23:00.
  // We parse the date and check both UTC and UTC+1 to get the right month.
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      // Use UTC+1 (Lagos/WAT) to determine the correct month.
      // Add 1 hour to shift from UTC to WAT before extracting month.
      var wat = new Date(d.getTime() + 60 * 60 * 1000);
      var y = wat.getUTCFullYear();
      var m = wat.getUTCMonth() + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    }
  }

  // Fallback: extract first 7 chars if they look like YYYY-MM
  if (str.length >= 7 && /^\d{4}-\d{2}/.test(str)) {
    return str.slice(0, 7);
  }

  return str;
}

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
    month_key: _normaliseMonthKey(String(row.month_key || '')),
    name:      String(row.name      || '').trim(),
    amount:    parseFloat(row.amount) || 0,
    type:      String(row.type      || '').trim().toLowerCase(),
    category:  String(row.category  || 'Other Expense').trim(),
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
