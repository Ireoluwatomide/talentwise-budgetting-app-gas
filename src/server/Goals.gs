/**
 * Goals.gs — Month-Scoped Budget Goals
 *
 * SCHEMA CHANGE (feat/goals-month-scoped):
 *   Goals are now scoped to a specific month.
 *   Each goal row belongs to exactly one YYYY-MM month.
 *
 * SHEET: Goals
 * COLUMNS: id | month_key | category | monthly_limit
 *
 * UNIQUENESS: month_key + category (enforced by addGoal upsert logic)
 *
 * KEY BEHAVIOURS:
 *   - getGoalsByMonth(monthKey)         → goals for one month
 *   - getAllGoals()                      → all goals grouped by month_key
 *   - addGoal(monthKey, cat, limit)      → upsert within that month only
 *   - copyGoalsFromMonth(from, to)       → carry-forward from previous month
 *   - getPreviousMonthWithGoals(key)     → walks back to find the nearest
 *                                          prior month that has goals
 *   - applyBudgetTemplate(key, inc, tpl) → month-scoped template apply
 *   - checkBudgetAlerts(monthKey)        → for Notifications.gs
 *
 * CALLED BY:
 *   Client via google.script.run, Main.gs (bootstrap), Notifications.gs
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getGoalsByMonth(monthKey)
 *
 * Returns all goals for a single month as a flat array.
 * Returns [] if no goals exist for that month yet.
 */
function getGoalsByMonth(monthKey) {
  if (!monthKey) throw new Error('Goals.gs: monthKey is required.');

  var norm = _normGoalKey(monthKey);

  return getUserAllRows('Goals')
    .filter(function(row) {
      return _normGoalKey(String(row.month_key || '')) === norm;
    })
    .map(_castGoalRow);
}

/**
 * getAllGoals()
 *
 * Returns ALL goals grouped by month_key.
 * Shape: { 'YYYY-MM': [{ id, month_key, category, monthly_limit }] }
 *
 * Used by getBootstrapData() in Main.gs so the client has all months'
 * goals on first load — same pattern as transactions.
 */
function getAllGoals() {
  var rows = getUserAllRows('Goals').map(_castGoalRow);
  var grouped = {};

  rows.forEach(function(goal) {
    var key = goal.month_key;
    if (!key) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(goal);
  });

  return grouped;
}

/**
 * getPreviousMonthWithGoals(monthKey)
 *
 * Walks backwards from monthKey (exclusive) looking for the most recent
 * prior month that has at least one goal row.
 *
 * If the user skipped months (e.g. no goals in Feb, but Jan has goals),
 * it keeps walking back until it finds one or exhausts 24 months.
 *
 * Returns the YYYY-MM key string, or null if nothing found.
 */
function getPreviousMonthWithGoals(monthKey) {
  if (!monthKey) return null;

  var parts = monthKey.split('-');
  var year  = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);

  // Collect all month_keys that have at least one goal.
  var rows     = getUserAllRows('Goals');
  var keysWithGoals = {};
  rows.forEach(function(row) {
    var k = _normGoalKey(String(row.month_key || ''));
    if (k) keysWithGoals[k] = true;
  });

  // Walk backwards up to 24 months.
  for (var i = 0; i < 24; i++) {
    month--;
    if (month < 1) { month = 12; year--; }
    var candidate = year + '-' + (month < 10 ? '0' : '') + month;
    if (keysWithGoals[candidate]) return candidate;
  }

  return null;
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addGoal(monthKey, category, monthlyLimit)
 *
 * Upserts a goal for the given month + category pair.
 * If a goal for this month+category already exists → updates the limit.
 * If not → creates a new row.
 *
 * Returns the created/updated goal object.
 */
