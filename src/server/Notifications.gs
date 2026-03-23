/**
 * Notifications.gs — Email Alerts via MailApp
 *
 * PURPOSE:
 *   Send a single consolidated daily email when bills are due soon
 *   or budget categories are over/approaching their limits.
 *   Uses Apps Script's built-in MailApp — free, no setup required.
 *
 * FREE TIER: 100 emails/day via MailApp. Sufficient for personal use.
 *
 * DESIGN:
 *   One consolidated email per day (not one per alert). Batching is more
 *   user-friendly than receiving several separate emails in quick succession.
 *   If there is nothing to report, no email is sent.
 *
 * CALLED BY:
 *   - Triggers.gs dailyAlertHandler() — fires every morning at 8 AM WAT
 *   - Developer manually via sendTestEmail() during setup / debugging
 */


// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

/**
 * sendDailyAlerts()
 *
 * Master function called by the daily trigger.
 * 1. Fetches bills due within the next 5 days.
 * 2. Checks budget alerts for the current month.
 * 3. Sends a consolidated email if either list is non-empty.
 * 4. Logs the result for the Apps Script execution log.
 */
function sendDailyAlerts() {
  try {
    var upcomingBills = getUpcomingBills(); // threshold read from preferences inside Bills.gs
    var today         = new Date();
    var monthKey      = _buildMonthKey(today);
    var budgetAlerts  = checkBudgetAlerts(monthKey);

    // Only include budget alerts that are actionable (over or warning).
    var actionableAlerts = budgetAlerts.filter(function(a) {
      return a.status === 'over' || a.status === 'warning';
    });

    var hasContent = upcomingBills.length > 0 || actionableAlerts.length > 0;

    if (!hasContent) {
      Logger.log('Notifications.gs: No alerts to send for ' + monthKey + '.');
      return;
    }

    sendConsolidatedAlert(upcomingBills, actionableAlerts);
    Logger.log(
      'Notifications.gs: Alert sent — ' +
      upcomingBills.length + ' bill(s), ' +
      actionableAlerts.length + ' budget alert(s).'
    );

  } catch (e) {
    // Log but do not rethrow — a thrown error from a trigger handler causes
    // Google to send its own error email to the script owner, which is noisy.
    Logger.log('Notifications.gs: sendDailyAlerts() failed — ' + e.message);
  }
}


// ─── EMAIL BUILDER ───────────────────────────────────────────────────────────

/**
 * sendConsolidatedAlert(upcomingBills, budgetAlerts)
 *
 * Builds a plain-text email body and an HTML email body, then sends both
 * via MailApp. The HTML body provides a richer reading experience in
 * email clients that support it; the plain-text body is the fallback.
 *
 * upcomingBills: [{ id, name, amount, due_day, paid, daysUntilDue }]
 * budgetAlerts:  [{ category, limit, spent, status }]
 */
function sendConsolidatedAlert(upcomingBills, budgetAlerts) {
  var email   = getUserEmail();
  var subject = _buildSubject(upcomingBills, budgetAlerts);
  var plain   = _buildPlainBody(upcomingBills, budgetAlerts);
  var html    = _buildHtmlBody(upcomingBills, budgetAlerts);

  try {
    MailApp.sendEmail({
      to:       email,
      subject:  subject,
      body:     plain,
      htmlBody: html
    });
  } catch (e) {
    Logger.log('Notifications.gs: MailApp.sendEmail() failed — ' + e.message);
    throw e;
  }
}


// ─── EMAIL CONTENT ───────────────────────────────────────────────────────────

/**
 * _buildSubject(bills, alerts)
 * Builds a concise, informative subject line.
 * Examples:
 *   "Budget Tracker — 2 bills due, 1 budget alert"
 *   "Budget Tracker — 3 bills due soon"
 *   "Budget Tracker — Over budget on Housing"
 */
function _buildSubject(bills, alerts) {
  var parts = [];
  if (bills.length > 0) {
    parts.push(bills.length + ' bill' + (bills.length > 1 ? 's' : '') + ' due soon');
  }
  if (alerts.length > 0) {
    var overCount = alerts.filter(function(a) { return a.status === 'over'; }).length;
    if (overCount > 0) {
      parts.push(overCount + ' budget over-limit' + (overCount > 1 ? 's' : ''));
    } else {
      parts.push(alerts.length + ' budget warning' + (alerts.length > 1 ? 's' : ''));
    }
  }
  return 'Budget Tracker — ' + (parts.length > 0 ? parts.join(', ') : 'Daily Summary');
}

