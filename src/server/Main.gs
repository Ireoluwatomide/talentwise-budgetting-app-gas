/**
 * Main.gs — Entry Point (Multi-User Edition)
 *
 * CHANGES (recurring enhancement):
 *   - getBootstrapData() now loads recurringHistory and recurringStatus
 *   - recurringStatus = getRecurringStatus(curMonthKey) — per-template
 *     operational status for the current month (applied, skipped, next_apply)
 *   - recurringHistory = getRecurringHistory() — full application audit trail
 *   - All other logic unchanged
 */


/**
 * doGet(e)
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
 *
 * RECURRING ADDITIONS:
 *   recurring        — template list (unchanged, now includes new fields)
 *   recurringHistory — application audit trail (all RecurringHistory rows)
 *   recurringStatus  — per-template status for curMonthKey (applied?, skipped?, next?)
 */
function getBootstrapData() {
  var now = new Date();
  var data = {
    curYear:          now.getFullYear(),
    curMonth:         now.getMonth() + 1,
    currency:         'NGN',
    darkMode:         false,
    categories:       [],
    transactions:     {},
    goals:            {},
    bills:            [],
    billHistory:      [],
    billAlertDays:    5,
    savingsGoals:     [],
    savingsHistory:   [],
    debts:            [],
    debtHistory:      [],
    debtArchived:     [],
    debtToIncomeRatio: 0,
    netWorthItems:    [],
    netWorthHistory:  [],
    netWorthTarget:   0,
    netWorthSummary:  null,
    recurring:        [],
    recurringHistory: [],   // NEW: full application audit trail
    recurringStatus:  []    // NEW: per-template status for current month
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

  // Transactions (all months)
  if (typeof getAllTransactions === 'function') {
    try {
      var allTxs = getAllTransactions();
      allTxs.forEach(function(tx) {
        var key = tx.month_key;
        if (!key) return;
        if (!data.transactions[key]) data.transactions[key] = [];
        data.transactions[key].push(tx);
      });
      Logger.log('Bootstrap: Loaded transactions for ' +
        Object.keys(data.transactions).length + ' month(s).');
    } catch (e) {
      Logger.log('Bootstrap: getAllTransactions failed — ' + e.message);
      try {
        var mk = data.curYear + '-' + (data.curMonth < 10 ? '0' : '') + data.curMonth;
        var monthTxs = getTransactionsByMonth(mk);
        data.transactions[mk] = monthTxs;
      } catch (e2) {
        Logger.log('Bootstrap: Transactions fallback also failed — ' + e2.message);
      }
    }
  }

  // Goals
  if (typeof getAllGoals === 'function') {
    try { data.goals = getAllGoals(); } catch(e) { Logger.log('Bootstrap: Goals — ' + e.message); }
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

  // Savings History
  if (typeof getAllSavingsHistory === 'function') {
    try { data.savingsHistory = getAllSavingsHistory(); } catch(e) {
      Logger.log('Bootstrap: SavingsHistory — ' + e.message);
      data.savingsHistory = [];
    }
  }

  // Debt History
  if (typeof getAllDebtHistory === 'function') {
    try { data.debtHistory = getAllDebtHistory(); } catch(e) {
      Logger.log('Bootstrap: DebtHistory — ' + e.message);
      data.debtHistory = [];
    }
  }

  // Archived Debts
  if (typeof getArchivedDebts === 'function') {
    try { data.debtArchived = getArchivedDebts(); } catch(e) {
      Logger.log('Bootstrap: ArchivedDebts — ' + e.message);
      data.debtArchived = [];
    }
  }

  // Debt-to-income ratio
  if (typeof getDebtSummary === 'function') {
    try {
      var curMk = data.curYear + '-' +
        (data.curMonth < 10 ? '0' : '') + data.curMonth;
      var debtSummary = getDebtSummary(curMk);
      data.debtToIncomeRatio = debtSummary.debt_to_income_ratio || 0;
    } catch(e) {
      Logger.log('Bootstrap: DebtSummary — ' + e.message);
    }
  }

  // Net Worth
  if (typeof syncDebtsToNetWorth === 'function' &&
      typeof getAllNetWorthItems  === 'function') {
    try {
      syncDebtsToNetWorth();
      data.netWorthItems = getAllNetWorthItems();
    } catch(e) {
      Logger.log('Bootstrap: NetWorth/syncDebts — ' + e.message);
      try { data.netWorthItems = getAllNetWorthItems(); } catch(e2) {}
    }
  }

  if (typeof getNetWorthHistory === 'function') {
    try { data.netWorthHistory = getNetWorthHistory(); } catch(e) {
      Logger.log('Bootstrap: NetWorthHistory — ' + e.message);
      data.netWorthHistory = [];
    }
  }

  if (typeof getNetWorthTarget === 'function') {
    try { data.netWorthTarget = getNetWorthTarget(); } catch(e) {
      Logger.log('Bootstrap: NetWorthTarget — ' + e.message);
      data.netWorthTarget = 0;
    }
  }

  if (typeof getNetWorthSummary === 'function') {
    try { data.netWorthSummary = getNetWorthSummary(); } catch(e) {
      Logger.log('Bootstrap: NetWorthSummary — ' + e.message);
      data.netWorthSummary = null;
    }
  }

  if (typeof getAllDebts         === 'function') { try { data.debts     = getAllDebts();     } catch(e) { Logger.log('Bootstrap: Debts — '     + e.message); } }

  // Recurring — templates (includes new fields)
  if (typeof getAllRecurring     === 'function') {
    try { data.recurring = getAllRecurring(); } catch(e) {
      Logger.log('Bootstrap: Recurring — ' + e.message);
      data.recurring = [];
    }
  }

  // Recurring History — application audit trail
  if (typeof getRecurringHistory === 'function') {
    try { data.recurringHistory = getRecurringHistory(); } catch(e) {
      Logger.log('Bootstrap: RecurringHistory — ' + e.message +
        ' (run initRecurringEnhancements() if sheet is missing)');
      data.recurringHistory = [];
    }
  }

  // Recurring Status — per-template status for current month
  if (typeof getRecurringStatus === 'function') {
    try {
      var statusMonthKey = data.curYear + '-' +
        (data.curMonth < 10 ? '0' : '') + data.curMonth;
      data.recurringStatus = getRecurringStatus(statusMonthKey);
    } catch(e) {
      Logger.log('Bootstrap: RecurringStatus — ' + e.message);
      data.recurringStatus = [];
    }
  }

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
