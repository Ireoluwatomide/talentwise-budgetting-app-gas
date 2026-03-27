/**
 * Notifications.gs — Email Alerts via MailApp
 *
 * ADDITIONS:
 *   - sendSavingsAlerts() — new daily savings alert email with five triggers:
 *       1. Milestone reached (25 / 50 / 75 / 100%)
 *       2. Deadline approaching within 30 days
 *       3. Goal created but never funded (saved_amount = 0)
 *       4. No contribution made to a goal this calendar month
 *       5. Goal is behind pace (avg monthly contribution < monthly_needed)
 *   - sendDailyAlerts() unchanged — bills + budget alerts
 *   - Both are called from Triggers.gs dailyAlertHandler()
 *
 * FREE TIER: 100 emails/day via MailApp. Both functions send one consolidated
 * email each, so the daily cost is at most 2 emails per user.
 */


// ─── ENTRY POINTS ────────────────────────────────────────────────────────────

/**
 * sendDailyAlerts()
 *
 * Sends bills + budget alert email.
 * Called by Triggers.gs dailyAlertHandler() every morning at 8 AM WAT.
 */
function sendDailyAlerts() {
  try {
    var upcomingBills = getUpcomingBills();
    var today         = new Date();
    var monthKey      = _buildMonthKey(today);
    var budgetAlerts  = checkBudgetAlerts(monthKey);

    var actionableAlerts = budgetAlerts.filter(function(a) {
      return a.status === 'over' || a.status === 'warning';
    });

    var hasContent = upcomingBills.length > 0 || actionableAlerts.length > 0;

    if (!hasContent) {
      Logger.log('Notifications.gs: sendDailyAlerts — no alerts for ' + monthKey + '.');
      return;
    }

    sendConsolidatedAlert(upcomingBills, actionableAlerts);
    Logger.log(
      'Notifications.gs: sendDailyAlerts sent — ' +
      upcomingBills.length + ' bill(s), ' +
      actionableAlerts.length + ' budget alert(s).'
    );
  } catch (e) {
    Logger.log('Notifications.gs: sendDailyAlerts() failed — ' + e.message);
  }
}

/**
 * sendSavingsAlerts()
 *
 * Sends savings-specific alert email if any of the five triggers fire.
 * Called by Triggers.gs dailyAlertHandler() every morning at 8 AM WAT,
 * immediately after sendDailyAlerts().
 *
 * Trigger summary:
 *   1. Milestone (25/50/75/100%) — fires when goal is within 2% above boundary
 *   2. Deadline near             — target_date within 30 days, not complete
 *   3. Never funded              — saved_amount = 0, no history rows
 *   4. No contribution this month — has history but none this calendar month
 *   5. Behind pace               — avg monthly contribution < monthly_needed
 */
function sendSavingsAlerts() {
  try {
    var data = getSavingsAlertsData(); // from Savings.gs

    var hasContent = (
      data.milestones.length     > 0 ||
      data.deadlineNear.length   > 0 ||
      data.neverFunded.length    > 0 ||
      data.noContribution.length > 0 ||
      data.behindPace.length     > 0
    );

    if (!hasContent) {
      Logger.log('Notifications.gs: sendSavingsAlerts — no savings alerts today.');
      return;
    }

    var email   = getUserEmail();
    var subject = _buildSavingsSubject(data);
    var plain   = _buildSavingsPlainBody(data);
    var html    = _buildSavingsHtmlBody(data);

    MailApp.sendEmail({
      to:       email,
      subject:  subject,
      body:     plain,
      htmlBody: html
    });

    Logger.log(
      'Notifications.gs: sendSavingsAlerts sent — ' +
      'milestones: ' + data.milestones.length + ', ' +
      'deadlineNear: ' + data.deadlineNear.length + ', ' +
      'neverFunded: ' + data.neverFunded.length + ', ' +
      'noContribution: ' + data.noContribution.length + ', ' +
      'behindPace: ' + data.behindPace.length
    );
  } catch (e) {
    Logger.log('Notifications.gs: sendSavingsAlerts() failed — ' + e.message);
  }
}


