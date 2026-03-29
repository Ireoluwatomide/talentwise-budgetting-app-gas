/**
 * NetWorth.gs — Net Worth Tracker (Overhauled)
 *
 * IMPROVEMENTS FROM PREVIOUS VERSION:
 *
 *   #1  updateNetWorthItem(itemId, name, type, amount, category)
 *       Edit existing items without delete + re-add.
 *
 *   #2  Category field on items
 *       Assets: Cash & Savings | Investments | Real Estate | Vehicle | Other Asset
 *       Liabilities: Mortgage | Personal Loan | Credit Card | Student Loan | Other Liability
 *       Stored in the NetWorth sheet as a new 'category' column.
 *
 *   #3  last_updated timestamp
 *       Tracks when each item was last reviewed so the client can flag stale values.
 *
 *   #4  NetWorthHistory sheet — monthly snapshots
 *       recordNetWorthSnapshot(label) saves a dated snapshot of total assets,
 *       liabilities, and net worth. Called by the monthly trigger and on demand.
 *
 *   #5  getNetWorthHistory() — returns all snapshots sorted oldest first
 *       Used by the trend chart on the client.
 *
 *   #6  Net worth target stored in Preferences
 *       getNetWorthTarget() / setNetWorthTarget(amount) persist a user-defined goal.
 *
 *   #7  syncDebtsToNetWorth() — AUTO-SYNCS active debt balances as liability items
 *       Called automatically on every bootstrap load (Main.gs getBootstrapData)
 *       and every month by Triggers.gs monthlyHandler() BEFORE the snapshot.
 *       Idempotent: updates existing debt-linked items, creates new ones, removes
 *       items whose debts were fully paid off or archived.
 *       NOT exposed as a client button — it runs silently in the background.
 *       importFromDebts() remains as the internal implementation it delegates to.
 *
 *   #8  importFromSavings() — MANUAL import of savings goal balances as assets
 *       Triggered by the "Import Savings" button on the client.
 *       Idempotent: updates existing savings-linked items rather than duplicating.
 *
 *   #9  checkNetWorthAlerts() — returns alert objects for Notifications.gs
 *       Triggers: liabilities > assets (negative net worth),
 *                 net worth declined vs last snapshot,
 *                 items not updated in > 60 days (stale data warning).
 *
 *  #10  getNetWorthSummary() — now included in getBootstrapData()
 *       Exposes totals + debt coverage ratio + liquidity split.
 *
 *  #11  initNetWorthEnhancements() — one-time migration for existing users
 *       Adds category + last_updated columns; creates NetWorthHistory sheet.
 *
 * SHEET: NetWorth
 * COLUMNS: id | name | type | amount | category | last_updated | source_id
 *
 *   source_id: optional — links imported items to their origin
 *              (debt id prefixed 'debt:' or savings goal id prefixed 'sav:')
 *              Enables idempotent re-import and prevents duplicates.
 *
 * SHEET: NetWorthHistory
 * COLUMNS: id | snapshot_date | label | total_assets | total_liabilities | net_worth
 *
 * CALLED BY:
 *   - Client via google.script.run (addNetWorthItem, updateNetWorthItem,
 *     deleteNetWorthItem, recordNetWorthSnapshot, setNetWorthTarget,
 *     importFromSavings — savings import is manual only)
 *   - Main.gs getBootstrapData() — calls syncDebtsToNetWorth() automatically
 *   - Triggers.gs monthlyHandler() — calls syncDebtsToNetWorth() then
 *     recordNetWorthSnapshot()
 *   - Notifications.gs — calls checkNetWorthAlerts()
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var VALID_NW_TYPES = ['asset', 'liability'];

var NW_ASSET_CATEGORIES = [
  'Cash & Savings',
  'Investments',
  'Real Estate',
  'Vehicle',
  'Business',
  'Other Asset'
];

var NW_LIABILITY_CATEGORIES = [
  'Mortgage',
  'Personal Loan',
  'Credit Card',
  'Student Loan',
  'Auto Loan',
  'Other Liability'
];

var NW_STALE_DAYS = 60; // items not updated in this many days are flagged stale

var NW_TARGET_PREF_KEY = 'net_worth_target';


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllNetWorthItems()
 *
 * Returns all net worth items as typed objects.
 * Includes computed field: is_stale (boolean — not updated in > NW_STALE_DAYS days).
 */
