/**
 * Preferences.gs — User Preferences
 *
 * PURPOSE:
 *   Store and retrieve user preferences: display currency, dark mode toggle,
 *   and custom category definitions (name + colour + type).
 *
 * SHEET: Preferences
 * COLUMNS: key | value
 *   Stored as simple key-value pairs.
 *   Complex values (categories array) are JSON-stringified in the value column.
 *
 * PREFERENCE KEYS:
 *   'currency'   → 'NGN' | 'USD' | 'EUR' | 'GBP'
 *   'dark_mode'  → 'true' | 'false'
 *   'categories' → JSON array of { name, color, type } objects
 *                  type: 'income' | 'expense' | 'savings'
 *
 * CALLED BY: client via google.script.run, and Main.gs (bootstrap data)
 */


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const VALID_CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP'];

/**
 * DEFAULT_CATEGORIES
 *
 * The built-in categories shipped with the app, split by transaction type.
 * Each category now carries a `type` field: 'income' | 'expense' | 'savings'.
 *
 * PROTECTED COUNT by type (used by deleteCategory() guard):
 *   income:   7  (indices 0–6 within the income slice)
 *   expense:  14 (indices 0–13 within the expense slice)
 *   savings:  6  (indices 0–5 within the savings slice)
 *
 * The flattened DEFAULT_CATEGORIES array is used only to determine which
 * entries are protected. deleteCategory() now checks `isDefault` by name+type
 * match against this list rather than by raw index.
 */
const DEFAULT_CATEGORIES = [
  // ── Income ──────────────────────────────────────────────────────────────────
  { name: 'Employment / Salary',  color: '#639922', type: 'income' },
  { name: 'Side Hustle',          color: '#1D9E75', type: 'income' },
  { name: 'Freelance',            color: '#2E8A57', type: 'income' },
  { name: 'Dividends',            color: '#185FA5', type: 'income' },
  { name: 'Rental Income',        color: '#378ADD', type: 'income' },
  { name: 'Business Income',      color: '#7F77DD', type: 'income' },
  { name: 'Other Income',         color: '#888780', type: 'income' },

  // ── Expense ──────────────────────────────────────────────────────────────────
  { name: 'Housing',              color: '#185FA5', type: 'expense' },
  { name: 'Utilities',            color: '#BA7517', type: 'expense' },
  { name: 'Groceries',            color: '#1D9E75', type: 'expense' },
  { name: 'Transportation',       color: '#D85A30', type: 'expense' },
  { name: 'Insurance',            color: '#7F77DD', type: 'expense' },
  { name: 'Clothing',             color: '#D4537E', type: 'expense' },
  { name: 'Entertainment',        color: '#BA7517', type: 'expense' },
  { name: 'Fun & Vacation',       color: '#E06B3F', type: 'expense' },
  { name: 'Media & Subscriptions',color: '#5C87D6', type: 'expense' },
  { name: 'Body Care & Medicine', color: '#C75B8A', type: 'expense' },
  { name: 'Education',            color: '#4A90D9', type: 'expense' },
  { name: 'Dining Out',           color: '#E8934A', type: 'expense' },
  { name: 'Debt Repayment',       color: '#D85A30', type: 'expense' },
  { name: 'Other Expense',        color: '#888780', type: 'expense' },

  // ── Savings ──────────────────────────────────────────────────────────────────
  { name: 'Emergency Fund',       color: '#185FA5', type: 'savings' },
  { name: 'Retirement Account',   color: '#1D9E75', type: 'savings' },
  { name: 'Stock Portfolio',      color: '#639922', type: 'savings' },
  { name: 'Sinking Fund',         color: '#BA7517', type: 'savings' },
  { name: 'Down Payment',         color: '#7F77DD', type: 'savings' },
  { name: 'Other Savings',        color: '#888780', type: 'savings' },
];

