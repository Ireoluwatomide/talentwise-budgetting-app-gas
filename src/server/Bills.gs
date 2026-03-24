/**
 * Bills.gs — Recurring Bills & Due-Date Tracking (Overhauled)
 *
 * CHANGES FROM PREVIOUS VERSION:
 *   - Bills schema: added 'category' column (defaults to 'Utilities' if blank)
 *   - toggleBillPaid(billId, monthKey) now accepts monthKey so it can record
 *     a transaction when the bill is marked paid and delete it when unpaid
 *   - addBill() now accepts a 'category' parameter
 *   - getUpcomingBills() reads alert threshold from preferences instead of
 *     the hardcoded value of 5
 *   - markAllBillsPaid(monthKey) — new: marks every unpaid bill paid in one call
 *   - getAllBillHistory() — new: returns all BillHistory rows for the current user
 *   - getBillHistoryByBill(billId) — new: history rows for one bill
 *   - _daysUntilAccurate() — replaces _daysUntil() with real calendar math
 *
 * SHEET: Bills
 * COLUMNS: id | name | amount | due_day | paid | category
 *
 * SHEET: BillHistory
 * COLUMNS: id | bill_id | month_key | paid_at | transaction_id | amount
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap),
 *            Notifications.gs, Triggers.gs
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var DEFAULT_BILL_ALERT_DAYS = 5;
var DEFAULT_BILL_CATEGORY   = 'Utilities';


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllBills()
 *
 * Returns all bills as [{ id, name, amount, due_day, paid, category }].
 * paid is normalised to a JS boolean.
 * category defaults to 'Utilities' if the column is blank (pre-migration rows).
 */
function getAllBills() {
  return getUserAllRows('Bills').map(_castBill);
}

/**
 * getUpcomingBills(daysAhead)
 *
 * Returns unpaid bills due within daysAhead days.
 * daysAhead defaults to the user's bills_alert_days preference (default 5).
 * Each returned bill includes a computed daysUntilDue field.
 */
function getUpcomingBills(daysAhead) {
  // If not supplied, read from preferences
  if (daysAhead === undefined || daysAhead === null) {
    try {
      var prefs = _getPrefsMap();
      var stored = parseInt(prefs['bills_alert_days'], 10);
      daysAhead = (!isNaN(stored) && stored > 0) ? stored : DEFAULT_BILL_ALERT_DAYS;
    } catch(e) {
      daysAhead = DEFAULT_BILL_ALERT_DAYS;
    }
  } else {
    daysAhead = parseInt(daysAhead, 10);
  }

  var today = new Date();
  var bills = getAllBills();

  return bills
    .filter(function(bill) { return !bill.paid; })
    .map(function(bill) {
      var daysUntil = _daysUntilAccurate(bill.due_day, today);
      return Object.assign({}, bill, { daysUntilDue: daysUntil });
    })
    .filter(function(bill) { return bill.daysUntilDue <= daysAhead; })
    .sort(function(a, b) { return a.daysUntilDue - b.daysUntilDue; });
}

/**
 * getAllBillHistory()
 *
 * Returns all BillHistory rows for the current user.
 * Used by getBootstrapData() to load history on page open.
 */
function getAllBillHistory() {
  return getUserAllRows('BillHistory').map(_castHistoryRow);
}

/**
 * getBillHistoryByBill(billId)
 * Returns history rows for a single bill, sorted newest first.
 */
function getBillHistoryByBill(billId) {
  return getUserAllRows('BillHistory')
    .map(_castHistoryRow)
    .filter(function(row) { return row.bill_id === String(billId); })
    .sort(function(a, b) { return b.paid_at.localeCompare(a.paid_at); });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addBill(name, amount, dueDay, category)
 *
 * Validates and appends a new bill row.
 * category is optional — defaults to DEFAULT_BILL_CATEGORY.
 * Returns the new bill object.
 */
function addBill(name, amount, dueDay, category) {
  if (!name || String(name).trim() === '') {
    throw new Error('Bills.gs: Bill name is required.');
  }

  var parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Bills.gs: amount must be a positive number.');
  }

  var parsedDay = parseInt(dueDay, 10);
  if (isNaN(parsedDay) || parsedDay < 1 || parsedDay > 31) {
    throw new Error('Bills.gs: due_day must be a number between 1 and 31.');
  }

  var trimmedCategory = (category && String(category).trim())
    ? String(category).trim()
    : DEFAULT_BILL_CATEGORY;

  var bill = {
    id:       generateId(),
    name:     String(name).trim(),
    amount:   parsedAmount,
    due_day:  parsedDay,
    paid:     false,
    category: trimmedCategory
  };

  getUserAppendRow('BILLS', bill);
  return bill;
}

