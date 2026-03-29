/**
 * Phase 5: email summary of Tasks (scheduled today, pending, follow-ups, deadlines).
 */
var CosDailyDigestService = {
  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @param {{ force?: boolean, skipIdempotency?: boolean }} [opts]
   * force=true sends even when DAILY_DIGEST_ENABLED is false (menu test).
   * skipIdempotency=true allows multiple sends the same calendar day (menu test).
   * @returns {{ ok: boolean, message?: string, skipped?: boolean, reason?: string }}
   */
  sendDigestEmail: function (optSs, opts) {
    var force = opts && opts.force === true;
    var skipIdemp = opts && opts.skipIdempotency === true;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      CosLogger.warn('sendDigestEmail: script lock timeout');
      return { ok: false, message: 'Lock timeout' };
    }
    try {
      var settings = new CosSettingsRepository().getSettings();
      if (!force && !settings.dailyDigestEnabled) {
        CosLogger.info('sendDigestEmail: DAILY_DIGEST_ENABLED is false');
        return { ok: true, skipped: true, reason: 'digest_disabled' };
      }

      var ss = optSs || CosBootstrap.getSpreadsheetForRun();
      if (!ss) {
        return { ok: false, message: 'No spreadsheet (open the bound Sheet or run Install).' };
      }

      var tz =
        String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
      var now = new Date();
      var dayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

      if (!force && !skipIdemp) {
        var last = PropertiesService.getScriptProperties().getProperty(
          CosConstants.PROP_KEYS.DAILY_DIGEST_LAST_SENT_DATE
        );
        if (last === dayKey) {
          CosLogger.info('sendDigestEmail: already sent today', { dayKey: dayKey });
          return { ok: true, skipped: true, reason: 'already_sent_today' };
        }
      }

      var to = String(settings.userEmail || '').trim();
      if (!to) {
        to = String(Session.getActiveUser().getEmail() || '').trim();
      }
      if (!to) {
        return { ok: false, message: 'No recipient email (USER_EMAIL / active user).' };
      }

      var taskRepo = new CosTaskRepository(ss);
      var tasks = taskRepo.fetchAllTasks();
      var bundle = CosDailyDigestService._categorizeTasks_(tasks, now, tz);

      var mapOverdue = CosDigestAiService.buildFollowUpContextMap(
        bundle.followUpOverdue,
        settings,
        { overdue: true }
      );
      var mapWaiting = CosDigestAiService.buildFollowUpContextMap(
        bundle.followUpWaiting,
        settings,
        { overdue: false }
      );
      /** @type {Object<string, { line: string, source: string }>} */
      var snippetMap = {};
      var mk;
      for (mk in mapOverdue) {
        if (Object.prototype.hasOwnProperty.call(mapOverdue, mk)) {
          snippetMap[mk] = mapOverdue[mk];
        }
      }
      for (mk in mapWaiting) {
        if (Object.prototype.hasOwnProperty.call(mapWaiting, mk)) {
          snippetMap[mk] = mapWaiting[mk];
        }
      }

      var subject =
        '[' +
        CosConstants.PRODUCT_NAME +
        '] Daily digest — ' +
        Utilities.formatDate(now, tz, 'EEE, MMM d, yyyy');
      var plain = CosDailyDigestService._buildPlain_(bundle, tz, dayKey, snippetMap);
      var html = CosDailyDigestService._buildHtml_(bundle, tz, dayKey, now, snippetMap);

      GmailApp.sendEmail(to, subject, plain, {
        htmlBody: html,
        name: CosConstants.PRODUCT_NAME,
      });

      if (!skipIdemp) {
        PropertiesService.getScriptProperties().setProperty(
          CosConstants.PROP_KEYS.DAILY_DIGEST_LAST_SENT_DATE,
          dayKey
        );
      }

      CosLogger.info('sendDigestEmail: sent', { to: to, dayKey: dayKey });
      return { ok: true };
    } catch (e) {
      CosLogger.error('sendDigestEmail failed', { error: String(e) });
      return { ok: false, message: String(e.message || e) };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {CosTask[]} tasks
   * @param {Date} now
   * @param {string} tz
   * @private
   */
  _categorizeTasks_: function (tasks, now, tz) {
    /** @type {CosTask[]} */
    var scheduledToday = [];
    /** @type {CosTask[]} */
    var pending = [];
    /** @type {CosTask[]} */
    var followUpOverdue = [];
    /** @type {CosTask[]} */
    var followUpWaiting = [];
    /** @type {CosTask[]} */
    var dueToday = [];
    /** @type {CosTask[]} */
    var overdue = [];
    /** @type {CosTask[]} */
    var scheduledJeevesWeek = [];

    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var weekEndMs =
      now.getTime() +
      (CosConstants.DIGEST_JEEVES_WEEK_DAYS - 1) * 24 * 60 * 60 * 1000;
    var weekEndKey = Utilities.formatDate(new Date(weekEndMs), tz, 'yyyy-MM-dd');

    var fu = CosConstants.TASK_PRIORITY.FOLLOW_UP;
    var overdueH = CosConstants.FOLLOW_UP_DIGEST_OVERDUE_HOURS;
    var overdueMs = overdueH * 3600000;
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var st = String(t.status || '').trim();
      if (st === CosConstants.TASK_STATUS.DONE) {
        continue;
      }
      if (st === CosConstants.TASK_STATUS.PAUSED) {
        continue;
      }

      if (st === CosConstants.TASK_STATUS.SCHEDULED) {
        var sStart = CosDailyDigestService._parseIso_(t.scheduledStart);
        if (sStart && CosDailyDigestService._sameCalendarDay_(sStart, now, tz)) {
          scheduledToday.push(t);
        }
        var calId = String(t.calendarEventId || '').trim();
        if (sStart && calId) {
          var pr = String(t.priority || '').trim();
          var weekPri =
            pr === CosConstants.TASK_PRIORITY.P0 ||
            pr === CosConstants.TASK_PRIORITY.P1 ||
            pr === CosConstants.TASK_PRIORITY.P2;
          var sk = Utilities.formatDate(sStart, tz, 'yyyy-MM-dd');
          if (
            weekPri &&
            sk >= todayKey &&
            sk <= weekEndKey &&
            !CosDailyDigestService._sameCalendarDay_(sStart, now, tz)
          ) {
            scheduledJeevesWeek.push(t);
          }
        }
      }
      if (st === CosConstants.TASK_STATUS.PENDING) {
        if (String(t.priority || '').trim() !== fu) {
          pending.push(t);
        }
      }
      if (
        String(t.priority || '').trim() === fu &&
        st === CosConstants.TASK_STATUS.PENDING
      ) {
        var cAt = CosDailyDigestService._parseIso_(t.createdAt);
        if (cAt && now.getTime() - cAt.getTime() > overdueMs) {
          followUpOverdue.push(t);
        } else {
          followUpWaiting.push(t);
        }
      }

      var dl = CosTaskSchedulerService._parseDeadline_(t.deadline);
      if (dl) {
        var dlKey = Utilities.formatDate(dl, tz, 'yyyy-MM-dd');
        var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
        if (dlKey === todayKey) {
          dueToday.push(t);
        } else if (dlKey < todayKey) {
          overdue.push(t);
        }
      }
    }

    scheduledToday.sort(CosDailyDigestService._cmpScheduledStart_);
    scheduledJeevesWeek.sort(CosDailyDigestService._cmpScheduledJeevesWeek_);
    pending.sort(CosDailyDigestService._cmpPriorityThenTitle_);
    followUpOverdue.sort(CosDailyDigestService._cmpCreatedAsc_);
    followUpWaiting.sort(CosDailyDigestService._cmpCreatedAsc_);
    dueToday.sort(CosDailyDigestService._cmpDeadline_);
    overdue.sort(CosDailyDigestService._cmpDeadline_);

    return {
      scheduledToday: scheduledToday,
      scheduledJeevesWeek: scheduledJeevesWeek,
      pending: pending,
      followUpOverdue: followUpOverdue,
      followUpWaiting: followUpWaiting,
      dueToday: dueToday,
      overdue: overdue,
    };
  },

  /**
   * Digest-only priority rank: P0, P1, P2, then other priorities.
   * @param {string} priority
   * @returns {number}
   * @private
   */
  _digestWeekPriorityRank_: function (priority) {
    var s = String(priority || '').trim();
    if (s === CosConstants.TASK_PRIORITY.P0) {
      return 0;
    }
    if (s === CosConstants.TASK_PRIORITY.P1) {
      return 1;
    }
    if (s === CosConstants.TASK_PRIORITY.P2) {
      return 2;
    }
    if (s === CosConstants.TASK_PRIORITY.P3) {
      return 3;
    }
    if (s === CosConstants.TASK_PRIORITY.FOLLOW_UP) {
      return 4;
    }
    return 50;
  },

  /**
   * @param {CosTask} a
   * @param {CosTask} b
   * @returns {number}
   * @private
   */
  _cmpScheduledJeevesWeek_: function (a, b) {
    var ra = CosDailyDigestService._digestWeekPriorityRank_(a.priority);
    var rb = CosDailyDigestService._digestWeekPriorityRank_(b.priority);
    if (ra !== rb) {
      return ra - rb;
    }
    return CosDailyDigestService._cmpScheduledStart_(a, b);
  },

  /**
   * @param {CosTask} a
   * @param {CosTask} b
   * @returns {number}
   * @private
   */
  _cmpCreatedAsc_: function (a, b) {
    var da = CosDailyDigestService._parseIso_(a.createdAt);
    var db = CosDailyDigestService._parseIso_(b.createdAt);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (ta !== tb) {
      return ta - tb;
    }
    return String(a.task).localeCompare(String(b.task));
  },

  /**
   * @param {string} raw
   * @returns {Date|null}
   * @private
   */
  _parseIso_: function (raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    var d = new Date(String(raw).trim());
    return isNaN(d.getTime()) ? null : d;
  },

  /**
   * @param {Date} a
   * @param {Date} b
   * @param {string} tz
   * @returns {boolean}
   * @private
   */
  _sameCalendarDay_: function (a, b, tz) {
    return (
      Utilities.formatDate(a, tz, 'yyyy-MM-dd') ===
      Utilities.formatDate(b, tz, 'yyyy-MM-dd')
    );
  },

  /**
   * @param {CosTask} a
   * @param {CosTask} b
   * @returns {number}
   * @private
   */
  _cmpScheduledStart_: function (a, b) {
    var da = CosDailyDigestService._parseIso_(a.scheduledStart);
    var db = CosDailyDigestService._parseIso_(b.scheduledStart);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (ta !== tb) {
      return ta - tb;
    }
    return String(a.task).localeCompare(String(b.task));
  },

  /**
   * @param {CosTask} a
   * @param {CosTask} b
   * @returns {number}
   * @private
   */
  _cmpPriorityThenTitle_: function (a, b) {
    var ra = CosTaskSchedulerService._priorityRank_(a.priority);
    var rb = CosTaskSchedulerService._priorityRank_(b.priority);
    if (ra !== rb) {
      return ra - rb;
    }
    return String(a.task).localeCompare(String(b.task));
  },

  /**
   * @param {CosTask} a
   * @param {CosTask} b
   * @returns {number}
   * @private
   */
  _cmpDeadline_: function (a, b) {
    var da = CosTaskSchedulerService._parseDeadline_(a.deadline);
    var db = CosTaskSchedulerService._parseDeadline_(b.deadline);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    return ta - tb;
  },

  /**
   * @param {Object} bundle
   * @param {string} tz
   * @param {string} dayKey
   * @param {Object<string, { line: string, source: string }>} snippetMap
   * @returns {string}
   * @private
   */
  _buildPlain_: function (bundle, tz, dayKey, snippetMap) {
    var lines = [];
    lines.push('Daily digest for ' + dayKey + ' (' + tz + ').');
    lines.push('');
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Scheduled today',
      bundle.scheduledToday,
      function (t) {
        var s = CosDailyDigestService._parseIso_(t.scheduledStart);
        var e = CosDailyDigestService._parseIso_(t.scheduledEnd);
        var ts = s
          ? Utilities.formatDate(s, tz, 'HH:mm')
          : '?';
        var te = e ? Utilities.formatDate(e, tz, 'HH:mm') : '';
        return (
          '• ' +
          ts +
          (te ? '–' + te : '') +
          '  ' +
          t.task +
          '  [' +
          t.priority +
          ', ' +
          t.durationMin +
          'm]'
        );
      },
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Scheduled by Jeeves — P0 / P1 / P2 (rest of week, excludes today)',
      bundle.scheduledJeevesWeek,
      function (t) {
        return CosDailyDigestService._lineScheduledJeevesWeek_(t, tz);
      },
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Follow-up — overdue (>' +
        CosConstants.FOLLOW_UP_DIGEST_OVERDUE_HOURS +
        'h since created; not on calendar)',
      bundle.followUpOverdue,
      function (t) {
        return CosDailyDigestService._lineFollowUp_(t, tz, snippetMap);
      },
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Follow-up — waiting (within ' +
        CosConstants.FOLLOW_UP_DIGEST_OVERDUE_HOURS +
        'h)',
      bundle.followUpWaiting,
      function (t) {
        return CosDailyDigestService._lineFollowUp_(t, tz, snippetMap);
      },
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Pending (calendar candidates only)',
      bundle.pending,
      CosDailyDigestService._lineTask_,
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Due today (deadline)',
      bundle.dueToday,
      CosDailyDigestService._lineTaskDeadline_,
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Overdue (deadline)',
      bundle.overdue,
      CosDailyDigestService._lineTaskDeadline_,
      true
    );
    lines.push('');
    lines.push(
      'Follow-up lines: from Notes when present; with digest AI on, they may be model-assisted.'
    );
    lines.push('— ' + CosConstants.PRODUCT_NAME);
    return lines.join('\n');
  },

  /**
   * @param {CosTask} t
   * @param {string} tz
   * @returns {string}
   * @private
   */
  _lineScheduledJeevesWeek_: function (t, tz) {
    var s = CosDailyDigestService._parseIso_(t.scheduledStart);
    var e = CosDailyDigestService._parseIso_(t.scheduledEnd);
    var when = '';
    if (s) {
      when =
        Utilities.formatDate(s, tz, 'EEE MMM d') +
        ' ' +
        Utilities.formatDate(s, tz, 'HH:mm');
      if (e) {
        when += '–' + Utilities.formatDate(e, tz, 'HH:mm');
      }
      when += '  ';
    }
    return (
      '• ' +
      when +
      t.task +
      '  [' +
      t.priority +
      ', ' +
      t.durationMin +
      'm]'
    );
  },

  /**
   * @param {CosTask} t
   * @returns {string}
   * @private
   */
  /**
   * @param {CosTask} t
   * @param {string} tz
   * @returns {string}
   * @private
   */
  _htmlScheduledJeevesWeekRow_: function (t, tz) {
    var s = CosDailyDigestService._parseIso_(t.scheduledStart);
    var e = CosDailyDigestService._parseIso_(t.scheduledEnd);
    var dayTime = '';
    if (s) {
      dayTime =
        '<span style="color:#5f6368;font-size:13px;">' +
        CosDailyDigestService._esc_(Utilities.formatDate(s, tz, 'EEE MMM d')) +
        ' · ' +
        CosDailyDigestService._esc_(Utilities.formatDate(s, tz, 'HH:mm'));
      if (e) {
        dayTime +=
          '–' +
          CosDailyDigestService._esc_(Utilities.formatDate(e, tz, 'HH:mm'));
      }
      dayTime += '</span> ';
    }
    return (
      dayTime +
      '<b style="color:#202124;">' +
      CosDailyDigestService._esc_(t.task) +
      '</b> <span style="color:#5f6368;font-size:13px;">[' +
      CosDailyDigestService._esc_(t.priority) +
      ', ' +
      CosDailyDigestService._esc_(t.durationMin) +
      'm]</span>'
    );
  },

  _lineTask_: function (t) {
    return (
      '• ' +
      t.task +
      '  [' +
      t.status +
      ', ' +
      t.priority +
      ', ' +
      t.durationMin +
      'm]'
    );
  },

  /**
   * @param {CosTask} t
   * @param {string} tz
   * @param {Object<string, { line: string, source: string }>} snippetMap
   * @returns {string}
   * @private
   */
  _lineFollowUp_: function (t, tz, snippetMap) {
    var meta = CosDailyDigestService._followUpMetaLine_(t, tz);
    var id = String(t.taskId || '').trim();
    var ctx = id && snippetMap[id] ? snippetMap[id] : null;
    var line = ctx && ctx.line ? ctx.line : '';
    var base = '• ' + t.task + (meta ? '\n  ' + meta : '');
    if (line) {
      return base + '\n  ' + line;
    }
    return base;
  },

  /**
   * Meta line for follow-ups: only includes date/age when parseable (no placeholders).
   * @param {CosTask} t
   * @param {string} tz
   * @returns {string}
   * @private
   */
  _followUpMetaLine_: function (t, tz) {
    var c = CosDailyDigestService._parseIso_(t.createdAt);
    if (!c || isNaN(c.getTime())) {
      c = CosDailyDigestService._parseIso_(t.updatedAt);
    }
    var parts = [];
    if (c && !isNaN(c.getTime())) {
      parts.push(Utilities.formatDate(c, tz, 'MMM d, h:mm a'));
      var h = Math.floor((new Date().getTime() - c.getTime()) / 3600000);
      if (h >= 0) {
        parts.push('~' + h + 'h ago');
      }
    }
    var st = String(t.status || '').trim();
    if (st) {
      parts.push(st);
    }
    return parts.join(' · ');
  },

  /**
   * @param {CosTask} t
   * @param {string} tz
   * @param {Object<string, { line: string, source: string }>} snippetMap
   * @returns {string}
   * @private
   */
  _htmlFollowUpBlock_: function (t, tz, snippetMap) {
    var meta = CosDailyDigestService._followUpMetaLine_(t, tz);
    var id = String(t.taskId || '').trim();
    var ctx = id && snippetMap[id] ? snippetMap[id] : null;
    var line = ctx && ctx.line ? ctx.line : '';
    var parts = [];
    parts.push(
      '<div style="font:600 16px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#202124;">' +
        CosDailyDigestService._esc_(t.task) +
        '</div>'
    );
    if (meta) {
      parts.push(
        '<div style="font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#5f6368;margin:4px 0 0;">' +
          CosDailyDigestService._esc_(meta) +
          '</div>'
      );
    }
    if (line) {
      parts.push(
        '<div style="font:12px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#5f6368;margin:8px 0 0;padding:6px 10px;background:#f8f9fa;border-radius:6px;border-left:3px solid #1a73e8;">' +
          CosDailyDigestService._esc_(line) +
        '</div>'
      );
    }
    return parts.join('');
  },

  /**
   * @param {CosTask} t
   * @returns {string}
   * @private
   */
  _lineTaskDeadline_: function (t) {
    return (
      '• ' +
      t.task +
      '  (deadline: ' +
      t.deadline +
      ')  [' +
      t.status +
      ']'
    );
  },

  /**
   * @param {string[]} lines
   * @param {string} title
   * @param {CosTask[]} items
   * @param {function(CosTask): string} fmt
   * @param {boolean=} skipIfEmpty omit section when empty (mobile-friendly digest)
   * @private
   */
  _appendPlainSection_: function (lines, title, items, fmt, skipIfEmpty) {
    if (skipIfEmpty && (!items || !items.length)) {
      return;
    }
    lines.push('== ' + title + ' ==');
    if (!items.length) {
      lines.push('(none)');
    } else {
      var i;
      for (i = 0; i < items.length; i++) {
        lines.push(fmt(items[i]));
      }
    }
    lines.push('');
  },

  /**
   * @param {Object} bundle
   * @param {string} tz
   * @param {string} dayKey
   * @param {Date} now
   * @param {Object<string, { line: string, source: string }>} snippetMap
   * @returns {string}
   * @private
   */
  _buildHtml_: function (bundle, tz, dayKey, now, snippetMap) {
    var pre = CosDailyDigestService._preheaderSummary_(bundle);
    var headDate = Utilities.formatDate(now, tz, 'EEE, MMM d, yyyy');
    var parts = [];
    parts.push(
      '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' +
        CosDailyDigestService._esc_(pre) +
        '</div>'
    );
    parts.push(
      '<div style="margin:0;padding:0;background:#e8eaed;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' +
        '<tr><td align="center" style="padding:20px 12px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;border-collapse:collapse;">' +
        '<tr><td style="padding:0 0 4px;">'
    );
    parts.push(
      '<p style="margin:0 0 18px;font:16px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#202124;">' +
        '<span style="font-weight:600;">Daily digest</span><br/>' +
        '<span style="font-size:14px;font-weight:400;color:#5f6368;line-height:1.55;">' +
        CosDailyDigestService._esc_(headDate) +
        ' · ' +
        CosDailyDigestService._esc_(tz) +
        (pre && pre !== 'No open items in these sections — nice.'
          ? '<br/><span style="display:inline-block;margin-top:8px;padding:3px 11px;background:#fff3e0;border-radius:999px;font-size:12px;font-weight:500;color:#5f3600;max-width:100%;box-sizing:border-box;">' +
            CosDailyDigestService._esc_(pre) +
            '</span>'
          : '') +
        '</span></p>'
    );

    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Scheduled today',
      bundle.scheduledToday,
      function (t) {
        var s = CosDailyDigestService._parseIso_(t.scheduledStart);
        var e = CosDailyDigestService._parseIso_(t.scheduledEnd);
        var ts = s
          ? Utilities.formatDate(s, tz, 'HH:mm')
          : '?';
        var te = e ? Utilities.formatDate(e, tz, 'HH:mm') : '';
        return (
          CosDailyDigestService._esc_(ts + (te ? '–' + te : '')) +
          ' — <b style="color:#202124;">' +
          CosDailyDigestService._esc_(t.task) +
          '</b> <span style="color:#5f6368;font-size:13px;">[' +
          CosDailyDigestService._esc_(t.priority) +
          ', ' +
          CosDailyDigestService._esc_(t.durationMin) +
          'm]</span>'
        );
      },
      { titleColor: '#1a73e8' }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Scheduled by Jeeves (next 7 days)',
      bundle.scheduledJeevesWeek,
      function (t) {
        return CosDailyDigestService._htmlScheduledJeevesWeekRow_(t, tz);
      },
      {
        titleColor: '#1967d2',
        subtitle:
          'P0, P1, P2 only · from tomorrow through the 7-day window · sorted by priority then start time',
      }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Follow-up — overdue (>' +
        CosConstants.FOLLOW_UP_DIGEST_OVERDUE_HOURS +
        'h)',
      bundle.followUpOverdue,
      function (t) {
        return CosDailyDigestService._htmlFollowUpBlock_(t, tz, snippetMap);
      },
      { titleColor: '#c5221f', itemGap: true }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Follow-up — waiting (within ' +
        CosConstants.FOLLOW_UP_DIGEST_OVERDUE_HOURS +
        'h)',
      bundle.followUpWaiting,
      function (t) {
        return CosDailyDigestService._htmlFollowUpBlock_(t, tz, snippetMap);
      },
      { titleColor: '#188038', itemGap: true }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Pending (calendar)',
      bundle.pending,
      function (t) {
        return (
          '<b style="color:#202124;">' +
          CosDailyDigestService._esc_(t.task) +
          '</b> <span style="color:#5f6368;font-size:13px;">[' +
          CosDailyDigestService._esc_(t.status) +
          ', ' +
          CosDailyDigestService._esc_(t.priority) +
          ', ' +
          CosDailyDigestService._esc_(t.durationMin) +
          'm]</span>'
        );
      },
      { titleColor: '#202124' }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Due today (deadline)',
      bundle.dueToday,
      function (t) {
        return (
          '<b style="color:#202124;">' +
          CosDailyDigestService._esc_(t.task) +
          '</b> <span style="color:#5f6368;font-size:13px;">(deadline: ' +
          CosDailyDigestService._esc_(t.deadline) +
          ') [' +
          CosDailyDigestService._esc_(t.status) +
          ']</span>'
        );
      },
      { titleColor: '#e37400' }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Overdue (deadline)',
      bundle.overdue,
      function (t) {
        return (
          '<b style="color:#202124;">' +
          CosDailyDigestService._esc_(t.task) +
          '</b> <span style="color:#5f6368;font-size:13px;">(deadline: ' +
          CosDailyDigestService._esc_(t.deadline) +
          ') [' +
          CosDailyDigestService._esc_(t.status) +
          ']</span>'
        );
      },
      { titleColor: '#c5221f' }
    );

    parts.push(
      '<p style="margin:18px 12px 0;font:11px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#9aa0a6;text-align:center;">' +
        'Follow-up lines use your Notes when present; with digest AI on, they may be model-assisted. Treat as hints, not quotes.' +
        '</p>'
    );
    parts.push(
      '<p style="margin:12px 0 0;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#80868b;text-align:center;">' +
        CosDailyDigestService._esc_(CosConstants.PRODUCT_NAME) +
        '</p>'
    );
    parts.push('</td></tr></table></td></tr></table></div>');
    return parts.join('');
  },

  /**
   * @param {Object} bundle
   * @returns {string}
   * @private
   */
  _preheaderSummary_: function (bundle) {
    var bits = [];
    if (bundle.scheduledToday.length) {
      bits.push(
        bundle.scheduledToday.length +
          ' on calendar today'
      );
    }
    if (bundle.scheduledJeevesWeek.length) {
      bits.push(
        bundle.scheduledJeevesWeek.length +
          ' later this week (Jeeves)'
      );
    }
    var fu =
      bundle.followUpOverdue.length + bundle.followUpWaiting.length;
    if (fu) {
      bits.push(fu + ' follow-up' + (fu === 1 ? '' : 's'));
    }
    if (bundle.pending.length) {
      bits.push(bundle.pending.length + ' pending');
    }
    if (bundle.dueToday.length) {
      bits.push(bundle.dueToday.length + ' due today');
    }
    if (bundle.overdue.length) {
      bits.push(bundle.overdue.length + ' overdue (deadline)');
    }
    if (!bits.length) {
      return 'No open items in these sections — nice.';
    }
    return bits.join(' · ');
  },

  /**
   * @param {string[]} parts
   * @param {string} title
   * @param {CosTask[]} items
   * @param {function(CosTask): string} fmt
   * @param {{ titleColor?: string, itemGap?: boolean }} [optStyle]
   * @private
   */
  _appendHtmlCardSection_: function (parts, title, items, fmt, optStyle) {
    if (!items || !items.length) {
      return;
    }
    var titleColor =
      optStyle && optStyle.titleColor ? optStyle.titleColor : '#202124';
    var gap = optStyle && optStyle.itemGap;
    var sub =
      optStyle && optStyle.subtitle
        ? '<p style="margin:0 0 12px;font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#5f6368;">' +
          CosDailyDigestService._esc_(optStyle.subtitle) +
          '</p>'
        : '';
    parts.push(
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border-collapse:collapse;">' +
        '<tr><td style="background:#ffffff;border:1px solid #dadce0;border-radius:12px;padding:16px 18px;">' +
        '<p style="margin:0 0 ' +
        (sub ? '4' : '12') +
        'px;font:700 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:' +
        titleColor +
        ';">' +
        CosDailyDigestService._esc_(title) +
        '</p>' +
        sub
    );
    if (gap) {
      var i;
      for (i = 0; i < items.length; i++) {
        var pad = i > 0 ? 'padding-top:14px;margin-top:14px;border-top:1px solid #f1f3f4;' : '';
        parts.push(
          '<div style="' + pad + '">' + fmt(items[i]) + '</div>'
        );
      }
    } else {
      parts.push(
        '<ul style="margin:0;padding:0 0 0 18px;font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#3c4043;">'
      );
      var j;
      for (j = 0; j < items.length; j++) {
        parts.push(
          '<li style="margin:8px 0;">' + fmt(items[j]) + '</li>'
        );
      }
      parts.push('</ul>');
    }
    parts.push('</td></tr></table>');
  },

  /**
   * @param {string} s
   * @returns {string}
   * @private
   */
  _esc_: function (s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
