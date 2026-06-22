/**
 * Weekly task performance metrics, score, and email/Telegram report (Phase: analytics).
 * Week window: rolling 7 calendar days in the spreadsheet timezone ending at local midnight
 * of the run day (same cadence as Saturday 9:00 trigger: prior 7 local days).
 */
var CosTaskAnalyticsService = {
  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @param {{ force?: boolean, skipIdempotency?: boolean }} [opts]
   * @returns {{ ok: boolean, message?: string, skipped?: boolean, reason?: string }}
   */
  sendWeeklyReport: function (optSs, opts) {
    var force = opts && opts.force === true;
    var skipIdemp = opts && opts.skipIdempotency === true;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      CosLogger.warn('sendWeeklyReport: script lock timeout');
      return { ok: false, message: 'Lock timeout' };
    }
    try {
      var settings = new CosSettingsRepository().getSettings();
      if (!force && !settings.weeklyPerformanceReportEnabled) {
        CosLogger.info('sendWeeklyReport: WEEKLY_PERFORMANCE_REPORT_ENABLED is false');
        return { ok: true, skipped: true, reason: 'weekly_report_disabled' };
      }

      var ss = optSs || CosBootstrap.getSpreadsheetForRun();
      if (!ss) {
        return {
          ok: false,
          message: 'No spreadsheet (open the bound Sheet or run Install).',
        };
      }

      var tz =
        String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
      var now = new Date();
      var dayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

      if (!force && !skipIdemp) {
        var last = PropertiesService.getScriptProperties().getProperty(
          CosConstants.PROP_KEYS.WEEKLY_PERFORMANCE_LAST_SENT_DATE
        );
        if (last === dayKey) {
          CosLogger.info('sendWeeklyReport: already sent today', {
            dayKey: dayKey,
          });
          return { ok: true, skipped: true, reason: 'already_sent_today' };
        }
      }

      var taskRepo = new CosTaskRepository(ss);
      taskRepo.ensureSchema();
      var v = taskRepo.validateSheet();
      if (!v.ok) {
        CosLogger.warn('sendWeeklyReport: Tasks sheet invalid', {
          messages: v.messages,
        });
        return {
          ok: false,
          message: 'Tasks sheet invalid — run Install / Repair. ' + v.messages.join(' '),
        };
      }

      var to = String(settings.userEmail || '').trim();
      if (!to) {
        to = String(Session.getActiveUser().getEmail() || '').trim();
      }
      if (!to) {
        return {
          ok: false,
          message: 'No recipient email (USER_EMAIL / active user).',
        };
      }

      var range = CosTaskAnalyticsService._weekRange_(ss);
      var tasks = taskRepo.fetchAllTasks();
      var breakdown = CosTaskAnalyticsService._computeWeeklyBreakdown_(tasks, range);
      var metrics = breakdown.metrics;
      var score = CosTaskAnalyticsService.computeScore(metrics);
      var plain = CosTaskAnalyticsService.generateWeeklyReport(
        metrics,
        score,
        range,
        breakdown.rows
      );
      var html = CosTaskAnalyticsService._buildWeeklyReportHtml_(
        metrics,
        score,
        range,
        breakdown.rows
      );

      var subject =
        '[' +
        CosConstants.PRODUCT_NAME +
        '] Weekly task performance — ' +
        Utilities.formatDate(now, tz, 'EEE, MMM d, yyyy') +
        ' · ' +
        score.normalized100 +
        '/100';

      GmailApp.sendEmail(to, subject, plain, {
        htmlBody: html,
        name: CosConstants.PRODUCT_NAME,
      });

      var tg = CosTelegramService.sendPlainToConfiguredChat_(settings, plain);
      if (!tg.ok) {
        CosLogger.warn('sendWeeklyReport: Telegram failed', {
          message: tg.message || '',
        });
      }

      if (!skipIdemp) {
        PropertiesService.getScriptProperties().setProperty(
          CosConstants.PROP_KEYS.WEEKLY_PERFORMANCE_LAST_SENT_DATE,
          dayKey
        );
      }

      CosLogger.info('sendWeeklyReport: sent', { to: to, dayKey: dayKey });
      return { ok: true };
    } catch (e) {
      CosLogger.error('sendWeeklyReport failed', { error: String(e) });
      return { ok: false, message: String(e.message || e) };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {CosTask[]} tasks
   * @param {{ weekStart: Date, weekEndExclusive: Date, tz: string }} range
   * @returns {Object}
   */
  computeWeeklyMetrics: function (tasks, range) {
    return CosTaskAnalyticsService._computeWeeklyBreakdown_(tasks, range).metrics;
  },

  /**
   * @param {Object} metrics
   * @returns {{ totalOutOf80: number, normalized100: number, p0ExecutionPoints: number, firstTimePoints: number, dropPenalty: number }}
   */
  computeScore: function (metrics) {
    var m = metrics || {};
    var p0Denom =
      (m.p0Completed || 0) +
      (m.p0Dropped || 0) +
      (m.p0Rescheduled || 0) +
      (m.p0Lowered || 0);
    var p0Exec =
      p0Denom === 0 ? 50 : (50 * (m.p0Completed || 0)) / p0Denom;
    var first =
      (m.completedTasks || 0) === 0
        ? 0
        : (30 * (m.firstTimeCompleted || 0)) / (m.completedTasks || 1);
    var dropPen =
      (m.totalTasks || 0) === 0
        ? 0
        : Math.min(
            20,
            (20 * (m.droppedTasks || 0)) / Math.max(1, m.totalTasks || 1)
          );
    var raw = p0Exec + first - dropPen;
    var totalOutOf80 = Math.max(0, Math.min(80, Math.round(raw)));
    var normalized100 = Math.max(
      0,
      Math.min(100, Math.round((totalOutOf80 / 80) * 100))
    );
    return {
      totalOutOf80: totalOutOf80,
      normalized100: normalized100,
      p0ExecutionPoints: Math.round(p0Exec * 10) / 10,
      firstTimePoints: Math.round(first * 10) / 10,
      dropPenalty: Math.round(dropPen * 10) / 10,
    };
  },

  /**
   * @param {Object} metrics
   * @param {Object} score
   * @param {{ weekStart: Date, weekEndExclusive: Date, tz: string }} range
   * @param {CosWeeklyTaskRow[]=} optRows
   * @returns {string}
   */
  generateWeeklyReport: function (metrics, score, range, optRows) {
    var m = metrics || {};
    var s = score || CosTaskAnalyticsService.computeScore(m);
    var tz = range && range.tz ? range.tz : '';
    var startStr = Utilities.formatDate(range.weekStart, tz, 'yyyy-MM-dd');
    var endStr = Utilities.formatDate(
      new Date(range.weekEndExclusive.getTime() - 1),
      tz,
      'yyyy-MM-dd'
    );
    var lines = [];
    lines.push(CosConstants.PRODUCT_NAME + ' — Weekly task performance');
    lines.push('Window (local): ' + startStr + ' → ' + endStr + ' (' + tz + ')');
    lines.push('');
    lines.push(
      'Score: ' +
        s.totalOutOf80 +
        '/80 (normalized ' +
        s.normalized100 +
        '/100)'
    );
    lines.push(
      '  P0 execution (50 max): ~' +
        s.p0ExecutionPoints +
        ' · First-time completion (30 max): ~' +
        s.firstTimePoints +
        ' · Drop penalty: -' +
        s.dropPenalty
    );
    lines.push('');
    lines.push('All priorities');
    lines.push('  Tasks in scope: ' + (m.totalTasks || 0));
    lines.push('  Completed: ' + (m.completedTasks || 0));
    lines.push('  First-time completed (no prior reschedules): ' + (m.firstTimeCompleted || 0));
    lines.push('  Rescheduled (closure): ' + (m.rescheduledTasks || 0));
    lines.push('  Lowered priority: ' + (m.loweredTasks || 0));
    lines.push('  Dropped: ' + (m.droppedTasks || 0));
    lines.push('');
    lines.push('P0 only');
    lines.push('  In scope: ' + (m.p0Total || 0));
    lines.push('  Completed: ' + (m.p0Completed || 0));
    lines.push('  First-time completed: ' + (m.p0FirstTimeCompleted || 0));
    lines.push('  Rescheduled: ' + (m.p0Rescheduled || 0));
    lines.push('  Lowered: ' + (m.p0Lowered || 0));
    lines.push('  Dropped: ' + (m.p0Dropped || 0));
    lines.push('');
    lines.push('— Tasks in this report —');
    var rows = optRows && optRows.length ? optRows : [];
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      lines.push(
        (r.priority || '') +
          ' | ' +
          CosTaskAnalyticsService._plainTruncate_(r.title || '', 72) +
          ' | ' +
          (r.weekActivity || '') +
          ' | now: ' +
          (r.currentStatus || '')
      );
    }
    if (!rows.length) {
      lines.push('(none)');
    }
    lines.push('');
    lines.push(
      'Notes: “In scope” counts tasks with a completion, drop, reschedule, or lower recorded in the window (Updated At / Completed At). Legacy rows without analytics columns are included when Last Outcome and timestamps match.'
    );
    return lines.join('\n');
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @returns {{ weekStart: Date, weekEndExclusive: Date, tz: string }}
   * @private
   */
  _weekRange_: function (ss) {
    var tz = ss.getSpreadsheetTimeZone();
    var now = new Date();
    var ymdToday = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var weekEndExclusive = CosTaskSchedulerService._localDayStartForYmdInTz_(
      ymdToday,
      tz
    );
    if (!weekEndExclusive) {
      weekEndExclusive = new Date(now.getTime());
    }
    var ymdStart = cos_ymdAddCalendarDays_(ymdToday, -7, tz);
    var weekStart = CosTaskSchedulerService._localDayStartForYmdInTz_(
      ymdStart,
      tz
    );
    if (!weekStart) {
      weekStart = new Date(weekEndExclusive.getTime() - 7 * 86400000);
    }
    return {
      weekStart: weekStart,
      weekEndExclusive: weekEndExclusive,
      tz: tz,
    };
  },

  /**
   * @param {string} raw
   * @returns {Date|null}
   * @private
   */
  _parseInstant_: function (raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    var d = new Date(String(raw).trim());
    return isNaN(d.getTime()) ? null : d;
  },

  /**
   * @param {Date} d
   * @param {Date} start
   * @param {Date} endEx
   * @returns {boolean}
   * @private
   */
  _inRange_: function (d, start, endEx) {
    var t = d.getTime();
    return t >= start.getTime() && t < endEx.getTime();
  },

  /**
   * @param {CosTask} t
   * @returns {Date|null}
   * @private
   */
  _effectiveCompletedAt_: function (t) {
    var ca = CosTaskAnalyticsService._parseInstant_(t.completedAt);
    if (ca) {
      return ca;
    }
    return CosTaskAnalyticsService._parseInstant_(t.completionTimestamp);
  },

  /**
   * @param {CosTask} t
   * @returns {boolean}
   * @private
   */
  _isP0_: function (t) {
    return String(t.priority || '').trim() === CosConstants.TASK_PRIORITY.P0;
  },

  /**
   * @param {CosTask} t
   * @returns {boolean}
   * @private
   */
  _legacyReschedule_: function (t) {
    var ct = String(t.closureType || '').trim();
    if (ct === CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.RESCHEDULE) {
      return true;
    }
    if (ct) {
      return false;
    }
    return (
      String(t.lastOutcome || '').trim() ===
      CosConstants.TASK_LAST_OUTCOME.RESCHEDULED
    );
  },

  /**
   * @param {CosTask} t
   * @returns {boolean}
   * @private
   */
  _legacyLower_: function (t) {
    var ct = String(t.closureType || '').trim();
    if (ct === CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.LOWER) {
      return true;
    }
    if (ct) {
      return false;
    }
    return (
      String(t.lastOutcome || '').trim() === CosConstants.TASK_LAST_OUTCOME.LOWERED
    );
  },

  /**
   * @param {CosTask} t
   * @returns {boolean}
   * @private
   */
  _legacyDrop_: function (t) {
    var ct = String(t.closureType || '').trim();
    if (ct === CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.DROP) {
      return true;
    }
    if (ct) {
      return false;
    }
    return (
      String(t.lastOutcome || '').trim() === CosConstants.TASK_LAST_OUTCOME.DROPPED
    );
  },

  /**
   * @param {CosTask[]} tasks
   * @param {{ weekStart: Date, weekEndExclusive: Date, tz: string }} range
   * @returns {{ metrics: Object, rows: Array<{taskId:string,title:string,priority:string,weekActivity:string,currentStatus:string,rescheduleCount:string}> }}
   * @private
   */
  _computeWeeklyBreakdown_: function (tasks, range) {
    var start = range.weekStart;
    var endEx = range.weekEndExclusive;
    var idsTotal = {};
    var idsP0 = {};
    var completed = 0;
    var firstTime = 0;
    var rescheduled = 0;
    var lowered = 0;
    var dropped = 0;
    var p0Completed = 0;
    var p0FirstTime = 0;
    var p0Rescheduled = 0;
    var p0Lowered = 0;
    var p0Dropped = 0;
    /** @type {Array<{taskId:string,title:string,priority:string,weekActivity:string,currentStatus:string,rescheduleCount:string}>} */
    var rows = [];
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var id = String(t.taskId || '').trim();
      if (!id) {
        continue;
      }
      var isP0 = CosTaskAnalyticsService._isP0_(t);
      var upd = CosTaskAnalyticsService._parseInstant_(t.updatedAt);
      var doneAt = CosTaskAnalyticsService._effectiveCompletedAt_(t);
      var hit = false;
      /** @type {string[]} */
      var labels = [];

      if (
        doneAt &&
        CosTaskAnalyticsService._inRange_(doneAt, start, endEx) &&
        (String(t.finalStatus || '').trim() ===
          CosConstants.TASK_ANALYTICS_FINAL_STATUS.DONE ||
          String(t.status || '').trim() === CosConstants.TASK_STATUS.DONE)
      ) {
        completed++;
        hit = true;
        var rc = parseInt(String(t.rescheduleCount || '0').trim(), 10);
        if (isNaN(rc) || rc <= 0) {
          firstTime++;
          labels.push('Completed (first time)');
        } else {
          labels.push('Completed');
        }
        if (isP0) {
          p0Completed++;
          if (isNaN(rc) || rc <= 0) {
            p0FirstTime++;
          }
        }
      }

      if (
        upd &&
        CosTaskAnalyticsService._inRange_(upd, start, endEx) &&
        CosTaskAnalyticsService._legacyDrop_(t) &&
        (String(t.finalStatus || '').trim() ===
          CosConstants.TASK_ANALYTICS_FINAL_STATUS.DROPPED ||
          String(t.status || '').trim() === CosConstants.TASK_STATUS.DROPPED)
      ) {
        dropped++;
        hit = true;
        labels.push('Dropped');
        if (isP0) {
          p0Dropped++;
        }
      }

      if (
        upd &&
        CosTaskAnalyticsService._inRange_(upd, start, endEx) &&
        CosTaskAnalyticsService._legacyReschedule_(t)
      ) {
        rescheduled++;
        hit = true;
        labels.push('Rescheduled');
        if (isP0) {
          p0Rescheduled++;
        }
      }

      if (
        upd &&
        CosTaskAnalyticsService._inRange_(upd, start, endEx) &&
        CosTaskAnalyticsService._legacyLower_(t)
      ) {
        lowered++;
        hit = true;
        labels.push('Lowered priority');
        if (isP0) {
          p0Lowered++;
        }
      }

      if (hit) {
        idsTotal[id] = true;
        if (isP0) {
          idsP0[id] = true;
        }
        rows.push({
          taskId: id,
          title: String(t.task || '').trim(),
          priority: String(t.priority || '').trim(),
          weekActivity: labels.join(' · '),
          currentStatus: String(t.status || '').trim(),
          rescheduleCount: String(t.rescheduleCount || '0'),
        });
      }
    }

    var totalKeys = 0;
    var p0TotalKeys = 0;
    var k;
    for (k in idsTotal) {
      if (Object.prototype.hasOwnProperty.call(idsTotal, k)) {
        totalKeys++;
      }
    }
    for (k in idsP0) {
      if (Object.prototype.hasOwnProperty.call(idsP0, k)) {
        p0TotalKeys++;
      }
    }

    CosTaskAnalyticsService._sortWeeklyRows_(rows);

    return {
      metrics: {
        totalTasks: totalKeys,
        completedTasks: completed,
        firstTimeCompleted: firstTime,
        rescheduledTasks: rescheduled,
        loweredTasks: lowered,
        droppedTasks: dropped,
        p0Total: p0TotalKeys,
        p0Completed: p0Completed,
        p0FirstTimeCompleted: p0FirstTime,
        p0Rescheduled: p0Rescheduled,
        p0Lowered: p0Lowered,
        p0Dropped: p0Dropped,
      },
      rows: rows,
    };
  },

  /**
   * @param {Array<{priority:string,title:string}>} rows
   * @private
   */
  _sortWeeklyRows_: function (rows) {
    var order = { P0: 0, P1: 1, P2: 2, P3: 3, 'Follow-up': 4 };
    rows.sort(function (a, b) {
      var pa = order.hasOwnProperty(a.priority) ? order[a.priority] : 99;
      var pb = order.hasOwnProperty(b.priority) ? order[b.priority] : 99;
      if (pa !== pb) {
        return pa - pb;
      }
      return String(a.title || '')
        .toLowerCase()
        .localeCompare(String(b.title || '').toLowerCase());
    });
  },

  /**
   * @param {string} s
   * @param {number} max
   * @returns {string}
   * @private
   */
  _plainTruncate_: function (s, max) {
    var t = String(s || '');
    if (t.length <= max) {
      return t;
    }
    return t.substring(0, Math.max(0, max - 1)) + '…';
  },

  /**
   * @param {string} s
   * @returns {string}
   * @private
   */
  _htmlEscape_: function (s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /**
   * @param {Object} metrics
   * @param {Object} score
   * @param {{ weekStart: Date, weekEndExclusive: Date, tz: string }} range
   * @param {Array<{taskId:string,title:string,priority:string,weekActivity:string,currentStatus:string,rescheduleCount:string}>} rows
   * @returns {string}
   * @private
   */
  _buildWeeklyReportHtml_: function (metrics, score, range, rows) {
    var m = metrics || {};
    var s = score || CosTaskAnalyticsService.computeScore(m);
    var tz = range && range.tz ? range.tz : '';
    var startStr = Utilities.formatDate(range.weekStart, tz, 'yyyy-MM-dd');
    var endStr = Utilities.formatDate(
      new Date(range.weekEndExclusive.getTime() - 1),
      tz,
      'yyyy-MM-dd'
    );
    var pct = s.normalized100;
    var barW = Math.max(8, Math.min(100, pct));

    var statRow = function (label, value) {
      return (
        '<tr><td style="padding:10px 12px;border-bottom:1px solid #e8eaed;color:#3c4043;font-size:15px;line-height:1.4;">' +
        CosTaskAnalyticsService._htmlEscape_(label) +
        '</td><td align="right" style="padding:10px 12px;border-bottom:1px solid #e8eaed;font-weight:600;color:#202124;font-size:15px;">' +
        CosTaskAnalyticsService._htmlEscape_(String(value)) +
        '</td></tr>'
      );
    };

    var html = [];
    html.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
    html.push(
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
    );
    html.push('<title>Weekly performance</title>');
    html.push(
      '<style type="text/css">@media only screen and (max-width:520px){.cos-wk-task{min-width:100%!important;display:block!important;}.cos-wk-wrap{padding:12px 8px!important;}}</style>'
    );
    html.push('</head>');
    html.push(
      '<body style="margin:0;padding:0;background-color:#f1f3f4;-webkit-text-size-adjust:100%;">'
    );
    html.push(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f3f4;">'
    );
    html.push('<tr><td class="cos-wk-wrap" style="padding:16px 12px;">');
    html.push(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(60,64,67,0.15);">'
    );

    html.push(
      '<tr><td style="background:linear-gradient(135deg,#1a5f4a 0%,#2d8a6e 100%);padding:20px 20px 18px;">'
    );
    html.push(
      '<div style="font-family:Georgia,\'Segoe UI\',Roboto,sans-serif;font-size:20px;font-weight:600;color:#ffffff;line-height:1.3;">' +
        CosTaskAnalyticsService._htmlEscape_(CosConstants.PRODUCT_NAME) +
        '</div>'
    );
    html.push(
      '<div style="font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.9);margin-top:6px;">Weekly task performance</div>'
    );
    html.push(
      '<div style="font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.85);margin-top:10px;">' +
        CosTaskAnalyticsService._htmlEscape_(startStr) +
        ' → ' +
        CosTaskAnalyticsService._htmlEscape_(endStr) +
        '<br><span style="opacity:0.9;">' +
        CosTaskAnalyticsService._htmlEscape_(tz) +
        '</span></div>'
    );
    html.push('</td></tr>');

    html.push('<tr><td style="padding:20px 20px 8px;">');
    html.push(
      '<div style="font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#5f6368;margin-bottom:8px;">Score</div>'
    );
    html.push(
      '<div style="font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:32px;font-weight:700;color:#202124;line-height:1.1;">' +
        CosTaskAnalyticsService._htmlEscape_(String(s.totalOutOf80)) +
        '<span style="font-size:18px;font-weight:500;color:#5f6368;">/80</span> <span style="font-size:16px;color:#5f6368;">(' +
        CosTaskAnalyticsService._htmlEscape_(String(pct)) +
        '/100)</span></div>'
    );
    html.push(
      '<div style="height:8px;background:#e8eaed;border-radius:4px;margin-top:14px;overflow:hidden;">'
    );
    html.push(
      '<div style="height:8px;width:' +
        barW +
        '%;max-width:100%;background:linear-gradient(90deg,#2d8a6e,#5cb896);border-radius:4px;"></div>'
    );
    html.push('</div>');
    html.push(
      '<div style="font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#5f6368;margin-top:14px;line-height:1.5;">'
    );
    html.push(
      'P0 execution (50 max): <strong style="color:#202124;">~' +
        CosTaskAnalyticsService._htmlEscape_(String(s.p0ExecutionPoints)) +
        '</strong><br>'
    );
    html.push(
      'First-time completion (30 max): <strong style="color:#202124;">~' +
        CosTaskAnalyticsService._htmlEscape_(String(s.firstTimePoints)) +
        '</strong><br>'
    );
    html.push(
      'Drop penalty: <strong style="color:#c5221f;">−' +
        CosTaskAnalyticsService._htmlEscape_(String(s.dropPenalty)) +
        '</strong>'
    );
    html.push('</div>');
    html.push('</td></tr>');

    html.push(
      '<tr><td style="padding:0 20px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
    );
    html.push(
      '<tr><td colspan="2" style="padding:12px 0 8px;font-size:13px;font-weight:600;color:#202124;border-bottom:2px solid #e8eaed;">All priorities</td></tr>'
    );
    html.push(statRow('Tasks in scope', m.totalTasks || 0));
    html.push(statRow('Completed', m.completedTasks || 0));
    html.push(
      statRow('First-time completed', m.firstTimeCompleted || 0)
    );
    html.push(statRow('Rescheduled (closure)', m.rescheduledTasks || 0));
    html.push(statRow('Lowered priority', m.loweredTasks || 0));
    html.push(statRow('Dropped', m.droppedTasks || 0));
    html.push(
      '<tr><td colspan="2" style="padding:16px 0 8px;font-size:13px;font-weight:600;color:#202124;border-bottom:2px solid #e8eaed;">P0 only</td></tr>'
    );
    html.push(statRow('In scope', m.p0Total || 0));
    html.push(statRow('Completed', m.p0Completed || 0));
    html.push(statRow('First-time completed', m.p0FirstTimeCompleted || 0));
    html.push(statRow('Rescheduled', m.p0Rescheduled || 0));
    html.push(statRow('Lowered', m.p0Lowered || 0));
    html.push(statRow('Dropped', m.p0Dropped || 0));
    html.push('</table></td></tr>');

    html.push(
      '<tr><td style="padding:16px 20px 20px;font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#5f6368;line-height:1.5;border-top:1px solid #e8eaed;">'
    );
    html.push(
      '<strong style="color:#202124;">Note:</strong> “In scope” means a completion, drop, reschedule, or lower was recorded in this window (via Updated At / Completed At). Legacy rows use Last Outcome when analytics columns are empty.'
    );
    html.push('</td></tr>');

    html.push(
      '<tr><td style="padding:0 20px 24px;font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
    );
    html.push(
      '<div style="font-size:14px;font-weight:600;color:#202124;margin-bottom:12px;">Task breakdown</div>'
    );
    if (!rows || !rows.length) {
      html.push(
        '<p style="margin:0;font-size:14px;color:#5f6368;">No tasks in this window.</p>'
      );
    } else {
      html.push(
        '<div class="cos-wk-task" style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #e8eaed;border-radius:8px;">'
      );
      html.push(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:520px;font-size:14px;">'
      );
      html.push(
        '<thead><tr style="background:#f8f9fa;"><th align="left" style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Task</th><th align="left" style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Pri</th><th align="left" style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">This week</th><th align="left" style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Now</th><th align="center" style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">#RS</th></tr></thead><tbody>'
      );
      var ri;
      for (ri = 0; ri < rows.length; ri++) {
        var rw = rows[ri];
        var bg = ri % 2 === 0 ? '#ffffff' : '#fafafa';
        var title = CosTaskAnalyticsService._htmlEscape_(
          CosTaskAnalyticsService._plainTruncate_(rw.title, 90)
        );
        html.push(
          '<tr style="background:' +
            bg +
            ';"><td style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#202124;word-break:break-word;max-width:220px;line-height:1.35;">' +
            title +
            '</td><td style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#3c4043;white-space:nowrap;">' +
            CosTaskAnalyticsService._htmlEscape_(rw.priority || '') +
            '</td><td style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#3c4043;line-height:1.35;">' +
            CosTaskAnalyticsService._htmlEscape_(rw.weekActivity || '') +
            '</td><td style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#3c4043;white-space:nowrap;">' +
            CosTaskAnalyticsService._htmlEscape_(rw.currentStatus || '') +
            '</td><td align="center" style="padding:10px 8px;border-bottom:1px solid #e8eaed;color:#3c4043;">' +
            CosTaskAnalyticsService._htmlEscape_(rw.rescheduleCount || '0') +
            '</td></tr>'
        );
      }
      html.push('</tbody></table></div>');
    }
    html.push('</td></tr>');

    html.push('</table>');
    html.push(
      '<div style="max-width:600px;margin:12px auto 0;font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#80868b;text-align:center;line-height:1.4;">' +
        CosTaskAnalyticsService._htmlEscape_(CosConstants.PRODUCT_NAME) +
        ' · Plain-text version included for clients that hide HTML.</div>'
    );
    html.push('</td></tr></table></body></html>');

    return html.join('');
  },
};
