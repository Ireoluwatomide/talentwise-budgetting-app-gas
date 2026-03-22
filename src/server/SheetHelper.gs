/**
 * SheetHelper.gs — Google Sheets Low-Level Utilities
 *
 * PURPOSE:
 *   Central abstraction layer for all read/write operations against the linked
 *   Google Sheet. Every other server module calls these helpers instead of
 *   using SpreadsheetApp directly.
 *
 * KEY FIX — month_key persistence:
 *   Google Sheets aggressively auto-converts any string that looks like a date
 *   (e.g. "2026-03") into a Date cell, even when the column is pre-formatted
 *   as Plain Text. sheet.appendRow() bypasses column formatting entirely —
 *   it writes to whatever row comes next, which has no format applied.
 *
 *   The fix is two-pronged:
 *     1. appendRow() writes month_key values via setValues() on the specific
 *        cell rather than including them in the appendRow() array, and
 *        explicitly sets that cell's number format to Plain Text (@STRING@)
 *        BEFORE writing the value. This prevents Sheets from ever seeing the
 *        string as a date candidate.
 *     2. _dateToMonthKey() uses WAT (UTC+1) consistently when converting a
 *        Date that Sheets has already auto-converted, ensuring the month
 *        extracted matches what the user originally entered.
 *
 * PATTERN:
 *   Each sheet is treated as a table: Row 1 = headers, Rows 2+ = data.
 *   All functions operate on the active spreadsheet (bound script).
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SHEET_NAMES = {
  TRANSACTIONS:  'Transactions',
  GOALS:         'Goals',
  BILLS:         'Bills',
  SAVINGS_GOALS: 'SavingsGoals',
  DEBTS:         'Debts',
  NET_WORTH:     'NetWorth',
  RECURRING:     'Recurring',
  PREFERENCES:   'Preferences'
};

/**
 * SHEET_HEADERS defines the exact column order for every sheet.
 * appendRow() and initSheets() both read from this single source of truth.
 */
const SHEET_HEADERS = {
  Transactions:  ['id', 'month_key', 'name', 'amount', 'type', 'category', 'note'],
  Goals:         ['id', 'month_key', 'category', 'monthly_limit'],
  Bills:         ['id', 'name', 'amount', 'due_day', 'paid'],
  SavingsGoals:  ['id', 'name', 'target_amount', 'saved_amount'],
  Debts:         ['id', 'name', 'total', 'paid', 'monthly_payment', 'interest_rate'],
  NetWorth:      ['id', 'name', 'type', 'amount'],
  Recurring:     ['id', 'name', 'amount', 'type', 'category'],
  Preferences:   ['key', 'value']
};

// Columns that must always be stored as plain text strings.
// Sheets will auto-convert anything that looks like a date — we fight this
// by writing these columns with an explicit @STRING@ format every time.
var STRING_COLUMNS = ['month_key', 'key'];


// ─── SPREADSHEET ACCESS ───────────────────────────────────────────────────────

var _spreadsheet = null;

/**
 * getSpreadsheet()
 * Returns the active spreadsheet, using a cached reference after the first call.
 */
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

/**
 * getSheet(sheetName)
 * Returns the named sheet tab. Throws a clear error if not found.
 */
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

/**
 * getAllRows(sheetName)
 *
 * Returns all data rows (Row 2 onward) as an array of plain objects
 * keyed by the header values in Row 1.
 *
 * When a cell value is a Date (Sheets auto-converted a string column),
 * _dateToMonthKey() recovers the original YYYY-MM string using WAT timezone.
 */
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
        // Sheets auto-converted a string to a Date.
        // _dateToMonthKey uses WAT (UTC+1) to recover "YYYY-MM".
        val = _dateToMonthKey(val);
      } else if (typeof val === 'string') {
        val = val.trim();
      }
      // Numbers and booleans pass through unchanged.

      obj[key] = val;
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * getRowsByFilter(sheetName, filterFn)
 * Returns only the rows from getAllRows() that satisfy filterFn.
 */
