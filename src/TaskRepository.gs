/**
 * Tasks sheet: schema, validation, CRUD, and row ↔ CosTask mapping.
 * Writes use the spreadsheet document lock to reduce lost updates from concurrent runs.
 * @constructor
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 */
function CosTaskRepository(spreadsheet) {
  /** @type {GoogleAppsScript.Spreadsheet.Spreadsheet} */
  this._ss = spreadsheet;
}

// --- Static helpers ---

/**
 * @returns {string}
 */
CosTaskRepository._nowIso_ = function () {
  return new Date().toISOString();
};

/**
 * @param {*} raw ISO string, Date, or empty
 * @returns {Date|string} Date for the sheet cell, or '' / raw if unparseable
 */
CosTaskRepository._parseToSheetDate_ = function (raw) {
  if (raw === undefined || raw === null || raw === '') {
    return '';
  }
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    /** @type {Date} */
    var existing = raw;
    return isNaN(existing.getTime()) ? '' : existing;
  }
  var d = new Date(String(raw).trim());
  return isNaN(d.getTime()) ? String(raw) : d;
};

/**
 * @param {Array} row 0-based row values
 * @param {number} idx
 */
CosTaskRepository._coerceSheetDatetimeCell_ = function (row, idx) {
  var v = row[idx];
  if (v === '' || v === null || v === undefined) {
    return;
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (!isNaN(v.getTime())) {
      return;
    }
  }
  var d = new Date(String(v).trim());
  if (!isNaN(d.getTime())) {
    row[idx] = d;
  }
};

/**
 * @param {*} cell
 * @returns {string}
 */
CosTaskRepository._formatCellDisplay_ = function (cell) {
  if (cell === '' || cell === null || cell === undefined) {
    return '';
  }
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    /** @type {Date} */
    var d = cell;
    return d.toISOString ? d.toISOString() : String(d);
  }
  return String(cell).trim();
};

/**
 * @param {*} cell
 * @returns {string}
 */
CosTaskRepository._durationToString_ = function (cell) {
  if (cell === '' || cell === null || cell === undefined) {
    return '';
  }
  if (typeof cell === 'number' && !isNaN(cell)) {
    return String(Math.round(cell));
  }
  var n = parseInt(String(cell), 10);
  return isNaN(n) ? String(cell).trim() : String(n);
};

/**
 * @param {*} v
 * @returns {number|null} null if missing/invalid
 */
CosTaskRepository._parseDurationNumber_ = function (v) {
  if (v === '' || v === null || v === undefined) {
    return null;
  }
  if (typeof v === 'number' && !isNaN(v)) {
    return Math.round(v) > 0 ? Math.round(v) : null;
  }
  var n = parseInt(String(v), 10);
  return isNaN(n) || n <= 0 ? null : n;
};

/**
 * @param {number|string|undefined} v
 * @returns {number}
 */
CosTaskRepository._normalizeDurationInput_ = function (v) {
  var n = CosTaskRepository._parseDurationNumber_(v);
  if (n === null) {
    return CosConstants.DEFAULT_TASK_DURATION_MINUTES;
  }
  return n;
};

/**
 * @param {*} s
 * @returns {boolean}
 */
CosTaskRepository._isValidPriority_ = function (s) {
  return (
    CosConstants.TASK_PRIORITY_LIST.indexOf(String(s).trim()) >= 0
  );
};

/**
 * @param {*} s
 * @returns {boolean}
 */
CosTaskRepository._isValidStatus_ = function (s) {
  return CosConstants.TASK_STATUS_LIST.indexOf(String(s).trim()) >= 0;
};

/**
 * @param {*} s
 * @returns {boolean}
 */
CosTaskRepository._isValidSource_ = function (s) {
  return CosConstants.TASK_SOURCE_LIST.indexOf(String(s).trim()) >= 0;
};

/**
 * @param {*} s
 * @returns {boolean} true for empty (clear) or allowed list value
 */
CosTaskRepository._isValidClosureStatusValue_ = function (s) {
  var t = String(s === undefined || s === null ? '' : s).trim();
  if (!t) {
    return true;
  }
  return CosConstants.TASK_CLOSURE_STATUS_LIST.indexOf(t) >= 0;
};

/**
 * @param {*} s
 * @returns {boolean}
 */
CosTaskRepository._isValidLastOutcomeValue_ = function (s) {
  var t = String(s === undefined || s === null ? '' : s).trim();
  if (!t) {
    return true;
  }
  return CosConstants.TASK_LAST_OUTCOME_LIST.indexOf(t) >= 0;
};

/**
 * @param {*} cell
 * @returns {string}
 */
CosTaskRepository._missCountFromCell_ = function (cell) {
  if (cell === '' || cell === null || cell === undefined) {
    return '0';
  }
  if (typeof cell === 'number' && !isNaN(cell)) {
    var rn = Math.round(cell);
    return String(rn < 0 ? 0 : rn);
  }
  var n = parseInt(String(cell), 10);
  return isNaN(n) || n < 0 ? '0' : String(n);
};

