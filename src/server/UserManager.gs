/**
 * UserManager.gs — Multi-User Data Layer
 *
 * FIX: _provisionUserSheets() now calls _applyStringFormats() after creating
 * each user sheet. Without this, user sheets had no @STRING@ format on the
 * month_key column, causing Sheets to auto-convert "2026-03" to a Date cell
 * on every appendRow() call — which manifested as transactions appearing in
 * the wrong month after a page refresh.
 *
 * All other logic is unchanged from the original.
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var USERS_SHEET_NAME = 'Users';
var USERS_HEADERS    = ['user_key', 'email', 'display_name', 'created_at', 'last_login'];

var _LOGICAL_NAME_MAP = {
  // Uppercase logical names (used by .gs files)
  'TRANSACTIONS':    'Transactions',
  'GOALS':           'Goals',
  'BILLS':           'Bills',
  'BILL_HISTORY':    'BillHistory',
  'SAVINGS_GOALS':   'SavingsGoals',
  'SAVINGS_HISTORY': 'SavingsHistory',
  'DEBTS':           'Debts',
  'DEBT_HISTORY':    'DebtHistory',
  'NET_WORTH':       'NetWorth',
  'RECURRING':       'Recurring',
  'PREFERENCES':     'Preferences',
  // PascalCase (for getUserSheetName direct calls)
  'Transactions':    'Transactions',
  'Goals':           'Goals',
  'Bills':           'Bills',
  'BillHistory':     'BillHistory',
  'SavingsGoals':    'SavingsGoals',
  'SavingsHistory':  'SavingsHistory',
  'Debts':           'Debts',
  'DebtHistory':     'DebtHistory',
  'NetWorth':        'NetWorth',
  'Recurring':       'Recurring',
  'Preferences':     'Preferences'
};


// ─── CURRENT USER ─────────────────────────────────────────────────────────────

function getCurrentUserEmail() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error(
      'UserManager.gs: No active user session. ' +
      'Ensure executeAs is set to USER_ACCESSING in appsscript.json.'
    );
  }
  return email;
}

function getCurrentUserKey() {
  return _hashEmail(getCurrentUserEmail());
}

function getCurrentUserProfile() {
  return getOrCreateUser(getCurrentUserEmail());
}


// ─── USER PROVISIONING ────────────────────────────────────────────────────────

function getOrCreateUser(email) {
  _ensureUsersSheet();

  var userKey  = _hashEmail(email);
  var users    = getAllRows(USERS_SHEET_NAME);
  var existing = users.find(function(u) {
    return String(u.email || '').toLowerCase() === email.toLowerCase();
  });

  var now = new Date().toISOString();

  if (existing) {
    var rowIndex = findRowIndex(USERS_SHEET_NAME, function(row) {
      return String(row.email || '').toLowerCase() === email.toLowerCase();
    });
    if (rowIndex !== -1) {
      var updated = Object.assign({}, existing, { last_login: now });
      updateRow(USERS_SHEET_NAME, rowIndex, updated);
    }
    return existing;
  }

  var displayName = email.split('@')[0];
  var profile = {
    user_key:     userKey,
    email:        email,
    display_name: displayName,
    created_at:   now,
    last_login:   now
  };

  _provisionUserSheets(userKey);
  _seedDefaultPreferences(userKey);
  appendRow(USERS_SHEET_NAME, profile);

  Logger.log('UserManager.gs: Provisioned new user ' + email + ' (key: ' + userKey + ')');
  return profile;
}

/**
 * _provisionUserSheets(userKey)
 *
 * Creates all data sheets for a new user (all keys in SHEET_HEADERS).
 * Applies @STRING@ format to string columns immediately after creation.
 * Now includes SavingsHistory automatically.
 */
function _provisionUserSheets(userKey) {
  var ss = getSpreadsheet();

  Object.keys(SHEET_HEADERS).forEach(function(logicalName) {
    var sheetName = userKey + ':' + logicalName;
    var existing  = ss.getSheetByName(sheetName);

    if (!existing) {
      var sheet   = ss.insertSheet(sheetName);
      var headers = SHEET_HEADERS[logicalName];

      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

      _applyStringFormats(sheet, headers);

      SpreadsheetApp.flush();
      Logger.log('UserManager.gs: Created sheet "' + sheetName + '" with string formats applied.');
    } else {
      var headers = SHEET_HEADERS[logicalName];
      _applyStringFormats(existing, headers);
    }
  });
}

/**
 * _seedDefaultPreferences(userKey)
 * Writes the default preference rows into the new user's Preferences sheet.
 * Includes bills_alert_days default of 5.
 */
