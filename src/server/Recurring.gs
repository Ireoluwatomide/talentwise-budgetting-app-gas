/**
 * Recurring.gs — Recurring Transactions (Overhauled)
 *
 * IMPROVEMENTS FROM PREVIOUS VERSION:
 *
 *   #1  recurring_id on Transactions
 *       addTransaction() now accepts an optional recurringId parameter.
 *       applyRecurringToMonth() passes the template id so every applied
 *       transaction carries a `recurring_id` column linking it back to its
 *       template. Idempotency now checks by recurring_id instead of name::type,
 *       eliminating false-positive skips when users manually add a same-named tx.
 *
 *   #2  Full schema upgrade
 *       Recurring sheet gains: frequency | day_of_month | start_date | end_date
 *                              | active | last_applied
 *       frequency: 'monthly' (default) | 'weekly' | 'fortnightly' | 'quarterly' | 'annual'
 *       day_of_month: 1–31, blank = apply on navigation (existing behaviour)
 *       start_date: YYYY-MM-DD, blank = immediate
 *       end_date:   YYYY-MM-DD, blank = never expires
 *       active:     true/false — pause/resume without deleting
 *       last_applied: YYYY-MM key of the most recent successful application
 *
 *   #3  Edit support
 *       updateRecurring(recurringId, fields) — updates any mutable field.
 *
 *   #4  Frequency-aware application
 *       _shouldApplyThisMonth(template, monthKey) decides whether a template
 *       fires in a given month based on its frequency, start_date, end_date,
 *       and active flag.
 *
 *   #5  RecurringHistory sheet
 *       Every successful application writes a history row:
 *       id | recurring_id | month_key | transaction_id | applied_at | skipped_reason
 *       getRecurringHistory() / getRecurringHistoryByTemplate() expose this.
 *
 *   #6  getRecurringStatus(monthKey)
 *       Returns each template annotated with: applied_this_month, skipped_reason,
 *       next_apply_month — used by the client to show per-template status.
 *
 *   #7  Expiry auto-deactivation
 *       When a template's end_date has passed, applyRecurringToMonth() marks
 *       it active=false automatically and logs the reason.
 *
 *   #8  initRecurringEnhancements()
 *       One-time migration that adds all new columns to existing Recurring sheets
 *       and creates the RecurringHistory sheet. Safe to re-run.
 *
 * SHEET: Recurring
 * COLUMNS: id | name | amount | type | category | frequency | day_of_month
 *          | start_date | end_date | active | last_applied
 *
 * SHEET: RecurringHistory
 * COLUMNS: id | recurring_id | month_key | transaction_id | applied_at | skipped_reason
 *
 * CALLED BY:
 *   - Client via google.script.run
 *   - utils.js _backgroundSyncMonth() on month navigation
 *   - Triggers.gs monthlyHandler() on the 1st of each month
 *   - Main.gs getBootstrapData()
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var VALID_FREQUENCIES = ['monthly', 'weekly', 'fortnightly', 'quarterly', 'annual'];
var DEFAULT_FREQUENCY  = 'monthly';


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllRecurring()
 *
 * Returns all recurring templates as typed objects including new fields.
 * Inactive templates are included — the client decides whether to show them.
 */
function getAllRecurring() {
  return getUserAllRows('Recurring').map(_castRecurring);
}

/**
 * getRecurringStatus(monthKey)
 *
 * #6 Returns each template annotated with operational status for the given month.
 * Used by the client to render per-template status indicators on the list.
 *
 * Each template gains:
 *   applied_this_month  {boolean}  — a history row exists for this template+month
 *   skipped_reason      {string}   — why it was skipped, or '' if applied/pending
 *   next_apply_month    {string}   — YYYY-MM of the next expected application
 *   history_count       {number}   — total number of times this template has applied
 */
