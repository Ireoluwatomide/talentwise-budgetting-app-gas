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
 *   total           → original total debt amount
 *   paid            → cumulative amount paid so far
 *   monthly_payment → planned monthly payment
 *   interest_rate   → annual interest rate as a percentage (e.g. 18 = 18%)
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap)
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllDebts()
 *
 * Returns all debts with three computed fields:
 *   amount_owed      = total - paid
 *   percent_paid     = Math.min(100, round(paid / total * 100))
 *   months_to_payoff = ceil(amount_owed / monthly_payment), or null if no payment set
 */
function getAllDebts() {
  return getUserAllRows('Debts').map(_castDebt);
}

/**
 * getDebtSummary()
 *
 * Returns aggregate header metrics for the Debt tab.
 *   total_debt_remaining   = sum of amount_owed across all debts
 *   total_monthly_payments = sum of monthly_payment across all debts
 *   debt_count             = number of active debts
 */
function getDebtSummary() {
  var debts = getAllDebts();
  var remaining = 0;
  var monthly   = 0;

  debts.forEach(function(d) {
    remaining += d.amount_owed;
    monthly   += d.monthly_payment;
  });

  return {
    total_debt_remaining:   remaining,
    total_monthly_payments: monthly,
    debt_count:             debts.length
  };
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addDebt(name, total, monthlyPayment, interestRate)
 *
 * Creates a new debt row with paid initialised to 0.
 * monthlyPayment and interestRate default to 0 if not provided —
 * users may not know these values at the time of entry.
 */
function addDebt(name, total, monthlyPayment, interestRate) {
  if (!name || String(name).trim() === '') {
    throw new Error('Debt.gs: Debt name is required.');
  }

  var parsedTotal = parseFloat(total);
  if (isNaN(parsedTotal) || parsedTotal <= 0) {
    throw new Error('Debt.gs: total must be a positive number.');
  }

  var parsedPayment = parseFloat(monthlyPayment) || 0;
  if (parsedPayment < 0) {
    throw new Error('Debt.gs: monthlyPayment cannot be negative.');
  }

  var parsedRate = parseFloat(interestRate) || 0;
  if (parsedRate < 0) {
    throw new Error('Debt.gs: interestRate cannot be negative.');
  }

  var debt = {
    id:               generateId(),
    name:             String(name).trim(),
    total:            parsedTotal,
    paid:             0,
    monthly_payment:  parsedPayment,
    interest_rate:    parsedRate
  };

  getUserAppendRow('DEBTS', debt);
  return _castDebt(debt);
}

/**
 * recordDebtPayment(debtId, paymentAmount)
 *
 * Adds paymentAmount to the existing paid amount, capped at total.
 * Returns the updated debt object with recomputed fields.
 */
function recordDebtPayment(debtId, paymentAmount) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');

  var payment = parseFloat(paymentAmount);
  if (isNaN(payment) || payment <= 0) {
    throw new Error('Debt.gs: paymentAmount must be a positive number.');
  }

  var rowIndex = getUserFindRowIndex('DEBTS', function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  var debts   = getAllDebts();
  var current = debts.find(function(d) { return d.id === debtId; });
  if (!current) throw new Error('Debt.gs: Debt "' + debtId + '" not found after index lookup.');

  var newPaid = (parseFloat(current.paid) || 0) + payment;
  // Cap paid at total — cannot overpay a debt in the tracker.
  newPaid = Math.min(newPaid, current.total);

  var updated = {
    id:              current.id,
    name:            current.name,
    total:           current.total,
    paid:            newPaid,
    monthly_payment: current.monthly_payment,
    interest_rate:   current.interest_rate
  };

  getUserUpdateRow('DEBTS', rowIndex, updated);
  return _castDebt(updated);
}

/**
 * deleteDebt(debtId)
 * Removes the debt row matching debtId.
 */
function deleteDebt(debtId) {
  if (!debtId) throw new Error('Debt.gs: debtId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.DEBTS, function(row) {
    return String(row.id) === String(debtId);
  });

  if (rowIndex === -1) {
    throw new Error('Debt.gs: Debt "' + debtId + '" not found.');
  }

  getUserDeleteRow('DEBTS', rowIndex);
  return { success: true };
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castDebt(row)
 *
 * Normalises a raw row into a typed debt object with three computed fields.
 * months_to_payoff is null when monthly_payment is 0 (no payment plan set).
 */
function _castDebt(row) {
  var total   = parseFloat(row.total)           || 0;
  var paid    = parseFloat(row.paid)            || 0;
  var payment = parseFloat(row.monthly_payment) || 0;
  var rate    = parseFloat(row.interest_rate)   || 0;

  var owed        = Math.max(0, total - paid);
  var percentPaid = total > 0
    ? Math.min(100, Math.round((paid / total) * 100))
    : 0;
  var monthsLeft  = (payment > 0 && owed > 0)
    ? Math.ceil(owed / payment)
    : null;

  return {
    id:               String(row.id   || '').trim(),
    name:             String(row.name || '').trim(),
    total:            total,
    paid:             paid,
    monthly_payment:  payment,
    interest_rate:    rate,
    amount_owed:      owed,
    percent_paid:     percentPaid,
    months_to_payoff: monthsLeft
  };
}
