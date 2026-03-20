/**
 * UserManager.gs — Multi-User Data Layer
 *
 * PURPOSE:
 *   Provides per-user data isolation within a single Apps Script project.
 *   Each authenticated Google user gets their own set of sheet tabs,
 *   namespaced by a short hash of their email address.
 *
 * HOW IT WORKS:
 *   When executeAs is set to USER_ACCESSING in appsscript.json, Apps Script
 *   runs as the visiting user. Session.getActiveUser().getEmail() returns
 *   their real Google account email.
 *
 *   All sheet names are prefixed with a 6-char user key derived from their
 *   email. e.g. "a3f9b1:Transactions", "a3f9b1:Goals", etc.
 *
 *   On first login, getOrCreateUser() calls _provisionUserSheets() to create
 *   all 8 data sheets, then immediately calls _seedDefaultPreferences() to
 *   write the full typed category list into the user's Preferences sheet.
 *   This ensures new users always start with the complete category set
 *   rather than falling back to the in-code defaults.
 *
 * ROOT CAUSE FIX — sheet name key resolution:
 *   Domain files (Bills.gs, Goals.gs, etc.) pass SHEET_NAMES constant keys
 *   (e.g. 'BILLS', 'GOALS', 'SAVINGS_GOALS') to the getUserXxx() helpers,
 *   while getAllRows() read calls pass the actual sheet names ('Bills', 'Goals',
 *   'SavingsGoals'). getUserSheetName() now resolves both forms to the correct
 *   actual sheet name via _LOGICAL_NAME_MAP before constructing the full name.
 *   Without this, writes went to non-existent sheets (e.g. 'a3f9b1:BILLS')
 *   while reads succeeded on the real sheet ('a3f9b1:Bills'), causing data to
 *   appear after adding but disappear on refresh.
 *
 * SHEET NAMING:
 *   {userKey}:{SheetName}
 *   e.g. "a3f9b1:Transactions", "a3f9b1:Goals", "a3f9b1:Preferences"
 *
 * USER REGISTRY:
 *   A special "Users" sheet tracks registered users:
 *   COLUMNS: user_key | email | display_name | created_at | last_login
 *
 * APPSSCRIPT.JSON REQUIREMENT:
 *   "webapp": { "executeAs": "USER_ACCESSING", "access": "DOMAIN" }
 *   — or "ANYONE_WITH_GOOGLE_ACCOUNT" for public access
 *
 * CALLED BY:
 *   Main.gs (doGet, getBootstrapData), all domain .gs files via getCurrentUserKey()
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var USERS_SHEET_NAME = 'Users';

// Headers for the Users registry sheet
var USERS_HEADERS = ['user_key', 'email', 'display_name', 'created_at', 'last_login'];

/**
 * _LOGICAL_NAME_MAP
 *
 * Maps every form a domain file might pass as a "logical name" to the
 * canonical actual sheet name used when constructing "{userKey}:{SheetName}".
 *
 * Domain files historically used two different conventions:
 *   - Read calls:  pass the real sheet name   e.g. 'Bills', 'Goals', 'SavingsGoals'
 *   - Write calls: pass the SHEET_NAMES key   e.g. 'BILLS', 'GOALS', 'SAVINGS_GOALS'
 *
 * Both forms are listed here so getUserSheetName() normalises them to the
 * same canonical name before building the full "{userKey}:{name}" string.
 *
 * If a value is not in this map it is passed through unchanged — this is safe
 * for any future sheet added to SHEET_HEADERS that hasn't been listed yet.
 */
var _LOGICAL_NAME_MAP = {
  // SHEET_NAMES constant keys (uppercase, used by write paths in domain files)
  'TRANSACTIONS':  'Transactions',
  'GOALS':         'Goals',
  'BILLS':         'Bills',
  'SAVINGS_GOALS': 'SavingsGoals',
  'DEBTS':         'Debts',
  'NET_WORTH':     'NetWorth',
  'RECURRING':     'Recurring',
  'PREFERENCES':   'Preferences',

  // Actual sheet names (used by read paths and some write paths — map to themselves
  // so the lookup is always safe regardless of which form was passed).
  'Transactions':  'Transactions',
  'Goals':         'Goals',
  'Bills':         'Bills',
  'SavingsGoals':  'SavingsGoals',
  'Debts':         'Debts',
  'NetWorth':      'NetWorth',
  'Recurring':     'Recurring',
  'Preferences':   'Preferences'
};


