/**
 * Debt.gs — Debt Tracker (Overhauled)
 *
 * IMPROVEMENTS FROM PREVIOUS VERSION:
 *
 *   #1  Transaction recording on payment
 *       recordDebtPayment() now calls addTransaction() with type='expense',
 *       category='Debt Repayment', note='debt payment'. Payments appear in
 *       the Overview, Categories breakdown, and budget goal tracking.
 *       Reversing a payment (via reverseDebtPayment) deletes the linked tx.
 *
 *   #2  DebtHistory sheet
 *       Every payment is recorded in a DebtHistory sheet:
 *       id | debt_id | month_key | transaction_id | amount | paid_at
 *       getAllDebtHistory() / getDebtHistoryByDebt() expose this for the client.
 *       Run initDebtEnhancements() once to create the sheet for existing users.
 *
 *   #3  Interest-aware payoff calculation
 *       _castDebt() now uses the standard amortisation formula when
 *       interest_rate > 0. When interest_rate = 0, falls back to simple division.
 *       Also exposes total_interest_cost (improvement #9).
 *
 *   #4  Debt-to-income ratio
 *       getDebtSummary() now includes debt_to_income_ratio computed from
 *       the current month's recorded income in Transactions.
 *
 *   #5  Payoff date
 *       _castDebt() now exposes payoff_date (ISO date string) in addition to
 *       months_to_payoff, so the client can display "Paid off around May 2027".
 *
 *   #6  Avalanche / Snowball ordering
 *       getAllDebts() accepts an optional sortMode: 'avalanche' | 'snowball' | 'default'.
 *       Client passes this based on user's toggle selection.
 *
 *   #7  Edit debt details
 *       updateDebt(debtId, fields) allows updating name, monthly_payment,
 *       interest_rate, and total without deleting and re-adding.
 *
 *   #8  Paid-off archiving
 *       archiveDebt(debtId) marks a debt as archived (paid_off=true) rather
 *       than deleting it. getAllDebts() filters out archived debts by default;
 *       getArchivedDebts() returns them separately. deleteDebt() is still
 *       available for permanent removal.
 *
 *   #9  Total interest cost projection
 *       _castDebt() exposes total_interest_cost so the client can show
 *       "You'll pay ₦42,000 in interest over 14 months".
 *
 *  #10  Recurring payment link
 *       addDebt() accepts an optional recurring_id. When the monthly recurring
 *       handler fires, linkDebtToRecurring() auto-applies the payment.
 *       getDebtsWithRecurring() returns debts that have an active recurring link.
 *
 * SHEET: Debts
 * COLUMNS: id | name | total | paid | monthly_payment | interest_rate | archived | recurring_id
 *
 * SHEET: DebtHistory
 * COLUMNS: id | debt_id | month_key | transaction_id | amount | paid_at
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap), Triggers.gs
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var DEBT_EXPENSE_CATEGORY = 'Debt Repayment';
var DEBT_TX_NOTE          = 'debt payment';


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllDebts(sortMode, includeArchived)
 *
 * Returns all active debts. Archived debts are excluded by default.
 *
 * sortMode:
 *   'default'   → insertion order (sheet row order)
 *   'avalanche' → highest interest rate first (mathematically optimal)
 *   'snowball'  → smallest amount owed first (psychologically motivating)
 *
 * #6 Avalanche / Snowball ordering
 * #8 Archived debts filtered out by default
 */
function getAllDebts(sortMode, includeArchived) {
  var rows = getUserAllRows('Debts').map(_castDebt);

  // Filter archived unless explicitly requested
  if (!includeArchived) {
    rows = rows.filter(function(d) { return !d.archived; });
  }

  // Apply sort order
  var mode = String(sortMode || 'default').toLowerCase();
  if (mode === 'avalanche') {
    rows.sort(function(a, b) { return b.interest_rate - a.interest_rate; });
  } else if (mode === 'snowball') {
    rows.sort(function(a, b) { return a.amount_owed - b.amount_owed; });
  }

  return rows;
}

/**
 * getArchivedDebts()
 * Returns only paid-off / archived debts.
 * #8 Paid-off archiving
 */
function getArchivedDebts() {
  return getUserAllRows('Debts')
    .map(_castDebt)
    .filter(function(d) { return d.archived; });
}

/**
 * getDebtSummary(monthKey)
 *
 * Returns aggregate metrics for the Debt tab header.
 * #4 Debt-to-income ratio — reads current month income from Transactions.
 */