function _seedDefaultPreferences(userKey) {
  var prefsSheetName = userKey + ':Preferences';
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(prefsSheetName);

  if (!sheet) {
    Logger.log('UserManager.gs: _seedDefaultPreferences — sheet "' + prefsSheetName + '" not found, skipping.');
    return;
  }

  var defaultRows = [
    ['currency',         'NGN'],
    ['dark_mode',        'false'],
    ['bills_alert_days', '5'],
    ['categories',       JSON.stringify(DEFAULT_CATEGORIES)]
  ];

  var lastRow = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(lastRow + 1, 1, defaultRows.length, 1).setNumberFormat('@STRING@');

  defaultRows.forEach(function(row) {
    sheet.getRange(lastRow + 1, 1, 1, 2).setValues([row]);
    lastRow++;
  });

  SpreadsheetApp.flush();
  Logger.log(
    'UserManager.gs: _seedDefaultPreferences — seeded ' +
    defaultRows.length + ' rows for key "' + userKey + '".'
  );
}


// ─── SCOPED SHEET HELPERS ─────────────────────────────────────────────────────

function getUserSheetName(logicalName) {
  var resolvedName = _LOGICAL_NAME_MAP[logicalName] || logicalName;
  return getCurrentUserKey() + ':' + resolvedName;
}

function getUserAllRows(logicalName) {
  return getAllRows(getUserSheetName(logicalName));
}

function getUserRowsByFilter(logicalName, filterFn) {
  return getRowsByFilter(getUserSheetName(logicalName), filterFn);
}

function getUserAppendRow(logicalName, rowObject) {
  return appendRow(getUserSheetName(logicalName), rowObject);
}

function getUserUpdateRow(logicalName, rowIndex, rowObject) {
  return updateRow(getUserSheetName(logicalName), rowIndex, rowObject);
}

function getUserDeleteRow(logicalName, rowIndex) {
  return deleteRow(getUserSheetName(logicalName), rowIndex);
}

function getUserFindRowIndex(logicalName, filterFn) {
  return findRowIndex(getUserSheetName(logicalName), filterFn);
}


// ─── ADMIN HELPERS ────────────────────────────────────────────────────────────

function getAllUsers() {
  _ensureUsersSheet();
  return getAllRows(USERS_SHEET_NAME);
}

function getUserCount() {
  return getAllUsers().length;
}

function deleteUserData(email) {
  var userKey = _hashEmail(email);
  var ss      = getSpreadsheet();
  var deleted = 0;

  ss.getSheets().forEach(function(sheet) {
    if (sheet.getName().startsWith(userKey + ':')) {
      ss.deleteSheet(sheet);
      deleted++;
    }
  });

  var rowIndex = findRowIndex(USERS_SHEET_NAME, function(row) {
    return String(row.email || '').toLowerCase() === email.toLowerCase();
  });
  if (rowIndex !== -1) deleteRow(USERS_SHEET_NAME, rowIndex);

  Logger.log('UserManager.gs: Deleted user ' + email + ' (' + deleted + ' sheets removed)');
  return { deleted_sheets: deleted };
}


// ─── SETUP ────────────────────────────────────────────────────────────────────

function initMultiUser() {
  _ensureUsersSheet();
  Logger.log('UserManager.gs: Multi-user setup complete. Users sheet ready.');
}

/**
 * fixExistingUserSheets()
 * One-time migration — applies @STRING@ format to all string columns
 * for every existing user's sheets.
 */
function fixExistingUserSheets() {
  var ss      = getSpreadsheet();
  var sheets  = ss.getSheets();
  var fixed   = 0;

  sheets.forEach(function(sheet) {
    var name = sheet.getName();

    // Only process user data sheets (format: "xxxxxx:SheetName")
    if (!name.match(/^[a-z0-9]{6}:/)) return;

    // Extract the logical sheet name after the colon.
    var logicalName = name.split(':').slice(1).join(':');
    var headers     = SHEET_HEADERS[logicalName];

    // Skip sheets we don't recognise (e.g. Users registry).
    if (!headers) return;

    _applyStringFormats(sheet, headers);
    fixed++;
    Logger.log('fixExistingUserSheets: Applied string formats to "' + name + '"');
  });

  SpreadsheetApp.flush();
  Logger.log('fixExistingUserSheets: Done. Fixed ' + fixed + ' sheet(s).');
}


// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

function _ensureUsersSheet() {
  var ss       = getSpreadsheet();
  var existing = ss.getSheetByName(USERS_SHEET_NAME);
  if (!existing) {
    var sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.getRange(1, 1, 1, USERS_HEADERS.length).setValues([USERS_HEADERS]);
    sheet.getRange(1, 1, 1, USERS_HEADERS.length).setFontWeight('bold');
    SpreadsheetApp.flush();
    Logger.log('UserManager.gs: Created Users registry sheet.');
  }
}

function _hashEmail(email) {
  var str  = String(email).toLowerCase().trim();
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0x7FFFFFFF;
  }
  var encoded = hash.toString(36);
  while (encoded.length < 6) encoded = '0' + encoded;
  return encoded.slice(0, 6);
}
