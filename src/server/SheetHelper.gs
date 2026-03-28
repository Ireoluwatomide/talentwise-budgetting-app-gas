/**
 * SheetHelper.gs — Google Sheets Low-Level Utilities
 *
 * CHANGES (savings enhancement):
 *   - SavingsGoals headers updated: added target_date and sort_order columns
 *   - New SavingsHistory entry added to SHEET_HEADERS and _LOGICAL_NAME_MAP in UserManager.gs
 *   - All other logic unchanged
 *
 * KEY FIX — month_key persistence:
 *   Google Sheets aggressively auto-converts any string that looks like a date
 *   (e.g. "2026-03") into a Date cell. The fix is two-pronged:
 *     1. appendRow() writes string columns via setValues() with @STRING@ format applied first.
 *     2. _dateToMonthKey() uses WAT (UTC+1) consistently when converting a Date back.
 *
 * PATTERN:
 *   Row 1 = headers, Rows 2+ = data. All functions operate on the active spreadsheet.
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SHEET_NAMES = {
  TRANSACTIONS:    'Transactions',
  GOALS:           'Goals',
  BILLS:           'Bills',
  BILL_HISTORY:    'BillHistory',
  SAVINGS_GOALS:   'SavingsGoals',
  SAVINGS_HISTORY: 'SavingsHistory',
  DEBTS:           'Debts',
  NET_WORTH:       'NetWorth',
  RECURRING:       'Recurring',
  PREFERENCES:     'Preferences'
};

/**
 * SHEET_HEADERS — single source of truth for column order in every sheet.
 *
 * SavingsGoals: added target_date (YYYY-MM-DD or blank) and sort_order (integer)
 * SavingsHistory: new sheet — id | goal_id | transaction_id | month_key | amount | note | recorded_at
 */
const SHEET_HEADERS = {
  Transactions:   ['id', 'month_key', 'name', 'amount', 'type', 'category', 'note'],
  Goals:          ['id', 'month_key', 'category', 'monthly_limit'],
  Bills:          ['id', 'name', 'amount', 'due_day', 'paid', 'category'],
  BillHistory:    ['id', 'bill_id', 'month_key', 'paid_at', 'transaction_id', 'amount'],
  SavingsGoals:   ['id', 'name', 'target_amount', 'saved_amount', 'target_date', 'sort_order'],
  SavingsHistory: ['id', 'goal_id', 'transaction_id', 'month_key', 'amount', 'note', 'recorded_at'],
  Debts:          ['id', 'name', 'total', 'paid', 'monthly_payment', 'interest_rate', 'archived', 'recurring_id'],
  DebtHistory:    ['id', 'debt_id', 'month_key', 'transaction_id', 'amount', 'paid_at'],
  NetWorth:       ['id', 'name', 'type', 'amount'],
  Recurring:      ['id', 'name', 'amount', 'type', 'category'],
  Preferences:    ['key', 'value']
};

// Columns that must always be stored as plain text strings.
var STRING_COLUMNS = ['month_key', 'key', 'recorded_at', 'paid_at', 'target_date'];


// ─── SPREADSHEET ACCESS ───────────────────────────────────────────────────────

var _spreadsheet = null;

function getSpreadsheet() {
  if (!_spreadsheet) {
    _spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!_spreadsheet) {
      throw new Error(
        'SheetHelper: No active spreadsheet found. ' +
        'Make sure this script is bound to a Google Sheet.'
      );
    }
  }
  return _spreadsheet;
}

function getSheet(sheetName) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(
      'SheetHelper: Sheet "' + sheetName + '" not found. ' +
      'Run initSheets() first to create all required tabs.'
    );
  }
  return sheet;
}


// ─── READ OPERATIONS ──────────────────────────────────────────────────────────

function getAllRows(sheetName) {
  var sheet = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];

  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    var isEmpty = row.every(function(cell) {
      return cell === '' || cell === null || cell === undefined;
    });
    if (isEmpty) continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var val = row[j];

      if (val instanceof Date) {
        val = _dateToMonthKey(val);
      } else if (typeof val === 'string') {
        val = val.trim();
      }

      obj[key] = val;
    }
    rows.push(obj);
  }
  return rows;
}

function getRowsByFilter(sheetName, filterFn) {
  return getAllRows(sheetName).filter(filterFn);
}


// ─── WRITE OPERATIONS ─────────────────────────────────────────────────────────

function appendRow(sheetName, rowObject) {
  var sheet   = getSheet(sheetName);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function(h) { return String(h).trim(); });

  var stringColIndices = [];
  headers.forEach(function(h, idx) {
    if (STRING_COLUMNS.indexOf(h) !== -1) {
      stringColIndices.push(idx);
    }
  });

  var newRowNum = sheet.getLastRow() + 1;

  stringColIndices.forEach(function(colIdx) {
    sheet.getRange(newRowNum, colIdx + 1).setNumberFormat('@STRING@');
  });

  var values = headers.map(function(h) {
    var val = rowObject[h];
    return (val === undefined || val === null) ? '' : val;
  });

  sheet.getRange(newRowNum, 1, 1, lastCol).setValues([values]);
  SpreadsheetApp.flush();

  return newRowNum;
}