// Build a fast lookup set of default category identifiers (name::type).
// Used by deleteCategory() to block deletion of built-in entries.
var _DEFAULT_KEYS = (function() {
  var keys = {};
  DEFAULT_CATEGORIES.forEach(function(cat) {
    keys[cat.name.toLowerCase() + '::' + cat.type] = true;
  });
  return keys;
})();

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
  const rows = getUserAllRows('Preferences');
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
 *     categories: [{ name, color, type }, ...]  // array — typed categories
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
      // Validate: must be a non-empty array of objects with name+color+type.
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Back-compat: if stored categories lack `type`, assign 'expense'
        // so old data doesn't break.
        categories = parsed.map(function(cat) {
          return {
            name:  cat.name  || '',
            color: cat.color || '#888780',
            type:  cat.type  || 'expense'
          };
        });
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
  var rowIndex = getUserFindRowIndex('PREFERENCES', function(row) {
    return String(row.key).trim() === String(key).trim();
  });

  if (rowIndex !== -1) {
    // Update the existing row in place.
    getUserUpdateRow('PREFERENCES', rowIndex, { key: key, value: storedValue });
  } else {
    // First time this preference is being set — append a new row.
    getUserAppendRow('PREFERENCES', { key: key, value: storedValue });
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
 * getCategoriesByType(type)
 *
 * Returns only the categories matching the given type string.
 * type: 'income' | 'expense' | 'savings'
 *
 * Exposed for server-side validation in Transactions.gs and Goals.gs.
 */
function getCategoriesByType(type) {
  return getCategories().filter(function(cat) {
    return cat.type === type;
  });
}

/**
 * addCategory(name, color, type)
 *
 * Adds a new user-defined category to the stored list.
 *
 * Rules:
 *   - name must be a non-empty string
 *   - color must be a valid hex color string (e.g. '#1D9E75')
 *   - type must be 'income', 'expense', or 'savings'
 *   - Duplicate names within the same type are rejected (case-insensitive)
 *
 * Returns the full updated categories array so the client can
 * update AppState.categories without a second server call.
 */
function addCategory(name, color, type) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('Preferences.gs: Category name is required.');
  }
  if (!color || typeof color !== 'string' || !color.match(/^#[0-9A-Fa-f]{6}$/)) {
    throw new Error('Preferences.gs: Category color must be a valid hex color (e.g. #1D9E75).');
  }

  var normType = String(type || 'expense').trim().toLowerCase();
  if (['income', 'expense', 'savings'].indexOf(normType) === -1) {
    throw new Error('Preferences.gs: type must be income, expense, or savings. Got: "' + type + '".');
  }

  var trimmedName = name.trim();
  var current = getCategories();

  // Case-insensitive duplicate check within the same type.
  var isDuplicate = current.some(function(cat) {
    return cat.name.toLowerCase() === trimmedName.toLowerCase() && cat.type === normType;
  });
  if (isDuplicate) {
    throw new Error(
      'Preferences.gs: A ' + normType + ' category named "' + trimmedName + '" already exists.'
    );
  }

  var updated = current.concat([{ name: trimmedName, color: color, type: normType }]);
  setPreference(PREF_KEYS.CATEGORIES, JSON.stringify(updated));

  return updated;
}

/**
 * deleteCategory(categoryName, categoryType)
 *
 * Removes a user-added category from the stored list.
 *
 * Protection rules:
 *   - Categories whose name+type combination matches an entry in DEFAULT_CATEGORIES
 *     cannot be deleted. This is checked via the _DEFAULT_KEYS lookup set.
 *   - If the category is not found, throws a clear error.
 *
 * Returns the full updated categories array.
 */
function deleteCategory(categoryName, categoryType) {
  if (!categoryName) throw new Error('Preferences.gs: categoryName is required.');

  var normType = String(categoryType || 'expense').trim().toLowerCase();
  var current  = getCategories();
  var index    = -1;

  for (var i = 0; i < current.length; i++) {
    if (
      current[i].name.toLowerCase() === categoryName.toLowerCase() &&
      current[i].type === normType
    ) {
      index = i;
      break;
    }
  }

  if (index === -1) {
    throw new Error(
      'Preferences.gs: ' + normType + ' category "' + categoryName + '" not found.'
    );
  }

  // Block deletion of any built-in default category.
  var lookupKey = categoryName.toLowerCase() + '::' + normType;
  if (_DEFAULT_KEYS[lookupKey]) {
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
 * Wipes any stored custom categories and restores all defaults.
 * Exposed as a "Reset to defaults" action in the Settings screen.
 *
 * Returns the default categories array.
 */
function resetCategories() {
  setPreference(PREF_KEYS.CATEGORIES, JSON.stringify(DEFAULT_CATEGORIES));
  return DEFAULT_CATEGORIES;
}