function getAllNetWorthItems() {
  var today = new Date();
  return getUserAllRows('NetWorth').map(function(row) {
    return _castNWItem(row, today);
  });
}

/**
 * getNetWorthSummary()
 *
 * Returns aggregate metrics for the summary header.
 * Includes:
 *   total_assets, total_liabilities, net_worth,
 *   liquid_assets (Cash & Savings + Investments),
 *   illiquid_assets (Real Estate + Vehicle + Business + Other Asset),
 *   debt_coverage_ratio (total_assets / total_liabilities, 0 if no liabilities),
 *   stale_count (items not updated in NW_STALE_DAYS days)
 */
function getNetWorthSummary() {
  var items      = getAllNetWorthItems();
  var assets     = 0;
  var liabilities = 0;
  var liquid     = 0;
  var illiquid   = 0;
  var staleCount = 0;

  var liquidCats = ['Cash & Savings', 'Investments'];

  items.forEach(function(item) {
    var amt = parseFloat(item.amount) || 0;
    if (item.type === 'asset') {
      assets += amt;
      if (liquidCats.indexOf(item.category) !== -1) {
        liquid += amt;
      } else {
        illiquid += amt;
      }
    } else if (item.type === 'liability') {
      liabilities += amt;
    }
    if (item.is_stale) staleCount++;
  });

  var debtCoverage = liabilities > 0
    ? Math.round((assets / liabilities) * 100) / 100
    : null;

  return {
    total_assets:        assets,
    total_liabilities:   liabilities,
    net_worth:           assets - liabilities,
    liquid_assets:       liquid,
    illiquid_assets:     illiquid,
    debt_coverage_ratio: debtCoverage,
    stale_count:         staleCount,
    item_count:          items.length
  };
}

/**
 * getNetWorthHistory()
 * Returns all snapshot rows sorted oldest-first (for trend chart).
 */
function getNetWorthHistory() {
  try {
    return getUserAllRows('NetWorthHistory')
      .map(_castNWSnapshot)
      .sort(function(a, b) {
        return a.snapshot_date.localeCompare(b.snapshot_date);
      });
  } catch(e) {
    Logger.log('NetWorth.gs: getNetWorthHistory failed — ' + e.message);
    return [];
  }
}

/**
 * getNetWorthTarget()
 * Returns the user's net worth target amount (0 if not set).
 */
function getNetWorthTarget() {
  try {
    var map = _getPrefsMap();
    return parseFloat(map[NW_TARGET_PREF_KEY] || '0') || 0;
  } catch(e) {
    return 0;
  }
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addNetWorthItem(name, type, amount, category)
 *
 * Validates and appends a new net worth item.
 * #2 category field, #3 last_updated timestamp
 * Returns the new item object.
 */
function addNetWorthItem(name, type, amount, category) {
  if (!name || String(name).trim() === '') {
    throw new Error('NetWorth.gs: Item name is required.');
  }

  var normType = String(type || '').trim().toLowerCase();
  if (VALID_NW_TYPES.indexOf(normType) === -1) {
    throw new Error('NetWorth.gs: type must be "asset" or "liability". Got: "' + type + '".');
  }

  var parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('NetWorth.gs: amount must be a positive number.');
  }

  // Validate or default category
  var validCats = normType === 'asset' ? NW_ASSET_CATEGORIES : NW_LIABILITY_CATEGORIES;
  var trimmedCat = (category && String(category).trim()) ? String(category).trim() : '';
  if (!trimmedCat || validCats.indexOf(trimmedCat) === -1) {
    trimmedCat = normType === 'asset' ? 'Other Asset' : 'Other Liability';
  }

  var item = {
    id:           generateId(),
    name:         String(name).trim(),
    type:         normType,
    amount:       parsedAmount,
    category:     trimmedCat,
    last_updated: new Date().toISOString(),
    source_id:    ''
  };

  getUserAppendRow('NET_WORTH', item);
  return _castNWItem(item, new Date());
}