/**
 * _buildPlainBody(bills, alerts)
 * Plain-text email body — readable in all email clients.
 */
function _buildPlainBody(bills, alerts) {
  var lines = [];
  var today = new Date();
  lines.push('Budget Tracker — Daily Alert');
  lines.push(today.toDateString());
  lines.push('');

  if (bills.length > 0) {
    lines.push('UPCOMING BILLS');
    lines.push('─────────────');
    bills.forEach(function(bill) {
      var dueText = bill.daysUntilDue === 0 ? 'Due TODAY'
                  : 'Due in ' + bill.daysUntilDue + ' day' + (bill.daysUntilDue > 1 ? 's' : '');
      lines.push(
        bill.name + ' [' + (bill.category || 'Utilities') + ']: ₦' + _numFmt(bill.amount) +
        ' — ' + dueText + ' (day ' + bill.due_day + ' monthly)'
      );
    });
    lines.push('');
  }

  if (alerts.length > 0) {
    lines.push('BUDGET ALERTS');
    lines.push('─────────────');
    alerts.forEach(function(alert) {
      var status = alert.status === 'over' ? 'OVER LIMIT' : 'APPROACHING LIMIT';
      var pct    = alert.limit > 0 ? Math.round((alert.spent / alert.limit) * 100) : 0;
      lines.push(
        alert.category + ': ' + status +
        ' — spent ₦' + _numFmt(alert.spent) +
        ' of ₦' + _numFmt(alert.limit) +
        ' (' + pct + '%)'
      );
    });
    lines.push('');
  }

  lines.push('─────────────────────────────────────');
  lines.push('Sent by Budget Tracker (Google Apps Script)');
  lines.push('Open the app to manage your budget.');
  return lines.join('\n');
}

/**
 * _buildHtmlBody(bills, alerts)
 * HTML email body — richer reading experience in modern email clients.
 * Uses inline styles throughout for maximum email client compatibility.
 */
