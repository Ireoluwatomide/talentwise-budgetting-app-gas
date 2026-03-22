/**
 * Diagnostic.gs — Bootstrap & Sheet Read Diagnostics
 *
 * PURPOSE:
 *   Run these functions directly from the Apps Script editor to identify
 *   exactly why data is not persisting on the UI after refresh.
 *
 * HOW TO USE:
 *   1. Open the Apps Script editor (Extensions → Apps Script)
 *   2. Select a function from the dropdown (e.g. diagFull)
 *   3. Click ▶ Run
 *   4. Open View → Logs to see the output
 *
 * Start with diagFull() — it runs everything and logs a clear summary.
 */


/**
 * diagFull()
 *
 * Master diagnostic — runs all checks and logs a clear summary.
 * This is the one to run first.
 */
function diagFull() {
  Logger.log('=== BUDGET TRACKER FULL DIAGNOSTIC ===');
  Logger.log('Time: ' + new Date().toISOString());
  Logger.log('');

  // 1. User identity
  diagUser();

  // 2. Sheet existence
  diagSheets();

  // 3. Sheet contents (row counts)
  diagSheetContents();

  // 4. What bootstrap actually returns
  diagBootstrap();

  Logger.log('=== END DIAGNOSTIC ===');
}


/**
 * diagUser()
 * Logs the current user email and derived key.
 */
function diagUser() {
  Logger.log('--- USER ---');
  try {
    var email = Session.getActiveUser().getEmail();
    Logger.log('Email: ' + (email || '(empty — this is the problem!)'));

    if (!email) {
      Logger.log('ERROR: No user email. executeAs must be USER_ACCESSING in appsscript.json');
      Logger.log('Current appsscript.json webapp config:');
      Logger.log('  "executeAs": "USER_ACCESSING"  ← must be this');
      Logger.log('  "access": "ANYONE"             ← or ANYONE_WITH_GOOGLE_ACCOUNT');
      return;
    }

    var key = _hashEmail(email);
    Logger.log('User key (hash): ' + key);
    Logger.log('Expected sheet prefix: ' + key + ':');
  } catch (e) {
    Logger.log('ERROR getting user: ' + e.message);
  }
  Logger.log('');
}


/**
 * diagSheets()
 * Lists all sheets in the spreadsheet and flags which belong to the current user.
 */
function diagSheets() {
  Logger.log('--- SHEETS IN SPREADSHEET ---');
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var email = Session.getActiveUser().getEmail();
    var key   = email ? _hashEmail(email) : '(unknown)';
    var prefix = key + ':';

    Logger.log('Total sheets: ' + sheets.length);

    var userSheets = [];
    sheets.forEach(function(sheet) {
      var name = sheet.getName();
      var rows = sheet.getLastRow();
      var isUser = name.startsWith(prefix);
      if (isUser) userSheets.push(name);
      Logger.log('  ' + (isUser ? '✓ ' : '  ') + name + ' (' + rows + ' rows)');
    });

    Logger.log('');
    Logger.log('User sheets found (' + userSheets.length + '/8 expected):');
    var expected = ['Transactions','Goals','Bills','SavingsGoals','Debts','NetWorth','Recurring','Preferences'];
    expected.forEach(function(name) {
      var full = prefix + name;
      var exists = userSheets.indexOf(full) !== -1;
      Logger.log('  ' + (exists ? '✓' : '✗ MISSING') + ' ' + full);
    });

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
  Logger.log('');
}


/**
 * diagSheetContents()
 * For each user sheet, logs the header row and all data rows.
 */
