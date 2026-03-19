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
 *   On first login, provisionUser() creates all 8 sheets for that user.
 *   Subsequent logins reuse existing sheets.
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
 *   This is the critical change from Phase 1's USER_DEPLOYING.
 *
 * CALLED BY:
 *   Main.gs (doGet, getBootstrapData), all domain .gs files via getCurrentUserKey()
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var USERS_SHEET_NAME = 'Users';

// Headers for the Users registry sheet
var USERS_HEADERS = ['user_key', 'email', 'display_name', 'created_at', 'last_login'];


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
 * If not found, provisions a new user (creates all their sheets).
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

  // New user — provision their sheets.
  var displayName = email.split('@')[0]; // simple default display name
  var profile = {
    user_key:     userKey,
    email:        email,
    display_name: displayName,
    created_at:   now,
    last_login:   now
  };

  appendRow(USERS_SHEET_NAME, profile);
  _provisionUserSheets(userKey);

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


// ─── SCOPED SHEET HELPERS ────────────────────────────────────────────────────
//
// These wrap SheetHelper functions to automatically prepend the current
// user's key to sheet names. All domain .gs files should call these
// instead of the raw SheetHelper functions when multi-user is active.

/**
 * getUserSheetName(logicalName)
 *
 * Returns the full sheet name for the current user and a logical sheet name.
 * e.g. getUserSheetName('Transactions') → 'a3f9b1:Transactions'
 */
function getUserSheetName(logicalName) {
  return getCurrentUserKey() + ':' + logicalName;
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
