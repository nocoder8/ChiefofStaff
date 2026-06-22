/**
 * Orchestrates Timing → RAW_TIMING_ENTRIES import and TIMING_IMPORT_LOG rows.
 */
var CosTimingImportService = {
  /**
   * @param {string} selfPath e.g. /time-entries/42
   * @returns {string} stable id for sheet + idempotency
   * @private
   */
  _entryIdFromSelf_: function (selfPath) {
    var s = String(selfPath || '').trim();
    var m = /\/time-entries\/([^/?#]+)/.exec(s);
    return m ? String(m[1]).trim() : '';
  },

  /**
   * @param {Object} project nested project object from time entry
   * @returns {string}
   * @private
   */
  _projectDisplayName_: function (project) {
    if (!project || typeof project !== 'object') {
      return '';
    }
    if (project.title) {
      return String(project.title);
    }
    if (project.title_chain && project.title_chain.length) {
      return project.title_chain.join(' / ');
    }
    return String(project.self || '').trim();
  },

  /**
   * Normalizes labels used as {@code timing_project_name} (RAW_TIMING_ACTIVITY roots and
   * RAW_TIMING_ENTRIES project).
   *
   * <p>Activity hierarchy indent-0 lines from Timing often look like
   * {@code Recruiting | Google Chrome | app.eightfold.ai} — the canonical project is the
   * first {@code |}-delimited segment. Same for {@code Ops/Admin | Gmail | mail.google.com}
   * → {@code Ops/Admin}. Splits on whitespace around the pipe so {@code A|B} is unchanged.</p>
   *
   * <p>Also strips a leading {@code H:MM:SS } duration token, drops sheet errors and
   * non-project header lines (Date range, Total tracked, Block size).</p>
   *
   * @param {string} raw
   * @returns {string}
   */
  normalizeTimingProjectLabel: function (raw) {
    var s = String(raw || '').trim();
    if (!s) {
      return '';
    }
    if (/^#error!?$/i.test(s) || /^#n\/a$/i.test(s) || /^#ref!?$/i.test(s)) {
      return '';
    }
    if (
      /^date range:/i.test(s) ||
      /^total tracked:/i.test(s) ||
      /^block size:/i.test(s)
    ) {
      return '';
    }
    var m = s.match(/^(\d{1,4}):(\d{2}):(\d{2})\s+(.+)$/);
    if (m && m[4]) {
      s = String(m[4]).trim();
    }
    var segs = s.split(/\s+\|\s+/);
    if (segs.length >= 2) {
      s = String(segs[0]).trim();
    }
    return s;
  },

  /**
   * Splits Timing activity hierarchy indent-0 root lines into sheet columns:
   * {@code timing_project_name} (first segment) and {@code details} (rest joined with {@code |}).
   * Does not call {@link CosTimingImportService.normalizeTimingProjectLabel} on the full line first
   * (that would drop the tail). Applies duration strip to the whole line, then splits on {@code |}.
   * @param {string} raw indent-0 line text (tabs already stripped)
   * @returns {{ project: string, details: string }}
   * @private
   */
  _splitActivityHierarchyRootLine_: function (raw) {
    var s = String(raw || '').trim();
    if (!s) {
      return { project: '', details: '' };
    }
    if (/^#error!?$/i.test(s) || /^#n\/a$/i.test(s) || /^#ref!?$/i.test(s)) {
      return { project: '', details: '' };
    }
    if (
      /^date range:/i.test(s) ||
      /^total tracked:/i.test(s) ||
      /^block size:/i.test(s)
    ) {
      return { project: '', details: '' };
    }
    var m = s.match(/^(\d{1,4}):(\d{2}):(\d{2})\s+(.+)$/);
    if (m && m[4]) {
      s = String(m[4]).trim();
    }
    var segs = s.split(/\s+\|\s+/);
    if (segs.length < 2) {
      return {
        project: CosTimingImportService.normalizeTimingProjectLabel(s),
        details: '',
      };
    }
    var proj = CosTimingImportService.normalizeTimingProjectLabel(
      String(segs[0]).trim()
    );
    var details = segs.slice(1).join(' | ').trim();
    return { project: proj, details: details };
  },

  /**
   * @param {Object} entry one Timing time entry object
   * @param {string} importRunId
   * @param {string} importedAtIso
   * @returns {Array}
   * @private
   */
  _rawRowFromEntry_: function (entry, importRunId, importedAtIso) {
    var self = entry && entry.self ? String(entry.self) : '';
    var tid = CosTimingImportService._entryIdFromSelf_(self);
    var startTs = entry && entry.start_date ? String(entry.start_date) : '';
    var endTs = entry && entry.end_date ? String(entry.end_date) : '';
    var durSec =
      entry && typeof entry.duration === 'number' && !isNaN(entry.duration)
        ? entry.duration
        : null;
    var durMin = '';
    if (durSec !== null) {
      durMin = String(Math.round(durSec / 60));
    } else if (startTs && endTs) {
      var a = new Date(startTs);
      var b = new Date(endTs);
      if (!isNaN(a.getTime()) && !isNaN(b.getTime()) && b.getTime() >= a.getTime()) {
        durMin = String(Math.round((b.getTime() - a.getTime()) / 60000));
      }
    }
    var title = entry && entry.title != null ? String(entry.title) : '';
    var notes = entry && entry.notes != null ? String(entry.notes) : '';
    var projName = CosTimingImportService.normalizeTimingProjectLabel(
      CosTimingImportService._projectDisplayName_(entry.project)
    );
    var rawJson = '';
    try {
      rawJson = JSON.stringify(entry);
      if (rawJson.length > 48000) {
        rawJson = rawJson.substring(0, 47997) + '…';
      }
    } catch (e) {
      rawJson = '{"error":"stringify_failed"}';
    }
    var updatedTs = '';
    if (entry && entry.updated_at) {
      updatedTs = String(entry.updated_at);
    } else if (entry && entry.updatedAt) {
      updatedTs = String(entry.updatedAt);
    }
    return [
      tid,
      importRunId,
      startTs,
      endTs,
      durMin,
      title,
      projName,
      '',
      '',
      '',
      notes,
      updatedTs,
      rawJson,
      importedAtIso,
    ];
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {number} nDays inclusive calendar-day window ending today (min 1; invalid uses DEFAULT_TIMING_IMPORT_CALENDAR_DAYS)
   * @param {{ replaceSheet?: boolean }} [opt] when `replaceSheet` is true, clears all RAW_TIMING_ENTRIES data rows
   * before import so the sheet matches this window only (avoids “stale rows from older imports”).
   * @returns {Object}
   */
  importLastNDays: function (ss, nDays, opt) {
    opt = opt || {};
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(45000)) {
      CosLogger.warn('TimingImport: document lock timeout');
      return { ok: false, message: 'Lock timeout' };
    }
    var importRunId = Utilities.getUuid();
    var startedAt = new Date().toISOString();
    var tz = ss.getSpreadsheetTimeZone();
    var now = new Date();
    var endYmd = cos_formatYmd_(now, tz);
    var spanRaw = Math.floor(Number(nDays));
    var span =
      spanRaw >= 1 && !isNaN(spanRaw)
        ? spanRaw
        : CosTimingConstants.DEFAULT_TIMING_IMPORT_CALENDAR_DAYS;
    var startYmd = cos_ymdAddCalendarDays_(endYmd, -(span - 1), tz);

    /** @type {Array} */
    var logRow = [
      importRunId,
      startedAt,
      '',
      startYmd,
      endYmd,
      0,
      0,
      0,
      'running',
      '',
    ];

    try {
      var repo = new CosTimingSheetRepository(ss);
      repo.ensureSchema();
      if (opt.replaceSheet === true) {
        repo.clearRawTimingDataRows_();
        CosLogger.info('TimingImport: cleared RAW_TIMING_ENTRIES (replaceSheet)', {
          dateFrom: startYmd,
          dateTo: endYmd,
        });
      }

      var fetch = CosTimingApiClient.fetchTimeEntriesDateRange(startYmd, endYmd);
      if (!fetch.ok) {
        logRow[5] = 0;
        logRow[6] = 0;
        logRow[7] = 0;
        logRow[8] = 'failed';
        logRow[9] = String(fetch.error || 'fetch failed');
        logRow[2] = new Date().toISOString();
        repo.appendLogRow(logRow);
        CosLogger.error('TimingImport: fetch failed', { error: logRow[9] });
        return { ok: false, message: logRow[9], importRunId: importRunId };
      }

      var entries = fetch.entries || [];
      var idMap = repo.getExistingEntryIdToRow();
      var importedAt = new Date().toISOString();
      /** @type {Array[]} */
      var newRows = [];
      var inserted = 0;
      var skipped = 0;
      var ei;
      for (ei = 0; ei < entries.length; ei++) {
        var en = entries[ei];
        var eid = CosTimingImportService._entryIdFromSelf_(en && en.self);
        if (!eid) {
          CosLogger.warn('TimingImport: skip row without time entry id', {
            self: en && en.self,
          });
          continue;
        }
        if (idMap[eid]) {
          skipped++;
          continue;
        }
        idMap[eid] = -1;
        newRows.push(
          CosTimingImportService._rawRowFromEntry_(en, importRunId, importedAt)
        );
        inserted++;
      }

      if (newRows.length) {
        repo.appendRawRows(newRows);
      }

      logRow[5] = entries.length;
      logRow[6] = inserted;
      logRow[7] = skipped;
      logRow[8] = 'ok';
      logRow[9] = '';
      logRow[2] = new Date().toISOString();
      repo.appendLogRow(logRow);

      var hint = '';
      if (entries.length > 0 && inserted === 0 && skipped === entries.length) {
        hint =
          'all_fetched_time_entries_already_on_sheet — re-run only adds NEW ids; Slack/Chrome detail is activity import.';
      } else if (entries.length === 0) {
        hint = 'no_time_entries_in_window — try widening days or use activity import for app usage.';
      }
      CosLogger.info('TimingImport: complete', {
        importRunId: importRunId,
        dateFrom: startYmd,
        dateTo: endYmd,
        rowsFetched: entries.length,
        rowsInserted: inserted,
        rowsSkippedExisting: skipped,
        pages: fetch.pageCount,
        replaceSheet: opt.replaceSheet === true,
        messageHint: hint || undefined,
      });

      return {
        ok: true,
        importRunId: importRunId,
        rowsFetched: entries.length,
        rowsInserted: inserted,
        rowsSkippedExisting: skipped,
        pageCount: fetch.pageCount,
        replaceSheet: opt.replaceSheet === true,
        messageHint: hint || undefined,
      };
    } catch (e) {
      logRow[5] = 0;
      logRow[6] = 0;
      logRow[7] = 0;
      logRow[8] = 'failed';
      logRow[9] = String(e.message || e);
      logRow[2] = new Date().toISOString();
      try {
        var repoE = new CosTimingSheetRepository(ss);
        repoE.ensureSchema();
        repoE.appendLogRow(logRow);
      } catch (e2) {
        CosLogger.error('TimingImport: log append failed', {
          error: String(e2.message || e2),
        });
      }
      CosLogger.error('TimingImport: exception', { error: logRow[9] });
      return { ok: false, message: logRow[9], importRunId: importRunId };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Rolling window import: entries whose start_date falls in [now − hours, now] (UTC ISO
   * bounds). Idempotent by timing_entry_id; safe to overlap windows slightly via overlapMinutes
   * so a missed trigger does not leave a gap.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {number} hours lookback (min 1, default from CosTimingConstants.DEFAULT_IMPORT_LOOKBACK_HOURS)
   * @param {number} [overlapMinutes] extra lookback before the window start (0–180, default 0)
   * @returns {Object}
   */
  importLastHours: function (ss, hours, overlapMinutes) {
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(45000)) {
      CosLogger.warn('TimingImport: document lock timeout');
      return { ok: false, message: 'Lock timeout' };
    }
    var hRaw = Math.floor(Number(hours));
    var h =
      hRaw >= 1 && !isNaN(hRaw)
        ? hRaw
        : CosTimingConstants.DEFAULT_IMPORT_LOOKBACK_HOURS;
    var overlap = Math.max(
      0,
      Math.min(180, Math.floor(Number(overlapMinutes) || 0))
    );
    var importRunId = Utilities.getUuid();
    var startedAt = new Date().toISOString();
    var now = new Date();
    var startMs = now.getTime() - h * 3600000 - overlap * 60000;
    var startIso = new Date(startMs).toISOString();
    var endIso = now.toISOString();

    /** @type {Array} */
    var logRow = [
      importRunId,
      startedAt,
      '',
      startIso,
      endIso,
      0,
      0,
      0,
      'running',
      '',
    ];

    try {
      var repo = new CosTimingSheetRepository(ss);
      repo.ensureSchema();

      var fetch = CosTimingApiClient.fetchTimeEntriesIsoRange(startIso, endIso);
      if (!fetch.ok) {
        logRow[5] = 0;
        logRow[6] = 0;
        logRow[7] = 0;
        logRow[8] = 'failed';
        logRow[9] = String(fetch.error || 'fetch failed');
        logRow[2] = new Date().toISOString();
        repo.appendLogRow(logRow);
        CosLogger.error('TimingImport: fetch failed', { error: logRow[9] });
        return { ok: false, message: logRow[9], importRunId: importRunId };
      }

      var entries = fetch.entries || [];
      var idMap = repo.getExistingEntryIdToRow();
      var importedAt = new Date().toISOString();
      /** @type {Array[]} */
      var newRows = [];
      var inserted = 0;
      var skipped = 0;
      var ei;
      for (ei = 0; ei < entries.length; ei++) {
        var en = entries[ei];
        var eid = CosTimingImportService._entryIdFromSelf_(en && en.self);
        if (!eid) {
          CosLogger.warn('TimingImport: skip row without time entry id', {
            self: en && en.self,
          });
          continue;
        }
        if (idMap[eid]) {
          skipped++;
          continue;
        }
        idMap[eid] = -1;
        newRows.push(
          CosTimingImportService._rawRowFromEntry_(en, importRunId, importedAt)
        );
        inserted++;
      }

      if (newRows.length) {
        repo.appendRawRows(newRows);
      }

      logRow[5] = entries.length;
      logRow[6] = inserted;
      logRow[7] = skipped;
      logRow[8] = 'ok';
      logRow[9] = '';
      logRow[2] = new Date().toISOString();
      repo.appendLogRow(logRow);

      CosLogger.info('TimingImport: complete (hours window)', {
        importRunId: importRunId,
        startIso: startIso,
        endIso: endIso,
        hours: h,
        overlapMinutes: overlap,
        rowsFetched: entries.length,
        rowsInserted: inserted,
        rowsSkippedExisting: skipped,
        pages: fetch.pageCount,
      });

      return {
        ok: true,
        importRunId: importRunId,
        rowsFetched: entries.length,
        rowsInserted: inserted,
        rowsSkippedExisting: skipped,
        pageCount: fetch.pageCount,
      };
    } catch (e) {
      logRow[5] = 0;
      logRow[6] = 0;
      logRow[7] = 0;
      logRow[8] = 'failed';
      logRow[9] = String(e.message || e);
      logRow[2] = new Date().toISOString();
      try {
        var repoE = new CosTimingSheetRepository(ss);
        repoE.ensureSchema();
        repoE.appendLogRow(logRow);
      } catch (e2) {
        CosLogger.error('TimingImport: log append failed', {
          error: String(e2.message || e2),
        });
      }
      CosLogger.error('TimingImport: exception', { error: logRow[9] });
      return { ok: false, message: logRow[9], importRunId: importRunId };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {string} line
   * @returns {number}
   * @private
   */
  _leadingTabCount_: function (line) {
    var m = /^(\t*)/.exec(String(line || ''));
    return m ? m[1].length : 0;
  },

  /**
   * @param {string} text
   * @param {string} importRunId
   * @param {string} winStart ymd
   * @param {string} winEnd ymd
   * @param {string} blockSize
   * @param {number} minSec
   * @param {number} maxLines
   * @param {string} importedAtIso
   * @param {number} lineNoOffset previous lines in this import run
   * @returns {Array[]}
   * @private
   */
  _activityRowsFromText_: function (
    text,
    importRunId,
    winStart,
    winEnd,
    blockSize,
    minSec,
    maxLines,
    importedAtIso,
    lineNoOffset
  ) {
    var lines = String(text || '').split(/\r?\n/);
    /** @type {Array[]} */
    var out = [];
    var idx = Math.max(0, Math.floor(Number(lineNoOffset) || 0));
    /** First {@code |} segment on last indent-0 root (Timing project). */
    var lastIndent0Project = '';
    /** Remainder after first {@code |} on that root (app, URL, …). */
    var lastIndent0Details = '';
    var n;
    for (n = 0; n < lines.length; n++) {
      var raw = lines[n];
      if (raw == null) {
        continue;
      }
      if (!String(raw).trim()) {
        continue;
      }
      var tabs = CosTimingImportService._leadingTabCount_(raw);
      var textCol = String(raw).replace(/^\t+/, '');
      if (textCol.length > 48000) {
        textCol = textCol.substring(0, 47997) + '…';
      }
      if (tabs === 0) {
        var split = CosTimingImportService._splitActivityHierarchyRootLine_(
          textCol
        );
        lastIndent0Project = split.project;
        lastIndent0Details = split.details;
      }
      idx++;
      out.push([
        importRunId,
        winStart,
        winEnd,
        blockSize,
        String(minSec),
        String(maxLines),
        String(idx),
        String(tabs),
        textCol,
        lastIndent0Project,
        lastIndent0Details,
        importedAtIso,
      ]);
    }
    return out;
  },

  /**
   * Replaces all rows on RAW_TIMING_ACTIVITY with GET /activity-hierarchy output (finest block: 5min).
   * Fetches **one calendar day per HTTP request** so each day gets the full `max_lines` budget (Timing
   * caps lines per response across the whole `start_date`…`end_date` window, not per day).
   * Not idempotent across runs (sheet is cleared each success).
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {number} nDays inclusive calendar days ending today (sheet TZ), min 1 (invalid → DEFAULT_TIMING_IMPORT_CALENDAR_DAYS)
   * @param {{
   *   blockSize?: string,
   *   minDurationSeconds?: number,
   *   maxLines?: number,
   *   groupByProject?: boolean,
   *   includeMobileDevices?: boolean
   * }} [opt]
   * @returns {Object}
   */
  replaceActivityHierarchyLastNDays: function (ss, nDays, opt) {
    opt = opt || {};
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(120000)) {
      CosLogger.warn('TimingActivityImport: document lock timeout');
      return { ok: false, message: 'Lock timeout' };
    }
    var tz = ss.getSpreadsheetTimeZone();
    var now = new Date();
    var endYmd = cos_formatYmd_(now, tz);
    var spanRaw = Math.floor(Number(nDays));
    var span =
      spanRaw >= 1 && !isNaN(spanRaw)
        ? spanRaw
        : CosTimingConstants.DEFAULT_TIMING_IMPORT_CALENDAR_DAYS;
    var startYmd = cos_ymdAddCalendarDays_(endYmd, -(span - 1), tz);
    var importRunId = Utilities.getUuid();
    var startedAt = new Date().toISOString();
    var importedAt = startedAt;
    var blockSize = String(
      opt.blockSize || CosTimingConstants.ACTIVITY_BLOCK_SIZE
    ).trim();
    var minSec =
      opt.minDurationSeconds != null
        ? Math.floor(Number(opt.minDurationSeconds))
        : CosTimingConstants.ACTIVITY_MIN_DURATION_SECONDS;
    if (isNaN(minSec) || minSec < 0) {
      minSec = CosTimingConstants.ACTIVITY_MIN_DURATION_SECONDS;
    }
    var maxLines =
      opt.maxLines != null
        ? Math.floor(Number(opt.maxLines))
        : CosTimingConstants.ACTIVITY_HIERARCHY_MAX_LINES;
    if (isNaN(maxLines) || maxLines < 1) {
      maxLines = CosTimingConstants.ACTIVITY_HIERARCHY_MAX_LINES;
    }
    maxLines = Math.min(1000, Math.max(1, maxLines));

    /** @type {Array} */
    var logRow = [
      importRunId,
      startedAt,
      '',
      startYmd,
      endYmd,
      0,
      'running',
      '',
    ];

    try {
      var repo = new CosTimingSheetRepository(ss);
      repo.ensureSchema();
      repo.clearActivityDataRows_();

      var lineTotal = 0;
      var dayYmd = startYmd;
      while (String(dayYmd) <= String(endYmd)) {
        var fetch = CosTimingApiClient.fetchActivityHierarchyText(
          dayYmd,
          dayYmd,
          {
            blockSize: blockSize,
            minDurationSeconds: minSec,
            maxLines: maxLines,
            groupByProject: opt.groupByProject,
            includeMobileDevices: opt.includeMobileDevices,
          }
        );
        if (!fetch.ok) {
          logRow[5] = lineTotal;
          logRow[6] = 'failed';
          logRow[7] = String(fetch.error || 'fetch failed');
          logRow[2] = new Date().toISOString();
          repo.appendActivityLogRow(logRow);
          CosLogger.error('Timing activity import: fetch failed', {
            error: logRow[7],
            day: dayYmd,
          });
          return { ok: false, message: logRow[7], importRunId: importRunId };
        }
        var rawLines = String(fetch.text || '').split(/\r?\n/);
        var nonEmpty = 0;
        var zi;
        for (zi = 0; zi < rawLines.length; zi++) {
          if (String(rawLines[zi] || '').trim()) {
            nonEmpty++;
          }
        }
        if (nonEmpty >= maxLines) {
          CosLogger.warn('Timing activity import: day reached max_lines (Timing may truncate)', {
            day: dayYmd,
            maxLines: maxLines,
            nonEmptyLines: nonEmpty,
          });
        }
        var rows = CosTimingImportService._activityRowsFromText_(
          fetch.text || '',
          importRunId,
          dayYmd,
          dayYmd,
          blockSize,
          minSec,
          maxLines,
          importedAt,
          lineTotal
        );
        if (rows.length) {
          repo.appendActivityRows_(rows);
        }
        lineTotal += rows.length;
        dayYmd = cos_ymdAddCalendarDays_(dayYmd, 1, tz);
      }

      logRow[5] = lineTotal;
      logRow[6] = 'ok';
      logRow[7] = '';
      logRow[2] = new Date().toISOString();
      repo.appendActivityLogRow(logRow);

      CosLogger.info('Timing activity import: complete', {
        importRunId: importRunId,
        dateFrom: startYmd,
        dateTo: endYmd,
        linesWritten: lineTotal,
        blockSize: blockSize,
      });

      return {
        ok: true,
        importRunId: importRunId,
        linesWritten: lineTotal,
        dateFrom: startYmd,
        dateTo: endYmd,
      };
    } catch (e) {
      logRow[5] = 0;
      logRow[6] = 'failed';
      logRow[7] = String(e.message || e);
      logRow[2] = new Date().toISOString();
      try {
        var repoE = new CosTimingSheetRepository(ss);
        repoE.ensureSchema();
        repoE.appendActivityLogRow(logRow);
      } catch (e2) {
        CosLogger.error('Timing activity import: log append failed', {
          error: String(e2.message || e2),
        });
      }
      CosLogger.error('Timing activity import: exception', {
        error: logRow[7],
      });
      return { ok: false, message: logRow[7], importRunId: importRunId };
    } finally {
      lock.releaseLock();
    }
  },
};

/**
 * Run from Apps Script editor or menu: import last N calendar days (sheet TZ) into RAW_TIMING_ENTRIES.
 * Uses {@link CosTimingConstants.DEFAULT_TIMING_IMPORT_CALENDAR_DAYS} when called with no args pattern — see body.
 */
function testTimingImportLast2Days() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('testTimingImportLast2Days: no spreadsheet');
    return;
  }
  var d = CosTimingConstants.DEFAULT_TIMING_IMPORT_CALENDAR_DAYS;
  var r = CosTimingImportService.importLastNDays(ss, d, { replaceSheet: true });
  CosLogger.info('testTimingImportLast2Days', r);
  if (r.ok && r.messageHint) {
    CosLogger.info('testTimingImportLast2Days hint', { messageHint: r.messageHint });
  }
  return r;
}

/** @deprecated Use testTimingImportLast2Days (2-day default). */
function testTimingImportLast3Days() {
  return testTimingImportLast2Days();
}

/**
 * Rolling window: last N hours in UTC API bounds (good for a time trigger every N hours).
 * Optional overlapMinutes (e.g. 15) widens lookback to reduce gaps if a run is delayed.
 */
function testTimingImportLastHours() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('testTimingImportLastHours: no spreadsheet');
    return;
  }
  var h = CosTimingConstants.DEFAULT_IMPORT_LOOKBACK_HOURS;
  var r = CosTimingImportService.importLastHours(ss, h, 0);
  CosLogger.info('testTimingImportLastHours', r);
  return r;
}

/**
 * Replaces RAW_TIMING_ACTIVITY with Timing’s finest activity-hierarchy block (5min) for the last N local days
 * ({@link CosTimingConstants.DEFAULT_TIMING_IMPORT_CALENDAR_DAYS}).
 */
function testTimingActivityHierarchyLast2Days() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('testTimingActivityHierarchyLast2Days: no spreadsheet');
    return;
  }
  var d = CosTimingConstants.DEFAULT_TIMING_IMPORT_CALENDAR_DAYS;
  var r = CosTimingImportService.replaceActivityHierarchyLastNDays(ss, d, {});
  CosLogger.info('testTimingActivityHierarchyLast2Days', r);
  return r;
}

/** @deprecated Use testTimingActivityHierarchyLast2Days. */
function testTimingActivityHierarchyLast3Days() {
  return testTimingActivityHierarchyLast2Days();
}

/**
 * Verifies TIMING_API_KEY and fetches today’s time entries (0+ rows OK).
 */
function testTimingApiConnection() {
  var p = CosTimingApiClient.ping();
  CosLogger.info('testTimingApiConnection', p);
  return p;
}