// ─── CURRENT USER ─────────────────────────────────────────────────────────────

/**
 * getCurrentUserEmail()
 *
 * Returns the active user's Google email.
 * Throws if the script is not running as USER_ACCESSING or user is not signed in.
 */
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

/**
 * getCurrentUserKey()
 *
 * Returns the 6-character user key for the current session user.
 * This key is used as a prefix on all sheet names for this user.
 *
 * The key is derived from a simple hash of the email address.
 * It is NOT cryptographically secure — it is a namespace key, not a secret.
 */
function getCurrentUserKey() {
  var email = getCurrentUserEmail();
  return _hashEmail(email);
}

/**
 * getCurrentUserProfile()
 *
 * Returns the full user profile object for the current session user.
 * Creates the user if this is their first visit.
 *
 * Returns: { user_key, email, display_name, created_at, last_login }
 */
function getCurrentUserProfile() {
  var email = getCurrentUserEmail();
  return getOrCreateUser(email);
}


// ─── USER PROVISIONING ────────────────────────────────────────────────────────

/**
 * getOrCreateUser(email)
 *
 * Looks up the user by email in the Users registry.
 * If not found:
 *   1. Provisions all 8 data sheets for the new user.
 *   2. Seeds default preferences (typed category list) into their
 *      Preferences sheet — server-authoritative defaults.
 *   3. Registers the user in the Users registry.
 *
 * Updates last_login timestamp on every call.
 *
 * Returns the user profile object.
 */
function getOrCreateUser(email) {
  _ensureUsersSheet();

  var userKey = _hashEmail(email);
  var users   = getAllRows(USERS_SHEET_NAME);
  var existing = users.find(function(u) {
    return String(u.email || '').toLowerCase() === email.toLowerCase();
  });

  var now = new Date().toISOString();

  if (existing) {
    // Update last_login.
    var rowIndex = findRowIndex(USERS_SHEET_NAME, function(row) {
      return String(row.email || '').toLowerCase() === email.toLowerCase();
    });
    if (rowIndex !== -1) {
      var updated = Object.assign({}, existing, { last_login: now });
      updateRow(USERS_SHEET_NAME, rowIndex, updated);
    }
    return existing;
  }

  // New user — provision their data sheets first.
  var displayName = email.split('@')[0]; // simple default display name
  var profile = {
    user_key:     userKey,
    email:        email,
    display_name: displayName,
    created_at:   now,
    last_login:   now
  };

  // Step 1: Create all 8 data sheet tabs with headers.
  _provisionUserSheets(userKey);

  // Step 2: Seed default preferences into the Preferences sheet so the
  // new user starts with the full typed category list rather than seeing
  // an empty sheet and relying on the in-code fallback in getAllPreferences().
  _seedDefaultPreferences(userKey);

  // Step 3: Register in the Users sheet.
  appendRow(USERS_SHEET_NAME, profile);

  Logger.log('UserManager.gs: Provisioned new user ' + email + ' (key: ' + userKey + ')');
  return profile;
}

/**
 * _provisionUserSheets(userKey)
 *
 * Creates all 8 data sheets for a new user, prefixed with their userKey.
 * Skips any sheets that already exist (safe to call multiple times).
 */
function _provisionUserSheets(userKey) {
  var ss = getSpreadsheet();

  Object.keys(SHEET_HEADERS).forEach(function(logicalName) {
    var sheetName = userKey + ':' + logicalName;
    var existing  = ss.getSheetByName(sheetName);

    if (!existing) {
      var sheet = ss.insertSheet(sheetName);
      var headers = SHEET_HEADERS[logicalName];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      SpreadsheetApp.flush();
      Logger.log('UserManager.gs: Created sheet "' + sheetName + '"');
    }
  });
}

