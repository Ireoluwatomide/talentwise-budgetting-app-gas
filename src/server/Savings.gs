/**
 * Savings.gs — Savings Goals (Enhanced)
 *
 * ENHANCEMENTS:
 *   - SavingsGoals sheet now has two new columns: target_date | sort_order
 *   - New SavingsHistory sheet: id | goal_id | transaction_id | month_key | amount | note | recorded_at
 *   - updateSavingsGoalOnDeposit() now writes a SavingsHistory row on every credit
 *   - updateSavingsGoalOrder(goalId, newSortOrder) — persists drag-and-drop reorder
 *   - updateSavingsGoalTarget(goalId, targetDate) — persists target date changes
 *   - getAllSavingsHistory() — returns all history rows for the current user
 *   - _castSavingsGoal() now includes target_date, sort_order, and computed pace fields
 *
 * SHEET: SavingsGoals
 * COLUMNS: id | name | target_amount | saved_amount | target_date | sort_order
 *
 * SHEET: SavingsHistory
 * COLUMNS: id | goal_id | transaction_id | month_key | amount | note | recorded_at
 *
 * FIX: _castGoal renamed to _castSavingsGoal to avoid collision with Goals.gs.
 *
 * CALLED BY:
 *   - Client via google.script.run
 *   - Transactions.gs → updateSavingsGoalOnDeposit() on every savings deposit
 *   - Main.gs → getAllSavingsGoals() + getAllSavingsHistory() in getBootstrapData()
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllSavingsGoals()
 *
 * Returns all goals sorted by sort_order ascending (nulls/zeros last).
 * Each goal includes computed percent_complete, months_to_goal, and monthly_needed.
 */
function getAllSavingsGoals() {
  return getUserAllRows('SavingsGoals')
    .map(_castSavingsGoal)
    .sort(function(a, b) {
      var ao = a.sort_order || 9999;
      var bo = b.sort_order || 9999;
      return ao - bo;
    });
}

/**
 * getTotalSaved()
 * Returns the sum of saved_amount across all savings goals.
 */
function getTotalSaved() {
  return getAllSavingsGoals().reduce(function(sum, goal) {
    return sum + (parseFloat(goal.saved_amount) || 0);
  }, 0);
}

/**
 * getAllSavingsHistory()
 * Returns all SavingsHistory rows for the current user, sorted newest first.
 */
