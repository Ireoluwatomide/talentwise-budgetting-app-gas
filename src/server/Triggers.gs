/**
 * Triggers.gs — Time-Based Trigger Setup & Cron Handlers
 *
 * CHANGE FROM PREVIOUS VERSION:
 *   dailyAlertHandler() now calls sendSavingsAlerts() after sendDailyAlerts().
 *   Each is wrapped in its own try/catch so a failure in one does not prevent
 *   the other from running.
 *
 * TRIGGERS (registered once via installTriggers()):
 *   1. Daily    → dailyAlertHandler()  — every day at 8 AM WAT
 *      Sends bills + budget alert email (sendDailyAlerts)
 *      Sends savings alert email       (sendSavingsAlerts)
 *
 *   2. Monthly  → monthlyHandler()     — 1st of each month at 6 AM
 *      Applies recurring transactions
 *      Resets all bills to unpaid
 *
 * SETUP:
 *   Run installTriggers() ONCE from the Apps Script editor after deployment.
 *   Run removeTriggers() first if re-installing to avoid duplicate triggers.
 */


// ─── INSTALL / REMOVE ────────────────────────────────────────────────────────

/**
 * installTriggers()
 * Registers both time-based triggers. Call ONCE during initial setup.
 * Run removeTriggers() first to clear any existing triggers.
 */
function installTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  if (existing.length > 0) {
    Logger.log(
      'Triggers.gs: WARNING — ' + existing.length + ' trigger(s) already exist. ' +
      'Run removeTriggers() first to avoid duplicates.'
    );
  }

  // Trigger 1: Daily at 8–9 AM
  ScriptApp.newTrigger('dailyAlertHandler')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // Trigger 2: 1st of every month at 6–7 AM
  ScriptApp.newTrigger('monthlyHandler')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();

  Logger.log('Triggers.gs: Installed 2 triggers (dailyAlertHandler, monthlyHandler).');
  listTriggers();
}

/**
 * removeTriggers()
 * Deletes ALL existing triggers. Call before re-running installTriggers().
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
 * Logs all currently installed triggers to the execution log.
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

/**
 * dailyAlertHandler()
 *
 * Fires every morning at 8 AM WAT.
 * Runs two independent alert functions back-to-back.
 * Each is wrapped in its own try/catch so a failure in one does not prevent
 * the other from sending.
 *
 * Why two separate calls instead of one combined email?
 *   - Bills/budget alerts are time-sensitive (due dates, over-budget).
 *   - Savings alerts are motivational / informational.
 *   - Keeping them separate lets users filter/label them differently in Gmail.
 *   - A failure in getSavingsAlertsData() won't block the bills email.
 */
function dailyAlertHandler() {
  Logger.log('Triggers.gs: dailyAlertHandler() fired at ' + new Date().toISOString());

  // Step 1 — Bills + budget alerts
  try {
    sendDailyAlerts(); // from Notifications.gs
    Logger.log('Triggers.gs: sendDailyAlerts() completed.');
  } catch (e) {
    Logger.log('Triggers.gs: sendDailyAlerts() error — ' + e.message);
  }

  // Step 2 — Savings alerts
  try {
    sendSavingsAlerts(); // from Notifications.gs
    Logger.log('Triggers.gs: sendSavingsAlerts() completed.');
  } catch (e) {
    Logger.log('Triggers.gs: sendSavingsAlerts() error — ' + e.message);
  }

  Logger.log('Triggers.gs: dailyAlertHandler() finished.');
}

/**
 * monthlyHandler()
 *
 * Fires on the 1st of each month at 6 AM WAT.
 * Two independent steps — failure in step 1 does not prevent step 2.
 */
function monthlyHandler() {
  var today    = new Date();
  var monthKey = _triggerMonthKey(today);

  Logger.log('Triggers.gs: monthlyHandler() fired for ' + monthKey);

  // Step 1 — Apply recurring transactions
  try {
    var result = applyRecurringToMonth(monthKey); // from Recurring.gs
    Logger.log(
      'Triggers.gs: applyRecurringToMonth(' + monthKey + ') — ' +
      'applied: ' + result.applied + ', skipped: ' + result.skipped
    );
  } catch (e) {
    Logger.log('Triggers.gs: applyRecurringToMonth() error — ' + e.message);
  }

  // Step 2 — Reset bill paid status
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
 */
function _triggerMonthKey(date) {
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}