function getDebtSummary(monthKey) {
  var debts     = getAllDebts();
  var remaining = 0;
  var monthly   = 0;

  debts.forEach(function(d) {
    remaining += d.amount_owed;
    monthly   += d.monthly_payment;
  });

  // #4: Compute debt-to-income ratio from recorded income this month
  var dti = 0;
  if (monthKey && monthly > 0) {
    try {
      var txs = getTransactionsByMonth(monthKey);
      var income = txs.reduce(function(sum, tx) {
        return tx.type === 'income' ? sum + (parseFloat(tx.amount) || 0) : sum;
      }, 0);
      if (income > 0) {
        dti = Math.round((monthly / income) * 100);
      }
    } catch(e) {
      Logger.log('Debt.gs: getDebtSummary DTI calc failed — ' + e.message);
    }
  }

  return {
    total_debt_remaining:   remaining,
    total_monthly_payments: monthly,
    debt_count:             debts.length,
    debt_to_income_ratio:   dti        // #4 new field
  };
}

/**
 * getAllDebtHistory()
 * Returns all DebtHistory rows for the current user, newest first.
 * #2 DebtHistory sheet
 */
function getAllDebtHistory() {
  try {
    return getUserAllRows('DebtHistory')
      .map(_castDebtHistoryRow)
      .sort(function(a, b) { return b.paid_at.localeCompare(a.paid_at); });
  } catch(e) {
    Logger.log('Debt.gs: getAllDebtHistory failed (sheet may not exist yet): ' + e.message);
    return [];
  }
}

/**
 * getDebtHistoryByDebt(debtId)
 * Returns history rows for a single debt, newest first.
 * #2 DebtHistory sheet
 */
function getDebtHistoryByDebt(debtId) {
  return getAllDebtHistory().filter(function(h) {
    return h.debt_id === String(debtId);
  });
}

/**
 * getDebtsWithRecurring()
 * Returns active debts that have a linked recurring template.
 * #10 Recurring payment link
 */
function getDebtsWithRecurring() {
  return getAllDebts().filter(function(d) {
    return d.recurring_id && String(d.recurring_id).trim() !== '';
  });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addDebt(name, total, monthlyPayment, interestRate, recurringId)
 *
 * Creates a new debt row.
 * #10 Accepts optional recurringId to link to a recurring transaction template.
 */
function addDebt(name, total, monthlyPayment, interestRate, recurringId) {
  if (!name || String(name).trim() === '') {
    throw new Error('Debt.gs: Debt name is required.');
  }

  var parsedTotal = parseFloat(total);
  if (isNaN(parsedTotal) || parsedTotal <= 0) {
    throw new Error('Debt.gs: total must be a positive number.');
  }

  var parsedPayment = parseFloat(monthlyPayment) || 0;
  if (parsedPayment < 0) {
    throw new Error('Debt.gs: monthlyPayment cannot be negative.');
  }

  var parsedRate = parseFloat(interestRate) || 0;
  if (parsedRate < 0) {
    throw new Error('Debt.gs: interestRate cannot be negative.');
  }

  var debt = {
    id:               generateId(),
    name:             String(name).trim(),
    total:            parsedTotal,
    paid:             0,
    monthly_payment:  parsedPayment,
    interest_rate:    parsedRate,
    archived:         false,
    recurring_id:     recurringId ? String(recurringId).trim() : ''
  };

  getUserAppendRow('DEBTS', debt);
  return _castDebt(debt);
}

/**
 * updateDebt(debtId, fields)
 *
 * Updates mutable fields on an existing debt:
 *   name, monthly_payment, interest_rate, total, recurring_id
 *
 * Does NOT allow changing 'paid' directly — use recordDebtPayment() for that.
 * #7 Edit debt details
 */
function updateDebt(debtId, fields) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');
  if (!fields || typeof fields !== 'object') {
    throw new Error('Debt.gs: fields object is required.');
  }

  var rowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  var debts   = getAllDebts('default', true);
  var current = debts.find(function(d) { return d.id === debtId; });
  if (!current) throw new Error('Debt.gs: Debt "' + debtId + '" not found after index lookup.');

  // Validate updated fields
  var newName    = fields.name    ? String(fields.name).trim()          : current.name;
  var newTotal   = fields.total   ? parseFloat(fields.total)            : current.total;
  var newPayment = fields.monthly_payment != null
    ? parseFloat(fields.monthly_payment) : current.monthly_payment;
  var newRate    = fields.interest_rate != null
    ? parseFloat(fields.interest_rate)   : current.interest_rate;
  var newRecId   = fields.recurring_id != null
    ? String(fields.recurring_id).trim() : current.recurring_id;

  if (!newName) throw new Error('Debt.gs: name cannot be empty.');
  if (isNaN(newTotal) || newTotal <= 0) throw new Error('Debt.gs: total must be a positive number.');
  if (isNaN(newPayment) || newPayment < 0) throw new Error('Debt.gs: monthly_payment cannot be negative.');
  if (isNaN(newRate)    || newRate < 0)    throw new Error('Debt.gs: interest_rate cannot be negative.');

  var updated = {
    id:               current.id,
    name:             newName,
    total:            newTotal,
    paid:             current.paid,
    monthly_payment:  newPayment,
    interest_rate:    newRate,
    archived:         current.archived,
    recurring_id:     newRecId
  };

  getUserUpdateRow('DEBTS', rowIndex, updated);
  return _castDebt(updated);
}

