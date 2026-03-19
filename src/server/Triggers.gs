/**
 * Triggers.gs — Time-Based Trigger Setup & Cron Handlers
 *
 * PURPOSE:
 *   Register and manage the two time-based triggers that automate background tasks:
 *
 *   1. Daily trigger    → dailyAlertHandler()
 *      Fires every morning at 8 AM Lagos time (WAT / UTC+1).
 *      Checks bills due within 5 days and over-budget categories.
 *      Sends a consolidated email if there is anything to report.
 *
 *   2. Monthly trigger  → monthlyHandler()
 *      Fires at 6 AM on the 1st of each month.
 *      Applies all recurring transactions to the new month.
 *      Resets all bills to unpaid for the new month.
 *
 * SETUP:
 *   Run installTriggers() ONCE from the Apps Script editor after deployment.
 *   Run removeTriggers() first if re-installing to avoid duplicate triggers.
 *
 * ⚠ IMPORTANT: Never call installTriggers() without first calling removeTriggers()
 *   if triggers are already installed. Duplicate triggers will fire multiple times.
 */


// ─── INSTALL / REMOVE ────────────────────────────────────────────────────────

/**
 * installTriggers()
 *
 * Registers both time-based triggers for this script project.
 * Call ONCE from the Apps Script editor during initial setup.
 *
 * Run removeTriggers() first to clear any existing triggers before re-installing.
 */
function installTriggers() {
  // Guard: warn if triggers already exist.
  var existing = ScriptApp.getProjectTriggers();
  if (existing.length > 0) {
    Logger.log(
      'Triggers.gs: WARNING — ' + existing.length + ' trigger(s) already exist. ' +
      'Run removeTriggers() first to avoid duplicates.'
    );
    // Do not abort — the developer may be intentionally adding a second trigger,
    // though this is rarely the right call. Log the warning and proceed.
  }

  // Trigger 1: Daily alert — every day at 8–9 AM (Apps Script picks the exact minute).
  ScriptApp.newTrigger('dailyAlertHandler')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // Trigger 2: Monthly handler — 1st of every month at 6–7 AM.
  ScriptApp.newTrigger('monthlyHandler')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();

  Logger.log('Triggers.gs: Installed 2 triggers (dailyAlertHandler, monthlyHandler).');
  listTriggers(); // Log the full trigger list for confirmation.
}

/**
 * removeTriggers()
 *
 * Deletes ALL existing triggers for this script project.
 * Call before re-running installTriggers() to prevent duplicates.
 */
function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var count    = triggers.length;

  triggers.forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  Logger.log('Triggers.gs: Removed ' + count + ' trigger(s).');
}

/**
 * listTriggers()
 *
 * Logs all currently installed triggers to the Apps Script execution log.
 * Useful for verifying setup without opening the Triggers UI.
 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();

  if (triggers.length === 0) {
    Logger.log('Triggers.gs: No triggers installed.');
    return;
  }

  Logger.log('Triggers.gs: ' + triggers.length + ' trigger(s) installed:');
  triggers.forEach(function(trigger, i) {
    Logger.log(
      '  [' + (i + 1) + '] ' +
      trigger.getHandlerFunction() + ' — ' +
      trigger.getEventType() + ' — ' +
      (trigger.getTriggerSourceId ? String(trigger.getTriggerSourceId()) : 'n/a')
    );
  });
}


// ─── TRIGGER HANDLERS ────────────────────────────────────────────────────────
// These are top-level functions registered with ScriptApp.newTrigger() by name.
// Apps Script calls them directly — they must be at the top level of the project.

/**
 * dailyAlertHandler()
 *
 * Called every morning by the daily time-based trigger.
 * Delegates to Notifications.sendDailyAlerts().
 *
 * Wrapped in try/catch — a thrown error from a trigger handler causes Google
 * to send its own error notification email, which is noisy. Better to log
 * failures gracefully and let the next day's trigger retry naturally.
 */
function dailyAlertHandler() {
  try {
    Logger.log('Triggers.gs: dailyAlertHandler() fired at ' + new Date().toISOString());
    sendDailyAlerts(); // from Notifications.gs
    Logger.log('Triggers.gs: dailyAlertHandler() completed successfully.');
  } catch (e) {
    Logger.log('Triggers.gs: dailyAlertHandler() error — ' + e.message);
    // Intentionally not re-throwing — see comment above.
  }
}

/**
 * monthlyHandler()
 *
 * Called on the 1st of each month by the monthly time-based trigger.
 * Performs two independent tasks:
 *   1. Applies all recurring transactions to the new month.
 *   2. Resets all bills to unpaid for the new month.
 *
 * Each step is wrapped in its own try/catch so a failure in step 1
 * does not prevent step 2 from running.
 */
function monthlyHandler() {
  var today    = new Date();
  var monthKey = _triggerMonthKey(today);

  Logger.log('Triggers.gs: monthlyHandler() fired for ' + monthKey);

  // Step 1 — Apply recurring transactions.
  try {
    var result = applyRecurringToMonth(monthKey); // from Recurring.gs
    Logger.log(
      'Triggers.gs: applyRecurringToMonth(' + monthKey + ') — ' +
      'applied: ' + result.applied + ', skipped: ' + result.skipped
    );
  } catch (e) {
    Logger.log('Triggers.gs: applyRecurringToMonth() error — ' + e.message);
  }

  // Step 2 — Reset bill paid status for the new month.
  try {
    var reset = resetAllBillsPaid(); // from Bills.gs
    Logger.log('Triggers.gs: resetAllBillsPaid() — reset: ' + reset.reset);
  } catch (e) {
    Logger.log('Triggers.gs: resetAllBillsPaid() error — ' + e.message);
  }

  Logger.log('Triggers.gs: monthlyHandler() completed for ' + monthKey);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _triggerMonthKey(date)
 * Builds the YYYY-MM month key for a given Date object.
 * Kept local to Triggers.gs to avoid depending on any other module's helpers —
 * this file should be as self-contained as possible.
 */
function _triggerMonthKey(date) {
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}