function getRecurringStatus(monthKey) {
  if (!monthKey) throw new Error('Recurring.gs: monthKey is required for getRecurringStatus.');

  var templates = getAllRecurring();
  var history   = _safeGetHistory();

  // Build lookup: { recurring_id: [historyRows] }
  var histByTemplate = {};
  history.forEach(function(h) {
    if (!histByTemplate[h.recurring_id]) histByTemplate[h.recurring_id] = [];
    histByTemplate[h.recurring_id].push(h);
  });

  return templates.map(function(t) {
    var templateHistory = histByTemplate[t.id] || [];

    // Was this template applied this month?
    var appliedThisMonth = templateHistory.some(function(h) {
      return h.month_key === monthKey && !h.skipped_reason;
    });

    // Was it skipped this month, and why?
    var skipRow = templateHistory.find(function(h) {
      return h.month_key === monthKey && h.skipped_reason;
    });
    var skippedReason = skipRow ? skipRow.skipped_reason : '';

    // Next expected application month
    var nextApplyMonth = _computeNextApplyMonth(t, monthKey);

    return Object.assign({}, t, {
      applied_this_month: appliedThisMonth,
      skipped_reason:     skippedReason,
      next_apply_month:   nextApplyMonth,
      history_count:      templateHistory.filter(function(h) { return !h.skipped_reason; }).length
    });
  });
}

/**
 * getRecurringHistory()
 * #5 Returns all RecurringHistory rows, newest first.
 */
function getRecurringHistory() {
  return _safeGetHistory().sort(function(a, b) {
    return b.applied_at.localeCompare(a.applied_at);
  });
}

/**
 * getRecurringHistoryByTemplate(recurringId)
 * #5 Returns history rows for a single template, newest first.
 */
