/**
 * Public entrypoints: spreadsheet menu, open handler, and trigger-safe stubs.
 * Keep orchestration thin; delegate to Bootstrap and repositories.
 *
 * Operator docs: README.md at repository root (not bundled into Apps Script).
 */

/**
 * Installs the custom menu when the spreadsheet is opened.
 * @param {Object=} e Open event (optional in some run contexts)
 */
function onOpen(e) {
  try {
    CosMainMenu.build().addToUi();
  } catch (err) {
    CosLogger.warn('Could not add spreadsheet menu (UI unavailable in this context).', {
      error: String(err),
    });
  }
}

/**
 * Chief of Staff → Install / Repair
 */
function menuInstallChiefOfStaff() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuInstallChiefOfStaff: no active spreadsheet');
    return;
  }
  var result = CosBootstrap.installChiefOfStaff();
  var msg = result.ok
    ? CosConstants.PRODUCT_NAME + ': install finished.'
    : CosConstants.PRODUCT_NAME + ': install failed — ' + result.message;
  if (result.ok && result.triggers) {
    var tr = result.triggers;
    if (tr.ok) {
      msg +=
        ' Triggers: ' +
        (tr.installed.length
          ? tr.installed.join(' · ')
          : 'none (enable EMAIL_TASKS_ENABLED, DAILY_DIGEST_ENABLED, or keep schedule trigger on).');
    } else {
      msg += ' Triggers failed — ' + (tr.message || 'unknown') + ' (use Sync time triggers).';
    }
  }
  if (result.ok && result.gmailLabels) {
    var gl = result.gmailLabels;
    if (gl.ok) {
      msg +=
        ' Jeeves labels: ' +
        gl.created.length +
        ' created, ' +
        gl.existing.length +
        ' already present.';
    } else {
      msg +=
        ' Gmail labels skipped — authorize Gmail (Extensions → Apps Script → Run) then Install or “Create Gmail labels”.';
    }
  }
  ss.toast(msg, CosConstants.PRODUCT_NAME, 12);
}

/**
 * Chief of Staff → Validate Tasks sheet
 */
function menuValidateTasksSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuValidateTasksSheet: no active spreadsheet');
    return;
  }
  var repo = new CosTaskRepository(ss);
  var v = repo.validateSheet();
  if (v.ok) {
    ss.toast('Tasks sheet looks valid.', CosConstants.PRODUCT_NAME, 5);
    CosLogger.info('Tasks sheet validation OK');
    return;
  }
  ss.toast(
    'Validation issues — see Logs / Executions in the script editor.',
    CosConstants.PRODUCT_NAME,
    8
  );
  CosLogger.warn('Tasks sheet validation failed', { messages: v.messages });
}

/**
 * Chief of Staff → Add sample task
 */