/**
 * updateNetWorthItem(itemId, name, type, amount, category)
 *
 * #1 Edit support — updates a net worth item in place.
 * Refreshes last_updated to now.
 * Returns the updated item object.
 */
function updateNetWorthItem(itemId, name, type, amount, category) {
  if (!itemId) throw new Error('NetWorth.gs: itemId is required.');

  var rowIndex = getUserFindRowIndex('NET_WORTH', function(row) {
    return String(row.id) === String(itemId);
  });

  if (rowIndex === -1) {
    throw new Error('NetWorth.gs: Item "' + itemId + '" not found.');
  }

  var items   = getAllNetWorthItems();
  var current = items.find(function(i) { return i.id === itemId; });
  if (!current) throw new Error('NetWorth.gs: Item "' + itemId + '" not found after index lookup.');

  var newName   = (name && String(name).trim()) ? String(name).trim() : current.name;
  var newType   = (type && VALID_NW_TYPES.indexOf(String(type).toLowerCase()) !== -1)
    ? String(type).toLowerCase() : current.type;
  var newAmount = (amount !== undefined && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0)
    ? parseFloat(amount) : current.amount;

  var validCats = newType === 'asset' ? NW_ASSET_CATEGORIES : NW_LIABILITY_CATEGORIES;
  var newCat    = (category && validCats.indexOf(String(category).trim()) !== -1)
    ? String(category).trim()
    : (current.type === newType ? current.category : (newType === 'asset' ? 'Other Asset' : 'Other Liability'));

  var updated = {
    id:           itemId,
    name:         newName,
    type:         newType,
    amount:       newAmount,
    category:     newCat,
    last_updated: new Date().toISOString(),
    source_id:    current.source_id || ''
  };

  getUserUpdateRow('NET_WORTH', rowIndex, updated);
  return _castNWItem(updated, new Date());
}

/**
 * deleteNetWorthItem(itemId)
 * Removes the net worth item row matching itemId.
 */
function deleteNetWorthItem(itemId) {
  if (!itemId) throw new Error('NetWorth.gs: itemId is required.');

  var rowIndex = getUserFindRowIndex('NET_WORTH', function(row) {
    return String(row.id) === String(itemId);
  });

  if (rowIndex === -1) {
    throw new Error('NetWorth.gs: Item "' + itemId + '" not found.');
  }

  getUserDeleteRow('NET_WORTH', rowIndex);
  return { success: true };
}

/**
 * recordNetWorthSnapshot(label)
 *
 * #4 Saves a dated snapshot of total assets, liabilities, and net worth.
 * label: optional string (e.g. 'March 2026' or 'Manual') — defaults to current month.
 *
 * Called by:
 *   - Triggers.gs monthlyHandler() with the month label
 *   - Client "Record Snapshot" button with 'Manual'
 *
 * Returns the new snapshot object.
 */
function recordNetWorthSnapshot(label) {
  var summary = getNetWorthSummary();
  var now     = new Date();

  var snapshotDate = now.getFullYear() + '-' +
    (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1) + '-' +
    (now.getDate() < 10 ? '0' : '') + now.getDate();

  var snapshotLabel = label ? String(label).trim() : (
    ['January','February','March','April','May','June',
     'July','August','September','October','November','December'][now.getMonth()] +
    ' ' + now.getFullYear()
  );

  var snapshot = {
    id:                generateId(),
    snapshot_date:     snapshotDate,
    label:             snapshotLabel,
    total_assets:      summary.total_assets,
    total_liabilities: summary.total_liabilities,
    net_worth:         summary.net_worth
  };

  getUserAppendRow('NET_WORTH_HISTORY', snapshot);

  Logger.log(
    'NetWorth.gs: recordNetWorthSnapshot — ' + snapshotLabel +
    ' | NW: ' + summary.net_worth +
    ' | Assets: ' + summary.total_assets +
    ' | Liabilities: ' + summary.total_liabilities
  );

  return _castNWSnapshot(snapshot);
}

