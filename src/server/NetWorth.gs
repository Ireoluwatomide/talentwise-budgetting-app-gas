/**
 * NetWorth.gs — Net Worth Tracker
 *
 * PURPOSE:
 *   Track assets and liabilities for a full financial snapshot.
 *   Net Worth = Total Assets - Total Liabilities.
 *
 * SHEET: NetWorth
 * COLUMNS: id | name | type | amount
 *
 *   type → 'asset' | 'liability'
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap)
 */

var VALID_NW_TYPES = ['asset', 'liability'];


// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * getAllNetWorthItems()
 * Returns all items as [{ id, name, type, amount }].
 * amount is cast to a number.
 */
function getAllNetWorthItems() {
  return getAllRows(SHEET_NAMES.NET_WORTH).map(function(row) {
    return {
      id:     String(row.id   || '').trim(),
      name:   String(row.name || '').trim(),
      type:   String(row.type || '').trim().toLowerCase(),
      amount: parseFloat(row.amount) || 0
    };
  });
}

/**
 * getNetWorthSummary()
 *
 * Returns aggregate stats for the Net Worth tab header:
 *   { total_assets, total_liabilities, net_worth }
 */
function getNetWorthSummary() {
  var items      = getAllNetWorthItems();
  var assets     = 0;
  var liabilities = 0;

  items.forEach(function(item) {
    if (item.type === 'asset')      assets      += item.amount;
    else if (item.type === 'liability') liabilities += item.amount;
  });

  return {
    total_assets:       assets,
    total_liabilities:  liabilities,
    net_worth:          assets - liabilities
  };
}


// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * addNetWorthItem(name, type, amount)
 *
 * Validates and appends a new asset or liability row.
 * Returns the new item object.
 */
function addNetWorthItem(name, type, amount) {
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

  var item = {
    id:     generateId(),
    name:   String(name).trim(),
    type:   normType,
    amount: parsedAmount
  };

  appendRow(SHEET_NAMES.NET_WORTH, item);
  return item;
}

/**
 * deleteNetWorthItem(itemId)
 * Removes the net worth item row matching itemId.
 */
function deleteNetWorthItem(itemId) {
  if (!itemId) throw new Error('NetWorth.gs: itemId is required.');

  var rowIndex = findRowIndex(SHEET_NAMES.NET_WORTH, function(row) {
    return String(row.id) === String(itemId);
  });

  if (rowIndex === -1) {
    throw new Error('NetWorth.gs: Item "' + itemId + '" not found.');
  }

  deleteRow(SHEET_NAMES.NET_WORTH, rowIndex);
  return { success: true };
}
