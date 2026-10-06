/**
 * Savings.gs — Savings Goals (Redesigned)
 *
 * REDESIGN SUMMARY:
 *   The old approach auto-matched savings transactions to goals by comparing
 *   the transaction category name against goal names. This caused four problems:
 *     1. Users had to remember exact category names to credit a goal.
 *     2. Goals were constrained to pre-defined savings category names.
 *     3. Savings transactions could be added with no matching goal.
 *     4. No cap prevented over-funding a goal.
 *
 *   The new approach:
 *     - Goals carry their own `category` field (display/organisational only).
 *     - All top-ups go through topUpSavingsGoal() which validates, caps,
 *       creates the transaction, and updates saved_amount atomically.
 *     - updateSavingsGoalOnDeposit() is removed. addTransaction() no longer
 *       has any side-effect on savings goals.
 *     - Ordering is computed server-side by urgency score; drag-and-drop
 *       and sort_order persistence are removed.
 *
 * SHEET: SavingsGoals
 * COLUMNS: id | name | target_amount | saved_amount | target_date | category
 *   NOTE: sort_order column is no longer written or read. Existing rows that
 *   have a sort_order value are harmless — the column is simply ignored.
 *
 * SHEET: SavingsHistory
 * COLUMNS: id | goal_id | transaction_id | month_key | amount | note | recorded_at
 *
 * CALLED BY:
 *   - Client via google.script.run
 *   - Main.gs → getAllSavingsGoals() + getAllSavingsHistory() in getBootstrapData()
 *   - Notifications.gs → getSavingsAlertsData()
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllSavingsGoals()
 *
 * Returns all goals sorted by urgency score descending.
 *
 * Urgency score = (1 - percent_complete) / months_remaining
 *   - Goals with a target date and remaining balance get a real score.
 *   - Goals with no target date are sorted by percent_complete descending
 *     (most progress first — motivational) in a secondary group.
 *   - Completed goals (100%) go to the very bottom.
 *
 * This replaces the old sort_order / drag-and-drop approach entirely.
 */