/**
 * @param {*} raw
 * @returns {number} non-negative int for sheet cell
 */
CosTaskRepository._missCountToCell_ = function (raw) {
  var n = parseInt(String(raw === undefined || raw === null ? '0' : raw).trim(), 10);
  if (isNaN(n) || n < 0) {
    return 0;
  }
  return n;
};

/**
 * @param {Date|string|undefined|null} v
 * @returns {Date|string}
 */
CosTaskRepository._deadlineForCell_ = function (v) {
  if (v === undefined || v === null || v === '') {
    return '';
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v;
  }
  return String(v).trim();
};

/**
 * Coerces patch / slot fields for sheet storage (never the literal "undefined").
 * @param {*} v
 * @returns {string}
 */
CosTaskRepository._patchString_ = function (v) {
  if (v === undefined || v === null) {
    return '';
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.toISOString();
  }
  return String(v).trim();
};

/**
 * Google Sheets API: getRange(row, column, numRows, numColumns) — not R1C1 end coordinates.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} topRow 1-based inclusive
 * @param {number} bottomRow 1-based inclusive
 * @returns {GoogleAppsScript.Spreadsheet.Range}
 */
CosTaskRepository._sheetRangeDataRows_ = function (sheet, topRow, bottomRow) {
  var numCols = CosConstants.TASK_HEADERS.length;
  var numRows = bottomRow - topRow + 1;
  return sheet.getRange(topRow, 1, numRows, numCols);
};

/**
 * One full canonical row (all task columns).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNumber 1-based
 * @returns {GoogleAppsScript.Spreadsheet.Range}
 */
CosTaskRepository._sheetRangeOneFullRow_ = function (sheet, rowNumber) {
  var n = CosConstants.TASK_HEADERS.length;
  return sheet.getRange(rowNumber, 1, 1, n);
};

/**
 * One column, contiguous rows (for data validation).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} topRow 1-based
 * @param {number} numRows
 * @param {number} column 1-based
 * @returns {GoogleAppsScript.Spreadsheet.Range}
 */
CosTaskRepository._sheetRangeOneColumn_ = function (
  sheet,
  topRow,
  numRows,
  column
) {
  return sheet.getRange(topRow, column, numRows, 1);
};

/**
 * @param {Array} row 0-based row values
 * @returns {boolean}
 */
CosTaskRepository.prototype._isBlankDataRow_ = function (row) {
  for (var i = 0; i < row.length; i++) {
    var c = row[i];
    if (c === '' || c === null || c === undefined) {
      continue;
    }
    if (typeof c === 'string' && c.trim() === '') {
      continue;
    }
    return false;
  }
  return true;
};

/**
 * @param {Array} row
 * @private
 */
CosTaskRepository.prototype._padRowLength_ = function (row) {
  var n = CosConstants.TASK_HEADERS.length;
  while (row.length < n) {
    row.push('');
  }
};

/**
 * @param {Array} values 0-based row
 * @param {number} rowNumber 1-based sheet row
 * @returns {CosTask}
 */
CosTaskRepository.prototype._rowValuesToTask_ = function (values, rowNumber) {
  var v = values.slice();
  this._padRowLength_(v);
  return {
    taskId: CosTaskRepository._formatCellDisplay_(v[0]),
    task: CosTaskRepository._formatCellDisplay_(v[1]),
    priority: CosTaskRepository._formatCellDisplay_(v[2]),
    durationMin: CosTaskRepository._durationToString_(v[3]),
    deadline: CosTaskRepository._formatCellDisplay_(v[4]),
    status: CosTaskRepository._formatCellDisplay_(v[5]),
    source: CosTaskRepository._formatCellDisplay_(v[6]),
    sourceRef: CosTaskRepository._formatCellDisplay_(v[7]),
    scheduledStart: CosTaskRepository._formatCellDisplay_(v[8]),
    scheduledEnd: CosTaskRepository._formatCellDisplay_(v[9]),
    calendarEventId: CosTaskRepository._formatCellDisplay_(v[10]),
    notes: CosTaskRepository._formatCellDisplay_(v[11]),
    createdAt: CosTaskRepository._formatCellDisplay_(v[12]),
    updatedAt: CosTaskRepository._formatCellDisplay_(v[13]),
    closureStatus: CosTaskRepository._formatCellDisplay_(v[14]),
    closureRequestedAt: CosTaskRepository._formatCellDisplay_(v[15]),
    completionTimestamp: CosTaskRepository._formatCellDisplay_(v[16]),
    missCount: CosTaskRepository._missCountFromCell_(v[17]),
    lastOutcome: CosTaskRepository._formatCellDisplay_(v[18]),
    lastNudgeAt: CosTaskRepository._formatCellDisplay_(v[19]),
    rowNumber: rowNumber,
  };
};

/**
 * @param {CosTask} task
 * @returns {Array}
 */
