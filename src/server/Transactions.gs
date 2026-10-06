/**
 * Transactions.gs — Transaction CRUD
 *
 * CHANGES (recurring enhancement):
 *   - _castTransaction() now includes recurring_id field
 *   - This allows the client to identify auto-applied transactions via
 *     tx.recurring_id and render the AUTO badge in Overview
 *   - All other logic unchanged from savings redesign version
 *
 * NOTE: addTransaction() itself is unchanged — the recurring_id column is
 * written by Recurring.gs _addTransactionWithRecurringId() after calling
 * addTransaction(), patching the cell directly. This keeps addTransaction()
 * as a pure write with no recurring awareness.
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const VALID_TYPES = ['income', 'expense', 'savings'];


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getTransactionsByMonth(monthKey)
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
 */
function getAllTransactions() {
  return getUserAllRows('Transactions').map(_castTransaction);
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addTransaction(monthKey, name, amount, type, category, note)
 *
 * Pure write — no side effects. recurring_id is patched separately by
 * Recurring.gs when the transaction originates from a template.
 */
function addTransaction(monthKey, name, amount, type, category, note) {
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

  var tx = {
    id:           generateId(),
    month_key:    String(monthKey).trim(),
    name:         String(name).trim(),
    amount:       parsedAmount,
    type:         normalisedType,
    category:     category ? String(category).trim() : 'Other Expense',
    note:         note     ? String(note).trim()     : '',
    recurring_id: ''   // populated by Recurring.gs when applicable
  };

  getUserAppendRow('TRANSACTIONS', tx);
  return tx;
}

/**
 * deleteTransaction(transactionId)
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

function importTransactionsFromCSV(csvString, monthKey) {
  if (!csvString || !monthKey) {
    throw new Error('Transactions.gs: csvString and monthKey are both required.');
  }
  return _importFromCSV(csvString, monthKey);
}

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

function _normaliseMonthKey(raw) {
  if (!raw) return '';

  var str = String(raw).trim();

  if (/^\d{4}-\d{2}$/.test(str)) return str;

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
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
 *
 * CHANGED: now includes recurring_id field so the client can identify
 * auto-applied transactions and render the AUTO badge.
 */
function _castTransaction(row) {
  return {
    id:           String(row.id          || '').trim(),
    month_key:    _normaliseMonthKey(String(row.month_key || '')),
    name:         String(row.name        || '').trim(),
    amount:       parseFloat(row.amount) || 0,
    type:         String(row.type        || '').trim().toLowerCase(),
    category:     String(row.category    || 'Other Expense').trim(),
    note:         String(row.note        || '').trim(),
    recurring_id: String(row.recurring_id|| '').trim()  // NEW
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
