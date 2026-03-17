/**
 * Main.gs — Entry Point
 *
 * PURPOSE:
 *   Serves the HTML shell when the web app URL is opened.
 *   This is the only function Apps Script calls automatically on a GET request.
 *   All other server functions are called by the client via google.script.run.
 *
 * PATTERN:
 *   doGet() creates an HtmlTemplate from Index.html.
 *   Index.html uses <?!= include('path') ?> scriptlet tags to inline every
 *   stylesheet, utility, component, and screen file into a single HTML document.
 *   Bootstrap data is injected as window.__BOOTSTRAP__ so the first render
 *   is instant — zero extra round-trips after page load.
 */


// ─── WEB APP ENTRY POINT ─────────────────────────────────────────────────────

/**
 * doGet(e)
 *
 * Called automatically by Apps Script when the web app URL is opened.
 * Builds the full page by evaluating Index.html as a template, then
 * injects bootstrap data so the client can render immediately.
 *
 * The `e` parameter (event object) is available but not used currently.
 * It would contain query parameters if the app ever needs deep-linking.
 */
function doGet(e) {
  // Build the bootstrap data payload and inject it into the template
  // as a template variable. Index.html accesses it via <?!= bootstrapScript ?>.
  var bootstrapData   = getBootstrapData();
  var bootstrapScript = '<script>window.__BOOTSTRAP__ = ' +
                        JSON.stringify(bootstrapData) +
                        ';<\/script>';

  // Create the template from the root shell file.
  // HtmlService.createTemplateFromFile() supports <?= ?> and <?!= ?> scriptlets.
  var template = HtmlService.createTemplateFromFile('src/client/Index');

  // Pass the bootstrap script block as a template variable.
  // Index.html uses <?!= bootstrapScript ?> to inline it before utils.js loads.
  template.bootstrapScript = bootstrapScript;

  return template
    .evaluate()
    .setTitle('Budget Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ─── TEMPLATE HELPER ─────────────────────────────────────────────────────────

/**
 * include(filename)
 *
 * Inlines the content of another file into an HtmlTemplate.
 * Used inside .html files as: <?!= include('src/client/utils/styles.css') ?>
 *
 * The `!` in <?!= means "print without escaping HTML" — required here because
 * we're inlining raw HTML/CSS/JS, not user-generated content.
 *
 * Apps Script file naming note:
 *   clasp maps local paths like 'src/client/utils/styles.css' to a file named
 *   'src/client/utils/styles.css.html' on disk. In the Apps Script editor the
 *   file appears as 'src/client/utils/styles.css' (clasp strips the .html suffix
 *   on push). The include() call uses the path WITHOUT the .html extension.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// ─── BOOTSTRAP DATA ───────────────────────────────────────────────────────────

/**
 * getBootstrapData()
 *
 * Assembles all data needed for the initial page render into a single object.
 * Batching everything into one server call is critical — each google.script.run
 * call has ~300-500ms overhead, so 8 separate calls would add 2-4 seconds of
 * blank-screen time before any content appears.
 *
 * Each domain module is called inside its own try/catch so a failure in one
 * module (e.g. Bills.gs not yet deployed) does not prevent the whole app
 * from loading. The client always gets a complete object — missing data
 * just shows empty arrays/defaults, which render as empty states gracefully.
 *
 * Return shape (mirrors AppState structure in utils.js):
 * {
 *   currentMonthKey: 'YYYY-MM',
 *   transactions:    { 'YYYY-MM': [...] },   // current month only on first load
 *   goals:           [...],
 *   bills:           [...],
 *   savingsGoals:    [...],
 *   debts:           [...],
 *   netWorthItems:   [...],
 *   recurring:       [...],
 *   preferences:     { currency, dark_mode, categories }
 * }
 */
function getBootstrapData() {
  // Build the current month key — "YYYY-MM" format matching Transactions.gs convention.
  var now      = new Date();
  var year     = now.getFullYear();
  var month    = String(now.getMonth() + 1).padStart(2, '0');
  var monthKey = year + '-' + month;

  var data = {
    currentMonthKey: monthKey,
    transactions:    {},
    goals:           [],
    bills:           [],
    savingsGoals:    [],
    debts:           [],
    netWorthItems:   [],
    recurring:       [],
    preferences:     {
      currency:   'NGN',
      dark_mode:  false,
      categories: []
    }
  };

  // ── Preferences ─────────────────────────────────────────────────────────────
  // Load first — currency and categories are needed by all other render functions.
  try {
    data.preferences = getAllPreferences();
  } catch (e) {
    Logger.log('getBootstrapData: preferences failed — ' + e.message);
  }

  // ── Current month transactions ───────────────────────────────────────────────
  try {
    data.transactions[monthKey] = getTransactionsByMonth(monthKey);
  } catch (e) {
    Logger.log('getBootstrapData: transactions failed — ' + e.message);
    data.transactions[monthKey] = [];
  }

  // ── Goals ────────────────────────────────────────────────────────────────────
  try {
    data.goals = (typeof getAllGoals === 'function') ? getAllGoals() : [];
  } catch (e) {
    Logger.log('getBootstrapData: goals failed — ' + e.message);
  }

  // ── Bills ────────────────────────────────────────────────────────────────────
  try {
    data.bills = (typeof getAllBills === 'function') ? getAllBills() : [];
  } catch (e) {
    Logger.log('getBootstrapData: bills failed — ' + e.message);
  }

  // ── Savings goals ────────────────────────────────────────────────────────────
  try {
    data.savingsGoals = (typeof getAllSavingsGoals === 'function') ? getAllSavingsGoals() : [];
  } catch (e) {
    Logger.log('getBootstrapData: savingsGoals failed — ' + e.message);
  }

  // ── Debts ────────────────────────────────────────────────────────────────────
  try {
    data.debts = (typeof getAllDebts === 'function') ? getAllDebts() : [];
  } catch (e) {
    Logger.log('getBootstrapData: debts failed — ' + e.message);
  }

  // ── Net worth items ──────────────────────────────────────────────────────────
  try {
    data.netWorthItems = (typeof getAllNetWorthItems === 'function') ? getAllNetWorthItems() : [];
  } catch (e) {
    Logger.log('getBootstrapData: netWorthItems failed — ' + e.message);
  }

  // ── Recurring templates ──────────────────────────────────────────────────────
  try {
    data.recurring = (typeof getAllRecurring === 'function') ? getAllRecurring() : [];
  } catch (e) {
    Logger.log('getBootstrapData: recurring failed — ' + e.message);
  }

  return data;
}