/**
 * recordDebtPayment(debtId, paymentAmount, monthKey)
 *
 * Adds paymentAmount to paid, capped at total.
 * #1  Creates an expense transaction (type='expense', category='Debt Repayment').
 * #2  Writes a DebtHistory row linking debt → transaction.
 *
 * Returns { debt: updatedDebt, transactionId: '...' }
 */
function recordDebtPayment(debtId, paymentAmount, monthKey) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');

  var payment = parseFloat(paymentAmount);
  if (isNaN(payment) || payment <= 0) {
    throw new Error('Debt.gs: paymentAmount must be a positive number.');
  }

  // monthKey is optional — fall back to current month if not supplied
  var mk = monthKey;
  if (!mk || !String(mk).match(/^\d{4}-\d{2}$/)) {
    var now = new Date();
    mk = now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1);
  }

  var rowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  var debts   = getAllDebts('default', true);
  var current = debts.find(function(d) { return d.id === debtId; });
  if (!current) throw new Error('Debt.gs: Debt "' + debtId + '" not found after index lookup.');

  var newPaid = Math.min(current.total, (parseFloat(current.paid) || 0) + payment);

  var updated = {
    id:              current.id,
    name:            current.name,
    total:           current.total,
    paid:            newPaid,
    monthly_payment: current.monthly_payment,
    interest_rate:   current.interest_rate,
    archived:        current.archived,
    recurring_id:    current.recurring_id
  };

  getUserUpdateRow('DEBTS', rowIndex, updated);

  // #1 Record expense transaction
  var transactionId = null;
  try {
    var tx = addTransaction(
      mk,
      current.name,
      payment,
      'expense',
      DEBT_EXPENSE_CATEGORY,
      DEBT_TX_NOTE
    );
    transactionId = tx.id;
  } catch(e) {
    Logger.log('Debt.gs: recordDebtPayment — addTransaction failed (non-fatal): ' + e.message);
  }

  // #2 Write DebtHistory row
  try {
    var histRow = {
      id:             generateId(),
      debt_id:        debtId,
      month_key:      mk,
      transaction_id: transactionId || '',
      amount:         payment,
      paid_at:        new Date().toISOString()
    };
    getUserAppendRow('DEBT_HISTORY', histRow);
  } catch(e) {
    Logger.log('Debt.gs: recordDebtPayment — history write failed (non-fatal): ' + e.message);
  }

  Logger.log(
    'Debt.gs: recordDebtPayment — "' + current.name +
    '" paid ' + payment + ' (new paid total: ' + newPaid + ')'
  );

  return {
    debt:          _castDebt(updated),
    transactionId: transactionId
  };
}

/**
 * reverseDebtPayment(historyId, monthKey)
 *
 * Reverses a specific payment from DebtHistory:
 *   1. Finds the history row by historyId.
 *   2. Subtracts the payment amount from the debt's paid field.
 *   3. Deletes the linked transaction (if any).
 *   4. Deletes the history row.
 *
 * Returns { debt: updatedDebt }
 * #1 Undo support for transaction recording
 */