CosTaskRepository.prototype._taskToRowValues_ = function (task) {
  return [
    task.taskId,
    task.task,
    task.priority,
    CosTaskRepository._parseDurationNumber_(task.durationMin) !== null
      ? CosTaskRepository._parseDurationNumber_(task.durationMin)
      : CosConstants.DEFAULT_TASK_DURATION_MINUTES,
    task.deadline === '' ? '' : CosTaskRepository._parseToSheetDate_(task.deadline),
    task.status,
    task.source,
    task.sourceRef,
    CosTaskRepository._parseToSheetDate_(task.scheduledStart),
    CosTaskRepository._parseToSheetDate_(task.scheduledEnd),
    task.calendarEventId,
    task.notes,
    CosTaskRepository._parseToSheetDate_(task.createdAt),
    CosTaskRepository._parseToSheetDate_(task.updatedAt),
    task.closureStatus === undefined || task.closureStatus === null
      ? ''
      : String(task.closureStatus).trim(),
    CosTaskRepository._parseToSheetDate_(task.closureRequestedAt),
    CosTaskRepository._parseToSheetDate_(task.completionTimestamp),
    CosTaskRepository._missCountToCell_(task.missCount),
    task.lastOutcome === undefined || task.lastOutcome === null
      ? ''
      : String(task.lastOutcome).trim(),
    CosTaskRepository._parseToSheetDate_(task.lastNudgeAt),
  ];
};

/**
 * @param {function(): *} fn
 * @returns {*}
 * @private
 */
CosTaskRepository.prototype._withDocumentLock_ = function (fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Could not acquire document lock within 30s.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
};

/**
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 * @private
 */
CosTaskRepository.prototype._requireSheet_ = function () {
  var sheet = this._ss.getSheetByName(CosConstants.TASKS_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      'Tasks sheet not found. Run Chief of Staff → Install / Repair first.'
    );
  }
  return sheet;
};

// --- Schema (Phase 1) ---

/**
 * Ensures the Tasks sheet exists, headers are canonical, and validations apply.
 */
CosTaskRepository.prototype.ensureSchema = function () {
  var sheet = this._getOrCreateTasksSheet_();
  this._migrateTaskSheetToV2IfNeeded_(sheet);
  this._ensureCanonicalHeaders_(sheet);
  this._applyValidations_(sheet);
  this._freezeHeaderRow_(sheet);
};

/**
 * Expands a 14-column Tasks sheet to include closure columns (schema v2).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @private
 */
CosTaskRepository.prototype._migrateTaskSheetToV2IfNeeded_ = function (sheet) {
  var expected = CosConstants.TASK_HEADERS;
  var nLegacy = CosConstants.TASK_HEADERS_LEGACY_COLUMN_COUNT;
  var lastCol = sheet.getLastColumn();
  if (lastCol >= expected.length) {
    return;
  }
  if (lastCol !== nLegacy) {
    return;
  }
  var header = sheet
    .getRange(1, 1, 1, nLegacy)
    .getValues()[0]
    .map(function (c) {
      return String(c).trim();
    });
  var wantLegacy = expected.slice(0, nLegacy);
  var i;
  for (i = 0; i < nLegacy; i++) {
    if (header[i] !== wantLegacy[i]) {
      return;
    }
  }
  sheet.getRange(1, 1, 1, expected.length).setValues([expected.slice()]);
  CosLogger.info('Tasks sheet migrated to closure schema', {
    fromCols: nLegacy,
    toCols: expected.length,
  });
};

/**
 * Validates header row and basic shape.
 * @returns {CosTasksSheetValidation}
 */