/**
 * setNetWorthTarget(amount)
 *
 * #6 Stores the user's net worth target in Preferences.
 * Returns { success: true, target: amount }
 */
function setNetWorthTarget(amount) {
  var parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error('NetWorth.gs: target amount must be a non-negative number.');
  }
  setPreference(NW_TARGET_PREF_KEY, String(parsed));
  return { success: true, target: parsed };
}

/**
 * syncDebtsToNetWorth()
 *
 * #7 PUBLIC ENTRY POINT — called automatically by Main.gs and Triggers.gs.
 *
 * Fully synchronises active debt balances into the NetWorth sheet as
 * liability items. This is the auto-sync path — no client button needed.
 *
 * Three operations performed in one pass:
 *   CREATE  — new active debt with no matching NW item → create liability
 *   UPDATE  — existing NW item whose debt amount changed → update amount/name
 *   REMOVE  — NW item linked to a debt that is now paid off or archived
 *             → delete it (debt no longer counts as a liability)
 *
 * Idempotent — safe to call on every page load and every monthly trigger.
 * Returns { created, updated, removed, skipped } for logging.
 *
 * DESIGN NOTE: We intentionally do NOT call this from the client via
 * google.script.run — it runs server-side only so the client never has to
 * wait for it. The updated items are returned by the next getBootstrapData()
 * call (i.e. the next page load or the monthly trigger cycle).
 */
function syncDebtsToNetWorth() {
  return _importFromDebtsInternal(true /* allowRemove */);
}

/**
 * importFromDebts()
 *
 * INTERNAL — delegates to _importFromDebtsInternal.
 * Kept as a named function so SERVER_PATCHES references remain valid.
 * allowRemove is false here — a manual call should not silently delete items
 * the user may have manually renamed or customised.
 *
 * Returns { created, updated, removed, skipped }
 */
function importFromDebts() {
  return _importFromDebtsInternal(false /* allowRemove */);
}

/**
 * _importFromDebtsInternal(allowRemove)
 *
 * Core debt-sync logic shared by syncDebtsToNetWorth() and importFromDebts().
 *
 * allowRemove:
 *   true  — called from auto-sync path; paid-off or archived debt items
 *            are deleted from NetWorth so they stop counting as liabilities.
 *   false — called from manual path; paid-off items are only zeroed/skipped,
 *            never deleted, so the user can review them first.
 */