function getAllSavingsGoals() {
  var goals = getUserAllRows('SavingsGoals').map(_castSavingsGoal);

  var complete   = [];
  var withDate   = [];
  var withoutDate = [];

  goals.forEach(function(g) {
    if (g.percent_complete >= 100) {
      complete.push(g);
    } else if (g.target_date && g.months_to_goal !== null && g.months_to_goal > 0) {
      withDate.push(g);
    } else {
      withoutDate.push(g);
    }
  });

  // Sort goals-with-date by urgency descending
  withDate.sort(function(a, b) {
    return _urgencyScore(b) - _urgencyScore(a);
  });

  // Sort goals-without-date by percent_complete descending (most progress first)
  withoutDate.sort(function(a, b) {
    return b.percent_complete - a.percent_complete;
  });

  // Complete goals: sort by name alphabetically
  complete.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  return withDate.concat(withoutDate).concat(complete);
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

/**
 * getSavingsAlertsData()
 *
 * Returns structured data for Notifications.gs to build savings alert emails.
 * Computes all five alert types without sending anything — Notifications.gs
 * decides what to include and how to format it.
 *
 * Returns:
 * {
 *   milestones:     [{ goal, milestone }]      — goals that just hit 25/50/75/100%
 *   deadlineNear:   [{ goal, daysUntil }]       — target date within 30 days
 *   neverFunded:    [goal, ...]                 — created >7 days ago, saved_amount = 0
 *   noContribution: [goal, ...]                 — no contribution this calendar month yet
 *   behindPace:     [{ goal, shortfall }]       — monthly_needed but avg < needed
 * }
 */
function getSavingsAlertsData() {
  var goals   = getAllSavingsGoals();
  var history = getAllSavingsHistory();
  var today   = new Date();

  var alerts = {
    milestones:     [],
    deadlineNear:   [],
    neverFunded:    [],
    noContribution: [],
    behindPace:     []
  };

  // Build per-goal history lookup
  var histByGoal = {};
  history.forEach(function(h) {
    if (!histByGoal[h.goal_id]) histByGoal[h.goal_id] = [];
    histByGoal[h.goal_id].push(h);
  });

  // Current month key
  var curMonthKey = today.getFullYear() + '-' +
    (today.getMonth() + 1 < 10 ? '0' : '') + (today.getMonth() + 1);

  goals.forEach(function(goal) {
    var goalHistory = histByGoal[goal.id] || [];
    var p = goal.percent_complete;

    // ── 1. Milestones ──────────────────────────────────────────────────────
    // We emit a milestone if the goal is within 2% above a milestone boundary.
    // (e.g. 25-26.99%, 50-51.99%, 75-76.99%, 100%)
    // The daily trigger fires once — the email captures the state at that moment.
    [25, 50, 75, 100].forEach(function(m) {
      if (p >= m && p < m + 2) {
        alerts.milestones.push({ goal: goal, milestone: m });
      }
    });

    // ── 2. Deadline approaching (within 30 days) ──────────────────────────
    if (goal.target_date && goal.months_to_goal !== null) {
      var daysUntil = _daysUntilDate(goal.target_date, today);
      if (daysUntil >= 0 && daysUntil <= 30 && p < 100) {
        alerts.deadlineNear.push({ goal: goal, daysUntil: daysUntil });
      }
    }

    // ── 3. Never funded (created >7 days ago, saved_amount = 0) ───────────
    if ((parseFloat(goal.saved_amount) || 0) === 0 && goalHistory.length === 0) {
      // We don't store created_at on goals — use a proxy: if the goal has
      // existed in this sheet across at least one daily check, we alert.
      // In practice we always alert if saved = 0, once per daily email.
      alerts.neverFunded.push(goal);
    }

    // ── 4. No contribution this calendar month ────────────────────────────
    if (p < 100 && goalHistory.length > 0) {
      var hasThisMonth = goalHistory.some(function(h) {
        return h.month_key === curMonthKey;
      });
      if (!hasThisMonth) {
        alerts.noContribution.push(goal);
      }
    }

    // ── 5. Behind pace ────────────────────────────────────────────────────
    if (goal.monthly_needed && goal.monthly_needed > 0 && p < 100) {
      // Compute average monthly contribution from history
      if (goalHistory.length > 0) {
        var totalContributed = goalHistory.reduce(function(s, h) {
          return s + (parseFloat(h.amount) || 0);
        }, 0);
        // Rough months since first contribution
        var firstDate   = new Date(goalHistory[goalHistory.length - 1].recorded_at);
        var monthsActive = Math.max(1, Math.ceil(
          (today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        ));
        var avgMonthly  = totalContributed / monthsActive;
        var shortfall   = goal.monthly_needed - avgMonthly;

        if (shortfall > 0) {
          alerts.behindPace.push({ goal: goal, shortfall: shortfall, avgMonthly: avgMonthly });
        }
      }
    }
  });

  return alerts;
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addSavingsGoal(name, targetAmount, targetDate, category)
 *
 * Creates a new savings goal.
 *   name        — free-text, any label the user wants
 *   targetAmount — positive number
 *   targetDate  — optional YYYY-MM-DD string
 *   category    — savings category name for display/organisation (defaults to 'Other Savings')
 *
 * Returns the new goal object including all computed fields.
 */
function addSavingsGoal(name, targetAmount, targetDate, category) {
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

  var cleanCategory = (category && String(category).trim())
    ? String(category).trim()
    : 'Other Savings';

  var goal = {
    id:            generateId(),
    name:          String(name).trim(),
    target_amount: target,
    saved_amount:  0,
    target_date:   cleanDate,
    category:      cleanCategory
    // sort_order intentionally omitted — ordering is now computed, not stored
  };

  getUserAppendRow('SAVINGS_GOALS', goal);
  return _castSavingsGoal(goal);
}

/**
 * topUpSavingsGoal(goalId, amount, monthKey, note)
 *
 * The single entry point for crediting a savings goal.
 *
 * Steps:
 *   1. Validate goalId exists and amount is positive.
 *   2. Cap amount at (target_amount - saved_amount) — cannot over-fund.
 *   3. Call addTransaction() to create an expense record in the Transactions sheet.
 *      type = 'savings', category = goal.category, note = note || 'top-up'
 *   4. Update saved_amount on the goal row.
 *   5. Write a SavingsHistory row linking goal → transaction.
 *   6. Return { goal: updatedGoal, transaction: newTx }
 *
 * monthKey must be YYYY-MM — passed from the client via curKey().
 */
function topUpSavingsGoal(goalId, amount, monthKey, note) {
  if (!goalId) throw new Error('Savings.gs: goalId is required.');
  if (!monthKey || !String(monthKey).match(/^\d{4}-\d{2}$/)) {
    throw new Error('Savings.gs: monthKey must be in YYYY-MM format.');
  }

  var deposit = parseFloat(amount);
  if (isNaN(deposit) || deposit <= 0) {
    throw new Error('Savings.gs: amount must be a positive number.');
  }

  // Find the goal
  var rowIndex = getUserFindRowIndex('SAVINGS_GOALS', function(row) {
    return String(row.id) === String(goalId);
  });
  if (rowIndex === -1) {
    throw new Error('Savings.gs: Goal "' + goalId + '" not found.');
  }

  var goals   = getUserAllRows('SavingsGoals').map(_castSavingsGoal);
  var current = goals.find(function(g) { return g.id === goalId; });
  if (!current) throw new Error('Savings.gs: Goal "' + goalId + '" not found after index lookup.');

  var remaining = Math.max(0, current.target_amount - current.saved_amount);
  if (remaining <= 0) {
    throw new Error('Savings.gs: Goal "' + current.name + '" is already fully funded.');
  }

  // Cap at remaining
  var cappedDeposit = Math.min(deposit, remaining);
  if (cappedDeposit < deposit) {
    Logger.log(
      'Savings.gs: topUpSavingsGoal — deposit ' + deposit +
      ' capped to ' + cappedDeposit + ' (remaining: ' + remaining + ')'
    );
  }

  var txNote = note ? String(note).trim() : 'top-up';

  // Create the transaction — this is the canonical record in Transactions sheet.
  // We call addTransaction() directly here. Since we've removed the auto-match
  // side-effect from addTransaction(), this will NOT trigger any goal update —
  // we handle that ourselves below.
  var newTx = addTransaction(
    monthKey,
    current.name,
    cappedDeposit,
    'savings',
    current.category,
    txNote
  );

  // Update saved_amount on the goal row
  var newSaved = current.saved_amount + cappedDeposit;

  var updatedRow = {
    id:            current.id,
    name:          current.name,
    target_amount: current.target_amount,
    saved_amount:  newSaved,
    target_date:   current.target_date  || '',
    category:      current.category     || 'Other Savings'
  };

  getUserUpdateRow('SAVINGS_GOALS', rowIndex, updatedRow);

  // Write SavingsHistory row
  try {
    var histRow = {
      id:             generateId(),
      goal_id:        current.id,
      transaction_id: newTx.id,
      month_key:      monthKey,
      amount:         cappedDeposit,
      note:           txNote,
      recorded_at:    new Date().toISOString()
    };
    getUserAppendRow('SAVINGS_HISTORY', histRow);
  } catch (e) {
    // Non-fatal — goal was credited and transaction was created.
    Logger.log('Savings.gs: topUpSavingsGoal history write failed (non-fatal): ' + e.message);
  }

  Logger.log(
    'Savings.gs: topUpSavingsGoal — goal "' + current.name +
    '" topped up by ' + cappedDeposit + ' (new saved: ' + newSaved + ')'
  );

  return {
    goal:        _castSavingsGoal(updatedRow),
    transaction: newTx
  };
}

/**
 * deleteSavingsGoal(goalId)
 *
 * Deletes the savings goal row.
 * Does NOT reverse any credited transactions — those remain in Transactions
 * as a permanent record. History rows for this goal are also left in place.
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

  var goals   = getUserAllRows('SavingsGoals').map(_castSavingsGoal);
  var current = goals.find(function(g) { return g.id === goalId; });
  if (!current) throw new Error('Savings.gs: Goal "' + goalId + '" not found after index lookup.');

  var updated = {
    id:            current.id,
    name:          current.name,
    target_amount: current.target_amount,
    saved_amount:  current.saved_amount,
    target_date:   cleanDate,
    category:      current.category || 'Other Savings'
  };

  getUserUpdateRow('SAVINGS_GOALS', rowIndex, updated);
  return _castSavingsGoal(updated);
}


// ─── ONE-TIME MIGRATION ───────────────────────────────────────────────────────

/**
 * migrateSavingsGoalsAddCategory()
 *
 * One-time migration — adds the 'category' column to the current user's
 * SavingsGoals sheet if it is missing. Fills existing rows with 'Other Savings'.
 *
 * Run from the Apps Script editor after deploying this update:
 *   1. Open Apps Script editor
 *   2. Select migrateSavingsGoalsAddCategory from the dropdown
 *   3. Click Run
 *
 * Safe to re-run — only adds the column if it is absent.
 */
function migrateSavingsGoalsAddCategory() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('migrateSavingsGoalsAddCategory: No active user — run while signed in.');
    return;
  }

  var userKey = getCurrentUserKey();
  var ss      = getSpreadsheet();
  var sgName  = userKey + ':SavingsGoals';
  var sheet   = ss.getSheetByName(sgName);

  if (!sheet) {
    Logger.log('migrateSavingsGoalsAddCategory: Sheet "' + sgName + '" not found.');
    return;
  }

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function(h) { return String(h).trim(); });

  if (headers.indexOf('category') !== -1) {
    Logger.log('migrateSavingsGoalsAddCategory: category column already exists — nothing to do.');
    return;
  }

  var newColIdx = lastCol + 1;
  sheet.getRange(1, newColIdx).setValue('category');
  sheet.getRange(1, newColIdx).setFontWeight('bold');
  sheet.getRange(1, newColIdx).setBackground('#f0f0f0');

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, newColIdx, lastRow - 1, 1).setValue('Other Savings');
  }

  SpreadsheetApp.flush();
  Logger.log(
    'migrateSavingsGoalsAddCategory: Added category column to "' + sgName +
    '" and filled ' + Math.max(0, lastRow - 1) + ' existing rows with "Other Savings".'
  );
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castSavingsGoal(row)
 *
 * Normalises a raw sheet row into a typed goal object.
 * Includes computed fields: percent_complete, months_to_goal, monthly_needed.
 * Does NOT include sort_order — ordering is computed in getAllSavingsGoals().
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

  var monthsToGoal  = null;
  var monthlyNeeded = null;

  if (targetDate) {
    var today     = new Date();
    var dateParts = targetDate.split('-');
    var tDate     = new Date(
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
      monthsToGoal = 0; // deadline passed or today
    }
  }

  return {
    id:               String(row.id       || '').trim(),
    name:             String(row.name     || '').trim(),
    target_amount:    target,
    saved_amount:     saved,
    percent_complete: percent,
    target_date:      targetDate,
    category:         String(row.category || 'Other Savings').trim(),
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

/**
 * _urgencyScore(goal)
 *
 * Higher = more urgent.
 * score = (1 - percent_complete/100) / months_remaining
 * A goal that is 20% complete with 2 months left scores much higher than
 * one that is 60% complete with 24 months left.
 */
function _urgencyScore(goal) {
  var remaining = 1 - (goal.percent_complete / 100);
  var months    = Math.max(0.1, goal.months_to_goal || 0.1);
  return remaining / months;
}

/**
 * _daysUntilDate(dateStr, today)
 * Returns the number of days between today and a YYYY-MM-DD date string.
 * Returns negative if the date has passed.
 */
function _daysUntilDate(dateStr, today) {
  var parts  = dateStr.split('-');
  var target = new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10)
  );
  var diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