function diagSheetContents() {
  Logger.log('--- SHEET CONTENTS ---');
  try {
    var email = Session.getActiveUser().getEmail();
    if (!email) { Logger.log('No email — skipping'); return; }
    var key = _hashEmail(email);
    var ss  = getSpreadsheet();

    var sheetNames = ['Transactions','Goals','Bills','SavingsGoals','Debts','NetWorth','Recurring','Preferences'];

    sheetNames.forEach(function(name) {
      var fullName = key + ':' + name;
      var sheet    = ss.getSheetByName(fullName);

      if (!sheet) {
        Logger.log(name + ': SHEET NOT FOUND (' + fullName + ')');
        return;
      }

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();

      if (lastRow < 1) {
        Logger.log(name + ': empty (no rows at all)');
        return;
      }

      var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var headers = data[0];
      Logger.log(name + ': ' + (lastRow - 1) + ' data rows. Headers: [' + headers.join(', ') + ']');

      // Log up to 3 data rows for inspection
      for (var i = 1; i < Math.min(4, data.length); i++) {
        Logger.log('  Row ' + i + ': ' + JSON.stringify(data[i]));
      }
    });

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
  Logger.log('');
}


/**
 * diagBootstrap()
 * Runs getBootstrapData() and logs what each domain returns.
 * This shows exactly what the client receives on page load.
 */
function diagBootstrap() {
  Logger.log('--- BOOTSTRAP DATA ---');
  try {
    var data = getBootstrapData();

    Logger.log('curYear:  ' + data.curYear);
    Logger.log('curMonth: ' + data.curMonth);
    Logger.log('currency: ' + data.currency);
    Logger.log('darkMode: ' + data.darkMode);
    Logger.log('categories: ' + (data.categories || []).length + ' items');
    Logger.log('transactions: ' + Object.keys(data.transactions || {}).length + ' months');
    Logger.log('goals:        ' + (data.goals        || []).length + ' items');
    Logger.log('bills:        ' + (data.bills        || []).length + ' items');
    Logger.log('savingsGoals: ' + (data.savingsGoals || []).length + ' items');
    Logger.log('debts:        ' + (data.debts        || []).length + ' items');
    Logger.log('netWorthItems:' + (data.netWorthItems|| []).length + ' items');
    Logger.log('recurring:    ' + (data.recurring    || []).length + ' items');

    // Show first item of each non-empty array so we can inspect shape
    ['goals','bills','savingsGoals','debts','netWorthItems','recurring'].forEach(function(key) {
      var arr = data[key] || [];
      if (arr.length > 0) {
        Logger.log(key + '[0]: ' + JSON.stringify(arr[0]));
      }
    });

  } catch (e) {
    Logger.log('getBootstrapData() threw: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
  Logger.log('');
}


/**
 * diagWriteAndRead()
 *
 * Adds a test bill, immediately reads it back, and reports whether the
 * round-trip works. This isolates whether the problem is in write, read,
 * or bootstrap.
 *
 * Run this, then check the Apps Script Logs.
 * After running, delete the test row manually from the sheet.
 */
function diagWriteAndRead() {
  Logger.log('--- WRITE AND READ TEST ---');
  try {
    var email = Session.getActiveUser().getEmail();
    Logger.log('User: ' + email);
    Logger.log('Key:  ' + _hashEmail(email));

    // 1. Write a test bill directly
    var testBill = {
      id:      'DIAG-TEST-' + Date.now(),
      name:    'DIAGNOSTIC TEST BILL',
      amount:  999,
      due_day: 1,
      paid:    false
    };

    Logger.log('Writing test bill to BILLS sheet...');
    getUserAppendRow('BILLS', testBill);
    Logger.log('Write complete.');

    // 2. Read all bills back
    Logger.log('Reading all bills back...');
    var bills = getAllBills();
    Logger.log('getAllBills() returned ' + bills.length + ' bills');

    var found = bills.find(function(b) { return b.id === testBill.id; });
    if (found) {
      Logger.log('SUCCESS: Test bill found in read-back: ' + JSON.stringify(found));
    } else {
      Logger.log('FAILURE: Test bill NOT found in read-back!');
      Logger.log('All bill IDs: ' + bills.map(function(b) { return b.id; }).join(', '));
    }

    // 3. Check what sheet getUserSheetName resolves to
    Logger.log('getUserSheetName("BILLS") = ' + getUserSheetName('BILLS'));
    Logger.log('getUserSheetName("Bills") = ' + getUserSheetName('Bills'));

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
  Logger.log('');
}


/**
 * diagPreferences()
 * Specifically diagnoses the categories/preferences persistence issue.
 */
function diagPreferences() {
  Logger.log('--- PREFERENCES DIAGNOSTIC ---');
  try {
    var email = Session.getActiveUser().getEmail();
    var key   = _hashEmail(email);

    // 1. What does the raw sheet contain?
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(key + ':Preferences');

    if (!sheet) {
      Logger.log('Preferences sheet NOT FOUND: ' + key + ':Preferences');
      return;
    }

    var lastRow = sheet.getLastRow();
    Logger.log('Preferences sheet has ' + lastRow + ' rows');

    if (lastRow >= 1) {
      var data = sheet.getRange(1, 1, lastRow, 2).getValues();
      data.forEach(function(row, i) {
        var val = String(row[1] || '');
        // Truncate long values (like the full categories JSON)
        if (val.length > 120) val = val.slice(0, 120) + '...';
        Logger.log('  Row ' + (i+1) + ': key="' + row[0] + '" value="' + val + '"');
      });
    }

    // 2. What does getAllPreferences() return?
    Logger.log('');
    Logger.log('getAllPreferences() result:');
    var prefs = getAllPreferences();
    Logger.log('  currency:   ' + prefs.currency);
    Logger.log('  dark_mode:  ' + prefs.dark_mode);
    Logger.log('  categories: ' + prefs.categories.length + ' items');
    if (prefs.categories.length > 0) {
      Logger.log('  First 3 categories: ' + JSON.stringify(prefs.categories.slice(0, 3)));
    }

    // 3. Test setPreference round-trip
    Logger.log('');
    Logger.log('Testing setPreference round-trip...');
    setPreference('diag_test', 'hello_' + Date.now());
    var map = _getPrefsMap();
    Logger.log('diag_test value in sheet: ' + (map['diag_test'] || '(not found)'));

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
  Logger.log('');
}
