/**
 * Triggers.gs — Time-Based Trigger Setup & Cron Handlers
 *
 * PURPOSE:
 *   Define and register the time-based triggers that automate background tasks:
 *     1. Daily alert check → Notifications.sendDailyAlerts() — checks bills + budget every morning
 *     2. Monthly recurring  → Recurring.applyRecurringToMonth() — applies recurring txs on 1st of month
 *     3. Monthly bill reset → Bills.resetAllBillsPaid() — resets paid status on 1st of month
 *
 * HOW TRIGGERS WORK IN APPS SCRIPT:
 *   Triggers are registered programmatically via ScriptApp.newTrigger().
 *   Run installTriggers() once from the Apps Script editor to set them up.
 *   After that they fire automatically on their schedule — no server management required.
 *
 *   ⚠ Do NOT call installTriggers() more than once without first running removeTriggers(),
 *     or duplicate triggers will be created.
 *
 * CALLED BY: Developer manually from the Apps Script editor (setup step only)
 */


/**
 * installTriggers()
 *
 * TODO: Register all required time-based triggers for the project.
 *       Call this function ONCE from the Apps Script editor during initial setup.
 *
 * Triggers to install:
 *
 *   1. Daily alert — runs every morning at 8:00 AM Lagos time (WAT / UTC+1)
 *      ScriptApp.newTrigger('dailyAlertHandler')
 *        .timeBased()
 *        .everyDays(1)
 *        .atHour(8)
 *        .create()
 *
 *   2. Monthly 1st-of-month handler — runs at 6:00 AM on day 1 of each month
 *      ScriptApp.newTrigger('monthlyHandler')
 *        .timeBased()
 *        .onMonthDay(1)
 *        .atHour(6)
 *        .create()
 *
 * TODO: Log "Triggers installed successfully" via Logger.log() on completion
 */
function installTriggers() {
  // TODO: Implement
}


/**
 * removeTriggers()
 *
 * TODO: Delete ALL existing triggers for this script project.
 *       Use ScriptApp.getProjectTriggers() and loop to delete each.
 *       Call before re-running installTriggers() to avoid duplicates.
 *
 * TODO: Log the number of triggers removed
 */
function removeTriggers() {
  // TODO: Implement
}


/**
 * listTriggers()
 *
 * TODO: Log all currently installed triggers to the Apps Script execution log.
 *       Useful for debugging trigger setup.
 * TODO: For each trigger, log: handlerFunction, eventType, schedule
 */
function listTriggers() {
  // TODO: Implement
}


// ─── TRIGGER HANDLERS ─────────────────────────────────────────────────────────
// These are the functions registered with ScriptApp.newTrigger().
// Apps Script calls these by name — they must be top-level functions.


/**
 * dailyAlertHandler()
 *
 * TODO: Called every morning by the daily trigger.
 * TODO: Call Notifications.sendDailyAlerts()
 * TODO: Wrap in try/catch — log errors but do not rethrow
 *       (a thrown error in a trigger handler sends an error email from Google,
 *        which is noisy; better to handle gracefully)
 */
function dailyAlertHandler() {
  // TODO: try { Notifications.sendDailyAlerts(); } catch(e) { Logger.log(e); }
}


/**
 * monthlyHandler()
 *
 * TODO: Called on the 1st of each month by the monthly trigger.
 * TODO: 1. Build the current monthKey (YYYY-MM of today)
 * TODO: 2. Call Recurring.applyRecurringToMonth(monthKey) — auto-adds recurring transactions
 * TODO: 3. Call Bills.resetAllBillsPaid() — resets all bills to unpaid for the new month
 * TODO: Wrap each step in try/catch and log independently so one failure doesn't block others
 */
function monthlyHandler() {
  // TODO: Implement
}
