/**
 * Goals.gs — Budget Goals (Monthly Spending Limits)
 *
 * PURPOSE:
 *   Manage per-category monthly spending limits (budget goals).
 *   Goals are global — not month-specific. The same goal limits apply to every month
 *   and are compared against that month's actual spending to drive alerts and progress bars.
 *
 * SHEET: Goals
 * COLUMNS: id | category | monthly_limit
 *
 * CALLED BY: client via google.script.run.<functionName>()
 */


/**
 * getAllGoals()
 *
 * TODO: Return all budget goals as an array of { id, category, monthly_limit }
 * TODO: Use SheetHelper.getAllRows(SHEET_NAMES.GOALS)
 */
function getAllGoals() {
  // TODO: Implement
}


/**
 * addGoal(category, monthlyLimit)
 *
 * TODO: Validate — category must be a non-empty string, monthlyLimit must be a positive number
 * TODO: Check for duplicate: if a goal for this category already exists, call updateGoal() instead
 *       (one goal per category enforced)
 * TODO: Append new row via SheetHelper.appendRow()
 * TODO: Return the created goal object
 */
function addGoal(category, monthlyLimit) {
  // TODO: Implement
}


/**
 * updateGoal(goalId, monthlyLimit)
 *
 * TODO: Find the row with matching goalId
 * TODO: Update the monthly_limit value for that row
 * TODO: Return the updated goal object
 */
function updateGoal(goalId, monthlyLimit) {
  // TODO: Implement
}


/**
 * deleteGoal(goalId)
 *
 * TODO: Find and delete the row with matching goalId
 * TODO: Return { success: true }
 */
function deleteGoal(goalId) {
  // TODO: Implement
}


/**
 * applyBudgetTemplate(monthlyIncome, templateType)
 *
 * TODO: Generate and save a set of goals based on a budget template rule.
 *       templateType: '503020' or '702010'
 *
 * 50/30/20 allocations:
 *   Housing      → 30% of income
 *   Food         → 10% of income
 *   Transport    → 5% of income
 *   Utilities    → 5% of income
 *   Entertainment → 10% of income
 *   Health       → 10% of income  (all Needs+Wants = 50%)
 *   Savings      → 20% of income  (savings + debt)
 *
 * 70/20/10 allocations:
 *   Housing      → 35% of income
 *   Food         → 15% of income
 *   Transport    → 10% of income
 *   Utilities    → 10% of income
 *   Savings      → 20% of income
 *   Entertainment → 5% of income
 *   Health       → 5% of income
 *
 * TODO: For each category in the template, call addGoal() (which upserts automatically)
 * TODO: Return the full list of applied goals with computed amounts
 */
function applyBudgetTemplate(monthlyIncome, templateType) {
  // TODO: Implement
}


/**
 * checkBudgetAlerts(monthKey)
 *
 * TODO: Compare each goal's limit against actual spending for the given month.
 * TODO: Return an array of alert objects:
 *         { category, limit, spent, status }
 *         status: 'over' (spent > limit) | 'warning' (spent > 85% of limit) | 'ok'
 * TODO: Call Transactions.getCategoryBreakdown(monthKey) to get actual spending
 * TODO: Used by both the client (UI banners) and Notifications.gs (email alerts)
 */
function checkBudgetAlerts(monthKey) {
  // TODO: Implement
}
