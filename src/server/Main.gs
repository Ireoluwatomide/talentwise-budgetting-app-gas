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

function getBootstrapData() {
  var data = {
    curYear: new Date().getFullYear(), curMonth: new Date().getMonth() + 1,
    currency: 'NGN', darkMode: false, categories: [],
    transactions: {}, goals: [], bills: [], savingsGoals: [],
    debts: [], netWorthItems: [], recurring: []
  };

  if (typeof getAllPreferences === 'function') {
    try {
      var prefs = getAllPreferences();
      data.currency   = prefs.currency   || 'NGN';
      data.darkMode   = prefs.dark_mode  || false;
      data.categories = prefs.categories || [];
    } catch (e) { Logger.log('Bootstrap: Preferences — ' + e.message); }
  }

  if (typeof getTransactionsByMonth === 'function') {
    try {
      var mk = data.curYear + '-' + (data.curMonth < 10 ? '0' : '') + data.curMonth;
      data.transactions[mk] = getTransactionsByMonth(mk);
    } catch (e) { Logger.log('Bootstrap: Transactions — ' + e.message); }
  }

  if (typeof getAllGoals         === 'function') { try { data.goals         = getAllGoals();         } catch(e) { Logger.log('Bootstrap: Goals — '       + e.message); } }
  if (typeof getAllBills         === 'function') { try { data.bills         = getAllBills();         } catch(e) { Logger.log('Bootstrap: Bills — '       + e.message); } }
  if (typeof getAllSavingsGoals  === 'function') { try { data.savingsGoals  = getAllSavingsGoals();  } catch(e) { Logger.log('Bootstrap: Savings — '     + e.message); } }
  if (typeof getAllDebts         === 'function') { try { data.debts         = getAllDebts();         } catch(e) { Logger.log('Bootstrap: Debts — '       + e.message); } }
  if (typeof getAllNetWorthItems === 'function') { try { data.netWorthItems = getAllNetWorthItems(); } catch(e) { Logger.log('Bootstrap: NetWorth — '    + e.message); } }
  if (typeof getAllRecurring     === 'function') { try { data.recurring     = getAllRecurring();     } catch(e) { Logger.log('Bootstrap: Recurring — '   + e.message); } }

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
