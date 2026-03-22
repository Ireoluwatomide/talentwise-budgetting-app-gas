/**
 * Savings.gs — Savings Goals
 *
 * PURPOSE:
 *   Manage named savings targets (e.g. "Emergency Fund", "New Laptop").
 *   Each goal tracks a target amount and cumulative saved amount.
 *
 *   When a savings-type transaction is added, updateSavingsGoalOnDeposit()
 *   is called automatically by Transactions.gs — matched by CATEGORY rather
 *   than by transaction name. This is cleaner and more reliable: the user
 *   picks the savings category (e.g. "Emergency Fund") from the dropdown,
 *   and any deposit with that category auto-credits the matching goal.
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
  return getUserAllRows('SavingsGoals').map(_castSavingsGoal);
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
    id:            generateId(),
    name:          String(name).trim(),
    target_amount: target,
    saved_amount:  0
  };

  getUserAppendRow('SAVINGS_GOALS', goal);

  return _castSavingsGoal(goal);
}

/**
 * deleteSavingsGoal(goalId)
 *
 * Deletes the savings goal row matching goalId.
 * Note: deleting a goal does NOT reverse any transactions that funded it.
 */
function deleteSavingsGoal(goalId) {
  if (!goalId) throw new Error('Savings.gs: goalId is required.');

  var rowIndex = getUserFindRowIndex('SAVINGS_GOALS', function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Savings.gs: Savings goal "' + goalId + '" not found.');
  }

  getUserDeleteRow('SAVINGS_GOALS', rowIndex);
  return { success: true };
}

/**
 * updateSavingsGoalOnDeposit(category, depositAmount)
 *
 * Called automatically from Transactions.addTransaction() when type === 'savings'.
 *
 * MATCHING STRATEGY — category-match:
 *   Finds the savings goal whose name matches the transaction's category
 *   (case-insensitive). This is cleaner than name-matching because the
 *   user selects the savings category from the typed dropdown (e.g.
 *   "Emergency Fund", "Retirement Account") and the goal with that same
 *   name auto-receives the credit — regardless of what description the
 *   user typed for the transaction.
 *
 *   Example:
 *     Transaction: { name: 'Monthly top-up', category: 'Emergency Fund',
 *                    type: 'savings', amount: 25000 }
 *     → Finds goal named "Emergency Fund" and increments its saved_amount.
 *
 * Returns the updated goal object, or null if no matching goal is found.
 * A null return is NOT an error — the user may add savings transactions to
 * categories that don't correspond to a named goal, which is perfectly valid.
 */
function updateSavingsGoalOnDeposit(category, depositAmount) {
  if (!category) return null;

  var deposit = parseFloat(depositAmount);
  if (isNaN(deposit) || deposit <= 0) return null;

  var trimmedCategory = String(category).trim().toLowerCase();

  // Find the savings goal whose name matches the transaction category.
  var rowIndex = getUserFindRowIndex('SAVINGS_GOALS', function(row) {
    return String(row.name || '').trim().toLowerCase() === trimmedCategory;
  });

  if (rowIndex === -1) return null; // No matching goal — silent, not an error.

  // Re-read the current goal to get the latest saved_amount before updating.
  var goals   = getAllSavingsGoals();
  var current = goals.find(function(g) {
    return g.name.toLowerCase() === trimmedCategory;
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

  getUserUpdateRow('SAVINGS_GOALS', rowIndex, updated);

  Logger.log(
    'Savings.gs: updateSavingsGoalOnDeposit() — category "' + category +
    '" matched goal "' + current.name + '", new saved: ' + newSaved
  );

  return _castSavingsGoal(updated);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castSavingsGoal(row)
 *
 * Normalises a raw row into a typed savings goal object with computed
 * percent_complete. Called on every row returned by getAllSavingsGoals()
 * and on newly created/updated objects before returning to the client.
 */
function _castSavingsGoal(row) {
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