function getRowsByFilter(sheetName, filterFn) {
  return getAllRows(sheetName).filter(filterFn);
}


// ─── WRITE OPERATIONS ─────────────────────────────────────────────────────────

/**
 * appendRow(sheetName, rowObject)
 *
 * Appends a new data row to the sheet.
 *
 * FIX for month_key auto-conversion:
 *   sheet.appendRow() writes values and lets Sheets apply its own type
 *   detection — "2026-03" gets converted to a Date before we can stop it.
 *
 *   Instead we:
 *     1. Append a placeholder row (all values EXCEPT string columns, which
 *        get empty strings as placeholders).
 *     2. For each string column (month_key, key), set the cell's number
 *        format to @STRING@ FIRST, then write the value. This order is
 *        critical — setting the format after writing does not undo the
 *        auto-conversion that already happened.
 *
 *   Actually, the safest approach is to use sheet.getRange().setValues()
 *   for the entire row after setting @STRING@ on string columns, rather
 *   than using sheet.appendRow() at all. This gives us full control.
 *
 * Returns the 1-indexed sheet row number of the new row.
 */
function appendRow(sheetName, rowObject) {
  var sheet   = getSheet(sheetName);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function(h) { return String(h).trim(); });

  // Determine which column indices are string columns (0-indexed).
  var stringColIndices = [];
  headers.forEach(function(h, idx) {
    if (STRING_COLUMNS.indexOf(h) !== -1) {
      stringColIndices.push(idx);
    }
  });

  // The new row goes after the last row with content.
  var newRowNum = sheet.getLastRow() + 1;

  // Step 1: Apply @STRING@ format to string columns in the new row BEFORE
  // writing any values. This tells Sheets to treat whatever we write as
  // plain text, not a date or number.
  stringColIndices.forEach(function(colIdx) {
    sheet.getRange(newRowNum, colIdx + 1).setNumberFormat('@STRING@');
  });

  // Step 2: Build the values array.
  var values = headers.map(function(h) {
    var val = rowObject[h];
    return (val === undefined || val === null) ? '' : val;
  });

  // Step 3: Write the entire row as a single setValues() call.
  // Using setValues instead of appendRow means Sheets uses the number format
  // we just applied (Plain Text) rather than auto-detecting the type.
  sheet.getRange(newRowNum, 1, 1, lastCol).setValues([values]);

  SpreadsheetApp.flush();

  return newRowNum;
}

/**
 * updateRow(sheetName, rowIndex, rowObject)
 *
 * Overwrites the row at rowIndex (1-indexed).
 * Applies @STRING@ to string columns before writing, same as appendRow.
 */
function updateRow(sheetName, rowIndex, rowObject) {
  var sheet   = getSheet(sheetName);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function(h) { return String(h).trim(); });

  // Apply @STRING@ to string columns in this row before writing.
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

/**
 * deleteRow(sheetName, rowIndex)
 * Deletes the row at rowIndex (1-indexed sheet row number).
 */
function deleteRow(sheetName, rowIndex) {
  var sheet = getSheet(sheetName);
  sheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
}

/**
 * clearSheetData(sheetName)
 * Deletes all data rows, preserving the header row.
 */
function clearSheetData(sheetName) {
  var sheet   = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
}


// ─── ROW LOOKUP ───────────────────────────────────────────────────────────────

/**
 * findRowIndex(sheetName, matchFn)
 *
 * Returns the 1-indexed sheet row number of the first row satisfying matchFn.
 * Returns -1 if no match is found.
 */
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
      return i + 1; // Convert from 0-indexed array to 1-indexed sheet row.
    }
  }
  return -1;
}


// ─── SHEET INITIALISATION ─────────────────────────────────────────────────────

