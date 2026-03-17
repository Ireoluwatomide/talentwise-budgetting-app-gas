/**
 * Debt.gs — Debt Tracker
 *
 * PURPOSE:
 *   Track loans, credit cards, and other debts with interest rates,
 *   monthly payment amounts, and payoff ETA calculations.
 *
 * SHEET: Debts
 * COLUMNS: id | name | total | paid | monthly_payment | interest_rate
 *
 *   total          → original total debt amount
 *   paid           → cumulative amount paid so far
 *   monthly_payment → planned monthly payment
 *   interest_rate  → annual interest rate as percentage (e.g. 18 = 18%)
 *
 * CALLED BY: client via google.script.run
 */


/**
 * getAllDebts()
 *
 * TODO: Return all debts with computed fields:
 *         { id, name, total, paid, monthly_payment, interest_rate,
 *           amount_owed, percent_paid, months_to_payoff }
 *
 *   amount_owed    = total - paid
 *   percent_paid   = Math.min(100, Math.round(paid / total * 100))
 *   months_to_payoff = monthly_payment > 0 ? Math.ceil(amount_owed / monthly_payment) : null
 *
 * TODO: Cast all numeric fields to numbers (Sheets returns strings)
 */
function getAllDebts() {
  // TODO: Implement
}


/**
 * addDebt(name, total, monthlyPayment, interestRate)
 *
 * TODO: Validate — name required, total > 0, monthlyPayment >= 0, interestRate >= 0
 * TODO: Initialize paid to 0
 * TODO: Append row and return the new debt object (with computed fields)
 */
function addDebt(name, total, monthlyPayment, interestRate) {
  // TODO: Implement
}


/**
 * recordDebtPayment(debtId, paymentAmount)
 *
 * TODO: Find the debt by debtId
 * TODO: Add paymentAmount to the existing paid amount
 * TODO: Cap paid at total (cannot pay more than the full debt)
 * TODO: Update the row and return the updated debt object
 */
function recordDebtPayment(debtId, paymentAmount) {
  // TODO: Implement
}


/**
 * deleteDebt(debtId)
 *
 * TODO: Find and delete the row with matching debtId
 * TODO: Return { success: true }
 */
function deleteDebt(debtId) {
  // TODO: Implement
}


/**
 * getDebtSummary()
 *
 * TODO: Return aggregate stats for the Debt tab header metrics:
 *         { total_debt_remaining, total_monthly_payments, debt_count }
 *
 *   total_debt_remaining = sum of (total - paid) for all debts
 *   total_monthly_payments = sum of monthly_payment for all debts
 */
function getDebtSummary() {
  // TODO: Implement
}