// ─── BILLS + BUDGET EMAIL BUILDER ────────────────────────────────────────────

/**
 * sendConsolidatedAlert(upcomingBills, budgetAlerts)
 * Builds and sends the bills + budget consolidated email.
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
  return lines.join('\n');
}

function _buildHtmlBody(bills, alerts) {
  var today  = new Date();
  var styles = _emailStyles();

  var billRows = bills.map(function(bill) {
    var dueText = bill.daysUntilDue === 0 ? 'Due TODAY'
                : 'Due in ' + bill.daysUntilDue + 'd';
    var badgeSt = bill.daysUntilDue === 0
      ? 'background:#FCEBEB;color:#791F1F;'
      : 'background:#FAEEDA;color:#412402;';
    return (
      '<div style="' + styles.row + '">' +
        '<div>' +
          '<div style="' + styles.name + '">' + _escHtml(bill.name) + '</div>' +
          '<div style="' + styles.sub  + '">' + (bill.category || 'Utilities') + ' · Day ' + bill.due_day + ' monthly</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:13px;font-family:monospace;">₦' + _numFmt(bill.amount) + '</div>' +
          '<div style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;display:inline-block;margin-top:3px;' + badgeSt + '">' + dueText + '</div>' +
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
          '<div><span style="' + styles.name + '">' + _escHtml(alert.category) + '</span>' +
          '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;margin-left:8px;' + badgeSt + '">' + label + '</span></div>' +
          '<div style="font-size:12px;font-family:monospace;color:' + (isOver ? '#D85A30' : '#1a1a1a') + ';">₦' + _numFmt(alert.spent) + ' / ₦' + _numFmt(alert.limit) + '</div>' +
        '</div>' +
        '<div style="height:4px;background:#eee;border-radius:2px;overflow:hidden;">' +
          '<div style="height:100%;width:' + barPct + '%;background:' + barCol + ';border-radius:2px;"></div>' +
        '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:4px;">' + pct + '% of limit used</div>' +
      '</div>'
    );
  }).join('');

  var billSection  = bills.length === 0 ? '' : '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">Upcoming Bills</div>' + billRows + '</div>';
  var alertSection = alerts.length === 0 ? '' : '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">Budget Alerts</div>' + alertRows + '</div>';

  return _wrapEmailHtml(today, billSection + alertSection, styles);
}


// ─── SAVINGS EMAIL BUILDER ────────────────────────────────────────────────────

function _buildSavingsSubject(data) {
  var parts = [];

  if (data.milestones.length > 0) {
    parts.push('🏆 ' + data.milestones.length + ' savings milestone' +
      (data.milestones.length > 1 ? 's' : '') + ' reached');
  }
  if (data.deadlineNear.length > 0) {
    parts.push('⏰ ' + data.deadlineNear.length + ' goal deadline' +
      (data.deadlineNear.length > 1 ? 's' : '') + ' approaching');
  }
  if (data.behindPace.length > 0) {
    parts.push('📉 ' + data.behindPace.length + ' goal' +
      (data.behindPace.length > 1 ? 's' : '') + ' behind pace');
  }
  if (data.neverFunded.length > 0) {
    parts.push(data.neverFunded.length + ' unfunded goal' +
      (data.neverFunded.length > 1 ? 's' : ''));
  }
  if (data.noContribution.length > 0) {
    parts.push(data.noContribution.length + ' goal' +
      (data.noContribution.length > 1 ? 's' : '') + ' need contribution');
  }

  return 'Budget Tracker Savings — ' + parts.join(', ');
}

function _buildSavingsPlainBody(data) {
  var lines = [];
  var today = new Date();
  lines.push('Budget Tracker — Savings Alert');
  lines.push(today.toDateString());
  lines.push('');

  if (data.milestones.length > 0) {
    lines.push('🏆 MILESTONES REACHED');
    lines.push('─────────────────────');
    data.milestones.forEach(function(item) {
      lines.push(item.goal.name + ': ' + item.milestone + '% complete! (' +
        '₦' + _numFmt(item.goal.saved_amount) + ' of ₦' + _numFmt(item.goal.target_amount) + ')');
    });
    lines.push('');
  }

  if (data.deadlineNear.length > 0) {
    lines.push('⏰ DEADLINES APPROACHING');
    lines.push('────────────────────────');
    data.deadlineNear.forEach(function(item) {
      var label = item.daysUntil === 0 ? 'Due TODAY' : 'In ' + item.daysUntil + ' days';
      lines.push(item.goal.name + ': ' + label +
        ' — ' + item.goal.percent_complete + '% funded' +
        (item.goal.monthly_needed ? ' (need ₦' + _numFmt(item.goal.monthly_needed) + '/mo)' : ''));
    });
    lines.push('');
  }

  if (data.behindPace.length > 0) {
    lines.push('📉 BEHIND PACE');
    lines.push('──────────────');
    data.behindPace.forEach(function(item) {
      lines.push(item.goal.name + ': averaging ₦' + _numFmt(item.avgMonthly) + '/mo, ' +
        'need ₦' + _numFmt(item.goal.monthly_needed) + '/mo — shortfall ₦' + _numFmt(item.shortfall) + '/mo');
    });
    lines.push('');
  }

  if (data.neverFunded.length > 0) {
    lines.push('💤 NEVER FUNDED');
    lines.push('────────────────');
    data.neverFunded.forEach(function(goal) {
      lines.push(goal.name + ': ₦0 of ₦' + _numFmt(goal.target_amount) + ' — add your first top-up!');
    });
    lines.push('');
  }

  if (data.noContribution.length > 0) {
    lines.push('📅 NO CONTRIBUTION THIS MONTH');
    lines.push('──────────────────────────────');
    data.noContribution.forEach(function(goal) {
      lines.push(goal.name + ': ' + goal.percent_complete + '% funded' +
        (goal.monthly_needed ? ' (need ₦' + _numFmt(goal.monthly_needed) + '/mo)' : ''));
    });
    lines.push('');
  }

  lines.push('─────────────────────────────────────');
  lines.push('Sent by Budget Tracker — open the app to top up your goals.');
  return lines.join('\n');
}

function _buildSavingsHtmlBody(data) {
  var today  = new Date();
  var styles = _emailStyles();

  var sections = '';

  // ── Milestones ──────────────────────────────────────────────────────────
  if (data.milestones.length > 0) {
    var rows = data.milestones.map(function(item) {
      var emoji = item.milestone === 100 ? '🏆' : item.milestone === 75 ? '⚡' : item.milestone === 50 ? '🔵' : '✨';
      var pct   = item.goal.percent_complete;
      return (
        '<div style="' + styles.row + 'background:#f0faf5;border-radius:6px;margin-bottom:6px;">' +
          '<div>' +
            '<div style="' + styles.name + '">' + emoji + ' ' + _escHtml(item.goal.name) + '</div>' +
            '<div style="' + styles.sub + '">' + item.goal.category + ' · ' +
              '₦' + _numFmt(item.goal.saved_amount) + ' of ₦' + _numFmt(item.goal.target_amount) +
            '</div>' +
          '</div>' +
          '<div style="font-size:14px;font-weight:700;color:#1D9E75;">' + item.milestone + '%</div>' +
        '</div>' +
        _progressBarHtml(pct, '#1D9E75')
      );
    }).join('');
    sections += '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">🏆 Milestones Reached</div>' + rows + '</div>';
  }

  // ── Deadline approaching ────────────────────────────────────────────────
  if (data.deadlineNear.length > 0) {
    var rows = data.deadlineNear.map(function(item) {
      var dueStr   = item.daysUntil === 0 ? 'Due TODAY' : 'In ' + item.daysUntil + ' days';
      var urgColor = item.daysUntil <= 7 ? '#D85A30' : '#BA7517';
      var pct      = item.goal.percent_complete;
      return (
        '<div style="' + styles.row + '">' +
          '<div>' +
            '<div style="' + styles.name + '">' + _escHtml(item.goal.name) + '</div>' +
            '<div style="' + styles.sub + '">' + item.goal.category + ' · ' + pct + '% funded' +
              (item.goal.monthly_needed ? ' · need ₦' + _numFmt(item.goal.monthly_needed) + '/mo' : '') +
            '</div>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;' +
            'background:#FAEEDA;color:' + urgColor + ';">' + dueStr + '</div>' +
        '</div>' +
        _progressBarHtml(pct, urgColor)
      );
    }).join('');
    sections += '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">⏰ Deadlines Approaching</div>' + rows + '</div>';
  }

  // ── Behind pace ─────────────────────────────────────────────────────────
  if (data.behindPace.length > 0) {
    var rows = data.behindPace.map(function(item) {
      return (
        '<div style="' + styles.row + '">' +
          '<div>' +
            '<div style="' + styles.name + '">' + _escHtml(item.goal.name) + '</div>' +
            '<div style="' + styles.sub + '">' +
              'Avg: ₦' + _numFmt(item.avgMonthly) + '/mo &nbsp;·&nbsp; ' +
              'Needed: ₦' + _numFmt(item.goal.monthly_needed) + '/mo' +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:12px;font-weight:600;color:#D85A30;">−₦' + _numFmt(item.shortfall) + '/mo</div>' +
            '<div style="' + styles.sub + '">shortfall</div>' +
          '</div>' +
        '</div>' +
        _progressBarHtml(item.goal.percent_complete, '#D85A30')
      );
    }).join('');
    sections += '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">📉 Behind Pace</div>' + rows + '</div>';
  }

  // ── Never funded ────────────────────────────────────────────────────────
  if (data.neverFunded.length > 0) {
    var rows = data.neverFunded.map(function(goal) {
      return (
        '<div style="' + styles.row + '">' +
          '<div>' +
            '<div style="' + styles.name + '">' + _escHtml(goal.name) + '</div>' +
            '<div style="' + styles.sub + '">' + goal.category + ' · target ₦' + _numFmt(goal.target_amount) + '</div>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:600;background:#FAEEDA;color:#412402;padding:3px 8px;border-radius:4px;">₦0 saved</div>' +
        '</div>'
      );
    }).join('');
    sections += '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">💤 Not Yet Started</div>' + rows + '</div>';
  }

  // ── No contribution this month ──────────────────────────────────────────
  if (data.noContribution.length > 0) {
    var rows = data.noContribution.map(function(goal) {
      return (
        '<div style="' + styles.row + '">' +
          '<div>' +
            '<div style="' + styles.name + '">' + _escHtml(goal.name) + '</div>' +
            '<div style="' + styles.sub + '">' + goal.percent_complete + '% funded' +
              (goal.monthly_needed ? ' · need ₦' + _numFmt(goal.monthly_needed) + '/mo' : '') +
            '</div>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:600;background:#E6F1FB;color:#042C53;padding:3px 8px;border-radius:4px;">No deposit yet</div>' +
        '</div>' +
        _progressBarHtml(goal.percent_complete, '#185FA5')
      );
    }).join('');
    sections += '<div style="margin-bottom:24px;"><div style="' + styles.secHdr + '">📅 No Contribution This Month</div>' + rows + '</div>';
  }

  return _wrapEmailHtml(today, sections, styles);
}


// ─── TEST HELPERS ─────────────────────────────────────────────────────────────

/**
 * sendTestEmail()
 * Sends a test bills + budget email. Run from the Apps Script editor.
 */