function _importFromDebtsInternal(allowRemove) {
  // getAllDebts() returns only active (non-archived) debts by default.
  // We also need archived debts so we can remove their NW items.
  var activeDebts   = getAllDebts('default', false); // active only
  var allDebts      = getAllDebts('default', true);  // includes archived
  var items         = getAllNetWorthItems();

  // Build lookup of active debt IDs → debt object
  var activeDebtMap = {};
  activeDebts.forEach(function(d) { activeDebtMap[d.id] = d; });

  // Build lookup of source_id → NW item for all debt-linked items
  var bySource = {};
  items.forEach(function(item) {
    if (item.source_id && item.source_id.indexOf('debt:') === 0) {
      bySource[item.source_id] = item;
    }
  });

  var created = 0;
  var updated = 0;
  var removed = 0;
  var skipped = 0;

  // ── Pass 1: Create or update items for active debts ──────────────────────
  activeDebts.forEach(function(debt) {
    var sourceKey = 'debt:' + debt.id;
    var owed      = parseFloat(debt.amount_owed) || 0;

    var existing = bySource[sourceKey];

    if (owed <= 0) {
      // Debt is fully paid off — remove the NW item if allowRemove
      if (existing && allowRemove) {
        var rowIndex = getUserFindRowIndex('NET_WORTH', function(row) {
          return String(row.id) === String(existing.id);
        });
        if (rowIndex !== -1) {
          getUserDeleteRow('NET_WORTH', rowIndex);
          removed++;
        }
      } else {
        skipped++;
      }
      return;
    }

    if (existing) {
      // Check if name or amount changed — only write if needed
      var nameChanged   = existing.name   !== debt.name;
      var amountChanged = Math.abs(existing.amount - owed) > 0.01;

      if (nameChanged || amountChanged) {
        var rowIndex = getUserFindRowIndex('NET_WORTH', function(row) {
          return String(row.id) === String(existing.id);
        });
        if (rowIndex !== -1) {
          var updatedRow = {
            id:           existing.id,
            name:         debt.name,
            type:         'liability',
            amount:       owed,
            category:     existing.category || _guessDebtCategory(debt),
            last_updated: new Date().toISOString(),
            source_id:    sourceKey
          };
          getUserUpdateRow('NET_WORTH', rowIndex, updatedRow);
          updated++;
        }
      } else {
        skipped++;
      }
    } else {
      // New debt — create a liability item
      var newItem = {
        id:           generateId(),
        name:         debt.name,
        type:         'liability',
        amount:       owed,
        category:     _guessDebtCategory(debt),
        last_updated: new Date().toISOString(),
        source_id:    sourceKey
      };
      getUserAppendRow('NET_WORTH', newItem);
      created++;
    }
  });

  // ── Pass 2: Remove items for archived debts (auto-sync only) ─────────────
  if (allowRemove) {
    var archivedIds = {};
    allDebts.forEach(function(d) {
      if (d.archived) archivedIds['debt:' + d.id] = true;
    });

    Object.keys(bySource).forEach(function(sourceKey) {
      if (!archivedIds[sourceKey]) return;
      var item = bySource[sourceKey];
      var rowIndex = getUserFindRowIndex('NET_WORTH', function(row) {
        return String(row.id) === String(item.id);
      });
      if (rowIndex !== -1) {
        getUserDeleteRow('NET_WORTH', rowIndex);
        removed++;
      }
    });
  }

  Logger.log(
    'NetWorth.gs: _importFromDebtsInternal(allowRemove=' + allowRemove + ') — ' +
    'created: ' + created + ', updated: ' + updated +
    ', removed: ' + removed + ', skipped: ' + skipped
  );

  return { created: created, updated: updated, removed: removed, skipped: skipped };
}

/**
 * importFromSavings()
 *
 * #8 Creates or updates asset items from all savings goals.
 * Each goal becomes an asset item with source_id = 'sav:{goalId}'.
 * Category is always 'Cash & Savings'.
 *
 * Returns { created: N, updated: M, skipped: K }
 */
function importFromSavings() {
  var goals   = getAllSavingsGoals(); // from Savings.gs
  var items   = getAllNetWorthItems();

  var bySource = {};
  items.forEach(function(item) {
    if (item.source_id && item.source_id.indexOf('sav:') === 0) {
      bySource[item.source_id] = item;
    }
  });

  var created = 0;
  var updated = 0;
  var skipped = 0;

  goals.forEach(function(goal) {
    var sourceKey = 'sav:' + goal.id;
    var saved     = parseFloat(goal.saved_amount) || 0;

    if (saved <= 0) {
      skipped++;
      return; // no balance yet — nothing to import
    }

    var existing = bySource[sourceKey];

    if (existing) {
      if (Math.abs(existing.amount - saved) > 0.01) {
        var rowIndex = getUserFindRowIndex('NET_WORTH', function(row) {
          return String(row.id) === String(existing.id);
        });
        if (rowIndex !== -1) {
          var updatedRow = Object.assign({}, existing, {
            name:         goal.name,
            amount:       saved,
            last_updated: new Date().toISOString()
          });
          getUserUpdateRow('NET_WORTH', rowIndex, updatedRow);
          updated++;
        }
      } else {
        skipped++;
      }
    } else {
      var newItem = {
        id:           generateId(),
        name:         goal.name,
        type:         'asset',
        amount:       saved,
        category:     'Cash & Savings',
        last_updated: new Date().toISOString(),
        source_id:    sourceKey
      };
      getUserAppendRow('NET_WORTH', newItem);
      created++;
    }
  });

  Logger.log(
    'NetWorth.gs: importFromSavings — created: ' + created +
    ', updated: ' + updated + ', skipped: ' + skipped
  );

  return { created: created, updated: updated, skipped: skipped };
}

