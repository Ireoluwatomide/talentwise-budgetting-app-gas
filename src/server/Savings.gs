/**
 * Savings.gs — Savings Goals
 *
 * PURPOSE:
 *   Manage named savings targets (e.g. "Emergency Fund", "New Laptop").
 *   Each goal tracks a target amount and cumulative saved amount.
 *   When a savings-type transaction is added whose name matches a goal,
 *   updateSavingsGoalOnDeposit() is called automatically by Transactions.gs.
 *
 * SHEET: SavingsGoals
 * COLUMNS: id | name | target_amount | saved_amount
 *
 * CALLED BY:
 *   - Client via google.script.run
 *   - Transactions.gs → updateSavingsGoalOnDeposit() on every savings deposit
 *   - Main.gs → getAllSavingsGoals() in getBootstrapData()
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllSavingsGoals()
 *
 * Returns all goals with a computed percent_complete field.
 * All numeric fields cast to numbers — Sheets can return strings.
 */
function getAllSavingsGoals() {
  return getAllRows(SHEET_NAMES.SAVINGS_GOALS).map(_castGoal);
}

/**
 * getTotalSaved()
 *
 * Returns the sum of saved_amount across all savings goals.
 * Used by the Savings tab header metric "Total Saved (All Time)".
 */
function getTotalSaved() {
  return getAllSavingsGoals().reduce(function(sum, goal) {
    return sum + (parseFloat(goal.saved_amount) || 0);
  }, 0);
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addSavingsGoal(name, targetAmount)
 *
 * Creates a new savings goal with saved_amount initialised to 0.
 * Returns the new goal object including computed percent_complete.
 */
function addSavingsGoal(name, targetAmount) {
  if (!name || String(name).trim() === '') {
    throw new Error('Savings.gs: Goal name is required.');
  }

  var target = parseFloat(targetAmount);
  if (isNaN(target) || target <= 0) {
    throw new Error('Savings.gs: targetAmount must be a positive number.');
  }

  var goal = {
    id:           generateId(),
    name:         String(name).trim(),
    target_amount: target,
    saved_amount:  0
  };

  appendRow(SHEET_NAMES.SAVINGS_GOALS, goal);

  return _castGoal(goal);
}

/**
 * deleteSavingsGoal(goalId)
 *
 * Deletes the savings goal row matching goalId.
 * Note: deleting a goal does NOT reverse any transactions that funded it.
 */
function deleteSavingsGoal(goalId) {
  if (!goalId) throw new Error('Savings.gs: goalId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.SAVINGS_GOALS, function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Savings.gs: Savings goal "' + goalId + '" not found.');
  }

  deleteRow(SHEET_NAMES.SAVINGS_GOALS, rowIndex);
  return { success: true };
}

/**
 * updateSavingsGoalOnDeposit(goalName, depositAmount)
 *
 * Called automatically from Transactions.addTransaction() when type === 'savings'.
 * Finds the savings goal whose name matches goalName (case-insensitive) and
 * increments its saved_amount, capped at target_amount.
 *
 * Returns the updated goal object, or null if no matching goal is found.
 * A null return is NOT an error — the user may add savings transactions that
 * don't correspond to a named goal, which is perfectly valid.
 */
function updateSavingsGoalOnDeposit(goalName, depositAmount) {
  if (!goalName) return null;

  var deposit = parseFloat(depositAmount);
  if (isNaN(deposit) || deposit <= 0) return null;

  var trimmedName = String(goalName).trim().toLowerCase();

  // Find the matching goal row.
  var rowIndex = findRowIndex(SHEET_NAMES.SAVINGS_GOALS, function(row) {
    return String(row.name || '').trim().toLowerCase() === trimmedName;
  });

  if (rowIndex === -1) return null; // No matching goal — silent, not an error.

  // Re-read the current goal to get the latest saved_amount.
  var goals   = getAllSavingsGoals();
  var current = goals.find(function(g) {
    return g.name.toLowerCase() === trimmedName;
  });

  if (!current) return null;

  var newSaved = (parseFloat(current.saved_amount) || 0) + deposit;
  var target   = parseFloat(current.target_amount) || 0;

  // Cap at target — you cannot oversave a goal in the tracker.
  if (target > 0) newSaved = Math.min(newSaved, target);

  var updated = {
    id:            current.id,
    name:          current.name,
    target_amount: target,
    saved_amount:  newSaved
  };

  updateRow(SHEET_NAMES.SAVINGS_GOALS, rowIndex, updated);

  return _castGoal(updated);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castGoal(row)
 *
 * Normalises a raw row into a typed savings goal object with computed
 * percent_complete. Called on every row returned by getAllSavingsGoals()
 * and on newly created/updated objects before returning to the client.
 */
function _castGoal(row) {
  var target  = parseFloat(row.target_amount) || 0;
  var saved   = parseFloat(row.saved_amount)  || 0;
  var percent = target > 0
    ? Math.min(100, Math.round((saved / target) * 100))
    : 0;

  return {
    id:               String(row.id   || '').trim(),
    name:             String(row.name || '').trim(),
    target_amount:    target,
    saved_amount:     saved,
    percent_complete: percent
  };
}