function sendTestEmail() {
  var dummyBills = [
    { id: 'test-1', name: 'Internet',    amount: 15000, due_day: 15, paid: false, daysUntilDue: 3, category: 'Utilities' },
    { id: 'test-2', name: 'Electricity', amount: 8000,  due_day: 18, paid: false, daysUntilDue: 0, category: 'Utilities' }
  ];
  var dummyAlerts = [
    { category: 'Food',          limit: 30000, spent: 32500, status: 'over'    },
    { category: 'Entertainment', limit: 10000, spent: 9100,  status: 'warning' }
  ];
  Logger.log('Notifications.gs: Sending test bills/budget email to ' + getUserEmail());
  sendConsolidatedAlert(dummyBills, dummyAlerts);
  Logger.log('Notifications.gs: Test email sent.');
}

/**
 * sendTestSavingsEmail()
 * Sends a test savings alert email with dummy data. Run from the Apps Script editor.
 */
function sendTestSavingsEmail() {
  var dummyData = {
    milestones: [
      { goal: { id: 't1', name: 'Emergency Fund', category: 'Emergency Fund', saved_amount: 125000, target_amount: 500000, percent_complete: 25, monthly_needed: 25000, target_date: '' }, milestone: 25 }
    ],
    deadlineNear: [
      { goal: { id: 't2', name: 'Holiday Fund', category: 'Sinking Fund', saved_amount: 80000, target_amount: 150000, percent_complete: 53, monthly_needed: 35000, target_date: '2026-04-30' }, daysUntil: 12 }
    ],
    neverFunded: [
      { id: 't3', name: 'New Laptop', category: 'Sinking Fund', saved_amount: 0, target_amount: 250000, percent_complete: 0, monthly_needed: null, target_date: '' }
    ],
    noContribution: [
      { id: 't4', name: 'Retirement Account', category: 'Retirement Account', saved_amount: 320000, target_amount: 1000000, percent_complete: 32, monthly_needed: 25000, target_date: '' }
    ],
    behindPace: [
      { goal: { id: 't5', name: 'Down Payment', category: 'Down Payment', saved_amount: 200000, target_amount: 2000000, percent_complete: 10, monthly_needed: 60000, target_date: '2027-12-31' }, shortfall: 40000, avgMonthly: 20000 }
    ]
  };

  Logger.log('Notifications.gs: Sending test savings email to ' + getUserEmail());
  var email   = getUserEmail();
  var subject = _buildSavingsSubject(dummyData);
  var plain   = _buildSavingsPlainBody(dummyData);
  var html    = _buildSavingsHtmlBody(dummyData);
  MailApp.sendEmail({ to: email, subject: subject, body: plain, htmlBody: html });
  Logger.log('Notifications.gs: Test savings email sent.');
}