function menuAddSampleTask() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuAddSampleTask: no active spreadsheet');
    return;
  }
  try {
    var repo = new CosTaskRepository(ss);
    var task = repo.createTask({
      task: 'Sample: Review Chief of Staff setup',
      priority: CosConstants.TASK_PRIORITY.P2,
      durationMin: CosConstants.DEFAULT_TASK_DURATION_MINUTES,
      notes: 'Created from menu; delete or edit as needed.',
    });
    ss.toast(
      'Sample task added (row ' + task.rowNumber + ').',
      CosConstants.PRODUCT_NAME,
      6
    );
    CosLogger.info('Sample task created', { taskId: task.taskId });
  } catch (e) {
    CosLogger.error('menuAddSampleTask failed', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Normalize task rows
 */
function menuNormalizeTaskRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuNormalizeTaskRows: no active spreadsheet');
    return;
  }
  try {
    var repo = new CosTaskRepository(ss);
    var r = repo.normalizeExistingRows();
    ss.toast(
      'Normalized: ' +
        r.rowsUpdated +
        ' row(s) updated, ' +
        r.duplicateIdsFixed +
        ' duplicate id(s) fixed (scanned ' +
        r.rowsScanned +
        ').',
      CosConstants.PRODUCT_NAME,
      10
    );
    CosLogger.info('normalizeExistingRows', r);
  } catch (e) {
    CosLogger.error('menuNormalizeTaskRows failed', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Create / repair Gmail labels ([Jeeves])
 */
function menuEnsureJeevesGmailLabels() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuEnsureJeevesGmailLabels: no active spreadsheet');
    return;
  }
  try {
    var r = CosGmailLabelService.ensureJeevesLabels();
    ss.toast(
      'Jeeves: ' +
        r.created.length +
        ' label(s) created, ' +
        r.existing.length +
        ' already existed.',
      CosConstants.PRODUCT_NAME,
      10
    );
    CosLogger.info('menuEnsureJeevesGmailLabels', r);
  } catch (e) {
    CosLogger.error('menuEnsureJeevesGmailLabels failed', { error: String(e) });
    ss.toast(
      'Gmail labels failed: ' +
        String(e.message || e) +
        ' — open the script editor and run once to grant Gmail access.',
      CosConstants.PRODUCT_NAME,
      12
    );
  }
}

/**
 * Chief of Staff → Process Gmail → Tasks (runs even if EMAIL_TASKS_ENABLED is false)
 */
function menuProcessGmailInbox() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuProcessGmailInbox: no spreadsheet');
    return;
  }
  try {
    var r = CosEmailIngestionService.processInbox(ss, { force: true });
    var msg = !r.ok
      ? 'Gmail ingest failed: ' + (r.message || 'unknown')
      : r.scanned === 0
        ? 'No threads to ingest (need [Jeeves]/task or [Jeeves]/follow-up without [Jeeves]/ok).'
        : 'Gmail: +' +
          r.created +
          ' task(s), skipped ' +
          r.skipped +
          ', failed ' +
          r.failed +
          ' (of ' +
          r.scanned +
          ').';
    ss.toast(msg, CosConstants.PRODUCT_NAME, 12);
    CosLogger.info('menuProcessGmailInbox', r);
  } catch (e) {
    CosLogger.error('menuProcessGmailInbox', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 12);
  }
}

/**
 * Chief of Staff → Sync time triggers (from Script Properties)
 */
function menuSyncTimeTriggers() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuSyncTimeTriggers: no spreadsheet');
    return;
  }
  try {
    var settings = new CosSettingsRepository().getSettings();
    var r = CosTriggerService.syncFromSettings(
      settings,
      ss.getSpreadsheetTimeZone()
    );
    var msg = r.ok
      ? r.installed.length
        ? 'Triggers: ' + r.installed.join(' · ')
        : 'No triggers (see EMAIL_TASKS_ENABLED, DAILY_DIGEST_ENABLED, SCHEDULE_PENDING_TRIGGER_ENABLED).'
      : 'Trigger sync failed: ' + (r.message || 'unknown');
    ss.toast(msg, CosConstants.PRODUCT_NAME, 14);
    CosLogger.info('menuSyncTimeTriggers', r);
  } catch (e) {
    CosLogger.error('menuSyncTimeTriggers', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 12);
  }
}

/**
 * Chief of Staff → Run system health check (Phase 6 — sheets, properties, calendar, Gmail, triggers)
 */
function menuRunSystemHealthCheck() {
  var ssUi =
    SpreadsheetApp.getActiveSpreadsheet() || CosBootstrap.getSpreadsheetForRun();
  try {
    var r = CosHealthCheckService.run();
    var i;
    for (i = 0; i < r.items.length; i++) {
      var it = r.items[i];
      var payload = { id: it.id, message: it.message, detail: it.detail };
      if (it.status === 'fail') {
        CosLogger.error('Health check', payload);
      } else if (it.status === 'warn') {
        CosLogger.warn('Health check', payload);
      } else {
        CosLogger.info('Health check', payload);
      }
    }
    CosLogger.info('Health check summary', {
      ok: r.ok,
      summaryLine: r.summaryLine,
      passCount: r.passCount,
      warnCount: r.warnCount,
      failCount: r.failCount,
    });
    if (ssUi) {
      ssUi.toast(
        r.summaryLine + ' — see Executions for details.',
        CosConstants.PRODUCT_NAME,
        12
      );
    }
  } catch (e) {
    CosLogger.error('menuRunSystemHealthCheck', { error: String(e) });
    if (ssUi) {
      ssUi.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 12);
    }
  }
}

