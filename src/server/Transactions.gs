/**
 * Transactions.gs — Transaction CRUD
 *
 * CHANGE FROM PREVIOUS VERSION:
 *   The savings auto-credit side-effect has been removed from addTransaction().
 *   Previously, every savings-type transaction would call
 *   updateSavingsGoalOnDeposit() to try to match the transaction category
 *   against a goal name. This caused goal credits to fire even when the user
 *   was not intentionally topping up a specific goal.
 *
 *   All goal crediting now goes through Savings.gs topUpSavingsGoal(), which
 *   calls addTransaction() internally. addTransaction() is now a pure
 *   write-to-sheet function with no side effects.
 *
 * SHEET: Transactions
 * COLUMNS: id | month_key | name | amount | type | category | note
 *
 * CALLED BY:
 *   - Client via google.script.run
 *   - Savings.gs  → topUpSavingsGoal() (replaces the old side-effect pattern)
 *   - Recurring.gs → applyRecurringToMonth()
 *   - Bills.gs    → toggleBillPaid()
 *   - Main.gs     → getTransactionsByMonth() + getAllTransactions() in getBootstrapData()
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
 */
function getTransactionsByMonth(monthKey) {
  if (!monthKey) throw new Error('Transactions.gs: monthKey is required.');

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
 * Validates inputs and writes a new transaction row.
 * Returns the created transaction object.
 *
 * This function has NO side effects on savings goals. All goal crediting
 * is handled by Savings.gs topUpSavingsGoal() which calls this function
 * after performing its own validation and capping logic.
 *
 * When called from the Overview tab with type='savings', the client must
 * pass a goalId and route through topUpSavingsGoal() instead of calling
 * addTransaction() directly. See Overview.html for the updated flow.
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
    category:  category ? String(category).trim() : 'Other Expense',
    note:      note     ? String(note).trim()     : ''
  };

  getUserAppendRow('TRANSACTIONS', tx);

  // ── NOTE: No savings side-effect here. ──────────────────────────────────
  // If type === 'savings', the caller (topUpSavingsGoal) has already
  // handled goal crediting before calling addTransaction().

  return tx;
}

/**
 * deleteTransaction(transactionId)
 * Removes the transaction row matching transactionId.
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
 * Deletes all transactions for the given month.
 * Returns { deleted: N }.
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
    if (_normaliseMonthKey(String(rawKey)) === normKey) {
      toDelete.push(i + 1);
    }
  }

  toDelete.reverse().forEach(function(rowIdx) {
    sheet.deleteRow(rowIdx);
  });

  return { deleted: toDelete.length };
}


// ─── AGGREGATIONS ─────────────────────────────────────────────────────────────

/**
 * getMonthSummary(monthKey)
 * Returns income / expenses / savings / balance totals for a single month.
 */
function getMonthSummary(monthKey) {
  var txs = getTransactionsByMonth(monthKey);
  return _computeSummary(_normaliseMonthKey(monthKey), txs);
}

/**
 * getAllMonthSummaries()
 * Returns summary objects for every month that has transactions, sorted oldest first.
 */
function getAllMonthSummaries() {
  var all = getAllTransactions();

  var groups = {};
  all.forEach(function(tx) {
    var key = tx.month_key;
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  });

  return Object.keys(groups)
    .sort()
    .map(function(key) {
      return _computeSummary(key, groups[key]);
    });
}

/**
 * getCategoryBreakdown(monthKey)
 *
 * Returns expense totals grouped by category for the given month,
 * sorted descending by amount. Used by Goals.gs checkBudgetAlerts().
 */
function getCategoryBreakdown(monthKey) {
  var txs = getTransactionsByMonth(monthKey);

  var totals     = {};
  var grandTotal = 0;

  txs.forEach(function(tx) {
    if (tx.type !== 'expense') return;
    var cat     = tx.category || 'Other Expense';
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
    .sort(function(a, b) { return b.amount - a.amount; });
}


// ─── CSV IMPORT ───────────────────────────────────────────────────────────────

/**
 * importTransactionsFromCSV(csvString, monthKey)
 *
 * Parses the CSV string (built by CSV.gs parseCSV) and inserts each valid
 * row as a transaction. Delegates all parsing and validation to CSV.gs.
 *
 * Returns { imported: N, skipped: M, errors: [...] }
 */
function importTransactionsFromCSV(csvString, monthKey) {
  if (!csvString || !monthKey) {
    throw new Error('Transactions.gs: csvString and monthKey are both required.');
  }
  // Delegate to CSV.gs
  return _importFromCSV(csvString, monthKey);
}

// Internal alias called by CSV.gs (avoids circular reference issues)
function _importFromCSV(csvString, monthKey) {
  var rows     = parseCSV(csvString);
  var imported = 0;
  var skipped  = 0;
  var errors   = [];

  rows.forEach(function(row, i) {
    var validation = validateImportRow(row);

    if (!validation.valid) {
      skipped++;
      errors.push('Row ' + (i + 2) + ': ' + validation.reason);
      return;
    }

    var d = validation.data;

    try {
      addTransaction(monthKey, d.name, d.amount, d.type, d.category, d.note);
      imported++;
    } catch (e) {
      skipped++;
      errors.push('Row ' + (i + 2) + ': ' + e.message);
    }
  });

  Logger.log(
    'Transactions.gs: importTransactionsFromCSV(' + monthKey + ') — ' +
    'imported: ' + imported + ', skipped: ' + skipped
  );

  return { imported: imported, skipped: skipped, errors: errors };
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _normaliseMonthKey(raw)
 *
 * Converts any month_key representation to YYYY-MM.
 * Handles ISO date strings that Google Sheets may produce when reading
 * a cell that was auto-converted from "2026-03" to a Date object.
 */
function _normaliseMonthKey(raw) {
  if (!raw) return '';

  var str = String(raw).trim();

  if (/^\d{4}-\d{2}$/.test(str)) return str;

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      // Apply WAT (UTC+1) offset to avoid off-by-one on midnight boundaries
      var wat = new Date(d.getTime() + 60 * 60 * 1000);
      var y   = wat.getUTCFullYear();
      var m   = wat.getUTCMonth() + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    }
  }

  if (str.length >= 7 && /^\d{4}-\d{2}/.test(str)) {
    return str.slice(0, 7);
  }

  return str;
}

/**
 * _castTransaction(row)
 * Normalises a raw sheet row into a typed transaction object.
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
 * Aggregates a flat array of transactions into income/expenses/savings/balance totals.
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
