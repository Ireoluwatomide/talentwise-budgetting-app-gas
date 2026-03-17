/**
 * NetWorth.gs — Net Worth Tracker
 *
 * PURPOSE:
 *   Track assets and liabilities to give a full financial snapshot.
 *   Net Worth = Total Assets - Total Liabilities
 *
 * SHEET: NetWorth
 * COLUMNS: id | name | type | amount
 *
 *   type → 'asset' | 'liability'
 *
 * CALLED BY: client via google.script.run
 */


/**
 * getAllNetWorthItems()
 *
 * TODO: Return all items as { id, name, type, amount }
 * TODO: Cast amount to number
 * TODO: Use SheetHelper.getAllRows(SHEET_NAMES.NET_WORTH)
 */
function getAllNetWorthItems() {
  // TODO: Implement
}


/**
 * getNetWorthSummary()
 *
 * TODO: Return aggregate stats for the NetWorth tab header metrics:
 *         { total_assets, total_liabilities, net_worth }
 *
 *   total_assets      = sum of amount where type === 'asset'
 *   total_liabilities = sum of amount where type === 'liability'
 *   net_worth         = total_assets - total_liabilities
 */
function getNetWorthSummary() {
  // TODO: Implement
}


/**
 * addNetWorthItem(name, type, amount)
 *
 * TODO: Validate — name required, type must be 'asset' or 'liability', amount > 0
 * TODO: Append row and return the new item object
 */
function addNetWorthItem(name, type, amount) {
  // TODO: Implement
}


/**
 * deleteNetWorthItem(itemId)
 *
 * TODO: Find and delete the row with matching itemId
 * TODO: Return { success: true }
 */
function deleteNetWorthItem(itemId) {
  // TODO: Implement
}
