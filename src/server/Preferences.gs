/**
 * Preferences.gs — User Preferences
 *
 * PURPOSE:
 *   Store and retrieve user preferences: display currency, dark mode toggle,
 *   and custom category definitions (name + colour).
 *
 * SHEET: Preferences
 * COLUMNS: key | value
 *   Stored as simple key-value pairs.
 *   Complex values (categories array) are JSON-stringified in the value column.
 *
 * PREFERENCE KEYS:
 *   'currency'   → 'NGN' | 'USD' | 'EUR' | 'GBP'
 *   'dark_mode'  → 'true' | 'false'
 *   'categories' → JSON array of { name, color } objects
 *
 * CALLED BY: client via google.script.run, and Main.gs (bootstrap data)
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const VALID_CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP'];

/**
 * DEFAULT_CATEGORIES
 *
 * The 9 built-in categories shipped with the app.
 * Colors match the prototype's design tokens exactly.
 * These are always present — users cannot delete them, only add on top.
 *
 * INDEX MATTERS: deleteCategory() uses index >= 9 to identify user-added
 * categories. Do not reorder or add items to this list without updating
 * that guard.
 */
const DEFAULT_CATEGORIES = [
  { name: 'Housing',       color: '#185FA5' },  // 0 — blue
  { name: 'Food',          color: '#1D9E75' },  // 1 — green/teal
  { name: 'Transport',     color: '#D85A30' },  // 2 — coral
  { name: 'Utilities',     color: '#BA7517' },  // 3 — amber
  { name: 'Entertainment', color: '#7F77DD' },  // 4 — purple
  { name: 'Health',        color: '#D4537E' },  // 5 — pink
  { name: 'Salary',        color: '#639922' },  // 6 — green
  { name: 'Savings',       color: '#378ADD' },  // 7 — blue (lighter)
  { name: 'Other',         color: '#888780' },  // 8 — grey (fallback)
];

// Preference key strings — centralised to prevent typos.
const PREF_KEYS = {
  CURRENCY:   'currency',
  DARK_MODE:  'dark_mode',
  CATEGORIES: 'categories'
};


// ─── CORE READ / WRITE ────────────────────────────────────────────────────────

/**
 * _getPrefsMap()
 *
 * Internal helper. Reads all rows from the Preferences sheet and returns
 * a plain object: { currency: 'NGN', dark_mode: 'false', categories: '[...]' }
 *
 * All values are raw strings at this point — callers are responsible
 * for parsing (JSON.parse for categories, string→boolean for dark_mode).
 *
 * Private convention: prefix _ means "do not call from client via google.script.run".
 */
function _getPrefsMap() {
  const rows = getAllRows(SHEET_NAMES.PREFERENCES);
  const map  = {};
  rows.forEach(function(row) {
    if (row.key) map[String(row.key).trim()] = row.value;
  });
  return map;
}

/**
 * getAllPreferences()
 *
 * Returns a fully-parsed preferences object ready for the client:
 *   {
 *     currency:   'NGN',          // string
 *     dark_mode:  false,          // boolean
 *     categories: [{ name, color }, ...]  // array
 *   }
 *
 * Missing keys fall back to safe defaults — this means the app works
 * correctly on a brand-new sheet before the user has changed anything.
 */
function getAllPreferences() {
  const map = _getPrefsMap();

  // ── currency ──────────────────────────────────────────────────────────
  const currency = (map[PREF_KEYS.CURRENCY] && VALID_CURRENCIES.indexOf(map[PREF_KEYS.CURRENCY]) !== -1)
    ? map[PREF_KEYS.CURRENCY]
    : 'NGN';

  // ── dark_mode ─────────────────────────────────────────────────────────
  // Stored as the string 'true' or 'false'. Parse carefully.
  const darkMode = map[PREF_KEYS.DARK_MODE] === 'true';

  // ── categories ────────────────────────────────────────────────────────
  let categories = DEFAULT_CATEGORIES;
  if (map[PREF_KEYS.CATEGORIES]) {
    try {
      const parsed = JSON.parse(map[PREF_KEYS.CATEGORIES]);
      // Validate: must be a non-empty array of objects with name+color.
      if (Array.isArray(parsed) && parsed.length > 0) {
        categories = parsed;
      }
    } catch (e) {
      // Corrupted JSON in the sheet — fall back to defaults silently.
      Logger.log('Preferences.gs: Failed to parse categories JSON, using defaults. Error: ' + e.message);
    }
  }

  return {
    currency:   currency,
    dark_mode:  darkMode,
    categories: categories
  };
}

/**
 * setPreference(key, value)
 *
 * Upserts a preference row:
 *   - If a row with this key already exists → update its value column
 *   - If no row exists yet → append a new row
 *
 * Complex values (arrays, objects) must be JSON-stringified by the caller
 * before passing in, OR you can pass the raw value and this function will
 * stringify if needed.
 *
 * Returns { success: true } so the client can chain .then() calls cleanly.
 */