CosTaskRepository.prototype.validateSheet = function () {
  var messages = [];
  var sheet = this._ss.getSheetByName(CosConstants.TASKS_SHEET_NAME);
  if (!sheet) {
    messages.push('Tasks sheet is missing.');
    return { ok: false, messages: messages };
  }

  var headerCheck = this._readHeaderRow_(sheet);
  if (!headerCheck.ok) {
    messages = messages.concat(headerCheck.messages);
    return { ok: false, messages: messages };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var expectedCols = CosConstants.TASK_HEADERS.length;

  if (lastCol > 0 && lastCol !== expectedCols) {
    messages.push(
      'Column count is ' +
        lastCol +
        '; expected ' +
        expectedCols +
        ' for canonical schema.'
    );
  }

  if (lastRow > 0 && lastRow < CosConstants.TASKS_HEADER_ROW) {
    messages.push('Sheet has no header row.');
    return { ok: false, messages: messages };
  }

  return {
    ok: messages.length === 0,
    messages: messages,
  };
};

/**
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
CosTaskRepository.prototype.getTasksSheet = function () {
  return this._ss.getSheetByName(CosConstants.TASKS_SHEET_NAME);
};

/**
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 * @private
 */
CosTaskRepository.prototype._getOrCreateTasksSheet_ = function () {
  var name = CosConstants.TASKS_SHEET_NAME;
  var sheet = this._ss.getSheetByName(name);
  if (sheet) {
    return sheet;
  }
  sheet = this._ss.insertSheet(name);
  return sheet;
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @private
 */
CosTaskRepository.prototype._ensureCanonicalHeaders_ = function (sheet) {
  var expected = CosConstants.TASK_HEADERS.slice();
  var check = this._readHeaderRow_(sheet);

  if (check.ok) {
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow === 0 || this._rowIsAllEmpty_(sheet, 1, expected.length)) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
    return;
  }

  if (lastRow > CosConstants.TASKS_HEADER_ROW) {
    throw new Error(
      'Tasks sheet headers do not match the canonical schema and data rows exist. ' +
        'Fix headers manually or move data before running Install.'
    );
  }

  sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} row 1-based
 * @param {number} numCols
 * @returns {boolean}
 * @private
 */
CosTaskRepository.prototype._rowIsAllEmpty_ = function (sheet, row, numCols) {
  var rowVals = sheet.getRange(row, 1, 1, numCols).getValues()[0];
  for (var i = 0; i < rowVals.length; i++) {
    if (rowVals[i] !== '' && rowVals[i] !== null && rowVals[i] !== undefined) {
      return false;
    }
  }
  return true;
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {{ ok: boolean, messages: string[] }}
 * @private
 */
CosTaskRepository.prototype._readHeaderRow_ = function (sheet) {
  var expected = CosConstants.TASK_HEADERS;
  var lastCol = sheet.getLastColumn();
  if (lastCol < expected.length) {
    return {
      ok: false,
      messages: [
        'Header row is missing or incomplete (expected ' +
          expected.length +
          ' columns).',
      ],
    };
  }

  var actual = sheet
    .getRange(1, 1, 1, expected.length)
    .getValues()[0]
    .map(function (cell) {
      return String(cell).trim();
    });

  for (var i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      return {
        ok: false,
        messages: [
          'Header mismatch at column ' +
            (i + 1) +
            ': found "' +
            actual[i] +
            '", expected "' +
            expected[i] +
            '".',
        ],
      };
    }
  }
  return { ok: true, messages: [] };
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @private
 */
CosTaskRepository.prototype._applyValidations_ = function (sheet) {
  var start = CosConstants.TASKS_FIRST_DATA_ROW;
  var numCols = CosConstants.TASK_HEADERS.length;

  var maxRow = sheet.getMaxRows();
  // Strip all rules in the task column block (row 1 through sheet bottom) before
  // re-applying only C/F/G. One range avoids redundant clears and missed pockets.
  sheet.getRange(1, 1, maxRow, numCols).clearDataValidations();

  // Apply lists through the whole sheet height so new rows get dropdowns.
  var dataRegionNumRows = maxRow - start + 1;

  var priorityCol = CosConstants.COL.PRIORITY;
  var statusCol = CosConstants.COL.STATUS;
  var sourceCol = CosConstants.COL.SOURCE;
  var closureCol = CosConstants.COL.CLOSURE_STATUS;
  var outcomeCol = CosConstants.COL.LAST_OUTCOME;

  var priorityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CosConstants.TASK_PRIORITY_LIST, true)
    .setAllowInvalid(false)
    .build();

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CosConstants.TASK_STATUS_LIST, true)
    .setAllowInvalid(false)
    .build();

  var sourceRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CosConstants.TASK_SOURCE_LIST, true)
    .setAllowInvalid(false)
    .build();

  var closureRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CosConstants.TASK_CLOSURE_STATUS_LIST, true)
    .setAllowInvalid(true)
    .build();

  var outcomeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CosConstants.TASK_LAST_OUTCOME_LIST, true)
    .setAllowInvalid(true)
    .build();

  if (dataRegionNumRows > 0) {
    CosTaskRepository._sheetRangeOneColumn_(
      sheet,
      start,
      dataRegionNumRows,
      priorityCol
    ).setDataValidation(priorityRule);
    CosTaskRepository._sheetRangeOneColumn_(
      sheet,
      start,
      dataRegionNumRows,
      statusCol
    ).setDataValidation(statusRule);
    CosTaskRepository._sheetRangeOneColumn_(
      sheet,
      start,
      dataRegionNumRows,
      sourceCol
    ).setDataValidation(sourceRule);
    CosTaskRepository._sheetRangeOneColumn_(
      sheet,
      start,
      dataRegionNumRows,
      closureCol
    ).setDataValidation(closureRule);
    CosTaskRepository._sheetRangeOneColumn_(
      sheet,
      start,
      dataRegionNumRows,
      outcomeCol
    ).setDataValidation(outcomeRule);
  }

  this._applyDateTimeDisplayFormats_(sheet);
};

/**
 * Human-readable local date/time display (uses spreadsheet timezone for Date cells).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @private
 */