function getRecurringHistoryByTemplate(recurringId) {
  return _safeGetHistory()
    .filter(function(h) { return h.recurring_id === String(recurringId); })
    .sort(function(a, b) { return b.applied_at.localeCompare(a.applied_at); });
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addRecurring(name, amount, type, category, options)
 *
 * Creates a new recurring template. options is an optional object:
 *   {
 *     frequency:    'monthly' | 'weekly' | 'fortnightly' | 'quarterly' | 'annual'
 *     day_of_month: 1–31 | null
 *     start_date:   'YYYY-MM-DD' | ''
 *     end_date:     'YYYY-MM-DD' | ''
 *   }
 * Returns the new recurring object.
 */
function addRecurring(name, amount, type, category, options) {
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

  var opts        = options || {};
  var frequency   = _normFrequency(opts.frequency);
  var dayOfMonth  = _normDayOfMonth(opts.day_of_month);
  var startDate   = _normDate(opts.start_date);
  var endDate     = _normDate(opts.end_date);

  // Validate end_date > start_date if both provided
  if (startDate && endDate && endDate <= startDate) {
    throw new Error('Recurring.gs: end_date must be after start_date.');
  }

  var recurring = {
    id:           generateId(),
    name:         String(name).trim(),
    amount:       parsedAmount,
    type:         normType,
    category:     String(category || 'Other').trim(),
    frequency:    frequency,
    day_of_month: dayOfMonth,
    start_date:   startDate,
    end_date:     endDate,
    active:       true,
    last_applied: ''
  };

  getUserAppendRow('RECURRING', recurring);
  return _castRecurring(recurring);
}

/**
 * updateRecurring(recurringId, fields)
 *
 * #3 Edit support — updates any mutable field on an existing template.
 * Mutable fields: name, amount, type, category, frequency, day_of_month,
 *                 start_date, end_date, active
 * Immutable: id, last_applied (managed by the system)
 *
 * Returns the updated recurring object.
 */
function updateRecurring(recurringId, fields) {
  if (!recurringId) throw new Error('Recurring.gs: recurringId is required.');
  if (!fields || typeof fields !== 'object') {
    throw new Error('Recurring.gs: fields object is required.');
  }

  var rowIndex = getUserFindRowIndex('RECURRING', function(row) {
    return String(row.id) === String(recurringId);
  });

  if (rowIndex === -1) {
    throw new Error('Recurring.gs: Template "' + recurringId + '" not found.');
  }

  var templates = getAllRecurring();
  var current   = templates.find(function(t) { return t.id === recurringId; });
  if (!current) throw new Error('Recurring.gs: Template "' + recurringId + '" not found after index lookup.');

  // Apply updates, falling back to current values
  var newName     = (fields.name     !== undefined) ? String(fields.name).trim()         : current.name;
  var newAmount   = (fields.amount   !== undefined) ? parseFloat(fields.amount)           : current.amount;
  var newType     = (fields.type     !== undefined) ? String(fields.type).toLowerCase()   : current.type;
  var newCat      = (fields.category !== undefined) ? String(fields.category).trim()      : current.category;
  var newFreq     = (fields.frequency     !== undefined) ? _normFrequency(fields.frequency)       : current.frequency;
  var newDayOM    = (fields.day_of_month  !== undefined) ? _normDayOfMonth(fields.day_of_month)   : current.day_of_month;
  var newStart    = (fields.start_date    !== undefined) ? _normDate(fields.start_date)            : current.start_date;
  var newEnd      = (fields.end_date      !== undefined) ? _normDate(fields.end_date)              : current.end_date;
  var newActive   = (fields.active        !== undefined) ? !!fields.active                         : current.active;

  // Validation
  if (!newName)                                     throw new Error('Recurring.gs: name cannot be empty.');
  if (isNaN(newAmount) || newAmount <= 0)           throw new Error('Recurring.gs: amount must be a positive number.');
  if (['income','expense','savings'].indexOf(newType) === -1)
                                                    throw new Error('Recurring.gs: type must be income, expense, or savings.');
  if (newStart && newEnd && newEnd <= newStart)     throw new Error('Recurring.gs: end_date must be after start_date.');

  var updated = {
    id:           current.id,
    name:         newName,
    amount:       newAmount,
    type:         newType,
    category:     newCat,
    frequency:    newFreq,
    day_of_month: newDayOM,
    start_date:   newStart,
    end_date:     newEnd,
    active:       newActive,
    last_applied: current.last_applied
  };

  getUserUpdateRow('RECURRING', rowIndex, updated);

  Logger.log(
    'Recurring.gs: updateRecurring("' + current.name + '") — ' +
    Object.keys(fields).join(', ') + ' updated.'
  );

  return _castRecurring(updated);
}

/**
 * deleteRecurring(recurringId)
 *
 * Deletes the recurring template row. History rows are kept for audit.
 * Does NOT delete any transactions that were previously applied.
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

/**
 * toggleRecurringActive(recurringId)
 *
 * Convenience wrapper to flip the active flag on a template.
 * Returns the updated template object.
 */
function toggleRecurringActive(recurringId) {
  var templates = getAllRecurring();
  var current   = templates.find(function(t) { return t.id === recurringId; });
  if (!current) throw new Error('Recurring.gs: Template "' + recurringId + '" not found.');

  return updateRecurring(recurringId, { active: !current.active });
}


// ─── APPLY TO MONTH ───────────────────────────────────────────────────────────

/**
 * applyRecurringToMonth(monthKey)
 *
 * #1 #4 #7 Applies all eligible recurring templates to the given month.
 *
 * Eligibility rules (per template):
 *   - active must be true
 *   - start_date must be <= the month being applied (or blank)
 *   - end_date must be >= the month being applied (or blank)
 *   - frequency determines which months are valid application months
 *   - A history row with no skipped_reason must not already exist for this
 *     template+month (idempotency via recurring_id, not name::type)
 *
 * On application:
 *   - Calls addTransaction() with recurring_id so the tx is linked back
 *   - Writes a RecurringHistory row
 *   - Updates last_applied on the template row
 *
 * On skipping:
 *   - Writes a RecurringHistory row with a skipped_reason
 *   - Does NOT update last_applied
 *
 * On expiry:
 *   - Sets active=false on the template when end_date has passed
 *
 * Returns { applied: N, skipped: M, expired: K }
 *
 * Called from:
 *   1. Client _backgroundSyncMonth() on month navigation
 *   2. Triggers.gs monthlyHandler() on the 1st of each month
 */
function applyRecurringToMonth(monthKey) {
  if (!monthKey || !String(monthKey).match(/^\d{4}-\d{2}$/)) {
    throw new Error('Recurring.gs: monthKey must be YYYY-MM format.');
  }

  var templates = getAllRecurring();
  var history   = _safeGetHistory();

  // #1 Build idempotency lookup by recurring_id (not name::type)
  // A "done" entry means: applied this month, no skip reason
  var doneIds = {};
  history.forEach(function(h) {
    if (h.month_key === monthKey && !h.skipped_reason) {
      doneIds[h.recurring_id] = true;
    }
  });

  var applied = 0;
  var skipped = 0;
  var expired = 0;

  templates.forEach(function(template) {
    // Already applied this month — skip entirely, no new history row
    if (doneIds[template.id]) {
      skipped++;
      return;
    }

    // #7 Check expiry first
    if (template.end_date && monthKey > template.end_date.slice(0, 7)) {
      if (template.active) {
        _deactivateTemplate(template.id, 'end_date passed: ' + template.end_date);
        expired++;
      }
      _writeHistory(template.id, monthKey, '', 'expired: end_date ' + template.end_date);
      skipped++;
      return;
    }

    // Check active flag
    if (!template.active) {
      _writeHistory(template.id, monthKey, '', 'inactive');
      skipped++;
      return;
    }

    // Check start_date
    if (template.start_date && monthKey < template.start_date.slice(0, 7)) {
      _writeHistory(template.id, monthKey, '', 'before start_date: ' + template.start_date);
      skipped++;
      return;
    }

    // #4 Check frequency eligibility
    if (!_shouldApplyThisMonth(template, monthKey)) {
      _writeHistory(template.id, monthKey, '', 'frequency: not due this month (' + template.frequency + ')');
      skipped++;
      return;
    }

    // Apply — create the transaction with recurring_id
    try {
      var tx = _addTransactionWithRecurringId(
        monthKey,
        template.name,
        template.amount,
        template.type,
        template.category,
        'auto',
        template.id
      );

      // Update last_applied on template
      _updateLastApplied(template.id, monthKey);

      // Write success history row
      _writeHistory(template.id, monthKey, tx.id, '');

      applied++;
    } catch (e) {
      Logger.log('Recurring.gs: apply failed for "' + template.name + '": ' + e.message);
      _writeHistory(template.id, monthKey, '', 'error: ' + e.message);
      skipped++;
    }
  });

  Logger.log(
    'Recurring.gs: applyRecurringToMonth(' + monthKey + ') — ' +
    'applied: ' + applied + ', skipped: ' + skipped + ', expired: ' + expired
  );

  return { applied: applied, skipped: skipped, expired: expired };
}


// ─── MIGRATION ────────────────────────────────────────────────────────────────

/**
 * initRecurringEnhancements()
 *
 * #8 One-time migration for existing users.
 * Run from the Apps Script editor after deploying this update.
 *
 * What it does:
 *   1. Adds new columns to the Recurring sheet: frequency, day_of_month,
 *      start_date, end_date, active, last_applied
 *   2. Sets sensible defaults for all existing rows (monthly, active=true)
 *   3. Adds recurring_id column to the Transactions sheet
 *   4. Creates the RecurringHistory sheet if absent
 *
 * Safe to re-run — columns/sheets are only created when missing.
 */
function initRecurringEnhancements() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('initRecurringEnhancements: No active user — run while signed in.');
    return;
  }

  var userKey = getCurrentUserKey();
  var ss      = getSpreadsheet();

  // ── 1. Upgrade Recurring sheet ────────────────────────────────────────────
  var recName  = userKey + ':Recurring';
  var recSheet = ss.getSheetByName(recName);

  if (recSheet) {
    var lastCol = recSheet.getLastColumn();
    var headers = recSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                          .map(function(h) { return String(h).trim(); });
    var lastRow = recSheet.getLastRow();

    var newCols = [
      { col: 'frequency',    default: 'monthly' },
      { col: 'day_of_month', default: '' },
      { col: 'start_date',   default: '' },
      { col: 'end_date',     default: '' },
      { col: 'active',       default: true },
      { col: 'last_applied', default: '' }
    ];

    newCols.forEach(function(spec) {
      if (headers.indexOf(spec.col) === -1) {
        var colIdx = lastCol + 1;
        recSheet.getRange(1, colIdx).setValue(spec.col);
        recSheet.getRange(1, colIdx).setFontWeight('bold');
        recSheet.getRange(1, colIdx).setBackground('#f0f0f0');

        if (lastRow >= 2) {
          for (var r = 2; r <= lastRow; r++) {
            recSheet.getRange(r, colIdx).setValue(spec.default);
          }
        }

        lastCol++;
        headers.push(spec.col);
        Logger.log('initRecurringEnhancements: Added "' + spec.col + '" to ' + recName);
      }
    });

    // Apply string formats to date columns
    _applyStringFormats(recSheet, headers);
    SpreadsheetApp.flush();
  } else {
    Logger.log('initRecurringEnhancements: Recurring sheet not found for ' + userKey);
  }

  // ── 2. Add recurring_id column to Transactions sheet ─────────────────────
  var txName  = userKey + ':Transactions';
  var txSheet = ss.getSheetByName(txName);

  if (txSheet) {
    var txLastCol = txSheet.getLastColumn();
    var txHeaders = txSheet.getRange(1, 1, 1, txLastCol).getValues()[0]
                           .map(function(h) { return String(h).trim(); });

    if (txHeaders.indexOf('recurring_id') === -1) {
      var newCol = txLastCol + 1;
      txSheet.getRange(1, newCol).setValue('recurring_id');
      txSheet.getRange(1, newCol).setFontWeight('bold');
      txSheet.getRange(1, newCol).setBackground('#f0f0f0');

      var txLastRow = txSheet.getLastRow();
      if (txLastRow >= 2) {
        txSheet.getRange(2, newCol, txLastRow - 1, 1).setValue('');
      }

      txHeaders.push('recurring_id');
      _applyStringFormats(txSheet, txHeaders);
      SpreadsheetApp.flush();
      Logger.log('initRecurringEnhancements: Added recurring_id to Transactions for ' + userKey);
    } else {
      Logger.log('initRecurringEnhancements: recurring_id already exists in Transactions for ' + userKey);
    }
  }

  // ── 3. Create RecurringHistory sheet ──────────────────────────────────────
  var rhName  = userKey + ':RecurringHistory';
  var rhSheet = ss.getSheetByName(rhName);

  if (!rhSheet) {
    rhSheet = ss.insertSheet(rhName);
    var rhHeaders = ['id', 'recurring_id', 'month_key', 'transaction_id', 'applied_at', 'skipped_reason'];
    rhSheet.getRange(1, 1, 1, rhHeaders.length).setValues([rhHeaders]);
    rhSheet.getRange(1, 1, 1, rhHeaders.length).setFontWeight('bold');
    rhSheet.getRange(1, 1, 1, rhHeaders.length).setBackground('#f0f0f0');
    _applyStringFormats(rhSheet, rhHeaders);
    SpreadsheetApp.flush();
    Logger.log('initRecurringEnhancements: Created RecurringHistory sheet for ' + userKey);
  } else {
    Logger.log('initRecurringEnhancements: RecurringHistory sheet already exists for ' + userKey);
  }

  Logger.log('initRecurringEnhancements: Migration complete for ' + userKey);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castRecurring(row)
 * Normalises a raw sheet row into a typed recurring object including new fields.
 */