function _buildHtmlBody(bills, alerts) {
  var today  = new Date();
  var styles = {
    body:    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
             'background:#f5f5f3;margin:0;padding:0;',
    wrap:    'max-width:560px;margin:32px auto;background:#ffffff;' +
             'border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;',
    header:  'background:#1a1a1a;padding:20px 24px;',
    hTitle:  'color:#ffffff;font-size:18px;font-weight:500;margin:0;',
    hSub:    'color:#888;font-size:12px;margin:4px 0 0;',
    body_:   'padding:20px 24px;',
    secHdr:  'font-size:11px;font-weight:600;letter-spacing:0.08em;' +
             'text-transform:uppercase;color:#666;margin:0 0 12px;' +
             'padding-bottom:8px;border-bottom:1px solid #eee;',
    row:     'display:flex;justify-content:space-between;align-items:flex-start;' +
             'padding:8px 0;border-bottom:1px solid #f0f0f0;',
    name:    'font-size:13px;font-weight:500;color:#1a1a1a;',
    sub:     'font-size:11px;color:#888;margin-top:2px;',
    footer:  'background:#f5f5f3;padding:14px 24px;font-size:11px;color:#888;text-align:center;'
  };

  var billRows = bills.map(function(bill) {
    var dueText   = bill.daysUntilDue === 0 ? 'Due TODAY'
                  : 'Due in ' + bill.daysUntilDue + 'd';
    var badgeSt   = bill.daysUntilDue === 0
      ? 'background:#FCEBEB;color:#791F1F;'
      : 'background:#FAEEDA;color:#412402;';
    return (
      '<div style="' + styles.row + '">' +
        '<div>' +
          '<div style="' + styles.name + '">' + _escHtml(bill.name) + '</div>' +
          '<div style="' + styles.sub  + '">' +
            (bill.category || 'Utilities') + ' · Day ' + bill.due_day + ' monthly' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:13px;font-family:monospace;">₦' + _numFmt(bill.amount) + '</div>' +
          '<div style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;' +
               'display:inline-block;margin-top:3px;' + badgeSt + '">' + dueText + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  var alertRows = alerts.map(function(alert) {
    var isOver  = alert.status === 'over';
    var badgeSt = isOver
      ? 'background:#FCEBEB;color:#791F1F;'
      : 'background:#FAEEDA;color:#412402;';
    var label   = isOver ? 'Over limit' : 'Approaching limit';
    var pct     = alert.limit > 0 ? Math.round((alert.spent / alert.limit) * 100) : 0;
    var barPct  = Math.min(100, pct);
    var barCol  = isOver ? '#D85A30' : '#BA7517';
    return (
      '<div style="padding:10px 0;border-bottom:1px solid #f0f0f0;">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:6px;">' +
          '<div>' +
            '<span style="' + styles.name + '">' + _escHtml(alert.category) + '</span>' +
            '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;' +
                 'margin-left:8px;' + badgeSt + '">' + label + '</span>' +
          '</div>' +
          '<div style="font-size:12px;font-family:monospace;color:' + (isOver ? '#D85A30' : '#1a1a1a') + ';">' +
            '₦' + _numFmt(alert.spent) + ' / ₦' + _numFmt(alert.limit) +
          '</div>' +
        '</div>' +
        '<div style="height:4px;background:#eee;border-radius:2px;overflow:hidden;">' +
          '<div style="height:100%;width:' + barPct + '%;background:' + barCol + ';border-radius:2px;"></div>' +
        '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:4px;">' + pct + '% of limit used</div>' +
      '</div>'
    );
  }).join('');

  var billSection = bills.length === 0 ? '' : (
    '<div style="margin-bottom:24px;">' +
      '<div style="' + styles.secHdr + '">Upcoming Bills</div>' +
      billRows +
    '</div>'
  );

  var alertSection = alerts.length === 0 ? '' : (
    '<div style="margin-bottom:24px;">' +
      '<div style="' + styles.secHdr + '">Budget Alerts</div>' +
      alertRows +
    '</div>'
  );

  return (
    '<html><body style="' + styles.body + '">' +
      '<div style="' + styles.wrap + '">' +

        '<div style="' + styles.header + '">' +
          '<div style="' + styles.hTitle + '">Budget Tracker</div>' +
          '<div style="' + styles.hSub + '">' + today.toDateString() + ' · Daily Alert</div>' +
        '</div>' +

        '<div style="' + styles.body_ + '">' +
          billSection +
          alertSection +
        '</div>' +

        '<div style="' + styles.footer + '">' +
          'Sent automatically by Budget Tracker · Google Apps Script' +
        '</div>' +

      '</div>' +
    '</body></html>'
  );
}


// ─── UTILITIES ───────────────────────────────────────────────────────────────

/**
 * getUserEmail()
 * Returns the email of the script owner (the user who authorised the script).
 * Falls back to getEffectiveUser() if getActiveUser() returns an empty string.
 */
function getUserEmail() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    email = Session.getEffectiveUser().getEmail();
  }
  if (!email) {
    throw new Error('Notifications.gs: Could not determine user email address.');
  }
  return email;
}

/**
 * sendTestEmail()
 *
 * Utility function for developer testing.
 * Builds a realistic dummy payload and calls sendConsolidatedAlert().
 * Run manually from the Apps Script editor — never triggered automatically.
 */
function sendTestEmail() {
  var dummyBills = [
    { id: 'test-1', name: 'Internet',    amount: 15000, due_day: 15, paid: false, daysUntilDue: 3, category: 'Utilities' },
    { id: 'test-2', name: 'Electricity', amount: 8000,  due_day: 18, paid: false, daysUntilDue: 0, category: 'Utilities' }
  ];
  var dummyAlerts = [
    { category: 'Food',          limit: 30000,  spent: 32500,  status: 'over'    },
    { category: 'Entertainment', limit: 10000,  spent: 9100,   status: 'warning' }
  ];

  Logger.log('Notifications.gs: Sending test email to ' + getUserEmail());
  sendConsolidatedAlert(dummyBills, dummyAlerts);
  Logger.log('Notifications.gs: Test email sent.');
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * _buildMonthKey(date)
 * Returns the YYYY-MM key for the given Date object.
 */
function _buildMonthKey(date) {
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}

/**
 * _numFmt(n)
 * Formats a number with thousands separators for email body text.
 * e.g. 450000 → "450,000"
 */
function _numFmt(n) {
  return Math.round(parseFloat(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * _escHtml(str)
 * Minimal HTML escaping for email body content.
 */
function _escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