CosTaskRepository.prototype._applyDateTimeDisplayFormats_ = function (sheet) {
  var fmt = CosConstants.TASK_DATETIME_DISPLAY_FORMAT;
  var start = CosConstants.TASKS_FIRST_DATA_ROW;
  var maxRow = sheet.getMaxRows();
  var numRows = maxRow - start + 1;
  if (numRows <= 0) {
    return;
  }
  var cols = CosConstants.DATETIME_DISPLAY_COLUMNS;
  var i;
  for (i = 0; i < cols.length; i++) {
    CosTaskRepository._sheetRangeOneColumn_(
      sheet,
      start,
      numRows,
      cols[i]
    ).setNumberFormat(fmt);
  }
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @private
 */
CosTaskRepository.prototype._freezeHeaderRow_ = function (sheet) {
  sheet.setFrozenRows(1);
};

// --- Reads ---

/**
 * @returns {CosTask[]}
 */
CosTaskRepository.prototype.fetchAllTasks = function () {
  var sheet = this._requireSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < CosConstants.TASKS_FIRST_DATA_ROW) {
    return [];
  }
  var data = CosTaskRepository._sheetRangeDataRows_(
    sheet,
    CosConstants.TASKS_FIRST_DATA_ROW,
    lastRow
  ).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    this._padRowLength_(row);
    if (this._isBlankDataRow_(row)) {
      continue;
    }
    out.push(
      this._rowValuesToTask_(row, CosConstants.TASKS_FIRST_DATA_ROW + i)
    );
  }
  return out;
};

/**
 * @returns {CosTask[]}
 */
CosTaskRepository.prototype.fetchPendingTasks = function () {
  var all = this.fetchAllTasks();
  var pend = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].status === CosConstants.TASK_STATUS.PENDING) {
      pend.push(all[i]);
    }
  }
  return pend;
};

/**
 * @param {string} taskId
 * @returns {CosTask|null}
 */
CosTaskRepository.prototype.fetchByTaskId = function (taskId) {
  var id = String(taskId).trim();
  if (!id) {
    return null;
  }
  var sheet = this._requireSheet_();
  var row = this._findRowIndexByTaskId_(sheet, id);
  if (row < 0) {
    return null;
  }
  return this._readTaskAtRow_(sheet, row);
};

/**
 * Pending + Scheduled tasks whose title matches a search string (Telegram NL reschedule/drop).
 * @param {string} query
 * @param {number} limit
 * @returns {CosTask[]}
 */