function addGoal(monthKey, category, monthlyLimit) {
  if (!monthKey) throw new Error('Goals.gs: monthKey is required.');
  if (!category || String(category).trim() === '') {
    throw new Error('Goals.gs: category is required.');
  }

  var limit = parseFloat(monthlyLimit);
  if (isNaN(limit) || limit <= 0) {
    throw new Error('Goals.gs: monthlyLimit must be a positive number.');
  }

  var norm        = _normGoalKey(monthKey);
  var trimmedCat  = String(category).trim();

  // Check for an existing goal for this month + category.
  var rowIndex = getUserFindRowIndex('Goals', function(row) {
    return _normGoalKey(String(row.month_key || '')) === norm &&
           String(row.category || '').trim().toLowerCase() === trimmedCat.toLowerCase();
  });

  if (rowIndex !== -1) {
    // Upsert — update the limit for this month's goal.
    var existing = getGoalsByMonth(norm).find(function(g) {
      return g.category.toLowerCase() === trimmedCat.toLowerCase();
    });

    var updated = {
      id:            existing ? existing.id : generateId(),
      month_key:     norm,
      category:      trimmedCat,
      monthly_limit: limit
    };

    getUserUpdateRow('Goals', rowIndex, updated);
    return _castGoalRow(updated);
  }

  // New goal for this month.
  var goal = {
    id:            generateId(),
    month_key:     norm,
    category:      trimmedCat,
    monthly_limit: limit
  };

  getUserAppendRow('Goals', goal);
  return _castGoalRow(goal);
}

/**
 * updateGoal(goalId, monthlyLimit)
 *
 * Updates the monthly_limit for a specific goal by id.
 * Month and category remain unchanged.
 * Returns the updated goal object.
 */
function updateGoal(goalId, monthlyLimit) {
  if (!goalId) throw new Error('Goals.gs: goalId is required.');

  var limit = parseFloat(monthlyLimit);
  if (isNaN(limit) || limit <= 0) {
    throw new Error('Goals.gs: monthlyLimit must be a positive number.');
  }

  var rowIndex = getUserFindRowIndex('Goals', function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Goals.gs: Goal "' + goalId + '" not found.');
  }

  // Re-read to get current values we are not changing.
  var allRows = getUserAllRows('Goals').map(_castGoalRow);
  var current = allRows.find(function(g) { return g.id === goalId; });
  if (!current) throw new Error('Goals.gs: Goal "' + goalId + '" not found after index lookup.');

  var updated = {
    id:            goalId,
    month_key:     current.month_key,
    category:      current.category,
    monthly_limit: limit
  };

  getUserUpdateRow('Goals', rowIndex, updated);
  return _castGoalRow(updated);
}

/**
 * deleteGoal(goalId)
 *
 * Deletes a single goal row by id.
 * Only affects the specific month that goal belongs to.
 */
function deleteGoal(goalId) {
  if (!goalId) throw new Error('Goals.gs: goalId is required.');

  var rowIndex = getUserFindRowIndex('Goals', function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Goals.gs: Goal "' + goalId + '" not found.');
  }

  getUserDeleteRow('Goals', rowIndex);
  return { success: true };
}

/**
 * copyGoalsFromMonth(fromMonthKey, toMonthKey)
 *
 * Copies all goals from fromMonthKey into toMonthKey.
 * Uses addGoal() for each entry so it upserts — safe to call even if
 * toMonthKey already has some goals (existing ones are updated, new ones added).
 *
 * Returns the array of newly created/updated goal objects for toMonthKey.
 *
 * Called by the client when the user clicks "Copy from [Month]" on the
 * carry-forward prompt.
 */
function copyGoalsFromMonth(fromMonthKey, toMonthKey) {
  if (!fromMonthKey) throw new Error('Goals.gs: fromMonthKey is required.');
  if (!toMonthKey)   throw new Error('Goals.gs: toMonthKey is required.');

  var sourceGoals = getGoalsByMonth(fromMonthKey);

  if (sourceGoals.length === 0) {
    return [];
  }

  var created = [];
  sourceGoals.forEach(function(goal) {
    var result = addGoal(toMonthKey, goal.category, goal.monthly_limit);
    created.push(result);
  });

  Logger.log(
    'Goals.gs: copyGoalsFromMonth(' + fromMonthKey + ' → ' + toMonthKey + ') — ' +
    'copied: ' + created.length
  );

  return created;
}


// ─── BUDGET TEMPLATES ────────────────────────────────────────────────────────