/**
 * Chief of Staff → Log settings (Script Properties)
 */
function menuLogSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuLogSettings: no active spreadsheet');
    return;
  }
  var settings = new CosSettingsRepository().getSettings();
  CosLogger.info('Current settings snapshot', settings);
  ss.toast(
    'Settings logged (View → Logs / Executions in the script editor).',
    CosConstants.PRODUCT_NAME,
    8
  );
}

/**
 * Chief of Staff → Schedule pending tasks (calendar)
 */
function menuSchedulePendingTasks() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuSchedulePendingTasks: no spreadsheet');
    return;
  }
  try {
    var r = CosTaskSchedulerService.scheduleAllPending(ss);
    var msg = r.ok
      ? 'Scheduled ' +
        r.scheduled +
        ' · skipped ' +
        r.skipped +
        ' · failed ' +
        r.failed
      : 'Scheduling failed: ' + (r.message || 'unknown');
    ss.toast(msg, CosConstants.PRODUCT_NAME, 12);
    CosLogger.info('menuSchedulePendingTasks', r);
  } catch (e) {
    CosLogger.error('menuSchedulePendingTasks', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 12);
  }
}

/**
 * Chief of Staff → Schedule selected row (Tasks sheet, one data row, Pending only)
 */
function menuScheduleSelectedTask() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuScheduleSelectedTask: no spreadsheet');
    return;
  }
  var sheet = ss.getActiveSheet();
  if (sheet.getName() !== CosConstants.TASKS_SHEET_NAME) {
    ss.toast(
      'Open the Tasks tab and select one task row.',
      CosConstants.PRODUCT_NAME,
      8
    );
    return;
  }
  var r0 = sheet.getActiveRange();
  if (!r0 || r0.getNumRows() !== 1) {
    ss.toast(
      'Select exactly one row in Tasks (a single data row).',
      CosConstants.PRODUCT_NAME,
      8
    );
    return;
  }
  var row = r0.getRow();
  if (row < CosConstants.TASKS_FIRST_DATA_ROW) {
    ss.toast('Select a data row below the header.', CosConstants.PRODUCT_NAME, 6);
    return;
  }
  var taskId = sheet
    .getRange(row, CosConstants.COL.TASK_ID)
    .getDisplayValue()
    .toString()
    .trim();
  if (!taskId) {
    ss.toast('No Task ID in that row (Normalize first?).', CosConstants.PRODUCT_NAME, 8);
    return;
  }
  try {
    var r = CosTaskSchedulerService.scheduleOneById(ss, taskId);
    var msg = r.ok
      ? 'Scheduled ' +
        r.scheduled +
        ' · skipped ' +
        r.skipped +
        ' · failed ' +
        r.failed
      : 'Scheduling failed: ' + (r.message || 'unknown');
    ss.toast(msg, CosConstants.PRODUCT_NAME, 12);
    CosLogger.info('menuScheduleSelectedTask', { taskId: taskId, r: r });
  } catch (e) {
    CosLogger.error('menuScheduleSelectedTask', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 12);
  }
}

// --- Time-driven triggers ---

/**
 * Schedule pending tasks (bind spreadsheet via Install; authorize Calendar).
 */
function cos_triggerSchedulePending_() {
  CosTaskSchedulerService.scheduleAllPending();
}

/**
 * Time-driven: ingest labeled Gmail threads when EMAIL_TASKS_ENABLED is true.
 */
function cos_triggerProcessGmail_() {
  try {
    var r = CosEmailIngestionService.processInbox();
    CosLogger.info('cos_triggerProcessGmail_', r);
  } catch (e) {
    CosLogger.error('cos_triggerProcessGmail_', { error: String(e) });
  }
}

/**
 * Time-driven: daily digest email when DAILY_DIGEST_ENABLED is true (at most once per local day).
 */
function cos_triggerDailyDigest_() {
  try {
    var r = CosDailyDigestService.sendDigestEmail();
    CosLogger.info('cos_triggerDailyDigest_', r);
  } catch (e) {
    CosLogger.error('cos_triggerDailyDigest_', { error: String(e) });
  }
}