function _castRecurring(row) {
  var active = row.active === true
    || row.active === 'true'
    || row.active === 'TRUE'
    || row.active === 1
    || row.active === '1';

  // Default active=true for rows that pre-date the schema migration
  // (blank active column means the row existed before and was always on)
  if (row.active === '' || row.active === undefined || row.active === null) {
    active = true;
  }

  return {
    id:           String(row.id       || '').trim(),
    name:         String(row.name     || '').trim(),
    amount:       parseFloat(row.amount) || 0,
    type:         String(row.type     || '').trim().toLowerCase(),
    category:     String(row.category || 'Other').trim(),
    frequency:    _normFrequency(row.frequency),
    day_of_month: _normDayOfMonth(row.day_of_month),
    start_date:   _normDate(row.start_date),
    end_date:     _normDate(row.end_date),
    active:       active,
    last_applied: String(row.last_applied || '').trim()
  };
}

/**
 * _castHistoryRow(row)
 * Normalises a raw RecurringHistory row.
 */
function _castHistoryRow(row) {
  return {
    id:             String(row.id             || '').trim(),
    recurring_id:   String(row.recurring_id   || '').trim(),
    month_key:      String(row.month_key      || '').trim(),
    transaction_id: String(row.transaction_id || '').trim(),
    applied_at:     String(row.applied_at     || '').trim(),
    skipped_reason: String(row.skipped_reason || '').trim()
  };
}

