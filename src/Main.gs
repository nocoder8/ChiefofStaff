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
 * One-shot OAuth: run this from the script editor (toolbar → function dropdown → Run ▶).
 * Resolves the bound Tasks sheet, then touches Sheets, Calendar, Gmail, and UrlFetch so
 * Google prompts for every scope in appsscript.json. Use this if trigger functions do not
 * appear in the list or fail before authorization.
 *
 * Prerequisite: open Apps Script via the bound spreadsheet (Extensions → Apps Script), or
 * run Chief of Staff → Install / Repair from the sheet menu once so BOUND_SPREADSHEET_ID exists.
 */
function authorizeChiefOfStaffPermissions() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    throw new Error(
      'No spreadsheet. Open the bound Tasks sheet, use Extensions → Apps Script, then run again. Or run Chief of Staff → Install / Repair from the sheet menu first.'
    );
  }
  ss.getName();
  var settings = new CosSettingsRepository().getSettings();
  var calRepo = CosCalendarRepository.fromSettings(settings);
  calRepo.describeCalendar();
  try {
    GmailApp.getInboxUnreadCount();
  } catch (ge) {
    Logger.log('Gmail scope (optional in this run): ' + String(ge));
  }
  UrlFetchApp.fetch('https://www.google.com', {
    muteHttpExceptions: true,
    followRedirects: true,
  });
  Logger.log('authorizeChiefOfStaffPermissions: OK');
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
          : 'none (enable EMAIL_TASKS_ENABLED, DAILY_DIGEST_ENABLED, CALENDAR_SYNC_TRIGGER_ENABLED, CLOSURE_MAINTENANCE_TRIGGER_ENABLED, TELEGRAM_USE_POLLING, or schedule trigger).');
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
        : 'No triggers (see EMAIL_TASKS_ENABLED, DAILY_DIGEST_ENABLED, SCHEDULE_PENDING_TRIGGER_ENABLED, CALENDAR_SYNC_TRIGGER_ENABLED, CLOSURE_MAINTENANCE_TRIGGER_ENABLED, TELEGRAM_USE_POLLING).'
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

/**
 * Chief of Staff → Sync Jeeves calendar → sheet (manual; same logic as time trigger)
 */