function getAllSavingsHistory() {
  return getUserAllRows('SavingsHistory')
    .map(_castHistoryRowSav)
    .sort(function(a, b) {
      return b.recorded_at.localeCompare(a.recorded_at);
    });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addSavingsGoal(name, targetAmount, targetDate)
 *
 * Creates a new savings goal. targetDate is optional (YYYY-MM-DD or '').
 * sort_order is set to max existing + 1 so new goals appear at the bottom.
 * Returns the new goal object including computed fields.
 */
function addSavingsGoal(name, targetAmount, targetDate) {
  if (!name || String(name).trim() === '') {
    throw new Error('Savings.gs: Goal name is required.');
  }

  var target = parseFloat(targetAmount);
  if (isNaN(target) || target <= 0) {
    throw new Error('Savings.gs: targetAmount must be a positive number.');
  }

  var cleanDate = (targetDate && String(targetDate).trim().match(/^\d{4}-\d{2}-\d{2}$/))
    ? String(targetDate).trim()
    : '';

  // Compute next sort_order
  var existing   = getUserAllRows('SavingsGoals').map(_castSavingsGoal);
  var maxOrder   = existing.reduce(function(max, g) {
    return Math.max(max, g.sort_order || 0);
  }, 0);

  var goal = {
    id:            generateId(),
    name:          String(name).trim(),
    target_amount: target,
    saved_amount:  0,
    target_date:   cleanDate,
    sort_order:    maxOrder + 1
  };

  getUserAppendRow('SAVINGS_GOALS', goal);
  return _castSavingsGoal(goal);
}

/**
 * deleteSavingsGoal(goalId)
 * Deletes the savings goal row. Does NOT reverse any credited transactions.
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
 * updateSavingsGoalOnDeposit(category, depositAmount, transactionId, monthKey, note)
 *
 * Called automatically from Transactions.addTransaction() when type === 'savings'.
 * Matches by goal name vs transaction category (case-insensitive).
 * Now also writes a SavingsHistory row for contribution tracking.
 *
 * transactionId and note are optional (backward compat).
 */
function updateSavingsGoalOnDeposit(category, depositAmount, transactionId, monthKey, note) {
  if (!category) return null;

  var deposit = parseFloat(depositAmount);
  if (isNaN(deposit) || deposit <= 0) return null;

  var trimmedCategory = String(category).trim().toLowerCase();

  var rowIndex = getUserFindRowIndex('SAVINGS_GOALS', function(row) {
    return String(row.name || '').trim().toLowerCase() === trimmedCategory;
  });

  if (rowIndex === -1) return null;

  var goals   = getAllSavingsGoals();
  var current = goals.find(function(g) {
    return g.name.toLowerCase() === trimmedCategory;
  });

  if (!current) return null;

  var newSaved = (parseFloat(current.saved_amount) || 0) + deposit;
  var target   = parseFloat(current.target_amount) || 0;
  if (target > 0) newSaved = Math.min(newSaved, target);

  var updated = {
    id:            current.id,
    name:          current.name,
    target_amount: target,
    saved_amount:  newSaved,
    target_date:   current.target_date  || '',
    sort_order:    current.sort_order   || 1
  };

  getUserUpdateRow('SAVINGS_GOALS', rowIndex, updated);

  // Write a SavingsHistory row
  try {
    var histRow = {
      id:             generateId(),
      goal_id:        current.id,
      transaction_id: transactionId ? String(transactionId) : '',
      month_key:      monthKey       ? String(monthKey)       : '',
      amount:         deposit,
      note:           note           ? String(note)           : '',
      recorded_at:    new Date().toISOString()
    };
    getUserAppendRow('SAVINGS_HISTORY', histRow);
  } catch (e) {
    // Non-fatal — goal was credited, history write failed
    Logger.log('Savings.gs: updateSavingsGoalOnDeposit history write failed (non-fatal): ' + e.message);
  }

  Logger.log(
    'Savings.gs: updateSavingsGoalOnDeposit() — category "' + category +
    '" matched goal "' + current.name + '", new saved: ' + newSaved
  );

  return _castSavingsGoal(updated);
}

/**
 * updateSavingsGoalOrder(goalId, newSortOrder)
 *
 * Updates the sort_order for a single goal. Called after drag-and-drop reorder.
 * The client sends the full reordered array; this is called once per goal.
 * Returns { success: true }.
 */
function updateSavingsGoalOrder(goalId, newSortOrder) {
  if (!goalId) throw new Error('Savings.gs: goalId is required.');

  var order = parseInt(newSortOrder, 10);
  if (isNaN(order)) throw new Error('Savings.gs: newSortOrder must be an integer.');

  var rowIndex = getUserFindRowIndex('SAVINGS_GOALS', function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Savings.gs: Goal "' + goalId + '" not found.');
  }

  var goals   = getAllSavingsGoals();
  var current = goals.find(function(g) { return g.id === goalId; });
  if (!current) throw new Error('Savings.gs: Goal "' + goalId + '" not found after index lookup.');

  var updated = {
    id:            current.id,
    name:          current.name,
    target_amount: current.target_amount,
    saved_amount:  current.saved_amount,
    target_date:   current.target_date  || '',
    sort_order:    order
  };

  getUserUpdateRow('SAVINGS_GOALS', rowIndex, updated);
  return { success: true };
}

/**
 * updateSavingsGoalTarget(goalId, targetDate)
 *
 * Updates the target_date for a goal. targetDate: 'YYYY-MM-DD' or '' to clear.
 * Returns the updated goal object.
 */
function updateSavingsGoalTarget(goalId, targetDate) {
  if (!goalId) throw new Error('Savings.gs: goalId is required.');

  var cleanDate = (targetDate && String(targetDate).trim().match(/^\d{4}-\d{2}-\d{2}$/))
    ? String(targetDate).trim()
    : '';

  var rowIndex = getUserFindRowIndex('SAVINGS_GOALS', function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Savings.gs: Goal "' + goalId + '" not found.');
  }

  var goals   = getAllSavingsGoals();
  var current = goals.find(function(g) { return g.id === goalId; });
  if (!current) throw new Error('Savings.gs: Goal "' + goalId + '" not found after index lookup.');

  var updated = {
    id:            current.id,
    name:          current.name,
    target_amount: current.target_amount,
    saved_amount:  current.saved_amount,
    target_date:   cleanDate,
    sort_order:    current.sort_order || 1
  };

  getUserUpdateRow('SAVINGS_GOALS', rowIndex, updated);
  return _castSavingsGoal(updated);
}

/**
 * updateSavingsGoalOrderBatch(orderedIds)
 *
 * Accepts an array of goal IDs in the new desired order and updates
 * sort_order for each. Called once after a drag-and-drop reorder completes.
 *
 * orderedIds: ['id1', 'id2', 'id3', ...]
 * Returns { success: true, updated: N }
 */
function updateSavingsGoalOrderBatch(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { success: true, updated: 0 };
  }

  var updated = 0;
  orderedIds.forEach(function(goalId, idx) {
    try {
      updateSavingsGoalOrder(goalId, idx + 1);
      updated++;
    } catch(e) {
      Logger.log('Savings.gs: updateSavingsGoalOrderBatch — skipping "' + goalId + '": ' + e.message);
    }
  });

  return { success: true, updated: updated };
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castSavingsGoal(row)
 *
 * Normalises a raw row. Now includes:
 *   - target_date  (string YYYY-MM-DD or '')
 *   - sort_order   (integer, defaults to 9999 for ungrouped)
 *   - months_to_goal: computed from target_date if set
 *   - monthly_needed: amount/month needed to hit target_date
 *   - months_at_pace: how many months at avg monthly pace to reach target
 */
function _castSavingsGoal(row) {
  var target  = parseFloat(row.target_amount) || 0;
  var saved   = parseFloat(row.saved_amount)  || 0;
  var percent = target > 0
    ? Math.min(100, Math.round((saved / target) * 100))
    : 0;

  var targetDate = (row.target_date && String(row.target_date).trim().match(/^\d{4}-\d{2}-\d{2}$/))
    ? String(row.target_date).trim()
    : '';

  // Compute months until target_date from today (WAT)
  var monthsToGoal   = null;
  var monthlyNeeded  = null;

  if (targetDate) {
    var today   = new Date();
    var dateParts = targetDate.split('-');
    var tDate   = new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1,
      parseInt(dateParts[2], 10)
    );
    var diffMs  = tDate.getTime() - today.getTime();
    var diffMon = Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30.44));

    if (diffMon > 0) {
      monthsToGoal  = diffMon;
      var remaining = Math.max(0, target - saved);
      monthlyNeeded = remaining > 0 ? Math.ceil(remaining / diffMon) : 0;
    } else {
      monthsToGoal = 0; // deadline passed
    }
  }

  return {
    id:               String(row.id   || '').trim(),
    name:             String(row.name || '').trim(),
    target_amount:    target,
    saved_amount:     saved,
    percent_complete: percent,
    target_date:      targetDate,
    sort_order:       parseInt(row.sort_order, 10) || 9999,
    months_to_goal:   monthsToGoal,
    monthly_needed:   monthlyNeeded
  };
}

/**
 * _castHistoryRowSav(row)
 * Normalises a raw SavingsHistory row.
 */
function _castHistoryRowSav(row) {
  return {
    id:             String(row.id             || '').trim(),
    goal_id:        String(row.goal_id        || '').trim(),
    transaction_id: String(row.transaction_id || '').trim(),
    month_key:      String(row.month_key      || '').trim(),
    amount:         parseFloat(row.amount)    || 0,
    note:           String(row.note           || '').trim(),
    recorded_at:    String(row.recorded_at    || '').trim()
  };
}