/**
 * _normFrequency(raw)
 * Normalises a frequency value, defaulting to 'monthly'.
 */
function _normFrequency(raw) {
  var s = String(raw || '').trim().toLowerCase();
  return VALID_FREQUENCIES.indexOf(s) !== -1 ? s : DEFAULT_FREQUENCY;
}

/**
 * _normDayOfMonth(raw)
 * Normalises a day-of-month value. Returns '' if blank/invalid.
 */
function _normDayOfMonth(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  var d = parseInt(raw, 10);
  return (!isNaN(d) && d >= 1 && d <= 31) ? d : '';
}

/**
 * _normDate(raw)
 * Normalises a date string to YYYY-MM-DD or returns ''.
 */
function _normDate(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

/**
 * _shouldApplyThisMonth(template, monthKey)
 *
 * #4 Returns true if the template should generate a transaction in monthKey.
 * Assumes start_date/end_date/active checks have already passed.
 *
 * Frequency rules:
 *   monthly    — every month (always true)
 *   quarterly  — months 1, 4, 7, 10 relative to start_date month
 *               (or Jan/Apr/Jul/Oct if no start_date)
 *   annual     — only the month matching start_date (or January if none)
 *   weekly     — every month (weekly transactions apply once per month at the
 *               monthly level; the amount should reflect a 4-week period if desired)
 *               NOTE: True weekly granularity requires daily triggers which are
 *               outside the monthly navigation model. We document this limitation.
 *   fortnightly — every month (same reasoning as weekly)
 *
 * For the Apps Script monthly navigation model, weekly and fortnightly are
 * treated as "every month" at the sheet level. The amount field captures the
 * intent (e.g. weekly amount × 4 or × 2).
 */
function _shouldApplyThisMonth(template, monthKey) {
  var freq = template.frequency || DEFAULT_FREQUENCY;

  if (freq === 'monthly' || freq === 'weekly' || freq === 'fortnightly') {
    return true; // applies every navigation month
  }

  var parts  = monthKey.split('-');
  var year   = parseInt(parts[0], 10);
  var month  = parseInt(parts[1], 10); // 1-indexed

  if (freq === 'quarterly') {
    // Apply in Jan, Apr, Jul, Oct — or offset by start_date month if provided
    var offsetMonth = 1; // default anchor = January
    if (template.start_date) {
      var startParts = template.start_date.split('-');
      offsetMonth = parseInt(startParts[1], 10);
    }
    // Month qualifies if (month - offsetMonth) % 3 === 0
    var diff = ((month - offsetMonth) % 3 + 3) % 3;
    return diff === 0;
  }

  if (freq === 'annual') {
    // Apply only in the month matching start_date (or January)
    var targetMonth = 1;
    if (template.start_date) {
      var startParts2 = template.start_date.split('-');
      targetMonth = parseInt(startParts2[1], 10);
    }
    return month === targetMonth;
  }

  return true; // fallback — apply
}

/**
 * _computeNextApplyMonth(template, currentMonthKey)
 * Returns the YYYY-MM of the next month this template is expected to apply.
 * Returns '' if the template is inactive or expired.
 */
function _computeNextApplyMonth(template, currentMonthKey) {
  if (!template.active) return '';
  if (template.end_date && currentMonthKey > template.end_date.slice(0, 7)) return '';

  var parts = currentMonthKey.split('-');
  var year  = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);

  // Advance one month at a time until we find an eligible month (max 13 tries)
  for (var i = 0; i < 13; i++) {
    month++;
    if (month > 12) { month = 1; year++; }
    var candidate = year + '-' + (month < 10 ? '0' : '') + month;

    if (template.end_date && candidate > template.end_date.slice(0, 7)) return '';
    if (template.start_date && candidate < template.start_date.slice(0, 7)) continue;

    if (_shouldApplyThisMonth(template, candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * _addTransactionWithRecurringId(monthKey, name, amount, type, category, note, recurringId)
 *
 * #1 Wrapper around addTransaction() that also writes the recurring_id column.
 * Falls back gracefully if the recurring_id column doesn't exist yet
 * (pre-migration sheets).
 */
function _addTransactionWithRecurringId(monthKey, name, amount, type, category, note, recurringId) {
  // Call the standard addTransaction first
  var tx = addTransaction(monthKey, name, amount, type, category, note);

  // Now patch the recurring_id onto the row we just wrote
  if (recurringId && tx && tx.id) {
    try {
      var txSheetName = getUserSheetName('Transactions');
      var rowIndex = getUserFindRowIndex('TRANSACTIONS', function(row) {
        return String(row.id) === String(tx.id);
      });

      if (rowIndex !== -1) {
        var sheet   = getSheet(txSheetName);
        var lastCol = sheet.getLastColumn();
        var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                           .map(function(h) { return String(h).trim(); });
        var ridIdx  = headers.indexOf('recurring_id');

        if (ridIdx !== -1) {
          sheet.getRange(rowIndex, ridIdx + 1).setValue(String(recurringId));
          SpreadsheetApp.flush();
        }
      }
    } catch (e) {
      // Non-fatal — the transaction was written; only the link is missing
      Logger.log('Recurring.gs: _addTransactionWithRecurringId — could not write recurring_id: ' + e.message);
    }
  }

  // Return the tx with recurring_id attached for AppState
  return Object.assign({}, tx, { recurring_id: recurringId || '' });
}

/**
 * _writeHistory(recurringId, monthKey, transactionId, skippedReason)
 * Appends a row to the RecurringHistory sheet.
 * Silently no-ops if the sheet doesn't exist yet (pre-migration).
 */
function _writeHistory(recurringId, monthKey, transactionId, skippedReason) {
  try {
    var row = {
      id:             generateId(),
      recurring_id:   String(recurringId   || ''),
      month_key:      String(monthKey      || ''),
      transaction_id: String(transactionId || ''),
      applied_at:     new Date().toISOString(),
      skipped_reason: String(skippedReason || '')
    };
    getUserAppendRow('RECURRING_HISTORY', row);
  } catch (e) {
    Logger.log('Recurring.gs: _writeHistory failed (non-fatal): ' + e.message);
  }
}

/**
 * _updateLastApplied(recurringId, monthKey)
 * Updates the last_applied field on the template row.
 */
function _updateLastApplied(recurringId, monthKey) {
  try {
    var rowIndex = getUserFindRowIndex('RECURRING', function(row) {
      return String(row.id) === String(recurringId);
    });

    if (rowIndex === -1) return;

    var sheet   = getSheet(getUserSheetName('Recurring'));
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                       .map(function(h) { return String(h).trim(); });
    var laIdx   = headers.indexOf('last_applied');

    if (laIdx !== -1) {
      sheet.getRange(rowIndex, laIdx + 1).setValue(monthKey);
      SpreadsheetApp.flush();
    }
  } catch (e) {
    Logger.log('Recurring.gs: _updateLastApplied failed (non-fatal): ' + e.message);
  }
}

/**
 * _deactivateTemplate(recurringId, reason)
 * Sets active=false on a template row (used for auto-expiry).
 */
function _deactivateTemplate(recurringId, reason) {
  try {
    updateRecurring(recurringId, { active: false });
    Logger.log('Recurring.gs: auto-deactivated template "' + recurringId + '" — ' + reason);
  } catch (e) {
    Logger.log('Recurring.gs: _deactivateTemplate failed (non-fatal): ' + e.message);
  }
}

/**
 * _safeGetHistory()
 * Returns all RecurringHistory rows, returning [] if the sheet doesn't exist.
 */
function _safeGetHistory() {
  try {
    return getUserAllRows('RecurringHistory').map(_castHistoryRow);
  } catch (e) {
    return [];
  }
}
