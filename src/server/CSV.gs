/**
 * CSV.gs — CSV Export & Import Helpers
 *
 * PURPOSE:
 *   Handle all CSV generation and parsing logic.
 *   Keeps Transactions.gs clean by delegating CSV-specific work here.
 *
 * EXPORT FORMAT (column order):
 *   Description, Amount, Type, Category, Note, Month
 *
 * IMPORT FORMAT (flexible — mapped by header name, case-insensitive):
 *   Description (or Name), Amount, Type, Category, Note
 *   Month column is ignored on import — monthKey is passed in from the client.
 *
 * CALLED BY:
 *   - Client via google.script.run (exportTransactionsToCSV, importTransactionsFromCSV)
 *   - Transactions.gs → importTransactionsFromCSV() delegates parsing here
 */


// ─── EXPORT ───────────────────────────────────────────────────────────────────

/**
 * exportTransactionsToCSV(monthKey)
 *
 * Fetches all transactions for the given monthKey and builds a CSV string.
 * The string is returned to the client, which creates a Blob and triggers
 * a file download — no Google Drive file is created.
 *
 * Returns: CSV string with header row + one row per transaction.
 */
function exportTransactionsToCSV(monthKey) {
  if (!monthKey) throw new Error('CSV.gs: monthKey is required.');

  var txs = getTransactionsByMonth(monthKey); // from Transactions.gs

  var headers = ['Description', 'Amount', 'Type', 'Category', 'Note', 'Month'];

  // Build the month label for the Month column (e.g. "March 2026").
  var parts     = String(monthKey).split('-');
  var monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  var monthLabel = monthNames[parseInt(parts[1], 10) - 1] + ' ' + parts[0];

  var rows = [headers].concat(
    txs.map(function(tx) {
      return [
        tx.name       || '',
        tx.amount     || 0,
        tx.type       || 'expense',
        tx.category   || 'Other',
        tx.note       || '',
        monthLabel
      ];
    })
  );

  return rows.map(function(row) {
    return row.map(escapeCSVValue).join(',');
  }).join('\n');
}


// ─── IMPORT ───────────────────────────────────────────────────────────────────

/**
 * importTransactionsFromCSV(csvString, monthKey)
 *
 * Parses the CSV string and creates a transaction for each valid row.
 * Delegates parsing to parseCSV() and validation to validateImportRow().
 *
 * Returns { imported: N, skipped: M, errors: [...] } summary.
 * Called by Transactions.gs importTransactionsFromCSV() — kept thin here.
 */
function importTransactionsFromCSV(csvString, monthKey) {
  if (!csvString || !monthKey) {
    throw new Error('CSV.gs: csvString and monthKey are both required.');
  }

  var rows    = parseCSV(csvString);
  var imported = 0;
  var skipped  = 0;
  var errors   = [];

  rows.forEach(function(row, i) {
    var validation = validateImportRow(row);

    if (!validation.valid) {
      skipped++;
      errors.push('Row ' + (i + 2) + ': ' + validation.reason); // +2 = header + 1-indexed
      return;
    }

    var d = validation.data;

    try {
      addTransaction(monthKey, d.name, d.amount, d.type, d.category, d.note);
      imported++;
    } catch (e) {
      skipped++;
      errors.push('Row ' + (i + 2) + ': ' + e.message);
    }
  });

  Logger.log(
    'CSV.gs: importTransactionsFromCSV(' + monthKey + ') — ' +
    'imported: ' + imported + ', skipped: ' + skipped
  );

  return { imported: imported, skipped: skipped, errors: errors };
}


// ─── PARSING ──────────────────────────────────────────────────────────────────

/**
 * parseCSV(csvString)
 *
 * Parses a raw CSV string into an array of plain objects keyed by header name.
 * Handles:
 *   - Double-quoted fields (may contain commas, newlines, escaped double-quotes)
 *   - Windows (\r\n) and Unix (\n) line endings
 *   - Empty lines (skipped)
 *   - Case-insensitive headers
 *   - 'name' and 'description' treated as equivalent column names
 *
 * Returns [{ description, amount, type, category, note }, ...]
 *
 * NOTE: Apps Script has no built-in CSV parser. This implements RFC 4180
 * compliant parsing — quoted fields, escaped double-quotes (""), etc.
 */
