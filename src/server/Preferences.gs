/**
 * Preferences.gs — User Preferences
 *
 * PURPOSE:
 *   Store and retrieve user preferences: display currency, dark mode toggle,
 *   and custom category definitions (name + colour).
 *
 * SHEET: Preferences
 * COLUMNS: key | value
 *   Stored as simple key-value pairs. Complex values (e.g. categories array) are JSON-stringified.
 *
 * PREFERENCE KEYS:
 *   'currency'    → 'NGN' | 'USD' | 'EUR' | 'GBP'
 *   'dark_mode'   → 'true' | 'false'
 *   'categories'  → JSON array of { name, color } objects
 *
 * CALLED BY: client via google.script.run, Main.gs (bootstrap data)
 */


/**
 * DEFAULT CATEGORIES
 *
 * TODO: Define the default categories array here as a constant.
 *       Used when the Preferences sheet has no 'categories' entry yet.
 *
 * Default categories (from the prototype):
 *   Housing   #185FA5
 *   Food      #1D9E75
 *   Transport #D85A30
 *   Utilities #BA7517
 *   Entertainment #7F77DD
 *   Health    #D4537E
 *   Salary    #639922
 *   Savings   #378ADD
 *   Other     #888780
 */
const DEFAULT_CATEGORIES = [
  // TODO: Populate with default category objects { name, color }
];


/**
 * getAllPreferences()
 *
 * TODO: Return all preferences as a flat object: { currency, dark_mode, categories }
 * TODO: Parse 'categories' from JSON string to array
 * TODO: Parse 'dark_mode' from string to boolean
 * TODO: If a key is missing, return the sensible default:
 *         currency  → 'NGN'
 *         dark_mode → false
 *         categories → DEFAULT_CATEGORIES
 */
function getAllPreferences() {
  // TODO: Implement
}


/**
 * setPreference(key, value)
 *
 * TODO: Find the row where column 'key' === key
 * TODO: If found, update the value column for that row
 * TODO: If not found, append a new row with the key-value pair
 * TODO: Stringify complex values (arrays, objects) before storing
 * TODO: Return { success: true }
 */
function setPreference(key, value) {
  // TODO: Implement
}


/**
 * setCurrency(currency)
 *
 * TODO: Validate currency is one of: 'NGN', 'USD', 'EUR', 'GBP'
 * TODO: Call setPreference('currency', currency)
 */
function setCurrency(currency) {
  // TODO: Implement
}


/**
 * setDarkMode(enabled)
 *
 * TODO: Call setPreference('dark_mode', enabled.toString())
 */
function setDarkMode(enabled) {
  // TODO: Implement
}


/**
 * addCategory(name, color)
 *
 * TODO: Get current categories from getAllPreferences().categories
 * TODO: Check for duplicate name (case-insensitive) — throw if exists
 * TODO: Push new { name, color } to the array
 * TODO: Save via setPreference('categories', JSON.stringify(updatedArray))
 * TODO: Return the updated categories array
 */
function addCategory(name, color) {
  // TODO: Implement
}


/**
 * deleteCategory(categoryName)
 *
 * TODO: Get current categories, filter out the one matching categoryName
 * TODO: Prevent deletion of the 9 default categories (index 0–8)
 *       — only user-added categories (index 9+) can be deleted
 * TODO: Save the updated array via setPreference()
 * TODO: Return the updated categories array
 */
function deleteCategory(categoryName) {
  // TODO: Implement
}
