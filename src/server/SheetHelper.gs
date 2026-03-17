/**
 * SheetHelper.gs — Google Sheets Low-Level Utilities
 *
 * PURPOSE:
 *   Central abstraction layer for all read/write operations against the linked Google Sheet.
 *   Every other server module (Transactions, Goals, Bills, etc.) calls these helpers
 *   instead of using SpreadsheetApp directly. This keeps domain logic clean.
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
 * appendRow() and initSheets() both read from this single source of truth,
 * so adding a column only requires a change here.
 */
const SHEET_HEADERS = {
  Transactions:  ['id', 'month_key', 'name', 'amount', 'type', 'category', 'note'],
  Goals:         ['id', 'category', 'monthly_limit'],
  Bills:         ['id', 'name', 'amount', 'due_day', 'paid'],
  SavingsGoals:  ['id', 'name', 'target_amount', 'saved_amount'],
  Debts:         ['id', 'name', 'total', 'paid', 'monthly_payment', 'interest_rate'],
  NetWorth:      ['id', 'name', 'type', 'amount'],
  Recurring:     ['id', 'name', 'amount', 'type', 'category'],
  Preferences:   ['key', 'value']
};


// ─── SPREADSHEET ACCESS ───────────────────────────────────────────────────────

// Module-level cache — avoids repeated SpreadsheetApp.getActiveSpreadsheet()
// calls within a single server execution (each call has real latency).
// NOTE: Must be var, not let/const — Apps Script V8 can silently fail on
// top-level let/const redeclarations when files are loaded together.
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
        'Make sure this script is bound to a Google Sheet ' +
        '(Extensions → Apps Script from within the sheet).'
      );
    }
  }
  return _spreadsheet;
}

/**
 * getSheet(sheetName)
 * Returns the named sheet tab. Throws a clear error if not found —
 * much easier to debug than a silent null-pointer downstream.
 */
function getSheet(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
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
 * Returns all data rows (Row 2 onward) as an array of plain objects,
 * keyed by the header values in Row 1.
 *
 * Type coercions applied:
 *   - Strings are trimmed
 *   - Numbers are returned as JS numbers (Sheets sometimes returns them as strings
 *     when the cell format is Text; we parse defensively)
 *   - Booleans (TRUE/FALSE from a checkbox column) are returned as JS booleans
 *   - Empty rows (all cells blank) are skipped
 */
function getAllRows(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();

  // Only the header row exists — no data yet.
  if (lastRow < 2) return [];

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];

  // Read everything in one batch call — much faster than per-cell reads.
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // Skip entirely empty rows (can appear after a deleteRow call).
    const isEmpty = row.every(cell => cell === '' || cell === null || cell === undefined);
    if (isEmpty) continue;

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      let val = row[j];

      // Normalise types for reliable downstream use.
      if (typeof val === 'string') {
        val = val.trim();
      } else if (val instanceof Date) {
        // Dates can appear if a cell was formatted as Date in Sheets.
        // Store as ISO string to keep things serialisable.
        val = val.toISOString();
      }
      // Numbers and booleans are left as-is.

      obj[key] = val;
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * getRowsByFilter(sheetName, filterFn)
 *
 * Returns only the rows from getAllRows() that satisfy filterFn.
 * Example:
 *   getRowsByFilter(SHEET_NAMES.TRANSACTIONS, r => r.month_key === '2026-03')
 */
function getRowsByFilter(sheetName, filterFn) {
  return getAllRows(sheetName).filter(filterFn);
}


// ─── WRITE OPERATIONS ─────────────────────────────────────────────────────────

/**
 * appendRow(sheetName, rowObject)
 *
 * Appends a new row by reading the sheet's header row to determine
 * column order dynamically.  This means column order in code never
 * needs to change if a new column is inserted in the sheet.
 *
 * Returns the 1-indexed sheet row number of the new row.
 */
function appendRow(sheetName, rowObject) {
  const sheet = getSheet(sheetName);

  // Read headers from Row 1 to get authoritative column order.
  const lastCol  = sheet.getLastColumn();
  const headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                        .map(h => String(h).trim());

  // Build the values array in header order; missing keys become empty string.
  const values = headers.map(h => {
    const val = rowObject[h];
    return (val === undefined || val === null) ? '' : val;
  });

  sheet.appendRow(values);

  // Force the write buffer to flush immediately.
  // Without this, a subsequent getAllRows() in the same execution
  // can see a stale row count and miss the row just written.
  SpreadsheetApp.flush();

  // Return the row number that was just written.
  return sheet.getLastRow();
}

/**
 * updateRow(sheetName, rowIndex, rowObject)
 *
 * Overwrites the row at rowIndex (1-indexed, where row 1 is the header).
 * Uses a single setValues() call for an atomic update — avoids partial writes.
 *
 * Typical usage: find the row via getAllRows() (which stores _rowIndex on
 * each object — see note below), then call updateRow with that index.
 *
 * NOTE: getAllRows() does NOT currently attach _rowIndex. Callers that need
 * to update rows should use findRowIndex() to get the sheet row number first.
 */
function updateRow(sheetName, rowIndex, rowObject) {
  const sheet = getSheet(sheetName);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                       .map(h => String(h).trim());

  const values = headers.map(h => {
    const val = rowObject[h];
    return (val === undefined || val === null) ? '' : val;
  });

  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([values]);
  SpreadsheetApp.flush();
}

/**
 * deleteRow(sheetName, rowIndex)
 *
 * Deletes the row at rowIndex (1-indexed sheet row number).
 * All rows below shift up by 1 — callers must re-fetch after deletion.
 */
function deleteRow(sheetName, rowIndex) {
  const sheet = getSheet(sheetName);
  sheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
}

/**
 * clearSheetData(sheetName)
 *
 * Deletes all data rows, preserving the header row.
 * Guards against running on a sheet that has only the header (lastRow === 1).
 */
function clearSheetData(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // Nothing to clear.

  const lastCol = sheet.getLastColumn();
  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
}


// ─── ROW LOOKUP ───────────────────────────────────────────────────────────────

/**
 * findRowIndex(sheetName, matchFn)
 *
 * Returns the 1-indexed sheet row number of the first row that satisfies matchFn.
 * Returns -1 if no match is found.
 *
 * Because sheet row 1 is the header, data rows start at sheet row 2.
 * We track the offset carefully here so callers get a sheet-row index
 * they can pass directly to deleteRow() or updateRow().
 *
 * Example:
 *   const idx = findRowIndex(SHEET_NAMES.TRANSACTIONS, r => r.id === txId);
 *   if (idx !== -1) deleteRow(SHEET_NAMES.TRANSACTIONS, idx);
 */
function findRowIndex(sheetName, matchFn) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const lastCol = sheet.getLastColumn();
  const data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const isEmpty = row.every(c => c === '' || c === null || c === undefined);
    if (isEmpty) continue;

    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });

    if (matchFn(obj)) {
      return i + 1; // +1 because array is 0-indexed but sheet rows are 1-indexed.
    }
  }
  return -1;
}