/**
 * applyBudgetTemplate(monthKey, monthlyIncome, templateType)
 *
 * Generates and saves goals for a specific month from a percentage-based rule.
 * Now month-scoped — applying a template to April does not touch March's goals.
 *
 * templateType: '503020' | '702010'
 *
 * Uses addGoal() (upserts) so it is safe to re-apply on a month that already
 * has goals — existing limits are updated, not duplicated.
 *
 * Returns the full array of applied goal objects for the given month.
 */
function applyBudgetTemplate(monthKey, monthlyIncome, templateType) {
  if (!monthKey) throw new Error('Goals.gs: monthKey is required.');

  var income = parseFloat(monthlyIncome);
  if (isNaN(income) || income <= 0) {
    throw new Error('Goals.gs: monthlyIncome must be a positive number.');
  }

  var allocations;

  if (templateType === '503020') {
    allocations = [
      { category: 'Housing',       pct: 0.30 },
      { category: 'Groceries',     pct: 0.10 },
      { category: 'Transportation',pct: 0.05 },
      { category: 'Utilities',     pct: 0.05 },
      { category: 'Entertainment', pct: 0.10 },
      { category: 'Body Care & Medicine', pct: 0.10 },
      { category: 'Emergency Fund',pct: 0.20 }
    ];
  } else if (templateType === '702010') {
    allocations = [
      { category: 'Housing',       pct: 0.35 },
      { category: 'Groceries',     pct: 0.15 },
      { category: 'Transportation',pct: 0.10 },
      { category: 'Utilities',     pct: 0.10 },
      { category: 'Emergency Fund',pct: 0.20 },
      { category: 'Entertainment', pct: 0.05 },
      { category: 'Body Care & Medicine', pct: 0.05 }
    ];
  } else {
    throw new Error('Goals.gs: Unknown templateType "' + templateType + '". Use "503020" or "702010".');
  }

  var applied = [];

  allocations.forEach(function(alloc) {
    var limit = Math.round(income * alloc.pct);
    var goal  = addGoal(monthKey, alloc.category, limit);
    applied.push(goal);
  });

  Logger.log(
    'Goals.gs: applyBudgetTemplate(' + monthKey + ', ' + templateType + ') — ' +
    'applied: ' + applied.length + ' goals'
  );

  return applied;
}


// ─── ALERTS ───────────────────────────────────────────────────────────────────

/**
 * checkBudgetAlerts(monthKey)
 *
 * Compares each goal's limit against actual category spending for the month.
 * Used by Notifications.gs for email alerts.
 *
 * Returns [{ category, limit, spent, status }]
 *   status: 'over' | 'warning' | 'ok'
 */
function checkBudgetAlerts(monthKey) {
  var goals     = getGoalsByMonth(monthKey);
  var breakdown = getCategoryBreakdown(monthKey); // from Transactions.gs

  var spendMap = {};
  breakdown.forEach(function(item) {
    spendMap[item.category] = item.amount;
  });

  return goals.map(function(goal) {
    var spent = spendMap[goal.category] || 0;
    var limit = goal.monthly_limit;
    var ratio = limit > 0 ? spent / limit : 0;

    var status = 'ok';
    if (spent > limit)      status = 'over';
    else if (ratio >= 0.85) status = 'warning';

    return {
      category: goal.category,
      limit:    limit,
      spent:    spent,
      status:   status
    };
  });
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castGoalRow(row)
 * Normalises a raw sheet row into a typed goal object.
 */
function _castGoalRow(row) {
  return {
    id:            String(row.id        || '').trim(),
    month_key:     _normGoalKey(String(row.month_key || '')),
    category:      String(row.category  || '').trim(),
    monthly_limit: parseFloat(row.monthly_limit) || 0
  };
}

/**
 * _normGoalKey(raw)
 * Normalises any month_key representation to 'YYYY-MM'.
 * Reuses the same logic pattern as _normaliseMonthKey in Transactions.gs.
 */
function _normGoalKey(raw) {
  if (!raw) return '';
  var str = String(raw).trim();
  if (/^\d{4}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      var wat = new Date(d.getTime() + 60 * 60 * 1000);
      var y = wat.getUTCFullYear();
      var m = wat.getUTCMonth() + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    }
  }
  if (str.length >= 7 && /^\d{4}-\d{2}/.test(str)) return str.slice(0, 7);
  return str;
}