CosTaskRepository.prototype.searchTasksForTelegramEdit = function (query, limit) {
  var q = String(query || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  var max = Math.max(1, Math.min(8, parseInt(String(limit), 10) || 5));
  if (!q || q.length < 2) {
    return [];
  }
  var tokens = q.split(' ').filter(function (t) {
    return t.length > 0;
  });
  var all = this.fetchAllTasks();
  var scored = [];
  var i;
  for (i = 0; i < all.length; i++) {
    var t = all[i];
    var st = String(t.status || '').trim();
    if (
      st !== CosConstants.TASK_STATUS.PENDING &&
      st !== CosConstants.TASK_STATUS.SCHEDULED
    ) {
      continue;
    }
    var title = String(t.task || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      continue;
    }
    var score = 0;
    if (title.indexOf(q) >= 0) {
      score = 1000 + q.length;
    } else {
      var j;
      var tokHits = 0;
      for (j = 0; j < tokens.length; j++) {
        if (tokens[j].length >= 2 && title.indexOf(tokens[j]) >= 0) {
          tokHits++;
        }
      }
      if (tokHits === 0) {
        continue;
      }
      score = tokHits * 100;
    }
    var updRaw = new Date(String(t.updatedAt || '').trim()).getTime();
    var upd = isNaN(updRaw) ? 0 : updRaw;
    scored.push({ task: t, score: score, upd: upd });
  }
  scored.sort(function (a, b) {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.upd - a.upd;
  });
  var out = [];
  for (i = 0; i < scored.length && i < max; i++) {
    out.push(scored[i].task);
  }
  return out;
};

/**
 * Drop a Pending or Scheduled task (calendar event removed if present).
 * @param {string} taskId
 * @returns {CosTask|null}
 */
CosTaskRepository.prototype.dropPendingOrScheduledTask = function (taskId) {
  var id = String(taskId || '').trim();
  if (!id) {
    return null;
  }
  var task = this.fetchByTaskId(id);
  if (!task) {
    return null;
  }
  var st = String(task.status || '').trim();
  if (
    st !== CosConstants.TASK_STATUS.PENDING &&
    st !== CosConstants.TASK_STATUS.SCHEDULED
  ) {
    return null;
  }
  var cal = CosCalendarRepository.fromSettings(
    new CosSettingsRepository().getSettings()
  );
  CosTaskClosureService._deleteCalendarIfLinked_(cal, task);
  return this.updateTask(id, {
    status: CosConstants.TASK_STATUS.DROPPED,
    lastOutcome: CosConstants.TASK_LAST_OUTCOME.DROPPED,
    scheduledStart: '',
    scheduledEnd: '',
    calendarEventId: '',
    closureStatus: '',
    closureRequestedAt: '',
  });
};

// --- Writes ---

/**
 * @param {CosTaskCreateInput} input
 * @returns {CosTask}
 */
CosTaskRepository.prototype.createTask = function (input) {
  var self = this;
  return this._withDocumentLock_(function () {
    if (!input || !String(input.task || '').trim()) {
      throw new Error('createTask: "task" title is required.');
    }
    var sheet = self._requireSheet_();
    var now = CosTaskRepository._nowIso_();
    var task = {
      taskId: Utilities.getUuid(),
      task: String(input.task).trim(),
      priority: CosTaskRepository._isValidPriority_(input.priority)
        ? String(input.priority).trim()
        : CosConstants.TASK_PRIORITY.P2,
      durationMin: String(
        CosTaskRepository._normalizeDurationInput_(input.durationMin)
      ),
      deadline: CosTaskRepository._formatCellDisplay_(
        CosTaskRepository._deadlineForCell_(input.deadline)
      ),
      status: CosTaskRepository._isValidStatus_(input.status)
        ? String(input.status).trim()
        : CosConstants.TASK_STATUS.PENDING,
      source:
        input.source && CosTaskRepository._isValidSource_(input.source)
          ? String(input.source).trim()
          : CosConstants.TASK_SOURCE.MANUAL,
      sourceRef: input.sourceRef ? String(input.sourceRef).trim() : '',
      scheduledStart: '',
      scheduledEnd: '',
      calendarEventId: '',
      notes: input.notes ? String(input.notes).trim() : '',
      createdAt: now,
      updatedAt: now,
      closureStatus: '',
      closureRequestedAt: '',
      completionTimestamp: '',
      missCount: '0',
      lastOutcome: '',
      lastNudgeAt: '',
      rowNumber: 0,
    };

    var rowVals = self._taskToRowValues_(task);
    var nextRow =
      Math.max(sheet.getLastRow(), CosConstants.TASKS_HEADER_ROW) + 1;
    CosTaskRepository._sheetRangeOneFullRow_(sheet, nextRow).setValues([
      rowVals,
    ]);

    self._applyValidations_(sheet);
    task.rowNumber = nextRow;
    CosLogger.info('Task created', { taskId: task.taskId, row: nextRow });
    return task;
  });
};

/**
 * @param {string} taskId
 * @param {CosTaskUpdatePatch} patch
 * @returns {CosTask|null}
 */
CosTaskRepository.prototype.updateTask = function (taskId, patch) {
  var self = this;
  return this._withDocumentLock_(function () {
    var id = String(taskId).trim();
    if (!id || !patch) {
      return null;
    }
    var sheet = self._requireSheet_();
    var found = self._findRowIndexByTaskId_(sheet, id);
    if (found < 0) {
      return null;
    }
    if (Object.keys(patch).length === 0) {
      return self._readTaskAtRow_(sheet, found);
    }
    var task = self._readTaskAtRow_(sheet, found);
    if (patch.task !== undefined) {
      var nextTitle = CosTaskRepository._patchString_(patch.task);
      if (!nextTitle) {
        throw new Error('updateTask: task title cannot be empty.');
      }
      task.task = nextTitle;
    }
    if (patch.priority !== undefined) {
      task.priority = CosTaskRepository._isValidPriority_(patch.priority)
        ? CosTaskRepository._patchString_(patch.priority)
        : task.priority;
    }
    if (patch.durationMin !== undefined) {
      var dn = CosTaskRepository._parseDurationNumber_(patch.durationMin);
      task.durationMin =
        dn !== null ? String(dn) : String(CosConstants.DEFAULT_TASK_DURATION_MINUTES);
    }
    if (patch.deadline !== undefined) {
      task.deadline = CosTaskRepository._formatCellDisplay_(
        CosTaskRepository._deadlineForCell_(patch.deadline)
      );
    }
    if (patch.status !== undefined) {
      task.status = CosTaskRepository._isValidStatus_(patch.status)
        ? CosTaskRepository._patchString_(patch.status)
        : task.status;
    }
    if (patch.source !== undefined) {
      task.source = CosTaskRepository._isValidSource_(patch.source)
        ? CosTaskRepository._patchString_(patch.source)
        : task.source;
    }
    if (patch.sourceRef !== undefined) {
      task.sourceRef = CosTaskRepository._patchString_(patch.sourceRef);
    }
    if (patch.scheduledStart !== undefined) {
      task.scheduledStart = CosTaskRepository._patchString_(patch.scheduledStart);
    }
    if (patch.scheduledEnd !== undefined) {
      task.scheduledEnd = CosTaskRepository._patchString_(patch.scheduledEnd);
    }
    if (patch.calendarEventId !== undefined) {
      task.calendarEventId = CosTaskRepository._patchString_(patch.calendarEventId);
    }
    if (patch.notes !== undefined) {
      task.notes = CosTaskRepository._patchString_(patch.notes);
    }
    if (patch.closureStatus !== undefined) {
      task.closureStatus = CosTaskRepository._isValidClosureStatusValue_(
        patch.closureStatus
      )
        ? CosTaskRepository._patchString_(patch.closureStatus)
        : task.closureStatus;
    }
    if (patch.closureRequestedAt !== undefined) {
      if (patch.closureRequestedAt === '' || patch.closureRequestedAt === null) {
        task.closureRequestedAt = '';
      } else {
        var crd = CosTaskRepository._parseToSheetDate_(patch.closureRequestedAt);
        task.closureRequestedAt =
          crd === '' ? '' : CosTaskRepository._formatCellDisplay_(crd);
      }
    }
    if (patch.completionTimestamp !== undefined) {
      if (patch.completionTimestamp === '') {
        task.completionTimestamp = '';
      } else {
        var cts = CosTaskRepository._parseToSheetDate_(patch.completionTimestamp);
        task.completionTimestamp =
          cts === '' ? '' : CosTaskRepository._formatCellDisplay_(cts);
      }
    }
    if (patch.missCount !== undefined) {
      task.missCount = String(CosTaskRepository._missCountToCell_(patch.missCount));
    }
    if (patch.lastOutcome !== undefined) {
      task.lastOutcome = CosTaskRepository._isValidLastOutcomeValue_(
        patch.lastOutcome
      )
        ? CosTaskRepository._patchString_(patch.lastOutcome)
        : task.lastOutcome;
    }
    if (patch.lastNudgeAt !== undefined) {
      if (patch.lastNudgeAt === '') {
        task.lastNudgeAt = '';
      } else {
        var lna = CosTaskRepository._parseToSheetDate_(patch.lastNudgeAt);
        task.lastNudgeAt =
          lna === '' ? '' : CosTaskRepository._formatCellDisplay_(lna);
      }
    }
    if (
      task.status === CosConstants.TASK_STATUS.SCHEDULED &&
      String(task.scheduledStart || '').trim()
    ) {
      var strippedNotes = CosTaskSchedulerService.stripJeevesDeferTagsFromNotes_(
        task.notes || ''
      );
      if (strippedNotes !== task.notes) {
        task.notes = strippedNotes;
      }
    }
    task.updatedAt = CosTaskRepository._nowIso_();
    self._writeTaskAtRow_(sheet, found, task);
    self._applyValidations_(sheet);
    CosLogger.info('Task updated', { taskId: id, row: found });
    return task;
  });
};

/**
 * @param {string} taskId
 * @param {{ scheduledStart: string, scheduledEnd: string, calendarEventId: string }} slot
 * @returns {CosTask|null}
 */
CosTaskRepository.prototype.markScheduled = function (taskId, slot) {
  if (!slot || typeof slot !== 'object') {
    CosLogger.error('markScheduled: slot object required', { taskId: taskId });
    return null;
  }
  return this.updateTask(taskId, {
    status: CosConstants.TASK_STATUS.SCHEDULED,
    scheduledStart: slot.scheduledStart,
    scheduledEnd: slot.scheduledEnd,
    calendarEventId: slot.calendarEventId,
  });
};

/**
 * @param {string} taskId
 * @returns {CosTask|null}
 */
CosTaskRepository.prototype.markDone = function (taskId) {
  return this.updateTask(taskId, {
    status: CosConstants.TASK_STATUS.DONE,
  });
};

/**
 * @param {string} taskId
 * @param {string=} message appended to Notes
 * @returns {CosTask|null}
 */
CosTaskRepository.prototype.markError = function (taskId, message) {
  var self = this;
  return this._withDocumentLock_(function () {
    var id = String(taskId).trim();
    if (!id) {
      return null;
    }
    var sheet = self._requireSheet_();
    var rowNum = self._findRowIndexByTaskId_(sheet, id);
    if (rowNum < 0) {
      return null;
    }
    var task = self._readTaskAtRow_(sheet, rowNum);
    var stamp = CosTaskRepository._nowIso_();
    var extra = message ? String(message).trim() : '';
    if (extra) {
      task.notes = task.notes
        ? task.notes + '\n[' + stamp + '] ' + extra
        : '[' + stamp + '] ' + extra;
    }
    task.status = CosConstants.TASK_STATUS.ERROR;
    task.updatedAt = stamp;
    self._writeTaskAtRow_(sheet, rowNum, task);
    self._applyValidations_(sheet);
    CosLogger.warn('Task marked error', { taskId: id, row: rowNum });
    return task;
  });
};

/**
 * Fills missing Task IDs, defaults, timestamps; fixes duplicate Task IDs (keeps first row).
 * @returns {CosNormalizeTasksResult}
 */
CosTaskRepository.prototype.normalizeExistingRows = function () {
  var self = this;
  return this._withDocumentLock_(function () {
    var sheet = self._requireSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < CosConstants.TASKS_FIRST_DATA_ROW) {
      return { rowsScanned: 0, rowsUpdated: 0, duplicateIdsFixed: 0 };
    }
    var range = CosTaskRepository._sheetRangeDataRows_(
      sheet,
      CosConstants.TASKS_FIRST_DATA_ROW,
      lastRow
    );
    var rows = range.getValues();
    var updated = 0;
    for (var i = 0; i < rows.length; i++) {
      self._padRowLength_(rows[i]);
      if (self._isBlankDataRow_(rows[i])) {
        continue;
      }
      if (self._normalizeRowInPlace_(rows[i])) {
        updated++;
      }
    }
    var dups = self._fixDuplicateTaskIdsInPlace_(rows);
    if (updated > 0 || dups > 0) {
      range.setValues(rows);
      self._applyValidations_(sheet);
    }
    var scanned = 0;
    for (var j = 0; j < rows.length; j++) {
      if (!self._isBlankDataRow_(rows[j])) {
        scanned++;
      }
    }
    CosLogger.info('normalizeExistingRows complete', {
      rowsScanned: scanned,
      rowsUpdated: updated,
      duplicateIdsFixed: dups,
    });
    return {
      rowsScanned: scanned,
      rowsUpdated: updated,
      duplicateIdsFixed: dups,
    };
  });
};