// ─── SHARED UTILITIES ─────────────────────────────────────────────────────────

function getUserEmail() {
  var email = Session.getActiveUser().getEmail();
  if (!email) email = Session.getEffectiveUser().getEmail();
  if (!email) throw new Error('Notifications.gs: Could not determine user email address.');
  return email;
}

function _buildMonthKey(date) {
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function _numFmt(n) {
  return Math.round(parseFloat(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function _escHtml(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function _emailStyles() {
  return {
    body:   'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f3;margin:0;padding:0;',
    wrap:   'max-width:560px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;',
    header: 'background:#1a1a1a;padding:20px 24px;',
    hTitle: 'color:#ffffff;font-size:18px;font-weight:500;margin:0;',
    hSub:   'color:#888;font-size:12px;margin:4px 0 0;',
    body_:  'padding:20px 24px;',
    secHdr: 'font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#666;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid #eee;',
    row:    'display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f0f0f0;',
    name:   'font-size:13px;font-weight:500;color:#1a1a1a;',
    sub:    'font-size:11px;color:#888;margin-top:2px;',
    footer: 'background:#f5f5f3;padding:14px 24px;font-size:11px;color:#888;text-align:center;'
  };
}

function _progressBarHtml(pct, color) {
  var barPct = Math.min(100, Math.round(pct));
  return (
    '<div style="height:4px;background:#eee;border-radius:2px;overflow:hidden;margin:4px 0 8px;">' +
      '<div style="height:100%;width:' + barPct + '%;background:' + color + ';border-radius:2px;"></div>' +
    '</div>'
  );
}

function _wrapEmailHtml(today, bodyContent, styles) {
  return (
    '<html><body style="' + styles.body + '">' +
      '<div style="' + styles.wrap + '">' +
        '<div style="' + styles.header + '">' +
          '<div style="' + styles.hTitle + '">Budget Tracker</div>' +
          '<div style="' + styles.hSub + '">' + today.toDateString() + ' · Savings Alert</div>' +
        '</div>' +
        '<div style="' + styles.body_ + '">' + bodyContent + '</div>' +
        '<div style="' + styles.footer + '">Sent automatically by Budget Tracker · Google Apps Script</div>' +
      '</div>' +
    '</body></html>'
  );
}
