/**
 * Recurring.gs — Recurring Transactions
 *
 * PURPOSE:
 *   Manage a list of transaction templates that are automatically applied
 *   when the user navigates to a new month (salary, rent, subscriptions, etc.).
 *   Prevents manual re-entry of the same transactions every month.
 *
 * SHEET: Recurring
 * COLUMNS: id | name | amount | type | category
 *
 * TRIGGER:
 *   applyRecurringToMonth() is also called by Triggers.gs on the 1st of each month,
 *   ensuring new months are pre-populated even without a user logging in.
 *
 * CALLED BY:
 *   - Client via google.script.run (manual apply + list management)
 *   - utils.js applyRecurringForMonth() on month navigation
 *   - Triggers.gs monthlyHandler() on the 1st of each month
 *   - Main.gs getBootstrapData()
 */


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllRecurring()
 *
 * Returns all recurring templates as [{ id, name, amount, type, category }].
 * amount is cast to a number — Sheets can return numeric strings.
 */
function getAllRecurring() {
  return getUserAllRows('Recurring').map(function(row) {
    return {
      id:       String(row.id       || '').trim(),
      name:     String(row.name     || '').trim(),
      amount:   parseFloat(row.amount) || 0,
      type:     String(row.type     || '').trim().toLowerCase(),
      category: String(row.category || 'Other').trim()
    };
  });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addRecurring(name, amount, type, category)
 *
 * Validates and appends a new recurring template row.
 * Returns the new recurring object.
 */
function addRecurring(name, amount, type, category) {
  if (!name || String(name).trim() === '') {
    throw new Error('Recurring.gs: name is required.');
  }

  var parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Recurring.gs: amount must be a positive number.');
  }

  var normType = String(type || '').trim().toLowerCase();
  if (['income', 'expense', 'savings'].indexOf(normType) === -1) {
    throw new Error('Recurring.gs: type must be income, expense, or savings. Got: "' + type + '".');
  }

  var recurring = {
    id:       generateId(),
    name:     String(name).trim(),
    amount:   parsedAmount,
    type:     normType,
    category: String(category || 'Other').trim()
  };

  getUserAppendRow('RECURRING', recurring);
  return recurring;
}

/**
 * deleteRecurring(recurringId)
 *
 * Deletes the recurring template row matching recurringId.
 * Does NOT delete any transactions that were previously applied from this template.
 */
function deleteRecurring(recurringId) {
  if (!recurringId) throw new Error('Recurring.gs: recurringId is required.');

  var rowIndex = getUserFindRowIndex('RECURRING', function(row) {
    return String(row.id) === String(recurringId);
  });

  if (rowIndex === -1) {
    throw new Error('Recurring.gs: Recurring template "' + recurringId + '" not found.');
  }

  getUserDeleteRow('RECURRING', rowIndex);
  return { success: true };
}


// ─── APPLY TO MONTH ───────────────────────────────────────────────────────────

/**
 * applyRecurringToMonth(monthKey)
 *
 * Applies all recurring templates to the given month by creating matching
 * transactions. This function is IDEMPOTENT — safe to call multiple times
 * for the same month without creating duplicates.
 *
 * Idempotency is enforced by checking whether a transaction with the same
 * name AND type already exists for the given monthKey before inserting.
 * If it exists, that template is skipped.
 *
 * Returns { applied: N, skipped: M } so the caller can log or display results.
 *
 * Called from:
 *   1. Client-side prevMonth() / nextMonth() in utils.js (via callServerSilent)
 *   2. Triggers.gs monthlyHandler() on the 1st of each month
 */
function applyRecurringToMonth(monthKey) {
  if (!monthKey || !String(monthKey).match(/^\d{4}-\d{2}$/)) {
    throw new Error('Recurring.gs: monthKey must be YYYY-MM format.');
  }

  var templates    = getAllRecurring();
  var existingTxs  = getTransactionsByMonth(monthKey); // from Transactions.gs

  // Build a lookup set of "name::type" strings for O(1) duplicate checking.
  var existingKeys = {};
  existingTxs.forEach(function(tx) {
    var key = String(tx.name).trim().toLowerCase() + '::' + String(tx.type).trim().toLowerCase();
    existingKeys[key] = true;
  });

  var applied = 0;
  var skipped = 0;

  templates.forEach(function(template) {
    var key = template.name.toLowerCase() + '::' + template.type.toLowerCase();

    if (existingKeys[key]) {
      skipped++;
      return; // Already applied — skip to preserve idempotency.
    }

    // Apply this template as a new transaction with note = 'auto' to mark
    // it as system-generated (visible to the user in the transaction list).
    addTransaction(
      monthKey,
      template.name,
      template.amount,
      template.type,
      template.category,
      'auto'
    );

    // Add to the lookup so subsequent duplicates within the same template list
    // are also caught (in case the user created two templates with the same name+type).
    existingKeys[key] = true;
    applied++;
  });

  Logger.log('Recurring.gs: applyRecurringToMonth(' + monthKey + ') — applied: ' + applied + ', skipped: ' + skipped);
  return { applied: applied, skipped: skipped };
}
