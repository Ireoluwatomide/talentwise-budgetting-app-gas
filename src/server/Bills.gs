/**
 * Bills.gs — Recurring Bills & Due-Date Tracking
 *
 * PURPOSE:
 *   Manage recurring monthly bills (rent, utilities, subscriptions, etc.).
 *   Each bill has a due day-of-month. Alerts fire 5 days before the due date.
 *   Bills have a paid/unpaid toggle that resets each month via a trigger.
 *
 * SHEET: Bills
 * COLUMNS: id | name | amount | due_day | paid
 *
 * CALLED BY: client via google.script.run and Triggers.gs (daily cron)
 */


/**
 * getAllBills()
 *
 * TODO: Return all bills as array of { id, name, amount, due_day, paid }
 * TODO: Use SheetHelper.getAllRows(SHEET_NAMES.BILLS)
 * TODO: Parse paid as boolean (stored as TRUE/FALSE string in Sheets)
 */
function getAllBills() {
  // TODO: Implement
}


/**
 * addBill(name, amount, dueDay)
 *
 * TODO: Validate — name required, amount > 0, dueDay between 1 and 31
 * TODO: Default paid to false on creation
 * TODO: Append row and return the new bill object
 */
function addBill(name, amount, dueDay) {
  // TODO: Implement
}


/**
 * toggleBillPaid(billId)
 *
 * TODO: Flip the paid boolean for the given bill
 * TODO: Return the updated bill object
 */
function toggleBillPaid(billId) {
  // TODO: Implement
}


/**
 * deleteBill(billId)
 *
 * TODO: Find and delete the row with matching billId
 * TODO: Return { success: true }
 */
function deleteBill(billId) {
  // TODO: Implement
}


/**
 * getUpcomingBills(daysAhead)
 *
 * TODO: Return all unpaid bills due within `daysAhead` days from today.
 *       Default daysAhead = 5 (matches the "5 days before" alert rule).
 *
 * TODO: Get today's day-of-month via new Date().getDate()
 * TODO: For each unpaid bill, compute days until due:
 *         if due_day >= today → daysUntilDue = due_day - today
 *         if due_day < today  → daysUntilDue = (daysInMonth - today) + due_day
 * TODO: Return bills where daysUntilDue <= daysAhead
 * TODO: Include daysUntilDue in the returned objects (used for UI badge text)
 *
 * NOTE: This function is also called by Notifications.gs to send email reminders.
 */
function getUpcomingBills(daysAhead) {
  // TODO: Implement — default daysAhead to 5
}


/**
 * resetAllBillsPaid()
 *
 * TODO: Set paid = false for every bill in the sheet.
 *       Called on the 1st of each month by a Time-Based Trigger (see Triggers.gs).
 *       This ensures the monthly paid/unpaid state resets automatically.
 */
function resetAllBillsPaid() {
  // TODO: Implement
}