function menuSyncJeevesCalendarToSheet() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuSyncJeevesCalendarToSheet: no spreadsheet');
    return;
  }
  try {
    var r = CosCalendarJeevesSyncService.syncJeevesEventsFromCalendar(ss);
    var msg = !r.ok
      ? 'Calendar sync failed.'
      : 'Jeeves sync: ' +
        r.timeUpdated +
        ' row(s) updated' +
        (r.revertedToScheduled
          ? ' (' + r.revertedToScheduled + ' back to Scheduled)'
          : '') +
        ' · ' +
        r.scanned +
        ' linked row(s) scanned.';
    ss.toast(msg, CosConstants.PRODUCT_NAME, 12);
    CosLogger.info('menuSyncJeevesCalendarToSheet', r);
  } catch (e) {
    CosLogger.error('menuSyncJeevesCalendarToSheet', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
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
 * Every TRIGGER_CLOSURE_MAINTENANCE_EVERY_MINUTES: elapsed → Awaiting Closure + optional stale recovery
 * (Script Property CLOSURE_MAINTENANCE_TRIGGER_ENABLED).
 */
function cos_triggerClosureMaintenance_() {
  try {
    var q = CosTaskClosureService.processElapsedScheduledIntoClosure();
    var r = CosTaskClosureService.runStaleClosureRecovery();
    CosLogger.info('cos_triggerClosureMaintenance_', { queue: q, recovery: r });
  } catch (e) {
    CosLogger.error('cos_triggerClosureMaintenance_', { error: String(e) });
  }
}

/**
 * Every 15 min (when CALENDAR_SYNC_TRIGGER_ENABLED): Jeeves calendar event times → Tasks sheet;
 * Awaiting Closure + event end moved to future → back to Scheduled.
 */
function cos_triggerCalendarJeevesSync_() {
  try {
    var s = CosCalendarJeevesSyncService.syncJeevesEventsFromCalendar();
    CosLogger.info('cos_triggerCalendarJeevesSync_', s);
  } catch (e) {
    CosLogger.error('cos_triggerCalendarJeevesSync_', { error: String(e) });
  }
}

/**
 * Time-driven: Telegram getUpdates when TELEGRAM_USE_POLLING and closure/capture are on.
 */
function cos_triggerTelegramPoll_() {
  try {
    CosTelegramPolling.runOnce_();
  } catch (e) {
    CosLogger.error('cos_triggerTelegramPoll_', { error: String(e) });
  }
}

/** @deprecated Use cos_triggerClosureMaintenance_ (same behavior). */
function cos_triggerProcessTaskClosure_() {
  cos_triggerClosureMaintenance_();
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
 * Chief of Staff → Process closure queue (elapsed Scheduled → Awaiting Closure)
 */
function menuProcessTaskClosureQueue() {
  var ss = CosBootstrap.getSpreadsheetForRun();
  if (!ss) {
    CosLogger.error('menuProcessTaskClosureQueue: no spreadsheet');
    return;
  }
  try {
    var r = CosTaskClosureService.processElapsedScheduledIntoClosure(ss);
    var rec = CosTaskClosureService.runStaleClosureRecovery(ss);
    var msg = !r.ok
      ? 'Closure queue failed: ' + (r.message || '')
      : 'Closure: ' +
        r.transitioned +
        ' → Awaiting · ' +
        r.skipped +
        ' skipped · recovery: ' +
        (rec.recovered || 0) +
        ' auto-rescheduled.';
    ss.toast(msg, CosConstants.PRODUCT_NAME, 12);
    CosLogger.info('menuProcessTaskClosureQueue', { queue: r, recovery: rec });
  } catch (e) {
    CosLogger.error('menuProcessTaskClosureQueue', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Set closure web app URL (Script Property CLOSURE_WEBAPP_URL)
 */
function menuSetClosureWebAppUrl() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuSetClosureWebAppUrl: no active spreadsheet');
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Closure web app URL',
    'Paste the Web app URL from Deploy → Manage deployments (must end with /exec).\n' +
      'Anyone with a signed link can apply closure while the link is valid.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  var url = response.getResponseText().toString().replace(/^\s+|\s+$/g, '');
  if (!url) {
    ss.toast('No URL entered.', CosConstants.PRODUCT_NAME, 6);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.CLOSURE_WEBAPP_URL,
    url
  );
  ss.toast(
    'CLOSURE_WEBAPP_URL saved. Re-register the Telegram webhook if you use Telegram closure.',
    CosConstants.PRODUCT_NAME,
    10
  );
  CosLogger.info('CLOSURE_WEBAPP_URL updated');
}

/**
 * Chief of Staff → Set Telegram bot token (TELEGRAM_BOT_TOKEN)
 */
function menuSetTelegramBotToken() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuSetTelegramBotToken: no active spreadsheet');
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Telegram bot token',
    'Paste the token from @BotFather. Stored only in Script Properties.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  var tok = response.getResponseText().toString().replace(/^\s+|\s+$/g, '');
  if (!tok) {
    ss.toast('No token entered.', CosConstants.PRODUCT_NAME, 6);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_BOT_TOKEN,
    tok
  );
  ss.toast('Telegram bot token saved.', CosConstants.PRODUCT_NAME, 8);
}

/**
 * Chief of Staff → Set Telegram chat id (TELEGRAM_CHAT_ID)
 */
function menuSetTelegramChatId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    CosLogger.error('menuSetTelegramChatId: no active spreadsheet');
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Telegram chat id',
    'Your numeric chat id (e.g. message @userinfobot). Private chat: usually your user id.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  var id = response.getResponseText().toString().replace(/^\s+|\s+$/g, '');
  if (!id) {
    ss.toast('No chat id entered.', CosConstants.PRODUCT_NAME, 6);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_CHAT_ID,
    id
  );
  ss.toast('Telegram chat id saved.', CosConstants.PRODUCT_NAME, 8);
}

/**
 * Chief of Staff → Enable Telegram closure nudges
 */
function menuEnableTelegramClosure() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_CLOSURE_ENABLED,
    'true'
  );
  ss.toast(
    'Telegram closure enabled. Set token + chat id, deploy web app, then Register Telegram webhook.',
    CosConstants.PRODUCT_NAME,
    12
  );
}

/**
 * Chief of Staff → Disable Telegram closure nudges
 */
function menuDisableTelegramClosure() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_CLOSURE_ENABLED,
    'false'
  );
  ss.toast('Telegram closure disabled.', CosConstants.PRODUCT_NAME, 8);
}

/**
 * Chief of Staff → Enable Telegram task capture (plain messages → new Tasks rows)
 */
function menuEnableTelegramTaskCapture() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_TASK_CAPTURE_ENABLED,
    'true'
  );
  ss.toast('Telegram task capture enabled.', CosConstants.PRODUCT_NAME, 8);
}

/**
 * Chief of Staff → Disable Telegram task capture
 */
function menuDisableTelegramTaskCapture() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_TASK_CAPTURE_ENABLED,
    'false'
  );
  ss.toast('Telegram task capture disabled.', CosConstants.PRODUCT_NAME, 8);
}

/**
 * Chief of Staff → Enable LLM fallback for Telegram task capture (needs DIGEST_AI_API_KEY).
 */
