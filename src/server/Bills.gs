/**
 * Bills.gs — Recurring Bills & Due-Date Tracking
 *
 * PURPOSE:
 *   Manage recurring monthly bills. Each bill has a due day-of-month,
 *   an amount, and a paid/unpaid toggle that resets on the 1st of each month.
 *   Alerts fire 5 days before the due date.
 *
 * SHEET: Bills
 * COLUMNS: id | name | amount | due_day | paid
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap), Notifications.gs, Triggers.gs
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllBills()
 *
 * Returns all bills as [{ id, name, amount, due_day, paid }].
 * paid is normalised to a JS boolean — Sheets stores TRUE/FALSE as strings
 * or booleans depending on cell format, so we handle both.
 */
function getAllBills() {
  return getAllRows(SHEET_NAMES.BILLS).map(_castBill);
}

/**
 * getUpcomingBills(daysAhead)
 *
 * Returns unpaid bills due within daysAhead days (default 5).
 * Each returned bill includes a computed daysUntilDue field for UI badges
 * and email notification copy.
 *
 * Wrap-around logic handles bills due early in the next calendar month
 * from a date near the end of the current month.
 */
function getUpcomingBills(daysAhead) {
  daysAhead = (daysAhead === undefined || daysAhead === null) ? 5 : parseInt(daysAhead, 10);

  var today = new Date().getDate();
  var bills = getAllBills();

  return bills
    .filter(function(bill) { return !bill.paid; })
    .map(function(bill) {
      var dueDay     = parseInt(bill.due_day, 10);
      var daysUntil  = dueDay >= today
        ? dueDay - today
        : (31 - today) + dueDay;
      return Object.assign({}, bill, { daysUntilDue: daysUntil });
    })
    .filter(function(bill) { return bill.daysUntilDue <= daysAhead; })
    .sort(function(a, b) { return a.daysUntilDue - b.daysUntilDue; });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addBill(name, amount, dueDay)
 *
 * Validates and appends a new bill row.
 * Returns the new bill object.
 */
function addBill(name, amount, dueDay) {
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

  var bill = {
    id:      generateId(),
    name:    String(name).trim(),
    amount:  parsedAmount,
    due_day: parsedDay,
    paid:    false
  };

  appendRow(SHEET_NAMES.BILLS, bill);
  return bill;
}

/**
 * toggleBillPaid(billId)
 *
 * Flips the paid status for the given bill.
 * Returns the updated bill object.
 */
function toggleBillPaid(billId) {
  if (!billId) throw new Error('Bills.gs: billId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.BILLS, function(row) {
    return String(row.id) === String(billId);
  });

  if (rowIndex === -1) {
    throw new Error('Bills.gs: Bill "' + billId + '" not found.');
  }

  var bills    = getAllBills();
  var existing = bills.find(function(b) { return b.id === billId; });
  if (!existing) throw new Error('Bills.gs: Bill "' + billId + '" not found after index lookup.');

  var updated = Object.assign({}, existing, { paid: !existing.paid });
  updateRow(SHEET_NAMES.BILLS, rowIndex, updated);
  return updated;
}

/**
 * deleteBill(billId)
 * Deletes the bill row matching billId.
 */
function deleteBill(billId) {
  if (!billId) throw new Error('Bills.gs: billId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.BILLS, function(row) {
    return String(row.id) === String(billId);
  });

  if (rowIndex === -1) {
    throw new Error('Bills.gs: Bill "' + billId + '" not found.');
  }

  deleteRow(SHEET_NAMES.BILLS, rowIndex);
  return { success: true };
}

/**
 * resetAllBillsPaid()
 *
 * Sets paid = false for every bill in the sheet.
 * Called on the 1st of each month by the Triggers.gs monthly handler.
 *
 * Reads all rows once, updates only those where paid is currently true,
 * to minimise unnecessary writes.
 */
function resetAllBillsPaid() {
  var sheet   = getSheet(SHEET_NAMES.BILLS);
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
    var row = data[i];
    // Only write if currently paid — skip already-unpaid rows.
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
 */
function _castBill(row) {
  var paidRaw = row.paid;
  var paid    = paidRaw === true
             || paidRaw === 'true'
             || paidRaw === 'TRUE'
             || paidRaw === 1;

  return {
    id:      String(row.id      || '').trim(),
    name:    String(row.name    || '').trim(),
    amount:  parseFloat(row.amount)  || 0,
    due_day: parseInt(row.due_day, 10) || 1,
    paid:    paid
  };
}
