/**
 * Rolling retention for RAW_TIMING_ACTIVITY + TIMING_ACTIVITY_IMPORT_LOG (by calendar day in sheet TZ).
 * Each prune keeps rows with window_start_ymd / log date_from ≥ (today − keepDays); run weekly for a rolling window
 * (e.g. 45d) so month boundaries do not wipe data needed for in-week reports.
 * For archiving elsewhere (BigQuery, Drive, another workbook), export before prune or use a separate tool.
 */
var CosTimingRetentionService = {
  /**
   * Drops activity / activity-log rows whose window / range is entirely before the cutoff calendar day.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {number} keepDays keep rows with window_start_ymd >= (today − keepDays) in sheet TZ (min 7, max 366)
   * @returns {{ ok: boolean, message?: string, activityRemoved?: number, activityKept?: number, logRemoved?: number, logKept?: number }}
   */
  pruneActivitySheets: function (ss, keepDays) {
    if (!ss) {
      return { ok: false, message: 'No spreadsheet' };
    }
    var k = Math.floor(Number(keepDays));
    if (isNaN(k) || k < 7) {
      k = CosConstants.DEFAULT_TIMING_ACTIVITY_RETENTION_DAYS;
    }
    if (k > 366) {
      k = 366;
    }
    var tz = ss.getSpreadsheetTimeZone();
    var todayYmd = cos_formatYmd_(new Date(), tz);
    var cutoffYmd = cos_ymdAddCalendarDays_(todayYmd, -k, tz);
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(120000)) {
      return { ok: false, message: 'Lock timeout' };
    }
    try {
      var repo = new CosTimingSheetRepository(ss);
      repo.ensureSchema();
      var act = CosTimingRetentionService._pruneSheetByColumnYmd_(
        ss,
        CosTimingConstants.RAW_ACTIVITY_SHEET_NAME,
        CosTimingConstants.ACTIVITY_HEADERS.length,
        1,
        cutoffYmd
      );
      var log = CosTimingRetentionService._pruneSheetByColumnYmd_(
        ss,
        CosTimingConstants.ACTIVITY_LOG_SHEET_NAME,
        CosTimingConstants.ACTIVITY_LOG_HEADERS.length,
        3,
        cutoffYmd
      );
      CosLogger.info('TimingRetention: prune complete', {
        keepDays: k,
        cutoffYmd: cutoffYmd,
        activity: act,
        activityLog: log,
      });
      return {
        ok: true,
        activityRemoved: act.removed,
        activityKept: act.kept,
        logRemoved: log.removed,
        logKept: log.kept,
      };
    } catch (e) {
      CosLogger.error('TimingRetention: prune failed', {
        error: String(e.message || e),
      });
      return { ok: false, message: String(e.message || e) };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Keeps rows where date column (0-based colIdx) is empty OR >= cutoffYmd (yyyy-MM-dd string compare).
   * @returns {{ removed: number, kept: number }}
   * @private
   */
  _pruneSheetByColumnYmd_: function (ss, sheetName, width, colIdx, cutoffYmd) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) {
      return { removed: 0, kept: 0 };
    }
    var last = sh.getLastRow();
    if (last < CosTimingConstants.FIRST_DATA_ROW) {
      return { removed: 0, kept: 0 };
    }
    var numRows = last - CosTimingConstants.FIRST_DATA_ROW + 1;
    var data = sh
      .getRange(CosTimingConstants.FIRST_DATA_ROW, 1, numRows, width)
      .getValues();
    /** @type {Array[]} */
    var keep = [];
    var i;
    for (i = 0; i < data.length; i++) {
      var row = data[i];
      var y = String(row[colIdx] || '').trim();
      if (!y) {
        keep.push(row);
        continue;
      }
      if (String(y) >= String(cutoffYmd)) {
        keep.push(row);
      }
    }
    if (keep.length === data.length) {
      return { removed: 0, kept: keep.length };
    }
    sh.deleteRows(CosTimingConstants.FIRST_DATA_ROW, numRows);
    if (keep.length) {
      sh.getRange(
        CosTimingConstants.FIRST_DATA_ROW,
        1,
        keep.length,
        width
      ).setValues(keep);
    }
    return { removed: data.length - keep.length, kept: keep.length };
  },
};