function menuEnableTelegramParseAi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var k = CosConstants.PROP_KEYS;
  props.setProperty(k.TELEGRAM_PARSE_AI_ENABLED, 'true');
  var hasKey =
    String(props.getProperty(k.DIGEST_AI_API_KEY) || '').trim().length > 0;
  ss.toast(
    hasKey
      ? 'Telegram parse AI enabled (uses digest AI key & model).'
      : 'Flag on — set digest AI API key (menu or DIGEST_AI_API_KEY) or calls will skip the LLM.',
    CosConstants.PRODUCT_NAME,
    12
  );
}

/**
 * Chief of Staff → Disable LLM fallback for Telegram task capture
 */
function menuDisableTelegramParseAi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_PARSE_AI_ENABLED,
    'false'
  );
  ss.toast('Telegram parse AI disabled.', CosConstants.PRODUCT_NAME, 8);
}

/**
 * Chief of Staff → Enable conversational Telegram mode (butler replies + chat; uses LLM when enabled).
 */
function menuEnableTelegramConversationalMode() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_CONVERSATIONAL_MODE_ENABLED,
    'true'
  );
  ss.toast(
    'Conversational mode enabled for Telegram. (Tip: Enable Telegram parse AI + set digest AI key for best results.)',
    CosConstants.PRODUCT_NAME,
    12
  );
}

/**
 * Chief of Staff → Disable conversational Telegram mode
 */
function menuDisableTelegramConversationalMode() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    CosConstants.PROP_KEYS.TELEGRAM_CONVERSATIONAL_MODE_ENABLED,
    'false'
  );
  ss.toast('Conversational mode disabled for Telegram.', CosConstants.PRODUCT_NAME, 10);
}

/**
 * Chief of Staff → Log Telegram task capture parser self-test (Executions)
 */
function menuTelegramCaptureParserSelfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || CosBootstrap.getSpreadsheetForRun();
  var r = CosTelegramTaskCaptureParser.runSelfTest();
  var msg =
    'Parser self-test: ' + r.passed + ' passed, ' + r.failed + ' failed.';
  if (ss) {
    ss.toast(msg + ' See Executions for details.', CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Enable Telegram polling (getUpdates on a timer; works without public web app POST).
 */
function menuEnableTelegramPolling() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var k = CosConstants.PROP_KEYS;
    props.setProperty(k.TELEGRAM_USE_POLLING, 'true');
    props.deleteProperty(k.TELEGRAM_GET_UPDATES_OFFSET);
    var settings = new CosSettingsRepository().getSettings();
    var dw = CosTelegramService.deleteWebhook_(settings);
    var tz = ss.getSpreadsheetTimeZone();
    var r = CosTriggerService.syncFromSettings(settings, tz);
    var parts = ['Telegram polling enabled.'];
    if (!dw.ok) {
      parts.push('deleteWebhook: ' + (dw.message || 'failed') + ' (check token).');
    }
    if (!r.ok) {
      parts.push('Triggers: ' + (r.message || 'sync failed') + ' — run Sync time triggers.');
    } else {
      parts.push(
        r.installed && r.installed.length
          ? 'Triggers: ' + r.installed.join(' · ')
          : 'Run Sync time triggers if no poll trigger listed.'
      );
    }
    ss.toast(parts.join(' '), CosConstants.PRODUCT_NAME, 14);
    CosLogger.info('menuEnableTelegramPolling', { dw: dw, triggers: r });
  } catch (e) {
    CosLogger.error('menuEnableTelegramPolling', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Disable Telegram polling (use webhook again after admin allows public web app).
 */
function menuDisableTelegramPolling() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  try {
    PropertiesService.getScriptProperties().setProperty(
      CosConstants.PROP_KEYS.TELEGRAM_USE_POLLING,
      'false'
    );
    var settings = new CosSettingsRepository().getSettings();
    var r = CosTriggerService.syncFromSettings(
      settings,
      ss.getSpreadsheetTimeZone()
    );
    ss.toast(
      r.ok
        ? 'Telegram polling off. Re-register webhook if you use public web app POST.'
        : 'Polling off; trigger sync failed — run Sync time triggers.',
      CosConstants.PRODUCT_NAME,
      12
    );
    CosLogger.info('menuDisableTelegramPolling', r);
  } catch (e) {
    CosLogger.error('menuDisableTelegramPolling', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Register Telegram webhook (same web app URL as closure links)
 */
function menuRegisterTelegramWebhook() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  try {
    var settings = new CosSettingsRepository().getSettings();
    var r = CosTelegramService.setWebhookFromSettings_(settings);
    ss.toast(
      r.ok
        ? 'Telegram webhook registered. Send a test message from the bot chat.'
        : r.message || 'setWebhook failed',
      CosConstants.PRODUCT_NAME,
      12
    );
    CosLogger.info('menuRegisterTelegramWebhook', r);
  } catch (e) {
    CosLogger.error('menuRegisterTelegramWebhook', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Log Telegram webhook status (getWebhookInfo → Executions)
 */
function menuLogTelegramWebhookInfo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  try {
    var settings = new CosSettingsRepository().getSettings();
    var r = CosTelegramService.fetchWebhookInfo_(settings);
    if (!r.ok) {
      ss.toast(r.message || 'getWebhookInfo failed', CosConstants.PRODUCT_NAME, 10);
      CosLogger.warn('menuLogTelegramWebhookInfo', r);
      return;
    }
    var res = r.result || {};
    var whBase = CosTelegramService._execUrlWithoutQuery_(res.url);
    var propBase = CosTelegramService._execUrlWithoutQuery_(
      settings.closureWebAppUrl || ''
    );
    CosLogger.info('Telegram getWebhookInfo', {
      url: CosTelegramService._redactCosTgInUrl_(res.url),
      pending_update_count: res.pending_update_count,
      last_error_date: res.last_error_date,
      last_error_message: res.last_error_message,
      allowed_updates: res.allowed_updates,
    });
    CosLogger.info('Telegram webhook vs CLOSURE_WEBAPP_URL', {
      webhookExecUrl: whBase,
      propertyExecUrl: propBase,
      basesMatch: whBase === propBase && whBase.length > 0,
    });
    ss.toast(
      'Webhook status logged. Open Executions → latest run for details.',
      CosConstants.PRODUCT_NAME,
      12
    );
  } catch (e) {
    CosLogger.error('menuLogTelegramWebhookInfo', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
}

/**
 * Chief of Staff → Send Telegram test message
 */
function menuSendTelegramTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return;
  }
  try {
    var settings = new CosSettingsRepository().getSettings();
    var r = CosTelegramService.sendTestMessage_(settings);
    ss.toast(
      r.ok ? 'Telegram test sent.' : r.message || 'Failed',
      CosConstants.PRODUCT_NAME,
      10
    );
    CosLogger.info('menuSendTelegramTest', r);
  } catch (e) {
    CosLogger.error('menuSendTelegramTest', { error: String(e) });
    ss.toast(String(e.message || e), CosConstants.PRODUCT_NAME, 10);
  }
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
      .addItem('Process closure queue (+ recovery)', 'menuProcessTaskClosureQueue')
      .addItem('Set closure web app URL…', 'menuSetClosureWebAppUrl')
      .addItem('Set Telegram bot token…', 'menuSetTelegramBotToken')
      .addItem('Set Telegram chat id…', 'menuSetTelegramChatId')
      .addItem('Enable Telegram closure nudges', 'menuEnableTelegramClosure')
      .addItem('Disable Telegram closure nudges', 'menuDisableTelegramClosure')
      .addItem('Enable Telegram task capture', 'menuEnableTelegramTaskCapture')
      .addItem('Disable Telegram task capture', 'menuDisableTelegramTaskCapture')
      .addItem('Enable Telegram parse AI (digest key)', 'menuEnableTelegramParseAi')
      .addItem('Disable Telegram parse AI', 'menuDisableTelegramParseAi')
      .addItem('Enable Telegram conversational mode', 'menuEnableTelegramConversationalMode')
      .addItem('Disable Telegram conversational mode', 'menuDisableTelegramConversationalMode')
      .addItem('Log: Telegram capture parser self-test', 'menuTelegramCaptureParserSelfTest')
      .addItem('Enable Telegram polling (no public web app)', 'menuEnableTelegramPolling')
      .addItem('Disable Telegram polling', 'menuDisableTelegramPolling')
      .addItem('Register Telegram webhook', 'menuRegisterTelegramWebhook')
      .addItem('Log: Telegram webhook status (getWebhookInfo)', 'menuLogTelegramWebhookInfo')
      .addItem('Send Telegram test', 'menuSendTelegramTest')
      .addItem('Set digest AI API key…', 'menuSetDigestAiApiKey')
      .addItem('Turn off digest AI', 'menuDisableDigestAi')
      .addSeparator()
      .addItem('Schedule pending tasks', 'menuSchedulePendingTasks')
      .addItem('Schedule selected task (row)', 'menuScheduleSelectedTask')
      .addItem('Sync Jeeves calendar → sheet', 'menuSyncJeevesCalendarToSheet')
      .addSeparator()
      .addItem('Run system health check', 'menuRunSystemHealthCheck')
      .addItem('Log settings (script editor logs)', 'menuLogSettings');
  },
};