function reverseDebtPayment(historyId) {
  if (!historyId) throw new Error('Debt.gs: historyId is required.');

  // Find the history row
  var histRowIndex = getUserFindRowIndex('DEBT_HISTORY', function(row) {
    return String(row.id) === String(historyId);
  });

  if (histRowIndex === -1) {
    throw new Error('Debt.gs: History row "' + historyId + '" not found.');
  }

  var history = getAllDebtHistory();
  var histEntry = history.find(function(h) { return h.id === historyId; });
  if (!histEntry) throw new Error('Debt.gs: History entry "' + historyId + '" not found.');

  // Find the debt
  var debtRowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(histEntry.debt_id);
  });

  if (debtRowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + histEntry.debt_id + '" not found for reversal.');
  }

  var debts   = getAllDebts('default', true);
  var current = debts.find(function(d) { return d.id === histEntry.debt_id; });
  if (!current) throw new Error('Debt.gs: Debt not found after index lookup.');

  // Reverse the paid amount
  var newPaid = Math.max(0, (parseFloat(current.paid) || 0) - histEntry.amount);

  var updated = {
    id:              current.id,
    name:            current.name,
    total:           current.total,
    paid:            newPaid,
    monthly_payment: current.monthly_payment,
    interest_rate:   current.interest_rate,
    archived:        current.archived,
    recurring_id:    current.recurring_id
  };

  getUserUpdateRow('DEBTS', debtRowIndex, updated);

  // Delete the linked transaction
  if (histEntry.transaction_id) {
    try {
      deleteTransaction(histEntry.transaction_id);
    } catch(e) {
      Logger.log('Debt.gs: reverseDebtPayment — deleteTransaction failed (non-fatal): ' + e.message);
    }
  }

  // Delete the history row
  getUserDeleteRow('DEBT_HISTORY', histRowIndex);

  Logger.log(
    'Debt.gs: reverseDebtPayment — reversed ' + histEntry.amount +
    ' for "' + current.name + '" (new paid: ' + newPaid + ')'
  );

  return { debt: _castDebt(updated) };
}

/**
 * archiveDebt(debtId)
 *
 * Marks a debt as archived (paid_off). It disappears from getAllDebts()
 * but remains in the sheet for history purposes.
 * #8 Paid-off archiving
 */
function archiveDebt(debtId) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');

  var rowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  var debts   = getAllDebts('default', true);
  var current = debts.find(function(d) { return d.id === debtId; });
  if (!current) throw new Error('Debt.gs: Debt "' + debtId + '" not found after index lookup.');

  var updated = {
    id:              current.id,
    name:            current.name,
    total:           current.total,
    paid:            current.total, // ensure fully paid
    monthly_payment: current.monthly_payment,
    interest_rate:   current.interest_rate,
    archived:        true,
    recurring_id:    current.recurring_id
  };

  getUserUpdateRow('DEBTS', rowIndex, updated);
  return { success: true, debt: _castDebt(updated) };
}

/**
 * unarchiveDebt(debtId)
 * Restores an archived debt back to active status.
 * #8 Paid-off archiving
 */
function unarchiveDebt(debtId) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');

  var rowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  var debts   = getAllDebts('default', true);
  var current = debts.find(function(d) { return d.id === debtId; });
  if (!current) throw new Error('Debt.gs: Debt "' + debtId + '" not found after index lookup.');

  var updated = Object.assign({}, current, { archived: false });
  getUserUpdateRow('DEBTS', rowIndex, updated);
  return { success: true, debt: _castDebt(updated) };
}

/**
 * deleteDebt(debtId)
 *
 * Permanently removes the debt row and all its history rows.
 * Prefer archiveDebt() to preserve history.
 */
function deleteDebt(debtId) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');

  var rowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  getUserDeleteRow('DEBTS', rowIndex);

  // Clean up history rows
  try {
    var history = getAllDebtHistory();
    var toDelete = history.filter(function(h) { return h.debt_id === debtId; });
    var indices = [];
    toDelete.forEach(function(h) {
      var idx = getUserFindRowIndex('DEBT_HISTORY', function(row) {
        return String(row.id) === String(h.id);
      });
      if (idx !== -1) indices.push(idx);
    });
    // Delete bottom-up to preserve row indices
    indices.sort(function(a, b) { return b - a; }).forEach(function(idx) {
      getUserDeleteRow('DEBT_HISTORY', idx);
    });
  } catch(e) {
    Logger.log('Debt.gs: deleteDebt — history cleanup failed (non-fatal): ' + e.message);
  }

  return { success: true };
}

/**
 * linkDebtToRecurring(debtId, recurringId)
 *
 * Associates a debt with a recurring transaction template.
 * The monthly trigger then auto-applies payments via applyRecurringDebtPayments().
 * #10 Recurring payment link
 */
function linkDebtToRecurring(debtId, recurringId) {
  return updateDebt(debtId, { recurring_id: recurringId || '' });
}

