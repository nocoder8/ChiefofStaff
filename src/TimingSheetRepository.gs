/**
 * RAW_TIMING_ENTRIES, RAW_TIMING_ACTIVITY, and import log sheets on the bound spreadsheet.
 * @constructor
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 */
function CosTimingSheetRepository(spreadsheet) {
  /** @type {GoogleAppsScript.Spreadsheet.Spreadsheet} */
  this._ss = spreadsheet;
}

/**
 * @param {string} name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 * @private
 */
CosTimingSheetRepository.prototype._getOrCreateSheet_ = function (name) {
  var ss = this._ss;
  var sh = ss.getSheetByName(name);
  if (sh) {
    return sh;
  }
  return ss.insertSheet(name);
};

/**
 * Ensures header row matches frozen header list.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {readonly string[]} headers
 * @private
 */
CosTimingSheetRepository.prototype._ensureHeaders_ = function (sheet, headers) {
  var last = sheet.getLastColumn();
  if (last < headers.length) {
    sheet.insertColumnsAfter(Math.max(last, 1), headers.length - last);
  }
  var row1 = sheet
    .getRange(1, 1, 1, headers.length)
    .getValues()[0];
  var needs = false;
  var i;
  for (i = 0; i < headers.length; i++) {
    if (String(row1[i] || '').trim() !== headers[i]) {
      needs = true;
      break;
    }
  }
  if (needs) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  }
};

/**
 * Inserts {@code details} between {@code timing_project_name} and {@code imported_at} when the
 * sheet still has the pre-details layout (imported_at was column K / index 10).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @private
 */
CosTimingSheetRepository.prototype._migrateActivityDetailsColumnIfNeeded_ = function (
  sheet
) {
  var last = sheet.getLastColumn();
  if (last < 11) {
    return;
  }
  var r1 = sheet.getRange(1, 1, 1, last).getValues()[0];
  var wantProj = CosTimingConstants.ACTIVITY_HEADERS[9];
  var wantDetails = CosTimingConstants.ACTIVITY_HEADERS[10];
  var wantImported = CosTimingConstants.ACTIVITY_HEADERS[11];
  if (String(r1[9] || '').trim() !== wantProj) {
    return;
  }
  var c11 = String(r1[10] || '').trim().toLowerCase();
  if (c11 === String(wantDetails).toLowerCase()) {
    return;
  }
  if (c11 === String(wantImported).toLowerCase()) {
    sheet.insertColumnsAfter(10, 1);
  }
};

CosTimingSheetRepository.prototype.ensureSchema = function () {
  var raw = this._getOrCreateSheet_(CosTimingConstants.RAW_SHEET_NAME);
  this._ensureHeaders_(raw, CosTimingConstants.RAW_HEADERS);
  var log = this._getOrCreateSheet_(CosTimingConstants.LOG_SHEET_NAME);
  this._ensureHeaders_(log, CosTimingConstants.LOG_HEADERS);
  var act = this._getOrCreateSheet_(CosTimingConstants.RAW_ACTIVITY_SHEET_NAME);
  this._migrateActivityDetailsColumnIfNeeded_(act);
  this._ensureHeaders_(act, CosTimingConstants.ACTIVITY_HEADERS);
  var alog = this._getOrCreateSheet_(CosTimingConstants.ACTIVITY_LOG_SHEET_NAME);
  this._ensureHeaders_(alog, CosTimingConstants.ACTIVITY_LOG_HEADERS);
};

/**
 * Dense row of exact length for setValues (avoids jagged / sparse arrays).
 * @param {Array} row
 * @param {number} width
 * @returns {Array}
 * @private
 */
CosTimingSheetRepository.prototype._densifyRow_ = function (row, width) {
  row = row || [];
  var out = [];
  var i;
  for (i = 0; i < width; i++) {
    var v = row[i];
    out[i] = v === undefined || v === null ? '' : v;
  }
  return out;
};

/**
 * @returns {Object<string, number>} timing_entry_id → sheet row (1-based)
 */
CosTimingSheetRepository.prototype.getExistingEntryIdToRow = function () {
  var sh = this._ss.getSheetByName(CosTimingConstants.RAW_SHEET_NAME);
  if (!sh) {
    return {};
  }
  var last = sh.getLastRow();
  if (last < CosTimingConstants.FIRST_DATA_ROW) {
    return {};
  }
  /** Sheet.getRange(row, col, numRows, numCols) — not bottom-right corner. */
  var numDataRows = last - CosTimingConstants.FIRST_DATA_ROW + 1;
  var vals = sh
    .getRange(CosTimingConstants.FIRST_DATA_ROW, 1, numDataRows, 1)
    .getValues();
  /** @type {Object<string, number>} */
  var map = {};
  var r;
  for (r = 0; r < vals.length; r++) {
    var id = String(vals[r][0] || '').trim();
    if (id) {
      map[id] = CosTimingConstants.FIRST_DATA_ROW + r;
    }
  }
  return map;
};

