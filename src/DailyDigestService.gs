/**
 * Phase 5: email summary of Tasks (scheduled today, pending, follow-ups).
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
      var yesterdayYmd = cos_ymdAddCalendarDays_(dayKey, -1, tz);
      var abandoned = CosDailyDigestService._buildAbandonedPlanDigest_(
        tasks,
        tz,
        yesterdayYmd,
        ss
      );

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
      var plain = CosDailyDigestService._buildPlain_(
        bundle,
        tz,
        dayKey,
        snippetMap,
        settings,
        abandoned
      );
      var html = CosDailyDigestService._buildHtml_(
        bundle,
        tz,
        dayKey,
        now,
        snippetMap,
        settings,
        abandoned
      );

      GmailApp.sendEmail(to, subject, plain, {
        htmlBody: html,
        name: CosConstants.ASSISTANT_EMAIL_DISPLAY_NAME,
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
    /** @type {CosTask[]} */
    var awaitingClosure = [];

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
      if (st === CosConstants.TASK_STATUS.DROPPED) {
        continue;
      }
      if (st === CosConstants.TASK_STATUS.PAUSED) {
        continue;
      }

      if (st === CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
        awaitingClosure.push(t);
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
    awaitingClosure.sort(CosDailyDigestService._cmpClosureRequested_);
    pending.sort(CosDailyDigestService._cmpPriorityThenTitle_);
    followUpOverdue.sort(CosDailyDigestService._cmpCreatedAsc_);
    followUpWaiting.sort(CosDailyDigestService._cmpCreatedAsc_);
    dueToday.sort(CosDailyDigestService._cmpDeadline_);
    overdue.sort(CosDailyDigestService._cmpDeadline_);

    return {
      scheduledToday: scheduledToday,
      scheduledJeevesWeek: scheduledJeevesWeek,
      awaitingClosure: awaitingClosure,
      pending: pending,
      followUpOverdue: followUpOverdue,
      followUpWaiting: followUpWaiting,
      dueToday: dueToday,
      overdue: overdue,
    };
  },

  /**
   * @param {CosTask} a
   * @param {CosTask} b
   * @returns {number}
   * @private
   */
  _cmpClosureRequested_: function (a, b) {
    var da = CosDailyDigestService._parseIso_(a.closureRequestedAt);
    var db = CosDailyDigestService._parseIso_(b.closureRequestedAt);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (ta !== tb) {
      return ta - tb;
    }
    return String(a.task).localeCompare(String(b.task));
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
   * @param {Date} oStart
   * @param {Date} oEnd
   * @param {string} ymd yyyy-MM-dd
   * @param {string} tz
   * @returns {boolean}
   * @private
   */
  _originalWindowOverlapsYmd_: function (oStart, oEnd, ymd, tz) {
    if (!oStart || !oEnd || isNaN(oStart.getTime()) || isNaN(oEnd.getTime())) {
      return false;
    }
    var os = Utilities.formatDate(oStart, tz, 'yyyy-MM-dd');
    var oe = Utilities.formatDate(oEnd, tz, 'yyyy-MM-dd');
    return String(ymd) >= os && String(ymd) <= oe;
  },

  /**
   * Tail scan of RAW_TIMING_ACTIVITY for one calendar day (window_start_ymd).
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} ymd
   * @returns {{ rows: { proj: string, details: string, line: string, indent: number }[] }}
   * @private
   */
  _loadActivityRowsForYmd_: function (ss, ymd) {
    var empty = { rows: [] };
    var sh = ss.getSheetByName(CosTimingConstants.RAW_ACTIVITY_SHEET_NAME);
    if (!sh) {
      return empty;
    }
    var last = sh.getLastRow();
    if (last < CosTimingConstants.FIRST_DATA_ROW) {
      return empty;
    }
    var width = CosTimingConstants.ACTIVITY_HEADERS.length;
    var numData = last - CosTimingConstants.FIRST_DATA_ROW + 1;
    var cap = Math.min(numData, CosConstants.DIGEST_ABANDONED_MAX_ACTIVITY_ROWS);
    var startRow = last - cap + 1;
    if (startRow < CosTimingConstants.FIRST_DATA_ROW) {
      startRow = CosTimingConstants.FIRST_DATA_ROW;
    }
    var numRows = last - startRow + 1;
    var data = sh.getRange(startRow, 1, numRows, width).getValues();
    /** @type { { proj: string, details: string, line: string, indent: number }[] } */
    var rows = [];
    var yi;
    for (yi = 0; yi < data.length; yi++) {
      var row = data[yi];
      if (String(row[1] || '').trim() !== String(ymd).trim()) {
        continue;
      }
      var proj = CosTimingImportService.normalizeTimingProjectLabel(
        String(row[9] != null ? row[9] : '').trim()
      );
      var det = String(row[10] != null ? row[10] : '')
        .replace(/\s+/g, ' ')
        .trim();
      var lt = String(row[8] != null ? row[8] : '').replace(/\s+/g, ' ').trim();
      var indent = Math.floor(Number(row[7]) || 0);
      rows.push({
        proj: proj,
        details: det,
        line: lt,
        indent: indent,
      });
    }
    return { rows: rows };
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} ymd
   * @returns {{ topProjects: { name: string, count: number }[], sampleLines: string[], activityRows: { proj: string, details: string, line: string, indent: number }[] }}
   * @private
   */
  _rollupActivityForYmd_: function (ss, ymd) {
    var pack = CosDailyDigestService._loadActivityRowsForYmd_(ss, ymd);
    var activityRows = pack.rows;
    var empty = {
      topProjects: [],
      sampleLines: [],
      activityRows: [],
    };
    if (!activityRows.length) {
      return empty;
    }
    /** @type {Object<string, number>} */
    var counts = {};
    /** @type {Object<string, boolean>} */
    var seenLine = {};
    /** @type {string[]} */
    var samples = [];
    var maxSamples = CosConstants.DIGEST_ABANDONED_SAMPLE_LINES;
    var maxProj = CosConstants.DIGEST_ABANDONED_TOP_PROJECTS;
    var yi;
    for (yi = 0; yi < activityRows.length; yi++) {
      var ar = activityRows[yi];
      var proj = ar.proj;
      if (proj) {
        counts[proj] = (counts[proj] || 0) + 1;
      }
      var sampleStr = CosDailyDigestService._formatActivityRowDigestPlain_(ar, 100);
      if (
        sampleStr &&
        samples.length < maxSamples &&
        !seenLine[sampleStr]
      ) {
        seenLine[sampleStr] = true;
        samples.push(sampleStr);
      }
    }
    /** @type {{ name: string, count: number }[]} */
    var pairs = [];
    var pk;
    for (pk in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, pk)) {
        pairs.push({ name: pk, count: counts[pk] });
      }
    }
    pairs.sort(function (a, b) {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return String(a.name).localeCompare(String(b.name));
    });
    return {
      topProjects: pairs.slice(0, maxProj),
      sampleLines: samples,
      activityRows: activityRows,
    };
  },

  /**
   * One RAW_TIMING_ACTIVITY row for digest text (Project · Details · Line).
   * @param {{ proj?: string, details?: string, line?: string, indent?: number }} ar
   * @param {number} [lineMax] max chars for Line segment
   * @returns {string}
   * @private
   */
  _formatActivityRowDigestPlain_: function (ar, lineMax) {
    var pr = String(ar && ar.proj != null ? ar.proj : '')
      .replace(/\s+/g, ' ')
      .trim();
    var det = String(ar && ar.details != null ? ar.details : '')
      .replace(/\s+/g, ' ')
      .trim();
    var lt = String(ar && ar.line != null ? ar.line : '')
      .replace(/\s+/g, ' ')
      .trim();
    var cap =
      lineMax != null && !isNaN(lineMax) ? Math.floor(lineMax) : 100;
    if (lt.length > cap) {
      lt = lt.substring(0, Math.max(0, cap - 1)) + '…';
    }
    var parts = [];
    if (pr) {
      parts.push('Project: ' + pr);
    }
    if (det) {
      parts.push('Details: ' + det);
    }
    if (lt) {
      parts.push('Line: ' + lt);
    }
    return parts.join(' · ');
  },

  /**
   * Activity hierarchy lines for ymd whose timing_project_name is in projectNames.
   * @param {{ proj: string, details: string, line: string, indent: number }[]} activityRows
   * @param {string[]} projectNames
   * @param {number} [maxLines]
   * @returns {string} empty if nothing to add
   * @private
   */
  _activitySheetLinesForProjectsPlain_: function (
    activityRows,
    projectNames,
    maxLines
  ) {
    if (!activityRows || !activityRows.length) {
      return '';
    }
    if (!projectNames || !projectNames.length) {
      return '';
    }
    var cap =
      maxLines != null && !isNaN(maxLines)
        ? Math.floor(maxLines)
        : CosConstants.DIGEST_ABANDONED_SLOT_ACTIVITY_LINES;
    /** @type {Object<string, boolean>} */
    var set = {};
    var i;
    for (i = 0; i < projectNames.length; i++) {
      var nm = String(projectNames[i] || '').trim();
      if (nm && nm !== '(no project)') {
        set[nm] = true;
      }
    }
    if (!Object.keys(set).length) {
      return '';
    }
    /** @type {Object<string, boolean>} */
    var seen = {};
    /** @type {string[]} */
    var out = [];
    var ri;
    for (ri = 0; ri < activityRows.length; ri++) {
      var r = activityRows[ri];
      var pr = String(r.proj || '').trim();
      if (!pr || !set[pr]) {
        continue;
      }
      var lt = String(r.line || '').replace(/\s+/g, ' ').trim();
      var det = String(r.details || '').replace(/\s+/g, ' ').trim();
      if (!lt && !det) {
        continue;
      }
      if (r.indent === 0 && lt === pr && !det) {
        continue;
      }
      var key = pr + '\t' + det + '\t' + lt;
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      var one = CosDailyDigestService._formatActivityRowDigestPlain_(r, 140);
      if (one) {
        out.push(one);
      }
      if (out.length >= cap) {
        break;
      }
    }
    if (!out.length) {
      return (
        'RAW_TIMING_ACTIVITY: no hierarchy lines tagged with those timing_project_name values for this day (re-import activity).'
      );
    }
    return (
      'RAW_TIMING_ACTIVITY (same calendar day, matching project): ' +
      out.join(' · ')
    );
  },

  /**
   * @param {Array} row RAW_TIMING_ENTRIES row
   * @returns {{ start: Date, end: Date }|null}
   * @private
   */
  _parseRawTimeEntryBounds_: function (row) {
    var s = CosDailyDigestService._parseIso_(String(row[2] || '').trim());
    if (!s || isNaN(s.getTime())) {
      return null;
    }
    var e = CosDailyDigestService._parseIso_(String(row[3] || '').trim());
    if (!e || isNaN(e.getTime())) {
      var dm = Number(row[4]);
      if (!isNaN(dm) && dm > 0) {
        e = new Date(s.getTime() + Math.round(dm * 60000));
      } else {
        e = new Date(s.getTime() + 60000);
      }
    }
    if (e.getTime() <= s.getTime()) {
      e = new Date(s.getTime() + 60000);
    }
    return { start: s, end: e };
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} yesterdayYmd
   * @param {string} tz
   * @returns {{ entries: { start: Date, end: Date, title: string, project: string }[], scanTruncated: boolean, byProjectDayMinutes: Object<string, number> }}
   * @private
   */
  _loadTimeEntriesTouchingYmd_: function (ss, yesterdayYmd, tz) {
    var empty = {
      entries: [],
      scanTruncated: false,
      byProjectDayMinutes: {},
    };
    var sh = ss.getSheetByName(CosTimingConstants.RAW_SHEET_NAME);
    if (!sh) {
      return empty;
    }
    var last = sh.getLastRow();
    var first = CosTimingConstants.FIRST_DATA_ROW;
    if (last < first) {
      return empty;
    }
    var totalData = last - first + 1;
    var maxScan = CosConstants.DIGEST_ABANDONED_MAX_TIME_ENTRY_SCAN_ROWS;
    var startRow = first;
    var scanTruncated = false;
    if (totalData > maxScan) {
      startRow = last - maxScan + 1;
      scanTruncated = true;
    }
    var numRows = last - startRow + 1;
    var width = CosTimingConstants.RAW_HEADERS.length;
    var data = sh.getRange(startRow, 1, numRows, width).getValues();
    var nextYmd = cos_ymdAddCalendarDays_(yesterdayYmd, 1, tz);
    var dayStart = Utilities.parseDate(
      yesterdayYmd + ' 00:00',
      tz,
      'yyyy-MM-dd HH:mm'
    );
    var dayEnd = Utilities.parseDate(
      nextYmd + ' 00:00',
      tz,
      'yyyy-MM-dd HH:mm'
    );
    if (!dayStart || !dayEnd) {
      return {
        entries: [],
        scanTruncated: scanTruncated,
        byProjectDayMinutes: {},
      };
    }
    var t0 = dayStart.getTime();
    var t1 = dayEnd.getTime();
    /** @type {{ start: Date, end: Date, title: string, project: string }[]} */
    var out = [];
    var ri;
    for (ri = 0; ri < data.length; ri++) {
      var row = data[ri];
      var bounds = CosDailyDigestService._parseRawTimeEntryBounds_(row);
      if (!bounds) {
        continue;
      }
      var bs = bounds.start.getTime();
      var be = bounds.end.getTime();
      if (bs < t1 && be > t0) {
        var proj = CosTimingImportService.normalizeTimingProjectLabel(
          String(row[6] != null ? row[6] : '').trim()
        );
        if (!proj) {
          proj = '(no project)';
        }
        var ttl = String(row[5] != null ? row[5] : '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!ttl) {
          ttl = '(untitled entry)';
        }
        out.push({
          start: bounds.start,
          end: bounds.end,
          title: ttl,
          project: proj,
        });
      }
    }
    /** @type {Object<string, number>} */
    var byProjDay = {};
    var ej;
    for (ej = 0; ej < out.length; ej++) {
      var en = out[ej];
      var lo = Math.max(en.start.getTime(), t0);
      var hi = Math.min(en.end.getTime(), t1);
      if (hi <= lo) {
        continue;
      }
      var dayMins = Math.max(1, Math.round((hi - lo) / 60000));
      var pk = en.project;
      byProjDay[pk] = (byProjDay[pk] || 0) + dayMins;
    }
    return {
      entries: out,
      scanTruncated: scanTruncated,
      byProjectDayMinutes: byProjDay,
    };
  },

  /**
   * @param {number} mins
   * @returns {string} e.g. 3h 17m, 50m
   * @private
   */
  _formatDurationHhMm_: function (mins) {
    var m = Math.floor(Number(mins) || 0);
    if (m <= 0) {
      return '0m';
    }
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (h > 0 && r > 0) {
      return h + 'h ' + r + 'm';
    }
    if (h > 0) {
      return h + 'h';
    }
    return r + 'm';
  },

  /**
   * @param {Object<string, number>} byProjDay
   * @returns {{ key: string, displayLabel: string, minutes: number }[]}
   * @private
   */
  _timingChartSlicesFromDayMinutes_: function (byProjDay) {
    /** @type {{ key: string, displayLabel: string, minutes: number }[]} */
    var pairs = [];
    var k;
    for (k in byProjDay) {
      if (!Object.prototype.hasOwnProperty.call(byProjDay, k)) {
        continue;
      }
      var mn = Math.floor(Number(byProjDay[k]) || 0);
      if (mn <= 0) {
        continue;
      }
      var disp =
        String(k).trim() === '(no project)' ? '(Unassigned)' : String(k).trim();
      pairs.push({
        key: String(k),
        displayLabel: disp || '(Unassigned)',
        minutes: mn,
      });
    }
    pairs.sort(function (a, b) {
      if (b.minutes !== a.minutes) {
        return b.minutes - a.minutes;
      }
      return String(a.displayLabel).localeCompare(String(b.displayLabel));
    });
    var maxSeg = CosConstants.DIGEST_TIMING_CHART_MAX_SEGMENTS;
    if (pairs.length <= maxSeg) {
      return pairs;
    }
    var top = pairs.slice(0, maxSeg - 1);
    var otherSum = 0;
    var oi;
    for (oi = maxSeg - 1; oi < pairs.length; oi++) {
      otherSum += pairs[oi].minutes;
    }
    if (otherSum > 0) {
      top.push({
        key: '_other',
        displayLabel: 'Other',
        minutes: otherSum,
      });
    }
    return top;
  },

  /**
   * Builds a QuickChart PNG URL (Chart.js). Project names are sent to quickchart.io.
   * @param {{ displayLabel: string, minutes: number }[]} slices
   * @returns {string}
   * @private
   */
  _quickChartTimingDonutUrl_: function (slices) {
    if (!slices || !slices.length) {
      return '';
    }
    var colors = [
      '#7f1d1d',
      '#5b21b6',
      '#9d174d',
      '#166534',
      '#a16207',
      '#1d4ed8',
      '#0f766e',
      '#991b1b',
      '#4d7c0f',
      '#7e22ce',
      '#c2410c',
      '#0369a1',
      '#737373',
    ];
    var labels = [];
    var data = [];
    var bg = [];
    var si;
    for (si = 0; si < slices.length; si++) {
      var lab = String(slices[si].displayLabel || '').trim();
      if (lab.length > 36) {
        lab = lab.substring(0, 33) + '…';
      }
      labels.push(
        lab + '\n' + CosDailyDigestService._formatDurationHhMm_(slices[si].minutes)
      );
      data.push(slices[si].minutes);
      bg.push(colors[si % colors.length]);
    }
    var cfg = {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: bg,
            borderWidth: 2,
            borderColor: '#2d2d2d',
          },
        ],
      },
      options: {
        devicePixelRatio: 2,
        legend: {
          display: true,
          position: 'right',
          labels: {
            fontColor: '#e8eaed',
            boxWidth: 11,
            padding: 8,
            fontSize: 11,
          },
        },
      },
    };
    var w = CosConstants.DIGEST_QUICKCHART_WIDTH;
    var h = CosConstants.DIGEST_QUICKCHART_HEIGHT;
    var base =
      'https://quickchart.io/chart?w=' +
      w +
      '&h=' +
      h +
      '&f=png&bkg=%232d2d2d&version=2.9.4&c=';
    var enc = encodeURIComponent(JSON.stringify(cfg));
    if (base.length + enc.length > 7200) {
      if (slices.length <= 1) {
        return '';
      }
      var nextN = Math.max(1, Math.floor(slices.length / 2));
      return CosDailyDigestService._quickChartTimingDonutUrl_(
        slices.slice(0, nextN)
      );
    }
    return base + enc;
  },

  /**
   * @param {{ dayLabel: string, yesterdayYmd: string, slices: { displayLabel: string, minutes: number }[], scanTruncated: boolean, chartUrl: string }} timingChart
   * @returns {string}
   * @private
   */
  _timingChartPlain_: function (timingChart) {
    if (!timingChart || !timingChart.slices || !timingChart.slices.length) {
      return '';
    }
    var lines = [];
    lines.push('== Projects & time entries (yesterday, Timing) ==');
    lines.push(
      'Reference: ' +
        timingChart.dayLabel +
        ' (' +
        timingChart.yesterdayYmd +
        ') · minutes from RAW_TIMING_ENTRIES overlapping that calendar day in your timezone.'
    );
    if (timingChart.scanTruncated) {
      lines.push(
        'Note: time-entry sheet scan was truncated (see abandoned-plan note if present).'
      );
    }
    lines.push(
      'Chart in HTML digest uses QuickChart (project names are sent to quickchart.io to render the image).'
    );
    var i;
    for (i = 0; i < timingChart.slices.length; i++) {
      var sl = timingChart.slices[i];
      lines.push(
        '• ' +
          sl.displayLabel +
          ' — ' +
          CosDailyDigestService._formatDurationHhMm_(sl.minutes)
      );
    }
    return lines.join('\n');
  },

  /**
   * Fallback when no chart URL: legend-style table.
   * @param {{ displayLabel: string, minutes: number }[]} slices
   * @returns {string}
   * @private
   */
  _htmlTimingChartLegendOnly_: function (slices) {
    var esc = CosDailyDigestService._esc_;
    var colors = [
      '#7f1d1d',
      '#5b21b6',
      '#9d174d',
      '#166534',
      '#a16207',
      '#1d4ed8',
      '#0f766e',
      '#991b1b',
      '#4d7c0f',
      '#7e22ce',
      '#c2410c',
      '#0369a1',
      '#737373',
    ];
    var rows = [];
    var ri;
    for (ri = 0; ri < slices.length; ri++) {
      var sl = slices[ri];
      var c = colors[ri % colors.length];
      rows.push(
        '<tr><td style="padding:8px 0;border-top:1px solid #3c4043;">' +
          '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
          c +
          ';margin-right:10px;vertical-align:middle;"></span>' +
          '<span style="font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#e8eaed;vertical-align:middle;">' +
          esc(sl.displayLabel) +
          '</span></td>' +
          '<td align="right" style="padding:8px 0;border-top:1px solid #3c4043;font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#e8eaed;">' +
          esc(CosDailyDigestService._formatDurationHhMm_(sl.minutes)) +
          '</td></tr>'
      );
    }
    return (
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' +
      rows.join('') +
      '</table>'
    );
  },

  /**
   * HTML card: Timing donut (QuickChart) above abandoned-plan section.
   * @param {{ dayLabel: string, yesterdayYmd: string, slices: { displayLabel: string, minutes: number }[], scanTruncated: boolean, chartUrl: string }} timingChart
   * @returns {string}
   * @private
   */
  _htmlTimingDayDonutCard_: function (timingChart) {
    if (!timingChart) {
      return '';
    }
    if (!timingChart.slices || !timingChart.slices.length) {
      return (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border-collapse:collapse;">' +
        '<tr><td style="background:#ffffff;border:1px solid #dadce0;border-radius:12px;padding:16px 18px;">' +
        '<p style="margin:0 0 8px;font:700 14px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#202124;">Projects &amp; time entries</p>' +
        '<p style="margin:0;font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#5f6368;">No RAW_TIMING_ENTRIES overlap for yesterday in the scanned rows — run Timing time entry import for that day.</p>' +
        '</td></tr></table>'
      );
    }
    var esc = CosDailyDigestService._esc_;
    var inner = '';
    if (timingChart.chartUrl) {
      inner =
        '<img src="' +
        esc(timingChart.chartUrl) +
        '" alt="Timing by project (yesterday)" width="' +
        String(CosConstants.DIGEST_QUICKCHART_WIDTH) +
        '" height="' +
        String(CosConstants.DIGEST_QUICKCHART_HEIGHT) +
        '" style="display:block;max-width:100%;height:auto;border-radius:10px;border:1px solid #3c4043;" />' +
        '<p style="margin:10px 0 0;font:11px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#9aa0a6;">Chart image by <a href="https://quickchart.io/" style="color:#1a73e8;">QuickChart</a> (labels include your project names).</p>';
    } else {
      inner = CosDailyDigestService._htmlTimingChartLegendOnly_(timingChart.slices);
    }
    return (
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border-collapse:collapse;">' +
      '<tr><td style="background:#2d2d2d;border:1px solid #202124;border-radius:12px;padding:16px 18px;">' +
      '<p style="margin:0 0 4px;font:700 14px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#e8eaed;">Projects &amp; time entries</p>' +
      '<p style="margin:0 0 14px;font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#bdc1c6;">Yesterday · ' +
      esc(timingChart.dayLabel) +
      ' (' +
      esc(timingChart.yesterdayYmd) +
      ') · RAW_TIMING_ENTRIES overlap minutes</p>' +
      inner +
      '</td></tr></table>'
    );
  },

  /**
   * @param {{ start: Date, end: Date, title: string, project: string }[]} dayEntries
   * @param {Date} wStart
   * @param {Date} wEnd
   * @param {{ proj: string, details: string, line: string, indent: number }[]} activityRows
   * @returns {string}
   * @private
   */
  _formatSlotTimeEntryPlain_: function (dayEntries, wStart, wEnd, activityRows) {
    if (!wStart || !wEnd || isNaN(wStart.getTime()) || isNaN(wEnd.getTime())) {
      return (
        'During that planned window: could not read slot times; skipped Timing lookup.'
      );
    }
    if (!dayEntries || !dayEntries.length) {
      return (
        'During that planned window: no Timing time entries on this calendar day in RAW_TIMING_ENTRIES (run “Import Timing…”).'
      );
    }
    var w0 = wStart.getTime();
    var w1 = wEnd.getTime();
    if (w1 <= w0) {
      return (
        'During that planned window: invalid slot duration; skipped Timing lookup.'
      );
    }
    /** @type {Object<string, Object<string, number>>} */
    var byProj = {};
    var ei;
    for (ei = 0; ei < dayEntries.length; ei++) {
      var e = dayEntries[ei];
      var s = e.start.getTime();
      var ed = e.end.getTime();
      if (s >= w1 || ed <= w0) {
        continue;
      }
      var lo = Math.max(s, w0);
      var hi = Math.min(ed, w1);
      var mins = Math.max(1, Math.round((hi - lo) / 60000));
      var pr = e.project;
      if (!byProj[pr]) {
        byProj[pr] = {};
      }
      var bt = byProj[pr];
      var tkey = e.title;
      bt[tkey] = (bt[tkey] || 0) + mins;
    }
    /** @type {{ name: string, total: number, titles: { name: string, min: number }[] }[]} */
    var projRows = [];
    var pk;
    for (pk in byProj) {
      if (!Object.prototype.hasOwnProperty.call(byProj, pk)) {
        continue;
      }
      var titleMap = byProj[pk];
      var titles = [];
      var tk;
      for (tk in titleMap) {
        if (Object.prototype.hasOwnProperty.call(titleMap, tk)) {
          titles.push({ name: tk, min: titleMap[tk] });
        }
      }
      titles.sort(function (a, b) {
        if (b.min !== a.min) {
          return b.min - a.min;
        }
        return String(a.name).localeCompare(String(b.name));
      });
      var tot = 0;
      var ti;
      for (ti = 0; ti < titles.length; ti++) {
        tot += titles[ti].min;
      }
      projRows.push({
        name: pk,
        total: tot,
        titles: titles,
      });
    }
    projRows.sort(function (a, b) {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return String(a.name).localeCompare(String(b.name));
    });
    if (!projRows.length) {
      return (
        'During that planned window: no Timing time entries overlap this clock range (check RAW_TIMING_ENTRIES).'
      );
    }
    var maxP = CosConstants.DIGEST_ABANDONED_SLOT_MAX_PROJECTS;
    var maxT = CosConstants.DIGEST_ABANDONED_SLOT_MAX_TITLES_PER_PROJECT;
    var takeoverParts = [];
    var pi;
    for (pi = 0; pi < projRows.length; pi++) {
      takeoverParts.push(projRows[pi].name + ' ' + projRows[pi].total + 'm');
    }
    var takeoverLine =
      'Taking over this slot (timing_project_name on RAW_TIMING_ENTRIES, minutes in window): ';
    if (takeoverParts.length <= maxP) {
      takeoverLine += takeoverParts.join(' · ');
    } else {
      takeoverLine +=
        takeoverParts.slice(0, maxP).join(' · ') +
        ' · (+' +
        (takeoverParts.length - maxP) +
        ' more projects)';
    }
    var parts = [];
    for (pi = 0; pi < Math.min(projRows.length, maxP); pi++) {
      var prow = projRows[pi];
      var ttlStrs = [];
      var tj;
      var tlist = prow.titles;
      for (tj = 0; tj < Math.min(tlist.length, maxT); tj++) {
        ttlStrs.push(tlist[tj].name + ' (' + tlist[tj].min + 'm)');
      }
      var extraT = tlist.length - maxT;
      if (extraT > 0) {
        ttlStrs.push('+' + extraT + ' more');
      }
      parts.push(prow.name + ' — ' + ttlStrs.join('; '));
    }
    var extraP = projRows.length - maxP;
    var detailLine =
      'Time entry titles (RAW_TIMING_ENTRIES overlap): ' + parts.join(' · ');
    if (extraP > 0) {
      detailLine += ' · +' + extraP + ' more projects';
    }
    var namesForAct = [];
    for (pi = 0; pi < projRows.length; pi++) {
      namesForAct.push(projRows[pi].name);
    }
    var actPlain = CosDailyDigestService._activitySheetLinesForProjectsPlain_(
      activityRows || [],
      namesForAct
    );
    return (
      takeoverLine +
      '\n  ' +
      detailLine +
      (actPlain ? '\n  ' + actPlain : '')
    );
  },

  /**
   * @param {CosTask[]} tasks
   * @param {string} tz
   * @param {string} yesterdayYmd
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @returns {{ items: { task: CosTask, blockPlain: string }[], sharedTimingPlain: string, dayLabel: string, yesterdayYmd: string, timingChart: { dayLabel: string, yesterdayYmd: string, slices: { key: string, displayLabel: string, minutes: number }[], scanTruncated: boolean, chartUrl: string } }}
   * @private
   */
  _buildAbandonedPlanDigest_: function (tasks, tz, yesterdayYmd, ss) {
    var rollup = CosDailyDigestService._rollupActivityForYmd_(ss, yesterdayYmd);
    var yParts = String(yesterdayYmd).split('-');
    var yMid =
      yParts.length === 3
        ? new Date(
            parseInt(yParts[0], 10),
            parseInt(yParts[1], 10) - 1,
            parseInt(yParts[2], 10),
            12,
            0,
            0
          )
        : new Date();
    var dayLabel = Utilities.formatDate(yMid, tz, 'EEE, MMM d, yyyy');
    var timingLines = [];
    if (rollup.topProjects.length) {
      var pj = [];
      var pi;
      for (pi = 0; pi < rollup.topProjects.length; pi++) {
        var p = rollup.topProjects[pi];
        pj.push(p.name + ' (' + p.count + ' lines)');
      }
      timingLines.push(
        'Timing on ' +
          dayLabel +
          ' (calendar day rollup, not exact clock overlap): ' +
          pj.join(', ')
      );
    } else {
      timingLines.push(
        'No RAW_TIMING_ACTIVITY rows for ' +
          yesterdayYmd +
          ' — run “Import Timing activity…” so categories appear here.'
      );
    }
    if (rollup.sampleLines.length) {
      timingLines.push(
        'Sample activity rows (Project · Details · Line): ' +
          rollup.sampleLines.join(' · ')
      );
    }
    timingLines.push(
      'Per abandoned slot below: (1) timing_project_name + titles from RAW_TIMING_ENTRIES clock overlap, (2) RAW_TIMING_ACTIVITY rows matching that project, each labeled Project / Details / Line (Details = sheet column after timing_project_name). The day-level summary above is still all-day RAW_TIMING_ACTIVITY.'
    );
    var dayTimed = CosDailyDigestService._loadTimeEntriesTouchingYmd_(
      ss,
      yesterdayYmd,
      tz
    );
    if (dayTimed.scanTruncated) {
      timingLines.push(
        'Note: only the latest ' +
          CosConstants.DIGEST_ABANDONED_MAX_TIME_ENTRY_SCAN_ROWS +
          ' RAW_TIMING_ENTRIES rows were scanned; if the sheet is longer, yesterday’s rows may be missing from slot overlap.'
      );
    }
    var sharedTimingPlain = timingLines.join('\n');
    /** @type {{ task: CosTask, blockPlain: string }[]} */
    var items = [];
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var st = String(t.status || '').trim();
      if (
        st === CosConstants.TASK_STATUS.DONE ||
        st === CosConstants.TASK_STATUS.DROPPED ||
        st === CosConstants.TASK_STATUS.PAUSED
      ) {
        continue;
      }
      var origS = String(t.originalScheduledStart || '').trim();
      var origE = String(t.originalScheduledEnd || '').trim();
      if (!origS || !origE) {
        continue;
      }
      var oStart = CosDailyDigestService._parseIso_(origS);
      var oEnd = CosDailyDigestService._parseIso_(origE);
      if (
        !CosDailyDigestService._originalWindowOverlapsYmd_(
          oStart,
          oEnd,
          yesterdayYmd,
          tz
        )
      ) {
        continue;
      }
      var curS = String(t.scheduledStart || '').trim();
      var curE = String(t.scheduledEnd || '').trim();
      var moved = curS !== origS || curE !== origE;
      var cleared = !curS && !curE;
      if (
        st !== CosConstants.TASK_STATUS.AWAITING_CLOSURE &&
        !moved &&
        !cleared
      ) {
        continue;
      }
      var whenOrig = '';
      if (oStart) {
        whenOrig =
          Utilities.formatDate(oStart, tz, 'EEE MMM d') +
          ' · ' +
          Utilities.formatDate(oStart, tz, 'h:mm a');
        if (oEnd) {
          whenOrig += '–' + Utilities.formatDate(oEnd, tz, 'h:mm a');
        }
      }
      var nowCal = '';
      if (curS && curE) {
        var cs = CosDailyDigestService._parseIso_(curS);
        var ce = CosDailyDigestService._parseIso_(curE);
        if (cs && ce) {
          nowCal =
            'Now on calendar: ' +
            Utilities.formatDate(cs, tz, 'EEE MMM d') +
            ' · ' +
            Utilities.formatDate(cs, tz, 'h:mm a') +
            '–' +
            Utilities.formatDate(ce, tz, 'h:mm a');
        }
      } else if (cleared) {
        nowCal = 'Calendar slot cleared (pending reschedule or dropped event).';
      }
      var blockPlain =
        '• ' +
        String(t.task || '').trim() +
        '  [' +
        String(t.priority || '').trim() +
        ', ' +
        String(t.status || '').trim() +
        ']\n  Abandoned plan: ' +
        whenOrig +
        (nowCal ? '\n  ' + nowCal : '');
      if (oStart && oEnd) {
        blockPlain +=
          '\n  ' +
          CosDailyDigestService._formatSlotTimeEntryPlain_(
            dayTimed.entries,
            oStart,
            oEnd,
            rollup.activityRows || []
          );
      }
      items.push({
        task: t,
        blockPlain: blockPlain,
      });
    }
    items.sort(function (a, b) {
      var da = CosDailyDigestService._parseIso_(a.task.originalScheduledStart);
      var db = CosDailyDigestService._parseIso_(b.task.originalScheduledStart);
      var ta = da ? da.getTime() : 0;
      var tb = db ? db.getTime() : 0;
      return ta - tb;
    });
    var timingSlices = CosDailyDigestService._timingChartSlicesFromDayMinutes_(
      dayTimed.byProjectDayMinutes || {}
    );
    var chartUrl = '';
    if (timingSlices.length) {
      chartUrl = CosDailyDigestService._quickChartTimingDonutUrl_(timingSlices);
    }
    var timingChart = {
      dayLabel: dayLabel,
      yesterdayYmd: yesterdayYmd,
      slices: timingSlices,
      scanTruncated: dayTimed.scanTruncated,
      chartUrl: chartUrl,
    };
    return {
      items: items,
      sharedTimingPlain: sharedTimingPlain,
      dayLabel: dayLabel,
      yesterdayYmd: yesterdayYmd,
      timingChart: timingChart,
    };
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
   * Single follow-up list: overdue band first, then waiting (each band sorted by created time).
   * @param {{ followUpOverdue: CosTask[], followUpWaiting: CosTask[] }} bundle
   * @returns {CosTask[]}
   * @private
   */
  _followUpTasksMerged_: function (bundle) {
    var o = bundle.followUpOverdue || [];
    var w = bundle.followUpWaiting || [];
    return o.concat(w);
  },

  /**
   * @param {Object} bundle
   * @param {string} tz
   * @param {string} dayKey
   * @param {Object<string, { line: string, source: string }>} snippetMap
   * @param {CosSettings} settings
   * @param {{ items: { task: CosTask, blockPlain: string }[], sharedTimingPlain: string, dayLabel: string, yesterdayYmd: string, timingChart: Object }} abandoned
   * @returns {string}
   * @private
   */
  _buildPlain_: function (bundle, tz, dayKey, snippetMap, settings, abandoned) {
    var lines = [];
    var followUpAll = CosDailyDigestService._followUpTasksMerged_(bundle);
    lines.push('Daily digest for ' + dayKey + ' (' + tz + ').');
    lines.push('');
    var chartPlain = CosDailyDigestService._timingChartPlain_(
      abandoned.timingChart
    );
    if (chartPlain) {
      lines.push(chartPlain);
      lines.push('');
    }
    lines.push('== Yesterday vs plan (abandoned Jeeves windows + Timing) ==');
    lines.push(
      'Reference calendar day: ' +
        abandoned.dayLabel +
        ' (' +
        abandoned.yesterdayYmd +
        '). Original slots below overlapped that day; Timing is day-level (not exact clock overlap).'
    );
    lines.push('');
    if (!abandoned.items.length) {
      lines.push('(none)');
    } else {
      lines.push(abandoned.sharedTimingPlain);
      lines.push('');
      var abi;
      for (abi = 0; abi < abandoned.items.length; abi++) {
        lines.push(abandoned.items[abi].blockPlain);
        lines.push('');
      }
    }
    lines.push('');
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Follow-up',
      followUpAll,
      function (t) {
        return CosDailyDigestService._lineFollowUp_(t, tz, snippetMap, settings);
      },
      true
    );
    CosDailyDigestService._appendPlainSection_(
      lines,
      'Pending',
      bundle.pending,
      CosDailyDigestService._lineTask_,
      true
    );
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
      'Scheduled over next 7 days',
      bundle.scheduledJeevesWeek,
      function (t) {
        return CosDailyDigestService._lineScheduledJeevesWeek_(t, tz);
      },
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
  _lineFollowUp_: function (t, tz, snippetMap, settings) {
    var meta = CosDailyDigestService._followUpMetaLine_(t, tz);
    var id = String(t.taskId || '').trim();
    var ctx = id && snippetMap[id] ? snippetMap[id] : null;
    var line = ctx && ctx.line ? ctx.line : '';
    var base = '• ' + t.task + (meta ? '\n  ' + meta : '');
    if (line) {
      base = base + '\n  ' + line;
    }
    var act = CosDailyDigestService._followUpActionPlainLines_(t, settings);
    var a;
    for (a = 0; a < act.length; a++) {
      base = base + '\n  ' + act[a];
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
  _htmlFollowUpBlock_: function (t, tz, snippetMap, settings) {
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
    var actHtml = CosDailyDigestService._followUpActionHtml_(t, settings);
    if (actHtml) {
      parts.push(actHtml);
    }
    return parts.join('');
  },

  /**
   * Plain-text lines for follow-up actions (Gmail link, mailto draft).
   * @param {CosTask} t
   * @returns {string[]}
   * @private
   */
  _followUpActionPlainLines_: function (t, settings) {
    if (
      String(t.priority || '').trim() !== CosConstants.TASK_PRIORITY.FOLLOW_UP
    ) {
      return [];
    }
    var out = [];
    var src = String(t.source || '').trim();
    if (src === CosConstants.TASK_SOURCE.EMAIL) {
      var ref = String(t.sourceRef || '').trim();
      if (ref) {
        var jumpPlain = CosClosureLinkService.buildGmailThreadOpenUrl(
          ref,
          settings || {}
        );
        out.push(
          'Open in Gmail: ' +
            (jumpPlain ||
              'https://mail.google.com/mail/u/0/#all/' + ref)
        );
      }
    } else if (src === CosConstants.TASK_SOURCE.TELEGRAM) {
      var href = CosDailyDigestService._followUpMailtoHref_(t);
      if (href) {
        out.push('Draft follow-up (mailto): ' + href);
      }
    }
    var doneUrl = CosClosureLinkService.buildDigestFollowUpDoneUrl(
      String(t.taskId || '').trim(),
      settings || {}
    );
    if (doneUrl) {
      out.push('Mark follow-up done (tap once): ' + doneUrl);
    }
    return out;
  },

  /**
   * When the sheet title is like "Follow-up with Akhila for AIR SQL query", mailto subject/body
   * should use only the substance (e.g. "AIR SQL query"), not the repeated boilerplate.
   * @param {string} rawTitle
   * @returns {string}
   * @private
   */
  _followUpMailtoTopicLine_: function (rawTitle) {
    var t = String(rawTitle || '').replace(/\s+/g, ' ').trim();
    if (!t) {
      return '';
    }
    var m = /^\s*follow\s*-?\s*up\s+with\s+.+?\s+(?:for|regarding)\s+(.+)$/i.exec(
      t
    );
    if (m && String(m[1] || '').trim()) {
      return String(m[1] || '').trim();
    }
    return t;
  },

  /**
   * @param {CosTask} t
   * @returns {string} mailto URL or ''
   * @private
   */
  _followUpMailtoHref_: function (t) {
    var em = String(t.followUpContactEmail || '').trim().toLowerCase();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      return '';
    }
    var topic = CosDailyDigestService._followUpMailtoTopicLine_(
      String(t.task || '')
    );
    var subj = ('Follow-up: ' + topic).substring(0, 100);
    var name = String(t.followUpContactName || '').trim();
    var first = name ? name.split(/\s+/)[0] : '';
    var greet = first ? 'Hi ' + first + ',\n\n' : 'Hi,\n\n';
    var body =
      greet +
      'Following up regarding: ' +
      topic +
      '\n\n';
    var notes = String(t.notes || '').trim();
    if (notes) {
      body +=
        notes.substring(0, 500) + (notes.length > 500 ? '…' : '') + '\n\n';
    }
    body += 'Thanks,';
    return (
      'mailto:' +
      em +
      '?subject=' +
      encodeURIComponent(subj) +
      '&body=' +
      encodeURIComponent(body)
    );
  },

  /**
   * @param {CosTask} t
   * @returns {string} HTML fragment or ''
   * @private
   */
  _followUpActionHtml_: function (t, settings) {
    if (
      String(t.priority || '').trim() !== CosConstants.TASK_PRIORITY.FOLLOW_UP
    ) {
      return '';
    }
    var chunks = [];
    var src = String(t.source || '').trim();
    if (src === CosConstants.TASK_SOURCE.EMAIL) {
      var ref = String(t.sourceRef || '').trim();
      if (ref) {
        var gUrl =
          CosClosureLinkService.buildGmailThreadOpenUrl(ref, settings || {}) ||
          'https://mail.google.com/mail/u/0/#all/' + ref;
        chunks.push(
          '<div style="margin:10px 0 0;"><a target="_blank" rel="noopener noreferrer" href="' +
            CosDailyDigestService._esc_(gUrl) +
            '" style="color:#1a73e8;font-size:15px;font-weight:500;">Open thread in Gmail</a></div>'
        );
      }
    } else if (src === CosConstants.TASK_SOURCE.TELEGRAM) {
      var mailto = CosDailyDigestService._followUpMailtoHref_(t);
      if (mailto) {
        var nm = String(t.followUpContactName || '').trim();
        var label = nm
          ? 'Draft follow-up to ' + nm
          : 'Draft follow-up email';
        chunks.push(
          '<div style="margin:10px 0 0;"><a href="' +
            CosDailyDigestService._esc_(mailto) +
            '" style="color:#1a73e8;font-size:15px;font-weight:500;">' +
            CosDailyDigestService._esc_(label) +
            '</a></div>'
        );
      }
    }
    var doneUrl = CosClosureLinkService.buildDigestFollowUpDoneUrl(
      String(t.taskId || '').trim(),
      settings || {}
    );
    if (doneUrl) {
      chunks.push(
        '<div style="margin:12px 0 0;">' +
          '<a href="' +
          CosDailyDigestService._esc_(doneUrl) +
          '" style="display:inline-block;padding:12px 18px;background:#188038;color:#ffffff !important;' +
          'text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;' +
          '-webkit-tap-highlight-color:transparent;">Mark follow-up done</a>' +
          '</div>' +
          '<div style="margin:6px 0 0;font:11px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#80868b;">' +
          'One tap updates your Tasks sheet (same signed link as calendar closure).</div>'
      );
    }
    return chunks.join('');
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
   * @param {CosSettings} settings
   * @param {{ items: { task: CosTask, blockPlain: string }[], sharedTimingPlain: string, dayLabel: string, yesterdayYmd: string, timingChart: Object }} abandoned
   * @returns {string}
   * @private
   */
  _buildHtml_: function (bundle, tz, dayKey, now, snippetMap, settings, abandoned) {
    var pre = CosDailyDigestService._preheaderSummary_(bundle, abandoned);
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

    parts.push(
      CosDailyDigestService._htmlTimingDayDonutCard_(abandoned.timingChart)
    );
    parts.push(CosDailyDigestService._htmlAbandonedPlanCard_(abandoned));

    var followUpAllHtml = CosDailyDigestService._followUpTasksMerged_(bundle);
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Follow-up',
      followUpAllHtml,
      function (t) {
        return CosDailyDigestService._htmlFollowUpBlock_(t, tz, snippetMap, settings);
      },
      {
        titleColor: '#188038',
        itemGap: true,
        subtitle:
          'Not on calendar · over ' +
          CosConstants.FOLLOW_UP_DIGEST_OVERDUE_HOURS +
          'h since creation listed first',
      }
    );
    CosDailyDigestService._appendHtmlCardSection_(
      parts,
      'Pending',
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
      'Scheduled over next 7 days',
      bundle.scheduledJeevesWeek,
      function (t) {
        return CosDailyDigestService._htmlScheduledJeevesWeekRow_(t, tz);
      },
      {
        titleColor: '#1967d2',
        subtitle:
          'P0, P1, P2 only · Jeeves calendar events · excludes today · sorted by priority then start time',
      }
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
   * @param {{ items: { task: CosTask, blockPlain: string }[] }} [abandoned]
   * @returns {string}
   * @private
   */
  _preheaderSummary_: function (bundle, abandoned) {
    var bits = [];
    if (abandoned && abandoned.items && abandoned.items.length) {
      var nAb = abandoned.items.length;
      bits.push(
        nAb + ' abandoned plan' + (nAb === 1 ? '' : 's')
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
    if (bundle.scheduledToday.length) {
      bits.push(
        bundle.scheduledToday.length +
          ' on calendar today'
      );
    }
    if (bundle.scheduledJeevesWeek.length) {
      bits.push(
        bundle.scheduledJeevesWeek.length +
          ' scheduled in next 7 days'
      );
    }
    if (!bits.length) {
      return 'No open items in these sections — nice.';
    }
    return bits.join(' · ');
  },

  /**
   * HTML card for “yesterday vs plan”: Timing rollup + per-task abandoned original vs current calendar.
   * @param {{ items: { task: CosTask, blockPlain: string }[], sharedTimingPlain: string, dayLabel: string, yesterdayYmd: string }} abandoned
   * @returns {string}
   * @private
   */
  _htmlAbandonedPlanCard_: function (abandoned) {
    var titleColor = '#b06000';
    var subText =
      'Reference calendar day: ' +
      abandoned.dayLabel +
      ' (' +
      abandoned.yesterdayYmd +
      '). Original Jeeves slots overlapped that day; Timing below is a calendar-day rollup (not exact overlap with each slot).';
    var esc = CosDailyDigestService._esc_;
    var br = function (plain) {
      return esc(plain).replace(/\n/g, '<br/>');
    };
    var body = '';
    if (!abandoned.items.length) {
      body =
        '<p style="margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#5f6368;">(none)</p>';
    } else {
      body +=
        '<div style="margin:0 0 14px;padding:10px 12px;background:#f8f9fa;border-radius:8px;font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#3c4043;">' +
        br(abandoned.sharedTimingPlain) +
        '</div>';
      var abi;
      for (abi = 0; abi < abandoned.items.length; abi++) {
        var pad =
          abi > 0
            ? 'padding-top:14px;margin-top:14px;border-top:1px solid #f1f3f4;'
            : '';
        body +=
          '<div style="' +
          pad +
          'font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#202124;">' +
          br(abandoned.items[abi].blockPlain) +
          '</div>';
      }
    }
    return (
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border-collapse:collapse;">' +
      '<tr><td style="background:#ffffff;border:1px solid #dadce0;border-radius:12px;padding:16px 18px;">' +
      '<p style="margin:0 0 4px;font:700 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:' +
      titleColor +
      ';">Yesterday vs plan (abandoned slots + Timing)</p>' +
      '<p style="margin:0 0 12px;font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#5f6368;">' +
      esc(subText) +
      '</p>' +
      body +
      '</td></tr></table>'
    );
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