function setPreference(key, value) {
  if (!key) throw new Error('Preferences.gs: setPreference() requires a key.');

  // Stringify objects/arrays so they survive the sheet round-trip.
  var storedValue = (typeof value === 'object' && value !== null)
    ? JSON.stringify(value)
    : String(value);

  // Try to find an existing row for this key.
  var rowIndex = findRowIndex(SHEET_NAMES.PREFERENCES, function(row) {
    return String(row.key).trim() === String(key).trim();
  });

  if (rowIndex !== -1) {
    // Update the existing row in place.
    updateRow(SHEET_NAMES.PREFERENCES, rowIndex, { key: key, value: storedValue });
  } else {
    // First time this preference is being set — append a new row.
    appendRow(SHEET_NAMES.PREFERENCES, { key: key, value: storedValue });
  }

  return { success: true };
}


// ─── CURRENCY ─────────────────────────────────────────────────────────────────

/**
 * setCurrency(currency)
 *
 * Validates and stores the user's chosen display currency.
 * Throws if an invalid code is passed — prevents garbage data in the sheet.
 */
function setCurrency(currency) {
  if (VALID_CURRENCIES.indexOf(currency) === -1) {
    throw new Error(
      'Preferences.gs: Invalid currency "' + currency + '". ' +
      'Must be one of: ' + VALID_CURRENCIES.join(', ')
    );
  }
  return setPreference(PREF_KEYS.CURRENCY, currency);
}


// ─── DARK MODE ────────────────────────────────────────────────────────────────

/**
 * setDarkMode(enabled)
 *
 * Stores the dark mode preference as the string 'true' or 'false'.
 * Accepts a boolean or a boolean-like value from the client.
 */
function setDarkMode(enabled) {
  return setPreference(PREF_KEYS.DARK_MODE, enabled ? 'true' : 'false');
}


// ─── CATEGORIES ───────────────────────────────────────────────────────────────

/**
 * getCategories()
 *
 * Convenience function — returns just the categories array.
 * Used by other server modules that need the category list
 * (e.g. to validate a category name on a new transaction).
 */
function getCategories() {
  return getAllPreferences().categories;
}

/**
 * addCategory(name, color)
 *
 * Adds a new user-defined category to the stored list.
 *
 * Rules:
 *   - name must be a non-empty string
 *   - color must be a valid hex color string (e.g. '#1D9E75')
 *   - Duplicate names are rejected (case-insensitive)
 *
 * Returns the full updated categories array so the client can
 * update AppState.categories without a second server call.
 */
function addCategory(name, color) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('Preferences.gs: Category name is required.');
  }
  if (!color || typeof color !== 'string' || !color.match(/^#[0-9A-Fa-f]{6}$/)) {
    throw new Error('Preferences.gs: Category color must be a valid hex color (e.g. #1D9E75).');
  }

  var trimmedName = name.trim();
  var current = getCategories();

  // Case-insensitive duplicate check across both default and user-added categories.
  var isDuplicate = current.some(function(cat) {
    return cat.name.toLowerCase() === trimmedName.toLowerCase();
  });
  if (isDuplicate) {
    throw new Error('Preferences.gs: A category named "' + trimmedName + '" already exists.');
  }

  var updated = current.concat([{ name: trimmedName, color: color }]);
  setPreference(PREF_KEYS.CATEGORIES, JSON.stringify(updated));

  return updated;
}

/**
 * deleteCategory(categoryName)
 *
 * Removes a user-added category from the stored list.
 *
 * Protection rules:
 *   - The first 9 entries (DEFAULT_CATEGORIES) cannot be deleted.
 *     This is enforced by checking position in the stored array,
 *     not just by name — so even if the user has renamed nothing,
 *     the guard is based on index.
 *   - If the category is not found, throws a clear error.
 *
 * Returns the full updated categories array.
 */
function deleteCategory(categoryName) {
  if (!categoryName) throw new Error('Preferences.gs: categoryName is required.');

  var current = getCategories();
  var index   = -1;

  for (var i = 0; i < current.length; i++) {
    if (current[i].name.toLowerCase() === categoryName.toLowerCase()) {
      index = i;
      break;
    }
  }

  if (index === -1) {
    throw new Error('Preferences.gs: Category "' + categoryName + '" not found.');
  }

  // Indices 0–8 are the 9 default categories — they are protected.
  if (index < DEFAULT_CATEGORIES.length) {
    throw new Error(
      'Preferences.gs: "' + categoryName + '" is a default category and cannot be deleted.'
    );
  }

  var updated = current.filter(function(_, i) { return i !== index; });
  setPreference(PREF_KEYS.CATEGORIES, JSON.stringify(updated));

  return updated;
}

/**
 * resetCategories()
 *
 * Wipes any stored custom categories and restores the 9 defaults.
 * Exposed as a "Reset to defaults" action in the Settings screen.
 *
 * Returns the default categories array.
 */
function resetCategories() {
  setPreference(PREF_KEYS.CATEGORIES, JSON.stringify(DEFAULT_CATEGORIES));
  return DEFAULT_CATEGORIES;
}
