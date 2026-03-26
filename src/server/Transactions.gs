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
 * Validates inputs, writes a new row, and returns the created transaction object.
 *
 * SAVINGS SIDE-EFFECT (updated):
 *   Now passes tx.id, monthKey, and note to updateSavingsGoalOnDeposit() so the
 *   SavingsHistory row has a full transaction reference for the history panel.
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

  // ── Side-effect: credit savings goal if applicable ───────────────────────
  // Now passes tx.id and monthKey so SavingsHistory can reference the transaction.
  if (normalisedType === 'savings' && typeof updateSavingsGoalOnDeposit === 'function') {
    try {
      updateSavingsGoalOnDeposit(tx.category, tx.amount, tx.id, tx.month_key, tx.note);
    } catch (e) {
      Logger.log('Transactions.gs: updateSavingsGoalOnDeposit failed (non-fatal): ' + e.message);
    }
  }

  return tx;
}

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

function getMonthSummary(monthKey) {
  var txs = getTransactionsByMonth(monthKey);
  return _computeSummary(_normaliseMonthKey(monthKey), txs);
}

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

function getCategoryBreakdown(monthKey) {
  var txs = getTransactionsByMonth(monthKey);

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
    .sort(function(a, b) { return b.amount - a.amount; });
}


// ─── CSV IMPORT BRIDGE ────────────────────────────────────────────────────────

function importTransactionsFromCSV(csvString, monthKey) {
  throw new Error('importTransactionsFromCSV: Not yet implemented. Coming in Phase 6.');
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

function _normaliseMonthKey(raw) {
  if (!raw) return '';

  var str = String(raw).trim();

  if (/^\d{4}-\d{2}$/.test(str)) return str;

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      var wat = new Date(d.getTime() + 60 * 60 * 1000);
      var y = wat.getUTCFullYear();
      var m = wat.getUTCMonth() + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    }
  }

  if (str.length >= 7 && /^\d{4}-\d{2}/.test(str)) {
    return str.slice(0, 7);
  }

  return str;
}

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