/**
 * checkNetWorthAlerts()
 *
 * #9 Returns structured alert data for Notifications.gs.
 *
 * Alert types:
 *   'negative'  — liabilities > assets (negative net worth)
 *   'declined'  — net worth dropped vs last snapshot
 *   'stale'     — one or more items not updated in > NW_STALE_DAYS days
 *
 * Returns [{ type, severity, title, sub }]
 */
function checkNetWorthAlerts() {
  var alerts  = [];
  var summary = getNetWorthSummary();
  var history = getNetWorthHistory();

  // Alert 1: Negative net worth
  if (summary.net_worth < 0) {
    alerts.push({
      type:     'negative',
      severity: 'danger',
      title:    'Negative Net Worth',
      sub:      'Liabilities exceed assets by ' + Math.abs(summary.net_worth).toLocaleString()
    });
  }

  // Alert 2: Net worth declined vs last snapshot
  if (history.length >= 2) {
    var latest = history[history.length - 1];
    var prev   = history[history.length - 2];
    var decline = prev.net_worth - latest.net_worth;
    if (decline > 0) {
      alerts.push({
        type:     'declined',
        severity: 'warning',
        title:    'Net Worth Declined',
        sub:      'Down ' + decline.toLocaleString() + ' since ' + prev.label
      });
    }
  }

  // Alert 3: Stale items
  if (summary.stale_count > 0) {
    alerts.push({
      type:     'stale',
      severity: 'warning',
      title:    'Stale Net Worth Data',
      sub:      summary.stale_count + ' item' + (summary.stale_count > 1 ? 's' : '') +
                ' not updated in ' + NW_STALE_DAYS + '+ days'
    });
  }

  return alerts;
}


// ─── MIGRATION ────────────────────────────────────────────────────────────────

/**
 * initNetWorthEnhancements()
 *
 * #11 One-time migration for existing users.
 * Run from the Apps Script editor after deploying.
 *
 * What it does:
 *   1. Adds category, last_updated, source_id columns to NetWorth sheet
 *   2. Creates NetWorthHistory sheet
 *
 * Safe to re-run.
 */