/**
 * toggleBillPaid(billId, monthKey)
 *
 * Flips the paid status for the given bill.
 *
 * When marking PAID:
 *   1. Updates the bill row → paid: true
 *   2. Calls addTransaction() to record an expense transaction
 *   3. Writes a BillHistory row with the transaction_id
 *   Returns { bill: updatedBill, transactionId: '...' }
 *
 * When marking UNPAID (reversing a payment):
 *   1. Looks up the BillHistory row for this bill + monthKey
 *   2. Deletes the linked transaction (if any)
 *   3. Deletes the BillHistory row
 *   4. Updates the bill row → paid: false
 *   Returns { bill: updatedBill, transactionId: null }
 *
 * monthKey must be in YYYY-MM format — passed from the client via curKey().
 */
function toggleBillPaid(billId, monthKey) {
  if (!billId) throw new Error('Bills.gs: billId is required.');
  if (!monthKey || !String(monthKey).match(/^\d{4}-\d{2}$/)) {
    throw new Error('Bills.gs: monthKey must be in YYYY-MM format.');
  }

  var rowIndex = getUserFindRowIndex('BILLS', function(row) {
    return String(row.id) === String(billId);
  });

  if (rowIndex === -1) {
    throw new Error('Bills.gs: Bill "' + billId + '" not found.');
  }

  var bills    = getAllBills();
  var existing = bills.find(function(b) { return b.id === billId; });
  if (!existing) throw new Error('Bills.gs: Bill "' + billId + '" not found after index lookup.');

  var nowIsPaid    = !existing.paid;   // flip: if currently unpaid, we're marking paid
  var transactionId = null;

  // ── Marking PAID ──────────────────────────────────────────────────────────
  if (nowIsPaid) {
    // 1. Record the expense transaction
    try {
      var tx = addTransaction(
        monthKey,
        existing.name,
        existing.amount,
        'expense',
        existing.category || DEFAULT_BILL_CATEGORY,
        'bill payment'
      );
      transactionId = tx.id;
    } catch(e) {
      Logger.log('Bills.gs: toggleBillPaid — addTransaction failed: ' + e.message);
      // Still mark as paid even if transaction recording fails
    }

    // 2. Write BillHistory row
    var historyRow = {
      id:             generateId(),
      bill_id:        billId,
      month_key:      monthKey,
      paid_at:        new Date().toISOString(),
      transaction_id: transactionId || '',
      amount:         existing.amount
    };
    getUserAppendRow('BILL_HISTORY', historyRow);

  } else {
    // ── Marking UNPAID (reversal) ────────────────────────────────────────────
    // 1. Find the history row for this bill + month
    var historyRows = getUserAllRows('BillHistory').map(_castHistoryRow);
    var historyEntry = historyRows.find(function(h) {
      return h.bill_id === billId && h.month_key === monthKey;
    });

    if (historyEntry) {
      // 2. Delete the linked transaction if one exists
      if (historyEntry.transaction_id) {
        try {
          deleteTransaction(historyEntry.transaction_id);
        } catch(e) {
          Logger.log('Bills.gs: toggleBillPaid — deleteTransaction failed (non-fatal): ' + e.message);
        }
      }

      // 3. Delete the history row
      var histRowIndex = getUserFindRowIndex('BILL_HISTORY', function(row) {
        return String(row.id) === historyEntry.id;
      });
      if (histRowIndex !== -1) {
        getUserDeleteRow('BILL_HISTORY', histRowIndex);
      }
    }
  }

  // ── Update the bill row ───────────────────────────────────────────────────
  var updated = Object.assign({}, existing, { paid: nowIsPaid });
  getUserUpdateRow('BILLS', rowIndex, updated);

  return {
    bill:          updated,
    transactionId: transactionId
  };
}

/**
 * markAllBillsPaid(monthKey)
 *
 * Marks every currently-unpaid bill as paid in a single server call.
 * Records a transaction for each bill that gets marked paid.
 * Returns { bills: [updatedBill, ...], marked: N }
 */
function markAllBillsPaid(monthKey) {
  if (!monthKey || !String(monthKey).match(/^\d{4}-\d{2}$/)) {
    throw new Error('Bills.gs: monthKey must be in YYYY-MM format.');
  }

  var bills   = getAllBills();
  var unpaid  = bills.filter(function(b) { return !b.paid; });
  var updated = [];

  unpaid.forEach(function(bill) {
    try {
      var result = toggleBillPaid(bill.id, monthKey);
      updated.push(result.bill);
    } catch(e) {
      Logger.log('Bills.gs: markAllBillsPaid — failed for "' + bill.name + '": ' + e.message);
    }
  });

  // Return all bills (both newly-paid and already-paid)
  var allUpdated = getAllBills();
  return { bills: allUpdated, marked: updated.length };
}