/**
 * initSheets()
 *
 * One-time setup. Creates all sheet tabs with headers.
 * Applies @STRING@ to all string columns from row 2 down.
 * Safe to re-run — existing data is never overwritten.
 */
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
      headerRange.setBackground('#f0f0f0');
      Logger.log('initSheets: Wrote headers for "' + sheetName + '"');
    }

    // Always (re-)apply @STRING@ to string columns, even on existing sheets.
    _applyStringFormats(sheet, headers);
  });

  Logger.log('initSheets: Complete. ' + Object.keys(SHEET_HEADERS).length + ' sheets ready.');
}

/**
 * _applyStringFormats(sheet, headers)
 *
 * Applies @STRING@ number format to all string columns (month_key, key) from
 * row 2 down to row 2000. This prevents Sheets from auto-converting values
 * that are written into those columns.
 *
 * Must be called at initSheets time AND after provisioning new user sheets
 * (via UserManager._provisionUserSheets).
 */
function _applyStringFormats(sheet, headers) {
  var lastDataRow = Math.max(sheet.getLastRow(), 2);
  var maxRows     = Math.max(lastDataRow, 2000); // protect future rows too

  headers.forEach(function(h, idx) {
    if (STRING_COLUMNS.indexOf(h) !== -1) {
      sheet.getRange(2, idx + 1, maxRows, 1).setNumberFormat('@STRING@');
    }
  });
}


// ─── UTILITIES ────────────────────────────────────────────────────────────────

/**
 * generateId()
 * Returns a v4 UUID string used as the primary key for every new row.
 */
function generateId() {
  return Utilities.getUuid();
}

/**
 * headersToMap(headers)
 * Converts a header array to a { headerName: columnIndex } map (0-based).
 */
function headersToMap(headers) {
  var map = {};
  headers.forEach(function(h, i) { map[String(h).trim()] = i; });
  return map;
}

/**
 * _dateToMonthKey(date)
 *
 * Converts a JS Date (created by Sheets auto-converting "2026-03") back to
 * the original "YYYY-MM" string.
 *
 * WHY WAT (UTC+1):
 *   The spreadsheet timezone is Africa/Lagos (WAT = UTC+1).
 *   When Sheets stores "2026-03" it internally represents it as
 *   2026-03-01T00:00:00 WAT = 2026-02-28T23:00:00Z.
 *   Reading it back as a JS Date gives us 2026-02-28T23:00:00Z.
 *
 *   If we use UTC:   getUTCMonth() → February (WRONG — off by one month)
 *   If we use WAT:   add 1 hour first → 2026-03-01T00:00:00Z
 *                    getUTCMonth() → March (CORRECT)
 *
 *   This is the root cause of the "transaction goes to previous month on
 *   refresh" bug. The fix is to consistently apply the WAT offset here.
 *
 * NOTE: There is an edge case at month boundaries near midnight WAT, but
 * since month_key is always written as a string by the client ("2026-03")
 * and we are only ever recovering from Sheets' own auto-conversion, the
 * WAT offset always gives us the right month.
 */
function _dateToMonthKey(date) {
  // Add 1 hour to convert from UTC storage to WAT (Africa/Lagos, UTC+1).
  var wat = new Date(date.getTime() + 60 * 60 * 1000);
  var y   = wat.getUTCFullYear();
  var m   = wat.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}


/**
 * reinitGoalsSheet()
 *
 * One-time migration helper for the month-scoped goals schema change.
 * Run ONCE from the Apps Script editor after deploying this branch.
 */
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
  sheet.getRange(1, 1, 1, newHeaders.length).setBackground('#f0f0f0');

  _applyStringFormats(sheet, newHeaders);

  SpreadsheetApp.flush();

  Logger.log(
    'reinitGoalsSheet: Done. "' + sheetName + '" cleared and ' +
    'reinitialized with schema: [' + newHeaders.join(', ') + ']'
  );
}