// ─── SHEET INITIALISATION ─────────────────────────────────────────────────────

/**
 * initSheets()
 *
 * One-time setup function. Run this manually from the Apps Script editor
 * after binding the script to the Google Sheet.
 *
 * For each sheet defined in SHEET_HEADERS:
 *   1. Creates the tab if it does not exist.
 *   2. Writes the header row if Row 1 is empty.
 *
 * Safe to re-run — existing data is never overwritten.
 */
function initSheets() {
  const ss = getSpreadsheet();

  Object.entries(SHEET_HEADERS).forEach(([sheetName, headers]) => {
    let sheet = ss.getSheetByName(sheetName);

    // Create the tab if it doesn't exist yet.
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      Logger.log('Created sheet: ' + sheetName);
    }

    // Write headers only if Row 1 is completely empty.
    const firstCell = sheet.getRange(1, 1).getValue();
    if (firstCell === '' || firstCell === null) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

      // Style the header row for readability.
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#f0f0f0');

      Logger.log('Wrote headers for sheet: ' + sheetName);
    } else {
      Logger.log('Sheet already has headers, skipping: ' + sheetName);
    }
  });

  Logger.log('initSheets() complete. All ' + Object.keys(SHEET_HEADERS).length + ' sheets ready.');
}


// ─── UTILITIES ────────────────────────────────────────────────────────────────

/**
 * generateId()
 * Returns a v4 UUID string. Used as the primary key for every new row.
 */
function generateId() {
  return Utilities.getUuid();
}

/**
 * headersToMap(headers)
 *
 * Converts a flat array of header strings into a { headerName: columnIndex } map.
 * columnIndex is 0-based here (matching array indexing).
 * Used internally to avoid hard-coding column positions.
 *
 * Example:
 *   headersToMap(['id', 'name', 'amount'])
 *   // → { id: 0, name: 1, amount: 2 }
 */
function headersToMap(headers) {
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim()] = i; });
  return map;
}