/**
 * @param {Array} row 0-based, mutated
 * @returns {boolean} true if row was modified
 * @private
 */
CosTaskRepository.prototype._normalizeRowInPlace_ = function (row) {
  if (typeof row[1] === 'string') {
    row[1] = row[1].trim();
  }
  var changed = false;
  var id = row[0] === null || row[0] === undefined ? '' : String(row[0]).trim();
  if (!id) {
    row[0] = Utilities.getUuid();
    changed = true;
  }
  if (!CosTaskRepository._isValidPriority_(row[2])) {
    row[2] = CosConstants.TASK_PRIORITY.P2;
    changed = true;
  }
  if (!CosTaskRepository._isValidStatus_(row[5])) {
    row[5] = CosConstants.TASK_STATUS.PENDING;
    changed = true;
  }
  var src = row[6] === null || row[6] === undefined ? '' : String(row[6]).trim();
  if (!src || !CosTaskRepository._isValidSource_(row[6])) {
    row[6] = CosConstants.TASK_SOURCE.MANUAL;
    changed = true;
  }
  if (CosTaskRepository._parseDurationNumber_(row[3]) === null) {
    row[3] = CosConstants.DEFAULT_TASK_DURATION_MINUTES;
    changed = true;
  } else {
    row[3] = CosTaskRepository._parseDurationNumber_(row[3]);
  }
  var cr =
    row[12] === null || row[12] === undefined ? '' : String(row[12]).trim();
  if (!cr) {
    row[12] = new Date();
    changed = true;
  }
  var up =
    row[13] === null || row[13] === undefined ? '' : String(row[13]).trim();
  if (changed) {
    row[13] = new Date();
  } else if (!up) {
    row[13] = new Date();
    changed = true;
  }
  if (
    row[17] === '' ||
    row[17] === null ||
    row[17] === undefined ||
    (typeof row[17] === 'string' && String(row[17]).trim() === '')
  ) {
    row[17] = 0;
    changed = true;
  }
  CosTaskRepository._coerceSheetDatetimeCell_(row, 4);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 8);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 9);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 12);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 13);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 15);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 16);
  CosTaskRepository._coerceSheetDatetimeCell_(row, 19);
  return changed;
};