/**
 * applyRecurringDebtPayments(monthKey)
 *
 * Called by Triggers.gs monthlyHandler().
 * For every debt with a recurring_id, checks if the linked recurring
 * template exists and records a payment for its amount.
 *
 * Idempotent — skips if a DebtHistory row already exists for this
 * debt + monthKey combination.
 *
 * #10 Recurring payment link
 */
function applyRecurringDebtPayments(monthKey) {
  if (!monthKey) return { applied: 0, skipped: 0 };

  var debtsWithRecurring = getDebtsWithRecurring();
  if (debtsWithRecurring.length === 0) return { applied: 0, skipped: 0 };

  var allRecurring = getAllRecurring(); // from Recurring.gs
  var history      = getAllDebtHistory();

  var applied = 0;
  var skipped = 0;

  debtsWithRecurring.forEach(function(debt) {
    // Check if already applied this month
    var alreadyApplied = history.some(function(h) {
      return h.debt_id === debt.id && h.month_key === monthKey;
    });

    if (alreadyApplied) {
      skipped++;
      return;
    }

    // Find the linked recurring template
    var recurring = allRecurring.find(function(r) {
      return String(r.id) === String(debt.recurring_id);
    });

    if (!recurring) {
      Logger.log('Debt.gs: applyRecurringDebtPayments — recurring "' +
        debt.recurring_id + '" not found for debt "' + debt.name + '"');
      skipped++;
      return;
    }

    try {
      recordDebtPayment(debt.id, recurring.amount, monthKey);
      applied++;
    } catch(e) {
      Logger.log('Debt.gs: applyRecurringDebtPayments — failed for "' +
        debt.name + '": ' + e.message);
      skipped++;
    }
  });

  Logger.log(
    'Debt.gs: applyRecurringDebtPayments(' + monthKey + ') — ' +
    'applied: ' + applied + ', skipped: ' + skipped
  );

  return { applied: applied, skipped: skipped };
}


// ─── ONE-TIME MIGRATION ───────────────────────────────────────────────────────

/**
 * initDebtEnhancements()
 *
 * One-time migration for existing users.
 * Run from the Apps Script editor after deploying this update.
 *
 * What it does:
 *   1. Creates the DebtHistory sheet if it doesn't exist.
 *   2. Adds 'archived' and 'recurring_id' columns to the Debts sheet if missing.
 *
 * Safe to re-run — columns are only added if missing.
 */
