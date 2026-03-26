/**
 * Main.gs — Entry Point (Multi-User Edition)
 *
 * CHANGES FROM PHASE 1:
 *   - doGet() now checks if the user is authenticated.
 *   - Unauthenticated requests are served Landing.html (public page).
 *   - Authenticated requests provision the user if new, then serve the app.
 *   - getBootstrapData() scopes all data reads to the current user via UserManager.gs.
 *
 * APPSSCRIPT.JSON REQUIREMENT:
 *   Change "executeAs": "USER_DEPLOYING"  →  "USER_ACCESSING"
 *   Change "access":    "ANYONE_ANONYMOUS" →  "ANYONE_WITH_GOOGLE_ACCOUNT"
 *   This forces Google sign-in before the script runs, giving us the user's email.
 */


/**
 * doGet(e)
 *
 * Routes the request:
 *   - ?page=landing  → always serve Landing.html
 *   - No active user → serve Landing.html
 *   - Active user    → provision if new, serve the full app
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};

  if (params.page === 'landing') {
    return _serveLanding();
  }

  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (err) {
    Logger.log('Main.gs: doGet() — could not read user session: ' + err.message);
  }

  if (!email) {
    return _serveLanding();
  }

  try {
    getOrCreateUser(email);
  } catch (err) {
    Logger.log('Main.gs: doGet() — user provisioning error: ' + err.message);
  }

  return _serveApp();
}


// ─── PAGE SERVERS ─────────────────────────────────────────────────────────────

function _serveLanding() {
  return HtmlService
    .createTemplateFromFile('src/client/Landing')
    .evaluate()
    .setTitle('Budget Tracker — Track your finances, free')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _serveApp() {
  var template = HtmlService.createTemplateFromFile('src/client/Index');

  var data = getBootstrapData();
  template.bootstrapScript =
    '<script>window.__BOOTSTRAP__ = ' + JSON.stringify(data) + ';<\/script>';

  var profile = {};
  try { profile = getCurrentUserProfile(); }
  catch (err) { Logger.log('Main.gs: profile error — ' + err.message); }

  template.userProfile =
    '<script>window.__USER__ = ' + JSON.stringify(profile) + ';<\/script>';

  return template
    .evaluate()
    .setTitle('Budget Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ─── INCLUDE HELPER ───────────────────────────────────────────────────────────

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// ─── BOOTSTRAP DATA ───────────────────────────────────────────────────────────

/**
 * getBootstrapData()
 *
 * Loads all data needed for first render in a single server execution.
 * ADDED: savingsHistory loaded from getAllSavingsHistory()
 */
function getBootstrapData() {
  var now = new Date();
  var data = {
    curYear:        now.getFullYear(),
    curMonth:       now.getMonth() + 1,
    currency:       'NGN',
    darkMode:       false,
    categories:     [],
    transactions:   {},
    goals:          {},
    bills:          [],
    billHistory:    [],
    billAlertDays:  5,
    savingsGoals:   [],
    savingsHistory: [],      // NEW: contribution history rows
    debts:          [],
    netWorthItems:  [],
    recurring:      []
  };

  // Preferences
  if (typeof getAllPreferences === 'function') {
    try {
      var prefs = getAllPreferences();
      data.currency      = prefs.currency   || 'NGN';
      data.darkMode      = prefs.dark_mode  || false;
      data.categories    = prefs.categories || [];
      data.billAlertDays = prefs.bills_alert_days || 5;
    } catch (e) { Logger.log('Bootstrap: Preferences — ' + e.message); }
  }

  // ── TRANSACTIONS: load ALL months, grouped by month_key ─────────────────────
  // This is the key fix. Previously only the current month was loaded,
  // causing Savings "Total Saved All Time", multi-month charts, forecast
  // averages, and the Report to all show empty/zero data until the user
  // manually navigated to each past month.
  if (typeof getAllTransactions === 'function') {
    try {
      var allTxs = getAllTransactions();

      // Group by month_key into the same structure the client uses.
      allTxs.forEach(function(tx) {
        var key = tx.month_key;
        if (!key) return;
        if (!data.transactions[key]) data.transactions[key] = [];
        data.transactions[key].push(tx);
      });
      Logger.log('Bootstrap: Loaded transactions for ' +
        Object.keys(data.transactions).length + ' month(s).');
    } catch (e) {
      // Fall back to just current month if getAllTransactions fails
      Logger.log('Bootstrap: getAllTransactions failed — ' + e.message + '. Falling back to current month.');
      try {
        var mk = data.curYear + '-' + (data.curMonth < 10 ? '0' : '') + data.curMonth;
        var monthTxs = getTransactionsByMonth(mk);
        data.transactions[mk] = monthTxs;
      } catch (e2) {
        Logger.log('Bootstrap: Transactions fallback also failed — ' + e2.message);
      }
    }
  }

  // Goals — load ALL months grouped by month_key (getAllGoals now returns object)
  if (typeof getAllGoals === 'function') {
    try {
      data.goals = getAllGoals();
    } catch(e) { Logger.log('Bootstrap: Goals — ' + e.message); }
  }

  // Bills
  if (typeof getAllBills === 'function') {
    try { data.bills = getAllBills(); } catch(e) { Logger.log('Bootstrap: Bills — ' + e.message); }
  }

  // Bill History
  if (typeof getAllBillHistory === 'function') {
    try { data.billHistory = getAllBillHistory(); } catch(e) {
      Logger.log('Bootstrap: BillHistory — ' + e.message);
      data.billHistory = [];
    }
  }

  // Savings Goals
  if (typeof getAllSavingsGoals === 'function') {
    try { data.savingsGoals = getAllSavingsGoals(); } catch(e) {
      Logger.log('Bootstrap: SavingsGoals — ' + e.message);
    }
  }

  // Savings History — NEW
  if (typeof getAllSavingsHistory === 'function') {
    try { data.savingsHistory = getAllSavingsHistory(); } catch(e) {
      Logger.log('Bootstrap: SavingsHistory — ' + e.message + ' (run initSavingsEnhancements() if sheet is missing)');
      data.savingsHistory = [];
    }
  }

  if (typeof getAllDebts         === 'function') { try { data.debts         = getAllDebts();         } catch(e) { Logger.log('Bootstrap: Debts — '      + e.message); } }
  if (typeof getAllNetWorthItems === 'function') { try { data.netWorthItems = getAllNetWorthItems(); } catch(e) { Logger.log('Bootstrap: NetWorth — '   + e.message); } }
  if (typeof getAllRecurring     === 'function') { try { data.recurring     = getAllRecurring();     } catch(e) { Logger.log('Bootstrap: Recurring — '  + e.message); } }

  return data;
}


// ─── AUTH HELPERS (client-callable) ──────────────────────────────────────────

function getSessionUser() {
  try { return getCurrentUserProfile(); }
  catch (e) { return null; }
}

function getSignOutUrl() {
  return ScriptApp.getService().getUrl() + '?page=landing';
}