function parseCSV(csvString) {
  if (!csvString) return [];

  // Normalise line endings.
  var normalised = String(csvString).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  var allRows  = _splitCSVRows(normalised);
  if (allRows.length < 2) return []; // header only or empty

  // Parse header row — normalise to lower case.
  var rawHeaders = _parseCSVLine(allRows[0]);
  var headers    = rawHeaders.map(function(h) {
    var norm = String(h).trim().toLowerCase();
    // Treat 'name' as an alias for 'description'.
    return norm === 'name' ? 'description' : norm;
  });

  var results = [];

  for (var i = 1; i < allRows.length; i++) {
    var line = allRows[i].trim();
    if (!line) continue; // skip blank lines

    var values = _parseCSVLine(allRows[i]);
    var obj    = {};

    headers.forEach(function(header, col) {
      obj[header] = col < values.length ? String(values[col]).trim() : '';
    });

    results.push(obj);
  }

  return results;
}

/**
 * _splitCSVRows(str)
 *
 * Splits a CSV string into individual row strings, respecting quoted fields
 * that may contain embedded newlines.
 */
function _splitCSVRows(str) {
  var rows    = [];
  var current = '';
  var inQuote = false;

  for (var i = 0; i < str.length; i++) {
    var ch   = str[i];
    var next = i + 1 < str.length ? str[i + 1] : '';

    if (ch === '"') {
      if (inQuote && next === '"') {
        // Escaped double-quote inside a quoted field — keep one ".
        current += '"';
        i++; // skip next "
      } else {
        inQuote = !inQuote;
        current += ch;
      }
    } else if (ch === '\n' && !inQuote) {
      rows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  // Push the last row (no trailing newline required).
  if (current.trim()) rows.push(current);

  return rows;
}

/**
 * _parseCSVLine(line)
 *
 * Parses a single CSV line into an array of field values.
 * Handles quoted fields containing commas, newlines, and escaped quotes.
 * Strips surrounding double-quotes from quoted fields.
 */
function _parseCSVLine(line) {
  var fields  = [];
  var current = '';
  var inQuote = false;

  for (var i = 0; i < line.length; i++) {
    var ch   = line[i];
    var next = i + 1 < line.length ? line[i + 1] : '';

    if (ch === '"') {
      if (inQuote && next === '"') {
        current += '"'; // escaped double-quote → single "
        i++;
      } else {
        inQuote = !inQuote; // toggle quoted mode, don't add the quote char
      }
    } else if (ch === ',' && !inQuote) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current.trim()); // last field (no trailing comma required)
  return fields;
}


// ─── VALIDATION ───────────────────────────────────────────────────────────────

/**
 * validateImportRow(row)
 *
 * Validates a single parsed CSV row object before importing.
 * Returns { valid: true, data: {...} } or { valid: false, reason: '...' }.
 *
 * Rules:
 *   - description (or name) must be a non-empty string
 *   - amount must parse as a positive number
 *   - type must be 'income', 'expense', or 'savings' (defaults to 'expense' if blank)
 *   - category defaults to 'Other' if blank
 *   - note defaults to '' if blank
 */
function validateImportRow(row) {
  var name = String(row.description || row.name || '').trim();
  if (!name) {
    return { valid: false, reason: 'Description/Name is empty.' };
  }

  var amount = parseFloat(row.amount);
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, reason: 'Amount "' + row.amount + '" is not a positive number.' };
  }

  var rawType  = String(row.type || '').trim().toLowerCase();
  var validTypes = ['income', 'expense', 'savings'];
  var type = validTypes.indexOf(rawType) !== -1 ? rawType : 'expense';

  var category = String(row.category || '').trim() || 'Other';
  var note     = String(row.note     || '').trim();

  return {
    valid: true,
    data: {
      name:     name,
      amount:   amount,
      type:     type,
      category: category,
      note:     note
    }
  };
}


// ─── UTILITIES ────────────────────────────────────────────────────────────────

/**
 * escapeCSVValue(value)
 *
 * Wraps a value in double-quotes for CSV output.
 * Escapes any internal double-quotes by doubling them ("" per RFC 4180).
 * Handles numbers, strings, null, and undefined gracefully.
 *
 * escapeCSVValue('He said "hello"') → '"He said ""hello"""'
 */
function escapeCSVValue(value) {
  if (value === null || value === undefined) return '""';
  var str = String(value);
  // If the value contains a comma, newline, or double-quote, wrap in quotes.
  // Always wrap for consistency and safety.
  return '"' + str.replace(/"/g, '""') + '"';
}
