/**
 * Goals.gs — Budget Goals (Monthly Spending Limits)
 *
 * PURPOSE:
 *   Manage per-category monthly spending limits.
 *   Goals are global — the same limits apply to every month.
 *   Spending is compared against goals to drive progress bars and alert banners.
 *
 * SHEET: Goals
 * COLUMNS: id | category | monthly_limit
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap), Notifications.gs
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllGoals()
 * Returns all goals as [{ id, category, monthly_limit }].
 * monthly_limit is cast to a number so the client never receives strings.
 */
function getAllGoals() {
  return getAllRows(SHEET_NAMES.GOALS).map(function(row) {
    return {
      id:            String(row.id       || '').trim(),
      category:      String(row.category || '').trim(),
      monthly_limit: parseFloat(row.monthly_limit) || 0
    };
  });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addGoal(category, monthlyLimit)
 *
 * Enforces one goal per category — if a goal for this category already
 * exists it delegates to updateGoal() rather than creating a duplicate.
 * This makes addGoal() safe to call from applyBudgetTemplate() without
 * pre-checking for existing goals.
 *
 * Returns the created or updated goal object.
 */
function addGoal(category, monthlyLimit) {
  if (!category || String(category).trim() === '') {
    throw new Error('Goals.gs: category is required.');
  }

  var limit = parseFloat(monthlyLimit);
  if (isNaN(limit) || limit <= 0) {
    throw new Error('Goals.gs: monthlyLimit must be a positive number.');
  }

  var trimmedCat = String(category).trim();

  // Check for an existing goal with this category.
  var existing = getAllGoals().find(function(g) {
    return g.category.toLowerCase() === trimmedCat.toLowerCase();
  });

  if (existing) {
    // Upsert — update the limit instead of creating a duplicate.
    return updateGoal(existing.id, limit);
  }

  var goal = {
    id:            generateId(),
    category:      trimmedCat,
    monthly_limit: limit
  };

  appendRow(SHEET_NAMES.GOALS, goal);
  return goal;
}

/**
 * updateGoal(goalId, monthlyLimit)
 *
 * Updates the monthly_limit for an existing goal.
 * Returns the updated goal object.
 */
function updateGoal(goalId, monthlyLimit) {
  if (!goalId) throw new Error('Goals.gs: goalId is required.');

  var limit = parseFloat(monthlyLimit);
  if (isNaN(limit) || limit <= 0) {
    throw new Error('Goals.gs: monthlyLimit must be a positive number.');
  }

  var rowIndex = findRowIndex(SHEET_NAMES.GOALS, function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Goals.gs: Goal "' + goalId + '" not found.');
  }

  // Re-read the row to get the current category (needed for the full object update).
  var goals    = getAllGoals();
  var existing = goals.find(function(g) { return g.id === goalId; });
  if (!existing) throw new Error('Goals.gs: Goal "' + goalId + '" not found after index lookup.');

  var updated = {
    id:            goalId,
    category:      existing.category,
    monthly_limit: limit
  };

  updateRow(SHEET_NAMES.GOALS, rowIndex, updated);
  return updated;
}

/**
 * deleteGoal(goalId)
 * Deletes the goal row matching goalId.
 */
function deleteGoal(goalId) {
  if (!goalId) throw new Error('Goals.gs: goalId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.GOALS, function(row) {
    return String(row.id) === String(goalId);
  });

  if (rowIndex === -1) {
    throw new Error('Goals.gs: Goal "' + goalId + '" not found.');
  }

  deleteRow(SHEET_NAMES.GOALS, rowIndex);
  return { success: true };
}


// ─── BUDGET TEMPLATES ────────────────────────────────────────────────────────

/**
 * applyBudgetTemplate(monthlyIncome, templateType)
 *
 * Generates and saves a full set of goals from a percentage-based rule.
 * templateType: '503020' | '702010'
 *
 * Uses addGoal() for each category which handles upserts automatically —
 * safe to call on a sheet that already has some goals.
 *
 * Returns the full array of applied goal objects with computed amounts.
 */
function applyBudgetTemplate(monthlyIncome, templateType) {
  var income = parseFloat(monthlyIncome);
  if (isNaN(income) || income <= 0) {
    throw new Error('Goals.gs: monthlyIncome must be a positive number.');
  }

  var allocations;

  if (templateType === '503020') {
    allocations = [
      { category: 'Housing',       pct: 0.30 },
      { category: 'Food',          pct: 0.10 },
      { category: 'Transport',     pct: 0.05 },
      { category: 'Utilities',     pct: 0.05 },
      { category: 'Entertainment', pct: 0.10 },
      { category: 'Health',        pct: 0.10 },
      { category: 'Savings',       pct: 0.20 }
    ];
  } else if (templateType === '702010') {
    allocations = [
      { category: 'Housing',       pct: 0.35 },
      { category: 'Food',          pct: 0.15 },
      { category: 'Transport',     pct: 0.10 },
      { category: 'Utilities',     pct: 0.10 },
      { category: 'Savings',       pct: 0.20 },
      { category: 'Entertainment', pct: 0.05 },
      { category: 'Health',        pct: 0.05 }
    ];
  } else {
    throw new Error('Goals.gs: Unknown templateType "' + templateType + '". Use "503020" or "702010".');
  }

  var applied = [];

  allocations.forEach(function(alloc) {
    var limit = Math.round(income * alloc.pct);
    var goal  = addGoal(alloc.category, limit);
    applied.push(Object.assign({}, goal, { computed_amount: limit }));
  });

  return applied;
}


// ─── ALERTS ───────────────────────────────────────────────────────────────────

/**
 * checkBudgetAlerts(monthKey)
 *
 * Compares each goal's limit against actual category spending for the month.
 * Used by Notifications.gs for email alerts and could be called by the client
 * for server-side alert generation.
 *
 * Returns [{ category, limit, spent, status }]
 *   status: 'over' | 'warning' | 'ok'
 */
function checkBudgetAlerts(monthKey) {
  var goals     = getAllGoals();
  var breakdown = getCategoryBreakdown(monthKey); // from Transactions.gs

  // Build a lookup map: { category: amount }
  var spendMap = {};
  breakdown.forEach(function(item) {
    spendMap[item.category] = item.amount;
  });

  return goals.map(function(goal) {
    var spent = spendMap[goal.category] || 0;
    var limit = goal.monthly_limit;
    var ratio = limit > 0 ? spent / limit : 0;

    var status = 'ok';
    if (spent > limit)       status = 'over';
    else if (ratio >= 0.85)  status = 'warning';

    return {
      category: goal.category,
      limit:    limit,
      spent:    spent,
      status:   status
    };
  });
}