/**
 * deleteBill(billId)
 * Deletes the bill row matching billId.
 * Also deletes all BillHistory rows for this bill.
 */
function deleteBill(billId) {
  if (!billId) throw new Error('Bills.gs: billId is required.');

  var rowIndex = getUserFindRowIndex('BILLS', function(row) {
    return String(row.id) === String(billId);
  });

  if (rowIndex === -1) {
    throw new Error('Bills.gs: Bill "' + billId + '" not found.');
  }

  getUserDeleteRow('BILLS', rowIndex);

  // Clean up history rows — delete bottom-up to avoid index shift
  var historyRows = getUserAllRows('BillHistory').map(_castHistoryRow);
  var toDelete = historyRows.filter(function(h) { return h.bill_id === billId; });

  // Get their sheet row indices and delete bottom-up
  var indices = [];
  toDelete.forEach(function(h) {
    var idx = getUserFindRowIndex('BILL_HISTORY', function(row) {
      return String(row.id) === h.id;
    });
    if (idx !== -1) indices.push(idx);
  });

  indices.sort(function(a, b) { return b - a; }).forEach(function(idx) {
    getUserDeleteRow('BILL_HISTORY', idx);
  });

  return { success: true };
}

/**
 * resetAllBillsPaid()
 *
 * Sets paid = false for every bill in the sheet.
 * Called on the 1st of each month by the Triggers.gs monthly handler.
 * Does NOT delete history rows — history is permanent.
 *
 * Reads all rows once, updates only those where paid is currently true.
 * Returns { reset: N }
 */
function resetAllBillsPaid() {
  var sheet   = getSheet(getUserSheetName('Bills'));
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { reset: 0 };

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var paidIdx = headers.indexOf('paid');

  if (paidIdx === -1) {
    throw new Error('Bills.gs: "paid" column not found in Bills sheet.');
  }

  var resetCount = 0;

  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var isPaid = row[paidIdx] === true || row[paidIdx] === 'true' || row[paidIdx] === 'TRUE';
    if (isPaid) {
      sheet.getRange(i + 1, paidIdx + 1).setValue(false);
      resetCount++;
    }
  }

  if (resetCount > 0) SpreadsheetApp.flush();

  Logger.log('Bills.gs: resetAllBillsPaid() reset ' + resetCount + ' bill(s).');
  return { reset: resetCount };
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castBill(row)
 * Normalises a raw row from getAllRows() into a typed bill object.
 * paid is normalised from any truthy string/boolean to a JS boolean.
 * category defaults to DEFAULT_BILL_CATEGORY if blank (pre-migration rows).
 */
function _castBill(row) {
  var paidRaw = row.paid;
  var paid    = paidRaw === true
             || paidRaw === 'true'
             || paidRaw === 'TRUE'
             || paidRaw === 1;

  var category = (row.category && String(row.category).trim())
    ? String(row.category).trim()
    : DEFAULT_BILL_CATEGORY;

  return {
    id:       String(row.id      || '').trim(),
    name:     String(row.name    || '').trim(),
    amount:   parseFloat(row.amount)    || 0,
    due_day:  parseInt(row.due_day, 10) || 1,
    paid:     paid,
    category: category
  };
}

/**
 * _castHistoryRow(row)
 * Normalises a raw BillHistory row.
 */
function _castHistoryRow(row) {
  return {
    id:             String(row.id             || '').trim(),
    bill_id:        String(row.bill_id        || '').trim(),
    month_key:      String(row.month_key      || '').trim(),
    paid_at:        String(row.paid_at        || '').trim(),
    transaction_id: String(row.transaction_id || '').trim(),
    amount:         parseFloat(row.amount) || 0
  };
}

/**
 * _daysUntilAccurate(dueDay, today)
 *
 * Calculates the number of days until dueDay in the current or next month,
 * using real calendar math rather than the previous 31-day approximation.
 *
 * today: a Date object (defaults to new Date() if not supplied)
 *
 * Algorithm:
 *   - If dueDay >= today's date → it's still this month, days = dueDay - todayDate
 *   - If dueDay < today's date  → it's next month.
 *     days = (days remaining in current month) + dueDay
 *     "days remaining in current month" = daysInMonth - todayDate
 *
 * daysInMonth is computed correctly for each month including leap years.
 */
function _daysUntilAccurate(dueDay, today) {
  today = today || new Date();
  var d   = parseInt(dueDay, 10);
  var tod = today.getDate();

  if (d >= tod) {
    return d - tod;
  }

  // Due day is in the next month — compute real days left in current month
  var year        = today.getFullYear();
  var month       = today.getMonth(); // 0-indexed
  // getDate(0) of next month = last day of current month
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  return (daysInMonth - tod) + d;
}