/**
 * @param {Array[]} rows
 * @returns {number} count of duplicate ids reassigned
 * @private
 */
CosTaskRepository.prototype._fixDuplicateTaskIdsInPlace_ = function (rows) {
  var seen = {};
  var fixed = 0;
  for (var i = 0; i < rows.length; i++) {
    if (this._isBlankDataRow_(rows[i])) {
      continue;
    }
    var id = String(rows[i][0]).trim();
    if (!id) {
      continue;
    }
    if (seen[id]) {
      rows[i][0] = Utilities.getUuid();
      rows[i][13] = new Date();
      fixed++;
    } else {
      seen[id] = true;
    }
  }
  return fixed;
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} taskId
 * @returns {number} 1-based row or -1
 * @private
 */
CosTaskRepository.prototype._findRowIndexByTaskId_ = function (sheet, taskId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < CosConstants.TASKS_FIRST_DATA_ROW) {
    return -1;
  }
  var data = CosTaskRepository._sheetRangeDataRows_(
    sheet,
    CosConstants.TASKS_FIRST_DATA_ROW,
    lastRow
  ).getValues();
  var want = String(taskId).trim();
  for (var i = 0; i < data.length; i++) {
    this._padRowLength_(data[i]);
    if (this._isBlankDataRow_(data[i])) {
      continue;
    }
    var cell = data[i][0];
    var id = cell === null || cell === undefined ? '' : String(cell).trim();
    if (id === want) {
      return CosConstants.TASKS_FIRST_DATA_ROW + i;
    }
  }
  return -1;
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNumber 1-based
 * @returns {CosTask}
 * @private
 */
CosTaskRepository.prototype._readTaskAtRow_ = function (sheet, rowNumber) {
  var row = CosTaskRepository._sheetRangeOneFullRow_(sheet, rowNumber)
    .getValues()[0];
  this._padRowLength_(row);
  return this._rowValuesToTask_(row, rowNumber);
};

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNumber 1-based
 * @param {CosTask} task
 * @private
 */
CosTaskRepository.prototype._writeTaskAtRow_ = function (
  sheet,
  rowNumber,
  task
) {
  var rowVals = this._taskToRowValues_(task);
  CosTaskRepository._sheetRangeOneFullRow_(sheet, rowNumber).setValues([
    rowVals,
  ]);
};