/**
 * _seedDefaultPreferences(userKey)
 *
 * Writes the three default preference rows (currency, dark_mode, categories)
 * into the new user's Preferences sheet immediately after provisioning.
 *
 * This is the "pre-seed server-authoritative" approach: new users get the
 * full typed DEFAULT_CATEGORIES list written to their sheet on first login,
 * so getAllPreferences() always reads a populated sheet rather than relying
 * on the in-code fallback.
 *
 * Must be called AFTER _provisionUserSheets() so the sheet exists.
 *
 * Reads DEFAULT_CATEGORIES from Preferences.gs — both files live in the
 * same Apps Script project so the constant is always in scope.
 */
function _seedDefaultPreferences(userKey) {
  var prefsSheetName = userKey + ':Preferences';
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(prefsSheetName);

  if (!sheet) {
    Logger.log(
      'UserManager.gs: _seedDefaultPreferences() — sheet "' + prefsSheetName +
      '" not found, skipping seed.'
    );
    return;
  }

  // The Preferences sheet schema is: key | value
  // We write three rows: currency, dark_mode, categories.
  var defaultRows = [
    ['currency',   'NGN'],
    ['dark_mode',  'false'],
    ['categories', JSON.stringify(DEFAULT_CATEGORIES)]
  ];

  // Append each preference row directly (bypassing the scoped helpers since
  // we are in the provisioning path and getCurrentUserKey() would return
  // the wrong key if provisioning is triggered for a different user).
  var lastRow = Math.max(sheet.getLastRow(), 1);
  defaultRows.forEach(function(row) {
    sheet.getRange(lastRow + 1, 1, 1, 2).setValues([row]);
    lastRow++;
  });

  SpreadsheetApp.flush();
  Logger.log(
    'UserManager.gs: _seedDefaultPreferences() — seeded ' +
    defaultRows.length + ' preference rows for key "' + userKey + '".'
  );
}


// ─── SCOPED SHEET HELPERS ─────────────────────────────────────────────────────
//
// These wrap SheetHelper functions to automatically prepend the current
// user's key to sheet names. All domain .gs files call these instead of
// the raw SheetHelper functions.
//
// KEY FIX: getUserSheetName() resolves the incoming logicalName through
// _LOGICAL_NAME_MAP before building the full sheet name. This means both
// 'Bills' (read-path convention) and 'BILLS' (write-path convention) resolve
// to the same canonical name 'Bills', constructing 'a3f9b1:Bills' in both
// cases. Without this, writes used 'a3f9b1:BILLS' (non-existent) while reads
// used 'a3f9b1:Bills' (real), causing the data persistence bug.

/**
 * getUserSheetName(logicalName)
 *
 * Resolves logicalName through _LOGICAL_NAME_MAP (handling both uppercase
 * SHEET_NAMES keys and actual sheet names), then returns the full scoped
 * sheet name for the current user.
 *
 * Examples:
 *   getUserSheetName('BILLS')         → 'a3f9b1:Bills'        (was 'a3f9b1:BILLS' ✗)
 *   getUserSheetName('Bills')         → 'a3f9b1:Bills'        ✓
 *   getUserSheetName('SAVINGS_GOALS') → 'a3f9b1:SavingsGoals' (was 'a3f9b1:SAVINGS_GOALS' ✗)
 *   getUserSheetName('SavingsGoals')  → 'a3f9b1:SavingsGoals' ✓
 *   getUserSheetName('NET_WORTH')     → 'a3f9b1:NetWorth'     (was 'a3f9b1:NET_WORTH' ✗)
 */
function getUserSheetName(logicalName) {
  // Resolve through the map; fall back to the raw value if not listed.
  var resolvedName = _LOGICAL_NAME_MAP[logicalName] || logicalName;
  return getCurrentUserKey() + ':' + resolvedName;
}

/**
 * getUserAllRows(logicalName)
 * Scoped version of getAllRows() for the current user.
 */
function getUserAllRows(logicalName) {
  return getAllRows(getUserSheetName(logicalName));
}

/**
 * getUserRowsByFilter(logicalName, filterFn)
 * Scoped version of getRowsByFilter() for the current user.
 */
