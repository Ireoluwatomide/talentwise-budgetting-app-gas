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
 *   - getGoalsByMonth(monthKey)              → goals for one month
 *   - getAllGoals()                           → all goals grouped by month_key
 *   - addGoal(monthKey, cat, limit)           → upsert within that month only
 *   - copyGoalsFromMonth(from, to)            → carry-forward from previous month
 *   - getPreviousMonthWithGoals(key)          → walks back to find nearest prior month
 *   - applyBudgetTemplate(key, inc, tpl)      → month-scoped template apply across
 *                                               ALL user expense categories
 *   - checkBudgetAlerts(monthKey)             → for Notifications.gs
 *
 * CALLED BY:
 *   Client via google.script.run, Main.gs (bootstrap), Notifications.gs
 *
 * FIX: _castGoal renamed to _castGoalRow throughout to avoid collision with
 *      the _castGoal function in Savings.gs (Apps Script global scope merges
 *      all .gs files, so duplicate function names cause silent overrides).
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
 * Returns the YYYY-MM key string, or null if nothing found.
 */
function getPreviousMonthWithGoals(monthKey) {
  if (!monthKey) return null;

  var parts = monthKey.split('-');
  var year  = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);

  var rows = getUserAllRows('Goals');
  var keysWithGoals = {};
  rows.forEach(function(row) {
    var k = _normGoalKey(String(row.month_key || ''));
    if (k) keysWithGoals[k] = true;
  });

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

  var rowIndex = getUserFindRowIndex('Goals', function(row) {
    return _normGoalKey(String(row.month_key || '')) === norm &&
           String(row.category || '').trim().toLowerCase() === trimmedCat.toLowerCase();
  });

  if (rowIndex !== -1) {
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
 * Returns the array of newly created/updated goal objects for toMonthKey.
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
 * Generates and saves goals for ALL of the user's expense categories,
 * distributed according to the chosen percentage rule.
 *
 * DESIGN — two-tier allocation:
 *
 *   Each template splits income into percentage buckets (Needs / Wants /
 *   Savings). Within the Needs and Wants buckets, the budget is divided
 *   equally across the user's expense categories that belong to that bucket.
 *   This means every expense category the user has gets a goal — not just
 *   the 6-7 hardcoded ones from the original implementation.
 *
 *   50/30/20:
 *     Needs  (50%) → Housing, Groceries, Transportation, Utilities,
 *                    Insurance, Body Care & Medicine, Education
 *     Wants  (30%) → Entertainment, Fun & Vacation, Media & Subscriptions,
 *                    Dining Out, Clothing
 *     Debt   (20%) → Debt Repayment (single category, gets the full 20%)
 *     Any user-added expense categories not in either bucket list above
 *     are placed into the Needs bucket by default.
 *
 *   70/20/10:
 *     Needs  (70%) → same Needs list as above
 *     Wants  (0%)  → Wants categories get a small equal share from Needs
 *     Debt   (10%) → Debt Repayment
 *     Savings(20%) → not an expense category, skipped
 *
 * NOTE: Savings categories are intentionally excluded — goals are for
 * expense spending limits, not savings targets (those live in SavingsGoals).
 *
 * Uses addGoal() (upserts) so re-applying is safe and idempotent.
 *
 * Returns the full array of applied goal objects for the given month.
 */
function applyBudgetTemplate(monthKey, monthlyIncome, templateType) {
  if (!monthKey) throw new Error('Goals.gs: monthKey is required.');

  var income = parseFloat(monthlyIncome);
  if (isNaN(income) || income <= 0) {
    throw new Error('Goals.gs: monthlyIncome must be a positive number.');
  }

  if (templateType !== '503020' && templateType !== '702010') {
    throw new Error('Goals.gs: Unknown templateType "' + templateType + '". Use "503020" or "702010".');
  }

  // ── 1. Fetch ALL user expense categories ──────────────────────────────────
  // getCategories() is defined in Preferences.gs and returns the full list
  // including any user-added ones. We only want expense-type categories.
  var allCats = [];
  try {
    allCats = getCategories(); // from Preferences.gs
  } catch(e) {
    Logger.log('Goals.gs: applyBudgetTemplate — could not fetch categories: ' + e.message);
    allCats = [];
  }

  var expenseCats = allCats
    .filter(function(c) { return (c.type || 'expense') === 'expense'; })
    .map(function(c) { return c.name; });

  // ── 2. Define the canonical bucket membership ──────────────────────────────
  // These are the DEFAULT_CATEGORIES from Preferences.gs split by role.
  // "Debt Repayment" is handled separately as the debt allocation bucket.
  var NEEDS_CATS = [
    'Housing', 'Utilities', 'Groceries', 'Transportation', 'Insurance',
    'Body Care & Medicine', 'Education'
  ];

  var WANTS_CATS = [
    'Entertainment', 'Fun & Vacation', 'Media & Subscriptions',
    'Dining Out', 'Clothing'
  ];

  var DEBT_CAT = 'Debt Repayment';

  // ── 3. Partition user's expense categories into buckets ───────────────────
  var needsCats  = [];
  var wantsCats  = [];
  var debtCats   = [];
  var otherCats  = []; // user-added categories not in any default bucket

  expenseCats.forEach(function(name) {
    var lc = name.toLowerCase();

    if (lc === DEBT_CAT.toLowerCase()) {
      debtCats.push(name);
    } else if (NEEDS_CATS.some(function(n) { return n.toLowerCase() === lc; })) {
      needsCats.push(name);
    } else if (WANTS_CATS.some(function(w) { return w.toLowerCase() === lc; })) {
      wantsCats.push(name);
    } else {
      // Any user-added expense category not in the default lists goes into Needs.
      otherCats.push(name);
    }
  });

  // Merge user-added categories into Needs (conservative default).
  needsCats = needsCats.concat(otherCats);

  // ── 4. Calculate per-category limits based on template ───────────────────
  var allocations = []; // [{ category, monthly_limit }]

  if (templateType === '503020') {
    // 50% Needs, 30% Wants, 20% Debt
    var needsBudget = income * 0.50;
    var wantsBudget = income * 0.30;
    var debtBudget  = income * 0.20;

    // Divide Needs budget equally across all Needs categories
    if (needsCats.length > 0) {
      var needsPerCat = Math.round(needsBudget / needsCats.length);
      needsCats.forEach(function(cat) {
        allocations.push({ category: cat, monthly_limit: needsPerCat });
      });
    }

    // Divide Wants budget equally across all Wants categories
    if (wantsCats.length > 0) {
      var wantsPerCat = Math.round(wantsBudget / wantsCats.length);
      wantsCats.forEach(function(cat) {
        allocations.push({ category: cat, monthly_limit: wantsPerCat });
      });
    }

    // Debt Repayment gets the full 20% (single category)
    if (debtCats.length > 0) {
      var debtPerCat = Math.round(debtBudget / debtCats.length);
      debtCats.forEach(function(cat) {
        allocations.push({ category: cat, monthly_limit: debtPerCat });
      });
    }

  } else if (templateType === '702010') {
    // 70% Living (Needs + Wants combined), 10% Debt, 20% Savings (excluded)
    // Split the 70% living budget: 85% to Needs, 15% to Wants (within the 70%)
    // This gives Needs ~59.5% and Wants ~10.5% of income — a reasonable split.
    var livingBudget = income * 0.70;
    var debtBudget70 = income * 0.10;

    var totalLivingCats = needsCats.length + wantsCats.length;

    if (totalLivingCats > 0) {
      // Weight: Needs categories get 3x the allocation of Wants categories
      // to reflect the 70/20/10 philosophy of prioritising essentials.
      var needsWeight = 3;
      var wantsWeight = 1;
      var totalWeight = (needsCats.length * needsWeight) + (wantsCats.length * wantsWeight);
      var unitValue   = totalWeight > 0 ? livingBudget / totalWeight : 0;

      needsCats.forEach(function(cat) {
        var limit = Math.round(unitValue * needsWeight);
        if (limit > 0) allocations.push({ category: cat, monthly_limit: limit });
      });

      wantsCats.forEach(function(cat) {
        var limit = Math.round(unitValue * wantsWeight);
        if (limit > 0) allocations.push({ category: cat, monthly_limit: limit });
      });
    }

    if (debtCats.length > 0) {
      var debtPerCat70 = Math.round(debtBudget70 / debtCats.length);
      debtCats.forEach(function(cat) {
        allocations.push({ category: cat, monthly_limit: debtPerCat70 });
      });
    }
  }

  // ── 5. Fallback — if user has no categories yet use hardcoded defaults ────
  // This handles fresh accounts before the user has set up any categories.
  if (allocations.length === 0) {
    Logger.log('Goals.gs: applyBudgetTemplate — no expense categories found, using hardcoded defaults.');

    if (templateType === '503020') {
      allocations = [
        { category: 'Housing',              monthly_limit: Math.round(income * 0.30) },
        { category: 'Groceries',            monthly_limit: Math.round(income * 0.10) },
        { category: 'Transportation',       monthly_limit: Math.round(income * 0.05) },
        { category: 'Utilities',            monthly_limit: Math.round(income * 0.05) },
        { category: 'Entertainment',        monthly_limit: Math.round(income * 0.15) },
        { category: 'Body Care & Medicine', monthly_limit: Math.round(income * 0.15) },
        { category: 'Debt Repayment',       monthly_limit: Math.round(income * 0.20) }
      ];
    } else {
      allocations = [
        { category: 'Housing',              monthly_limit: Math.round(income * 0.35) },
        { category: 'Groceries',            monthly_limit: Math.round(income * 0.15) },
        { category: 'Transportation',       monthly_limit: Math.round(income * 0.10) },
        { category: 'Utilities',            monthly_limit: Math.round(income * 0.10) },
        { category: 'Entertainment',        monthly_limit: Math.round(income * 0.05) },
        { category: 'Body Care & Medicine', monthly_limit: Math.round(income * 0.05) },
        { category: 'Debt Repayment',       monthly_limit: Math.round(income * 0.10) }
      ];
    }
  }

  // ── 6. Upsert all allocations as goals ────────────────────────────────────
  var applied = [];

  allocations.forEach(function(alloc) {
    if (!alloc.category || alloc.monthly_limit <= 0) return;
    try {
      var goal = addGoal(monthKey, alloc.category, alloc.monthly_limit);
      applied.push(goal);
    } catch(e) {
      Logger.log('Goals.gs: applyBudgetTemplate — skipping "' + alloc.category + '": ' + e.message);
    }
  });

  Logger.log(
    'Goals.gs: applyBudgetTemplate(' + monthKey + ', ' + templateType + ') — ' +
    'applied: ' + applied.length + ' goals across ' + expenseCats.length + ' expense categories'
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
 *
 * Normalises a raw sheet row into a typed goal object.
 *
 * RENAMED from _castGoal to _castGoalRow to avoid collision with the
 * _castGoal function in Savings.gs. Both files compile into the same
 * Apps Script global scope — duplicate names cause the last-loaded
 * version to silently override all earlier ones, which was causing
 * applyBudgetTemplate() to return savings-shaped objects instead of
 * goal-shaped ones.
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