function initDebtEnhancements() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('initDebtEnhancements: No active user — run this while signed in.');
    return;
  }

  var userKey = getCurrentUserKey();
  var ss      = getSpreadsheet();

  // ── 1. Create DebtHistory sheet ──────────────────────────────────────────
  var dhName  = userKey + ':DebtHistory';
  var dhSheet = ss.getSheetByName(dhName);

  if (!dhSheet) {
    dhSheet = ss.insertSheet(dhName);
    var dhHeaders = ['id', 'debt_id', 'month_key', 'transaction_id', 'amount', 'paid_at'];
    dhSheet.getRange(1, 1, 1, dhHeaders.length).setValues([dhHeaders]);
    dhSheet.getRange(1, 1, 1, dhHeaders.length).setFontWeight('bold');
    dhSheet.getRange(1, 1, 1, dhHeaders.length).setBackground('#f0f0f0');
    // Apply string format to string columns
    _applyStringFormats(dhSheet, dhHeaders);
    SpreadsheetApp.flush();
    Logger.log('initDebtEnhancements: Created DebtHistory sheet for ' + userKey);
  } else {
    Logger.log('initDebtEnhancements: DebtHistory sheet already exists for ' + userKey);
  }

  // ── 2. Add 'archived' column to Debts sheet ───────────────────────────────
  var debtsName  = userKey + ':Debts';
  var debtsSheet = ss.getSheetByName(debtsName);

  if (debtsSheet) {
    var lastCol = debtsSheet.getLastColumn();
    var headers = debtsSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                            .map(function(h) { return String(h).trim(); });

    if (headers.indexOf('archived') === -1) {
      var archCol = lastCol + 1;
      debtsSheet.getRange(1, archCol).setValue('archived');
      debtsSheet.getRange(1, archCol).setFontWeight('bold');
      debtsSheet.getRange(1, archCol).setBackground('#f0f0f0');
      // Default existing rows to false (not archived)
      var lastRow = debtsSheet.getLastRow();
      if (lastRow >= 2) {
        debtsSheet.getRange(2, archCol, lastRow - 1, 1).setValue(false);
      }
      lastCol = archCol;
      headers.push('archived');
      Logger.log('initDebtEnhancements: Added archived column to Debts sheet');
    }

    if (headers.indexOf('recurring_id') === -1) {
      var recCol = lastCol + 1;
      debtsSheet.getRange(1, recCol).setValue('recurring_id');
      debtsSheet.getRange(1, recCol).setFontWeight('bold');
      debtsSheet.getRange(1, recCol).setBackground('#f0f0f0');
      // Default to blank
      var lastRow2 = debtsSheet.getLastRow();
      if (lastRow2 >= 2) {
        debtsSheet.getRange(2, recCol, lastRow2 - 1, 1).setValue('');
      }
      headers.push('recurring_id');
      Logger.log('initDebtEnhancements: Added recurring_id column to Debts sheet');
    }

    SpreadsheetApp.flush();
  }

  Logger.log('initDebtEnhancements: Migration complete for ' + userKey);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castDebt(row)
 *
 * Normalises a raw sheet row into a typed debt object.
 *
 * Computed fields:
 *   amount_owed        = total - paid
 *   percent_paid       = min(100, round(paid / total * 100))
 *   months_to_payoff   = amortisation-aware (#3)
 *   payoff_date        = ISO date string (#5)
 *   total_interest_cost = total interest paid over loan life (#9)
 *   archived           = boolean (#8)
 *   recurring_id       = string (#10)
 */
function _castDebt(row) {
  var total   = parseFloat(row.total)           || 0;
  var paid    = parseFloat(row.paid)            || 0;
  var payment = parseFloat(row.monthly_payment) || 0;
  var rate    = parseFloat(row.interest_rate)   || 0;

  var owed        = Math.max(0, total - paid);
  var percentPaid = total > 0
    ? Math.min(100, Math.round((paid / total) * 100))
    : 0;

  // #3 Interest-aware payoff calculation, #9 Total interest cost
  var monthsLeft        = null;
  var totalInterestCost = 0;
  var payoffDate        = null;

  if (payment > 0 && owed > 0) {
    if (rate > 0) {
      // Standard amortisation formula
      var monthlyRate = rate / 100 / 12;

      // Check if payment covers at least the monthly interest
      var monthlyInterest = owed * monthlyRate;
      if (payment > monthlyInterest) {
        // n = log(P / (P - r*B)) / log(1 + r)
        // P = monthly payment, r = monthly rate, B = balance
        monthsLeft = Math.ceil(
          Math.log(payment / (payment - monthlyRate * owed)) /
          Math.log(1 + monthlyRate)
        );

        // Total interest = (months * payment) - owed
        totalInterestCost = Math.max(0, Math.round((monthsLeft * payment) - owed));
      } else {
        // Payment doesn't cover interest — debt grows forever
        monthsLeft        = null;
        totalInterestCost = null; // indeterminate
      }
    } else {
      // No interest — simple division
      monthsLeft        = Math.ceil(owed / payment);
      totalInterestCost = 0;
    }

    // #5 Payoff date
    if (monthsLeft !== null) {
      var now         = new Date();
      var payoffMonth = new Date(now.getFullYear(), now.getMonth() + monthsLeft, 1);
      payoffDate      = payoffMonth.toISOString().slice(0, 10);
    }
  }

  // #8 Archived
  var archived = row.archived === true
    || row.archived === 'true'
    || row.archived === 'TRUE'
    || row.archived === 1;

  return {
    id:                  String(row.id   || '').trim(),
    name:                String(row.name || '').trim(),
    total:               total,
    paid:                paid,
    monthly_payment:     payment,
    interest_rate:       rate,
    amount_owed:         owed,
    percent_paid:        percentPaid,
    months_to_payoff:    monthsLeft,         // #3 amortisation-aware
    payoff_date:         payoffDate,          // #5 payoff date
    total_interest_cost: totalInterestCost,  // #9 interest projection
    archived:            archived,            // #8 archiving
    recurring_id:        String(row.recurring_id || '').trim() // #10 recurring link
  };
}

/**
 * _castDebtHistoryRow(row)
 * Normalises a raw DebtHistory row.
 * #2 DebtHistory sheet
 */
function _castDebtHistoryRow(row) {
  return {
    id:             String(row.id             || '').trim(),
    debt_id:        String(row.debt_id        || '').trim(),
    month_key:      String(row.month_key      || '').trim(),
    transaction_id: String(row.transaction_id || '').trim(),
    amount:         parseFloat(row.amount)    || 0,
    paid_at:        String(row.paid_at        || '').trim()
  };
}
