/**
 * Notifications.gs — Email Alerts via MailApp
 *
 * PURPOSE:
 *   Send email notifications for bill due dates and over-budget categories.
 *   Uses Apps Script's built-in MailApp (100 emails/day free, no setup required).
 *   Called on a daily schedule from Triggers.gs.
 *
 * FREE TIER LIMIT: 100 emails/day via MailApp.
 *   At personal scale this is more than sufficient.
 *   Phase 2 (React + Supabase) migrates to Mailgun for higher volume + templates.
 *
 * CALLED BY: Triggers.gs (daily cron), not called by client directly
 */


/**
 * sendDailyAlerts()
 *
 * TODO: Master function called by the daily trigger.
 *       Checks for both bill reminders and over-budget alerts, then sends
 *       a single consolidated email if there is anything to report.
 *       (Batching into one email is more user-friendly than multiple separate emails)
 *
 * TODO: 1. Call Bills.getUpcomingBills(5) to get bills due within 5 days
 * TODO: 2. Get current monthKey (YYYY-MM of today)
 * TODO: 3. Call Goals.checkBudgetAlerts(monthKey) to get over/warning-budget categories
 * TODO: 4. If either list is non-empty, call sendConsolidatedAlert(billAlerts, budgetAlerts)
 * TODO: 5. Log the result (Logger.log) for the Apps Script execution log
 */
function sendDailyAlerts() {
  // TODO: Implement
}


/**
 * sendConsolidatedAlert(upcomingBills, budgetAlerts)
 *
 * TODO: Build a plain-text email body that includes:
 *         - A section for upcoming bills (if any): name, amount, days until due
 *         - A section for budget alerts (if any): category, spent, limit, status
 *
 * TODO: Use MailApp.sendEmail({
 *           to: getUserEmail(),
 *           subject: 'Budget Tracker — Daily Summary',
 *           body: plainTextBody
 *         })
 *
 * TODO: Consider building an HTML email body for richer formatting (MailApp supports htmlBody param)
 * TODO: Wrap in try/catch — log failures gracefully, do not throw (trigger should not break)
 */
function sendConsolidatedAlert(upcomingBills, budgetAlerts) {
  // TODO: Implement
}


/**
 * getUserEmail()
 *
 * TODO: Return the email of the user running the script.
 *       Use Session.getActiveUser().getEmail() — available because the script executes as the owner.
 * TODO: Fall back to Session.getEffectiveUser().getEmail() if the above is empty
 */
function getUserEmail() {
  // TODO: return Session.getActiveUser().getEmail();
}


/**
 * sendTestEmail()
 *
 * TODO: Utility function to send a test email to the script owner.
 *       Used during development to verify MailApp permissions and formatting.
 *       Call manually from the Apps Script editor — never triggered automatically.
 */
function sendTestEmail() {
  // TODO: Build a dummy bill + budget alert payload and call sendConsolidatedAlert()
}