function updateRow(sheetName, rowIndex, rowObject) {
  var sheet   = getSheet(sheetName);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function(h) { return String(h).trim(); });

  headers.forEach(function(h, idx) {
    if (STRING_COLUMNS.indexOf(h) !== -1) {
      sheet.getRange(rowIndex, idx + 1).setNumberFormat('@STRING@');
    }
  });

  var values = headers.map(function(h) {
    var val = rowObject[h];
    return (val === undefined || val === null) ? '' : val;
  });

  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([values]);
  SpreadsheetApp.flush();
}

function deleteRow(sheetName, rowIndex) {
  var sheet = getSheet(sheetName);
  sheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
}

function clearSheetData(sheetName) {
  var sheet   = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
}


// ─── ROW LOOKUP ───────────────────────────────────────────────────────────────

function findRowIndex(sheetName, matchFn) {
  var sheet   = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var isEmpty = row.every(function(c) {
      return c === '' || c === null || c === undefined;
    });
    if (isEmpty) continue;

    var obj = {};
    headers.forEach(function(h, j) {
      var val = row[j];
      if (val instanceof Date) val = _dateToMonthKey(val);
      obj[h] = val;
    });

    if (matchFn(obj)) {
      return i + 1;
    }
  }
  return -1;
}


// ─── SHEET INITIALISATION ─────────────────────────────────────────────────────

function initSheets() {
  var ss = getSpreadsheet();

  Object.keys(SHEET_HEADERS).forEach(function(sheetName) {
    var headers = SHEET_HEADERS[sheetName];
    var sheet   = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      Logger.log('initSheets: Created sheet "' + sheetName + '"');
    }

    var firstCell = sheet.getRange(1, 1).getValue();
    if (firstCell === '' || firstCell === null) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('\x23f0f0f0');
      Logger.log('initSheets: Wrote headers for "' + sheetName + '"');
    }

    _applyStringFormats(sheet, headers);
  });

  Logger.log('initSheets: Complete. ' + Object.keys(SHEET_HEADERS).length + ' sheets ready.');
}

function _applyStringFormats(sheet, headers) {
  var lastDataRow = Math.max(sheet.getLastRow(), 2);
  var maxRows     = Math.max(lastDataRow, 2000);

  headers.forEach(function(h, idx) {
    if (STRING_COLUMNS.indexOf(h) !== -1) {
      sheet.getRange(2, idx + 1, maxRows, 1).setNumberFormat('@STRING@');
    }
  });
}


// ─── UTILITIES ────────────────────────────────────────────────────────────────

function generateId() {
  return Utilities.getUuid();
}

function headersToMap(headers) {
  var map = {};
  headers.forEach(function(h, i) { map[String(h).trim()] = i; });
  return map;
}

function _dateToMonthKey(date) {
  var wat = new Date(date.getTime() + 60 * 60 * 1000);
  var y   = wat.getUTCFullYear();
  var m   = wat.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}


// ─── ONE-TIME MIGRATION HELPERS ───────────────────────────────────────────────

function reinitGoalsSheet() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('reinitGoalsSheet: No active user — run this while signed in.');
    return;
  }

  var userKey   = getCurrentUserKey();
  var sheetName = userKey + ':Goals';
  var ss        = getSpreadsheet();
  var sheet     = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log('reinitGoalsSheet: Sheet "' + sheetName + '" not found — creating it.');
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clearContents();

  var newHeaders = ['id', 'month_key', 'category', 'monthly_limit'];
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, newHeaders.length).setBackground('\x23f0f0f0');

  _applyStringFormats(sheet, newHeaders);
  SpreadsheetApp.flush();

  Logger.log(
    'reinitGoalsSheet: Done. "' + sheetName + '" cleared and ' +
    'reinitialized with schema: [' + newHeaders.join(', ') + ']'
  );
}