function getUserRowsByFilter(logicalName, filterFn) {
  return getRowsByFilter(getUserSheetName(logicalName), filterFn);
}

/**
 * getUserAppendRow(logicalName, rowObject)
 * Scoped version of appendRow() for the current user.
 */
function getUserAppendRow(logicalName, rowObject) {
  return appendRow(getUserSheetName(logicalName), rowObject);
}

/**
 * getUserUpdateRow(logicalName, rowIndex, rowObject)
 * Scoped version of updateRow() for the current user.
 */
function getUserUpdateRow(logicalName, rowIndex, rowObject) {
  return updateRow(getUserSheetName(logicalName), rowIndex, rowObject);
}

/**
 * getUserDeleteRow(logicalName, rowIndex)
 * Scoped version of deleteRow() for the current user.
 */
function getUserDeleteRow(logicalName, rowIndex) {
  return deleteRow(getUserSheetName(logicalName), rowIndex);
}

/**
 * getUserFindRowIndex(logicalName, filterFn)
 * Scoped version of findRowIndex() for the current user.
 */
function getUserFindRowIndex(logicalName, filterFn) {
  return findRowIndex(getUserSheetName(logicalName), filterFn);
}


// ─── ADMIN HELPERS ────────────────────────────────────────────────────────────

/**
 * getAllUsers()
 *
 * Returns all registered users from the Users registry sheet.
 * Admin utility — only the spreadsheet owner can call this directly.
 */
function getAllUsers() {
  _ensureUsersSheet();
  return getAllRows(USERS_SHEET_NAME);
}

/**
 * getUserCount()
 * Returns the number of registered users.
 */
function getUserCount() {
  return getAllUsers().length;
}

/**
 * deleteUserData(email)
 *
 * Deletes all sheet tabs belonging to a user and removes them from the registry.
 * Admin utility — use with caution. Data is not recoverable.
 */
function deleteUserData(email) {
  var userKey = _hashEmail(email);
  var ss      = getSpreadsheet();

  // Delete all user sheets.
  var deleted = 0;
  ss.getSheets().forEach(function(sheet) {
    if (sheet.getName().startsWith(userKey + ':')) {
      ss.deleteSheet(sheet);
      deleted++;
    }
  });

  // Remove from Users registry.
  var rowIndex = findRowIndex(USERS_SHEET_NAME, function(row) {
    return String(row.email || '').toLowerCase() === email.toLowerCase();
  });
  if (rowIndex !== -1) deleteRow(USERS_SHEET_NAME, rowIndex);

  Logger.log('UserManager.gs: Deleted user ' + email + ' (' + deleted + ' sheets removed)');
  return { deleted_sheets: deleted };
}


// ─── SETUP ────────────────────────────────────────────────────────────────────

/**
 * initMultiUser()
 *
 * One-time setup call. Creates the Users registry sheet.
 * Call from the Apps Script editor after deploying the multi-user update.
 * Safe to call multiple times — skips if sheet already exists.
 */
function initMultiUser() {
  _ensureUsersSheet();
  Logger.log('UserManager.gs: Multi-user setup complete. Users sheet ready.');
}


// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

/**
 * _ensureUsersSheet()
 * Creates the Users registry sheet if it doesn't exist.
 */
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

/**
 * _hashEmail(email)
 *
 * Produces a stable 6-character alphanumeric key from an email address.
 * Used as the sheet name prefix for each user's data.
 *
 * This is a simple djb2-style hash — deterministic, not cryptographic.
 * The same email always produces the same key.
 *
 * Collision probability across millions of users is non-trivial, but for
 * a personal-scale multi-user app (< 10,000 users) the risk is negligible.
 * If collision is a concern at scale, switch to Utilities.computeDigest()
 * with SHA-256 and take the first 8 hex chars.
 */
function _hashEmail(email) {
  var str  = String(email).toLowerCase().trim();
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0x7FFFFFFF; // keep positive 32-bit int
  }
  // Encode as base36 (digits + lowercase letters) and pad/truncate to 6 chars.
  var encoded = hash.toString(36);
  while (encoded.length < 6) encoded = '0' + encoded;
  return encoded.slice(0, 6);
}