function initNetWorthEnhancements() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    Logger.log('initNetWorthEnhancements: No active user.');
    return;
  }

  var userKey = getCurrentUserKey();
  var ss      = getSpreadsheet();

  // ── 1. Update NetWorth sheet columns ──────────────────────────────────────
  var nwName  = userKey + ':NetWorth';
  var nwSheet = ss.getSheetByName(nwName);

  if (nwSheet) {
    var lastCol = nwSheet.getLastColumn();
    var headers = nwSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                         .map(function(h) { return String(h).trim(); });

    var toAdd = [
      { col: 'category',     default: function(type) { return type === 'asset' ? 'Other Asset' : 'Other Liability'; } },
      { col: 'last_updated', default: function()     { return new Date().toISOString(); } },
      { col: 'source_id',    default: function()     { return ''; } }
    ];

    toAdd.forEach(function(spec) {
      if (headers.indexOf(spec.col) === -1) {
        var newColIdx = lastCol + 1;
        nwSheet.getRange(1, newColIdx).setValue(spec.col);
        nwSheet.getRange(1, newColIdx).setFontWeight('bold');
        nwSheet.getRange(1, newColIdx).setBackground('#f0f0f0');

        // Fill existing rows with defaults
        var lastRow = nwSheet.getLastRow();
        if (lastRow >= 2) {
          var typeColIdx = headers.indexOf('type') + 1;
          for (var r = 2; r <= lastRow; r++) {
            var typeVal = typeColIdx > 0
              ? String(nwSheet.getRange(r, typeColIdx).getValue()).trim()
              : 'asset';
            nwSheet.getRange(r, newColIdx).setValue(spec.default(typeVal));
          }
        }

        lastCol = newColIdx;
        headers.push(spec.col);
        Logger.log('initNetWorthEnhancements: Added "' + spec.col + '" to ' + nwName);
      }
    });

    SpreadsheetApp.flush();
  } else {
    Logger.log('initNetWorthEnhancements: NetWorth sheet not found for ' + userKey);
  }

  // ── 2. Create NetWorthHistory sheet ───────────────────────────────────────
  var nhName  = userKey + ':NetWorthHistory';
  var nhSheet = ss.getSheetByName(nhName);

  if (!nhSheet) {
    nhSheet = ss.insertSheet(nhName);
    var nhHeaders = ['id', 'snapshot_date', 'label', 'total_assets', 'total_liabilities', 'net_worth'];
    nhSheet.getRange(1, 1, 1, nhHeaders.length).setValues([nhHeaders]);
    nhSheet.getRange(1, 1, 1, nhHeaders.length).setFontWeight('bold');
    nhSheet.getRange(1, 1, 1, nhHeaders.length).setBackground('#f0f0f0');
    _applyStringFormats(nhSheet, nhHeaders);
    SpreadsheetApp.flush();
    Logger.log('initNetWorthEnhancements: Created NetWorthHistory sheet for ' + userKey);
  } else {
    Logger.log('initNetWorthEnhancements: NetWorthHistory sheet already exists for ' + userKey);
  }

  Logger.log('initNetWorthEnhancements: Migration complete for ' + userKey);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _castNWItem(row, today)
 * Normalises a raw sheet row into a typed net worth item object.
 * Computes is_stale based on last_updated vs today.
 */
function _castNWItem(row, today) {
  var amt         = parseFloat(row.amount) || 0;
  var lastUpdated = String(row.last_updated || '').trim();
  var isStale     = false;

  if (lastUpdated) {
    try {
      var updDate  = new Date(lastUpdated);
      var diffDays = Math.floor((today.getTime() - updDate.getTime()) / (1000 * 60 * 60 * 24));
      isStale = diffDays > NW_STALE_DAYS;
    } catch(e) {}
  }

  var type = String(row.type || '').trim().toLowerCase();

  return {
    id:           String(row.id       || '').trim(),
    name:         String(row.name     || '').trim(),
    type:         type,
    amount:       amt,
    category:     String(row.category || (type === 'asset' ? 'Other Asset' : 'Other Liability')).trim(),
    last_updated: lastUpdated,
    source_id:    String(row.source_id || '').trim(),
    is_stale:     isStale
  };
}

/**
 * _castNWSnapshot(row)
 * Normalises a raw NetWorthHistory row.
 */
function _castNWSnapshot(row) {
  return {
    id:                String(row.id             || '').trim(),
    snapshot_date:     String(row.snapshot_date  || '').trim(),
    label:             String(row.label          || '').trim(),
    total_assets:      parseFloat(row.total_assets)      || 0,
    total_liabilities: parseFloat(row.total_liabilities) || 0,
    net_worth:         parseFloat(row.net_worth)         || 0
  };
}

/**
 * _guessDebtCategory(debt)
 * Attempts to guess the best liability category from a debt name.
 */
function _guessDebtCategory(debt) {
  var name = String(debt.name || '').toLowerCase();
  if (name.indexOf('mortgage') !== -1 || name.indexOf('property') !== -1) return 'Mortgage';
  if (name.indexOf('car') !== -1 || name.indexOf('auto') !== -1 || name.indexOf('vehicle') !== -1) return 'Auto Loan';
  if (name.indexOf('credit') !== -1 || name.indexOf('card') !== -1) return 'Credit Card';
  if (name.indexOf('student') !== -1 || name.indexOf('school') !== -1 || name.indexOf('education') !== -1) return 'Student Loan';
  return 'Personal Loan';
}