function initBillHistorySheet() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('initBillHistorySheet: No active user — run this while signed in.');
    return;
  }

  var userKey = getCurrentUserKey();
  var ss      = getSpreadsheet();

  // ── 1. Create BillHistory sheet if missing ────────────────────────────────
  var bhName  = userKey + ':BillHistory';
  var bhSheet = ss.getSheetByName(bhName);

  if (!bhSheet) {
    bhSheet = ss.insertSheet(bhName);
    var bhHeaders = SHEET_HEADERS['BillHistory'];
    bhSheet.getRange(1, 1, 1, bhHeaders.length).setValues([bhHeaders]);
    bhSheet.getRange(1, 1, 1, bhHeaders.length).setFontWeight('bold');
    bhSheet.getRange(1, 1, 1, bhHeaders.length).setBackground('\x23f0f0f0');
    _applyStringFormats(bhSheet, bhHeaders);
    SpreadsheetApp.flush();
    Logger.log('initBillHistorySheet: Created BillHistory sheet for ' + userKey);
  } else {
    Logger.log('initBillHistorySheet: BillHistory sheet already exists for ' + userKey);
  }

  // ── 2. Add 'category' column to Bills sheet if missing ────────────────────
  var billsName  = userKey + ':Bills';
  var billsSheet = ss.getSheetByName(billsName);

  if (billsSheet) {
    var lastCol    = billsSheet.getLastColumn();
    var headers    = billsSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                               .map(function(h) { return String(h).trim(); });

    if (headers.indexOf('category') === -1) {
      var newColIdx = lastCol + 1;
      billsSheet.getRange(1, newColIdx).setValue('category');
      billsSheet.getRange(1, newColIdx).setFontWeight('bold');
      billsSheet.getRange(1, newColIdx).setBackground('\x23f0f0f0');
      SpreadsheetApp.flush();
      Logger.log('initBillHistorySheet: Added category column to Bills sheet for ' + userKey);
    } else {
      Logger.log('initBillHistorySheet: Bills sheet already has category column for ' + userKey);
    }
  }

  Logger.log('initBillHistorySheet: Migration complete for ' + userKey);
}

/**
 * initSavingsEnhancements()
 *
 * One-time migration for the savings goals enhancement.
 * Run from the Apps Script editor after deploying this update.
 *
 * What it does for the current user:
 *   1. Adds target_date and sort_order columns to the SavingsGoals sheet
 *      (fills sort_order with sequential values for existing rows)
 *   2. Creates the SavingsHistory sheet if it doesn't exist
 *
 * Safe to re-run — columns are only added if missing, sheet only created if absent.
 */
function initSavingsEnhancements() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('initSavingsEnhancements: No active user — run this while signed in.');
    return;
  }

  var userKey = getCurrentUserKey();
  var ss      = getSpreadsheet();

  // ── 1. Update SavingsGoals schema ─────────────────────────────────────────
  var sgName  = userKey + ':SavingsGoals';
  var sgSheet = ss.getSheetByName(sgName);

  if (!sgSheet) {
    Logger.log('initSavingsEnhancements: SavingsGoals sheet not found — nothing to migrate.');
  } else {
    var lastCol  = sgSheet.getLastColumn();
    var headers  = sgSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                          .map(function(h) { return String(h).trim(); });

    // Add target_date if missing
    if (headers.indexOf('target_date') === -1) {
      var tdCol = lastCol + 1;
      sgSheet.getRange(1, tdCol).setValue('target_date');
      sgSheet.getRange(1, tdCol).setFontWeight('bold');
      sgSheet.getRange(1, tdCol).setBackground('\x23f0f0f0');
      // Default blank for all existing rows
      var lastRow = sgSheet.getLastRow();
      if (lastRow >= 2) {
        sgSheet.getRange(2, tdCol, lastRow - 1, 1).setValue('');
        sgSheet.getRange(2, tdCol, lastRow - 1, 1).setNumberFormat('@STRING@');
      }
      lastCol = tdCol;
      headers.push('target_date');
      Logger.log('initSavingsEnhancements: Added target_date column to ' + sgName);
    }

    // Add sort_order if missing
    if (headers.indexOf('sort_order') === -1) {
      var soCol   = lastCol + 1;
      sgSheet.getRange(1, soCol).setValue('sort_order');
      sgSheet.getRange(1, soCol).setFontWeight('bold');
      sgSheet.getRange(1, soCol).setBackground('\x23f0f0f0');
      // Fill sequential sort_order for existing rows
      var lastRow2 = sgSheet.getLastRow();
      if (lastRow2 >= 2) {
        for (var r = 2; r <= lastRow2; r++) {
          sgSheet.getRange(r, soCol).setValue(r - 1); // 1-based order
        }
      }
      headers.push('sort_order');
      Logger.log('initSavingsEnhancements: Added sort_order column to ' + sgName + ' with sequential values');
    }

    // Re-apply string formats to the updated header set
    _applyStringFormats(sgSheet, SHEET_HEADERS['SavingsGoals']);
    SpreadsheetApp.flush();
  }

  // ── 2. Create SavingsHistory sheet ────────────────────────────────────────
  var shName  = userKey + ':SavingsHistory';
  var shSheet = ss.getSheetByName(shName);

  if (!shSheet) {
    shSheet = ss.insertSheet(shName);
    var shHeaders = SHEET_HEADERS['SavingsHistory'];
    shSheet.getRange(1, 1, 1, shHeaders.length).setValues([shHeaders]);
    shSheet.getRange(1, 1, 1, shHeaders.length).setFontWeight('bold');
    shSheet.getRange(1, 1, 1, shHeaders.length).setBackground('\x23f0f0f0');
    _applyStringFormats(shSheet, shHeaders);
    SpreadsheetApp.flush();
    Logger.log('initSavingsEnhancements: Created SavingsHistory sheet for ' + userKey);
  } else {
    Logger.log('initSavingsEnhancements: SavingsHistory sheet already exists for ' + userKey);
  }

  Logger.log('initSavingsEnhancements: Migration complete for ' + userKey);
}