/**
 * @param {Array[]} rows same width as RAW_HEADERS
 */
/**
 * Deletes all time-entry data rows on RAW_TIMING_ENTRIES (keeps header row 1).
 */
CosTimingSheetRepository.prototype.clearRawTimingDataRows_ = function () {
  var sh = this._ss.getSheetByName(CosTimingConstants.RAW_SHEET_NAME);
  if (!sh) {
    return;
  }
  var last = sh.getLastRow();
  if (last < CosTimingConstants.FIRST_DATA_ROW) {
    return;
  }
  var n = last - CosTimingConstants.FIRST_DATA_ROW + 1;
  sh.deleteRows(CosTimingConstants.FIRST_DATA_ROW, n);
};

CosTimingSheetRepository.prototype.appendRawRows = function (rows) {
  if (!rows || !rows.length) {
    return;
  }
  var sh = this._ss.getSheetByName(CosTimingConstants.RAW_SHEET_NAME);
  if (!sh) {
    throw new Error('RAW_TIMING_ENTRIES sheet missing');
  }
  var width = CosTimingConstants.RAW_HEADERS.length;
  /** @type {Array[]} */
  var dense = [];
  var j;
  for (j = 0; j < rows.length; j++) {
    if (!Array.isArray(rows[j])) {
      throw new Error('Timing appendRawRows: row ' + j + ' is not an array');
    }
    dense.push(this._densifyRow_(rows[j], width));
  }
  var start = sh.getLastRow() + 1;
  /** Sheet.getRange(row, col, numRows, numCols) — not bottom-right corner. */
  sh.getRange(start, 1, dense.length, width).setValues(dense);
};

/**
 * @param {Array} logRow one row matching LOG_HEADERS
 */
CosTimingSheetRepository.prototype.appendLogRow = function (logRow) {
  var sh = this._ss.getSheetByName(CosTimingConstants.LOG_SHEET_NAME);
  if (!sh) {
    throw new Error('TIMING_IMPORT_LOG sheet missing');
  }
  var width = CosTimingConstants.LOG_HEADERS.length;
  var row = this._densifyRow_(logRow, width);
  var r = sh.getLastRow() + 1;
  /** Sheet.getRange(row, col, numRows, numCols): one log row. */
  sh.getRange(r, 1, 1, width).setValues([row]);
};

/**
 * Deletes all activity data rows (keeps header row 1).
 */
CosTimingSheetRepository.prototype.clearActivityDataRows_ = function () {
  var sh = this._ss.getSheetByName(CosTimingConstants.RAW_ACTIVITY_SHEET_NAME);
  if (!sh) {
    return;
  }
  var last = sh.getLastRow();
  if (last < CosTimingConstants.FIRST_DATA_ROW) {
    return;
  }
  var n = last - CosTimingConstants.FIRST_DATA_ROW + 1;
  sh.deleteRows(CosTimingConstants.FIRST_DATA_ROW, n);
};

/**
 * @param {Array[]} rows matching ACTIVITY_HEADERS
 */
CosTimingSheetRepository.prototype.appendActivityRows_ = function (rows) {
  if (!rows || !rows.length) {
    return;
  }
  var sh = this._ss.getSheetByName(CosTimingConstants.RAW_ACTIVITY_SHEET_NAME);
  if (!sh) {
    throw new Error('RAW_TIMING_ACTIVITY sheet missing');
  }
  var width = CosTimingConstants.ACTIVITY_HEADERS.length;
  var BATCH = 500;
  var offset = 0;
  while (offset < rows.length) {
    var slice = rows.slice(offset, offset + BATCH);
    /** @type {Array[]} */
    var dense = [];
    var j;
    for (j = 0; j < slice.length; j++) {
      dense.push(this._densifyRow_(slice[j], width));
    }
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, dense.length, width).setValues(dense);
    offset += slice.length;
  }
};

/**
 * @param {Array} logRow ACTIVITY_LOG_HEADERS width
 */
CosTimingSheetRepository.prototype.appendActivityLogRow = function (logRow) {
  var sh = this._ss.getSheetByName(CosTimingConstants.ACTIVITY_LOG_SHEET_NAME);
  if (!sh) {
    throw new Error('TIMING_ACTIVITY_IMPORT_LOG sheet missing');
  }
  var width = CosTimingConstants.ACTIVITY_LOG_HEADERS.length;
  var row = this._densifyRow_(logRow, width);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, width).setValues([row]);
};