/**
 * Chief of Staff → Set digest AI API key (Script Properties; enables DIGEST_AI_ENABLED).
 * You paste the key here; use Project Settings → Script properties to edit provider/model without re-pasting.
 */
function menuSetDigestAiApiKey() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuSetDigestAiApiKey: no active spreadsheet');
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Digest AI — API key',
    'Paste your OpenAI or Gemini API key. It is stored only in this project’s Script Properties.\n' +
      'Provider defaults to openai; set DIGEST_AI_PROVIDER to gemini in Script properties if needed.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  var key = response.getResponseText().toString().replace(/^\s+|\s+$/g, '');
  if (!key) {
    ss.toast('No key entered.', CosConstants.PRODUCT_NAME, 6);
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var k = CosConstants.PROP_KEYS;
  props.setProperty(k.DIGEST_AI_API_KEY, key);
  props.setProperty(k.DIGEST_AI_ENABLED, 'true');
  if (!props.getProperty(k.DIGEST_AI_PROVIDER)) {
    props.setProperty(k.DIGEST_AI_PROVIDER, 'openai');
  }
  ss.toast(
    'Digest AI enabled; key saved. First digest may prompt to allow external requests.',
    CosConstants.PRODUCT_NAME,
    12
  );
  CosLogger.info('Digest AI: API key stored and DIGEST_AI_ENABLED set true');
}

/**
 * Chief of Staff → Turn off digest AI (keeps API key in Script Properties).
 */
function menuDisableDigestAi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuDisableDigestAi: no active spreadsheet');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.DIGEST_AI_ENABLED,
    'false'
  );
  ss.toast('Digest AI summaries disabled (key not deleted).', CosConstants.PRODUCT_NAME, 8);
  CosLogger.info('Digest AI: DIGEST_AI_ENABLED set false');
}

/**
 * Chief of Staff → Send daily digest now (test email; ignores DAILY_DIGEST_ENABLED; can send multiple/day).
 */
function menuSendDailyDigestNow() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuSendDailyDigestNow: no spreadsheet');
    return;
  }
  try {
    var r = CosDailyDigestService.sendDigestEmail(ss, {
      force: true,
      skipIdempotency: true,
    });
    var msg = !r.ok
      ? 'Digest failed: ' + (r.message || 'unknown')
      : r.skipped
        ? 'Digest skipped: ' + (r.reason || '')
        : 'Daily digest email sent.';
    ss.toast(msg, CosConstants.PRODUCT_NAME, 10);
    CosLogger.info('menuSendDailyDigestNow', r);
  } catch (e) {
    CosLogger.error('menuSendDailyDigestNow', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Menu composition for the bound spreadsheet.
 */
var CosMainMenu = {
  build: function () {
    var ui = SpreadsheetApp.getUi();
    return ui
      .createMenu(CosConstants.PRODUCT_NAME)
      .addItem('Install / Repair', 'menuInstallChiefOfStaff')
      .addItem('Sync time triggers (from settings)', 'menuSyncTimeTriggers')
      .addSeparator()
      .addItem('Validate Tasks sheet', 'menuValidateTasksSheet')
      .addItem('Add sample task', 'menuAddSampleTask')
      .addItem('Normalize task rows', 'menuNormalizeTaskRows')
      .addSeparator()
      .addItem('Create / repair Gmail labels ([Jeeves])', 'menuEnsureJeevesGmailLabels')
      .addItem('Process Gmail → Tasks', 'menuProcessGmailInbox')
      .addSeparator()
      .addItem('Send daily digest now (email)', 'menuSendDailyDigestNow')
      .addItem('Set digest AI API key…', 'menuSetDigestAiApiKey')
      .addItem('Turn off digest AI', 'menuDisableDigestAi')
      .addSeparator()
      .addItem('Schedule pending tasks', 'menuSchedulePendingTasks')
      .addItem('Schedule selected task (row)', 'menuScheduleSelectedTask')
      .addSeparator()
      .addItem('Run system health check', 'menuRunSystemHealthCheck')
      .addItem('Log settings (script editor logs)', 'menuLogSettings');
  },
};
