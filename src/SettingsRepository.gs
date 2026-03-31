/**
 * Reads and writes Script Properties with explicit defaults.
 * @constructor
 */
function CosSettingsRepository() {
  /** @type {GoogleAppsScript.Properties.Properties} */
  this._props = PropertiesService.getScriptProperties();
}

/**
 * @returns {CosSettings}
 */
CosSettingsRepository.prototype.getSettings = function () {
  var keys = CosConstants.PROP_KEYS;
  var raw = this._props.getProperties();

  return {
    userEmail: CosSettingsRepository._readString(raw, keys.USER_EMAIL, ''),
    primaryCalendarId: CosSettingsRepository._readString(
      raw,
      keys.PRIMARY_CALENDAR_ID,
      ''
    ),
    timezone: CosSettingsRepository._readString(raw, keys.TIMEZONE, ''),
    workHoursJson: CosSettingsRepository._readString(
      raw,
      keys.WORK_HOURS_JSON,
      CosConstants.DEFAULT_WORK_HOURS_JSON
    ),
    emailTasksEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.EMAIL_TASKS_ENABLED,
      false
    ),
    emailTaskAutoSchedule: CosSettingsRepository._readBoolean(
      raw,
      keys.EMAIL_TASK_AUTO_SCHEDULE,
      false
    ),
    dailyDigestEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.DAILY_DIGEST_ENABLED,
      false
    ),
    dailyDigestTime: CosSettingsRepository._readString(
      raw,
      keys.DAILY_DIGEST_TIME,
      CosConstants.DEFAULT_DAILY_DIGEST_TIME
    ),
    digestAiEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.DIGEST_AI_ENABLED,
      false
    ),
    digestAiProvider: CosSettingsRepository._readString(
      raw,
      keys.DIGEST_AI_PROVIDER,
      'openai'
    ),
    digestAiApiKey: CosSettingsRepository._readString(
      raw,
      keys.DIGEST_AI_API_KEY,
      ''
    ),
    digestAiModel: CosSettingsRepository._readString(raw, keys.DIGEST_AI_MODEL, ''),
    scheduleSummaryEmailEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.SCHEDULE_SUMMARY_EMAIL_ENABLED,
      true
    ),
    schedulePendingTriggerEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.SCHEDULE_PENDING_TRIGGER_ENABLED,
      true
    ),
    calendarSyncTriggerEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.CALENDAR_SYNC_TRIGGER_ENABLED,
      true
    ),
    debugVerbose: CosSettingsRepository._readBoolean(
      raw,
      keys.DEBUG_VERBOSE,
      false
    ),
    gmailTaskQuery: CosSettingsRepository._readString(
      raw,
      keys.GMAIL_TASK_QUERY,
      CosConstants.DEFAULT_GMAIL_TASK_QUERY
    ),
    gmailLabelProcessed: CosSettingsRepository._readString(
      raw,
      keys.GMAIL_LABEL_PROCESSED,
      CosConstants.DEFAULT_GMAIL_LABEL_PROCESSED
    ),
    gmailLabelError: CosSettingsRepository._readString(
      raw,
      keys.GMAIL_LABEL_ERROR,
      CosConstants.DEFAULT_GMAIL_LABEL_ERROR
    ),
    installedAtIso: raw[keys.INSTALLED_AT_ISO] || '',
    installVersion: raw[keys.INSTALL_VERSION] || '',
    closureWebAppUrl: CosSettingsRepository._readString(
      raw,
      keys.CLOSURE_WEBAPP_URL,
      ''
    ),
    closureLinkSecret: CosSettingsRepository._readString(
      raw,
      keys.CLOSURE_LINK_SECRET,
      ''
    ),
    closureMaintenanceTriggerEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.CLOSURE_MAINTENANCE_TRIGGER_ENABLED,
      false
    ),
    closureRecoveryRescheduleStale: CosSettingsRepository._readBoolean(
      raw,
      keys.CLOSURE_RECOVERY_RESCHEDULE_STALE,
      false
    ),
    closureRecoveryGraceHours: CosSettingsRepository._readPositiveInt_(
      raw,
      keys.CLOSURE_RECOVERY_GRACE_HOURS,
      48
    ),
    telegramBotToken: CosSettingsRepository._readString(
      raw,
      keys.TELEGRAM_BOT_TOKEN,
      ''
    ),
    telegramChatId: CosSettingsRepository._readString(
      raw,
      keys.TELEGRAM_CHAT_ID,
      ''
    ),
    telegramClosureEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.TELEGRAM_CLOSURE_ENABLED,
      false
    ),
    telegramTaskCaptureEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.TELEGRAM_TASK_CAPTURE_ENABLED,
      true
    ),
    telegramWebhookSecret: CosSettingsRepository._readString(
      raw,
      keys.TELEGRAM_WEBHOOK_SECRET,
      ''
    ),
    telegramUsePolling: CosSettingsRepository._readBoolean(
      raw,
      keys.TELEGRAM_USE_POLLING,
      false
    ),
    telegramParseAiEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.TELEGRAM_PARSE_AI_ENABLED,
      false
    ),
    telegramConversationalModeEnabled: CosSettingsRepository._readBoolean(
      raw,
      keys.TELEGRAM_CONVERSATIONAL_MODE_ENABLED,
      false
    ),
  };
};

/**
 * Seeds missing keys with defaults derived from the active spreadsheet and user.
 * Idempotent: does not overwrite existing values.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 */
CosSettingsRepository.prototype.seedDefaultsIfMissing = function (
  spreadsheet
) {
  var keys = CosConstants.PROP_KEYS;
  var existing = this._props.getProperties();
  var patch = {};

  var email = Session.getActiveUser().getEmail();
  if (!existing[keys.USER_EMAIL] && email) {
    patch[keys.USER_EMAIL] = email;
  }

  if (!existing[keys.PRIMARY_CALENDAR_ID]) {
    var calId = email || '';
    patch[keys.PRIMARY_CALENDAR_ID] = calId;
  }

  if (!existing[keys.TIMEZONE]) {
    patch[keys.TIMEZONE] = spreadsheet.getSpreadsheetTimeZone();
  }

  if (!existing[keys.WORK_HOURS_JSON]) {
    patch[keys.WORK_HOURS_JSON] = CosConstants.DEFAULT_WORK_HOURS_JSON;
  }

  if (existing[keys.EMAIL_TASKS_ENABLED] === undefined) {
    patch[keys.EMAIL_TASKS_ENABLED] = 'false';
  }
  if (existing[keys.EMAIL_TASK_AUTO_SCHEDULE] === undefined) {
    patch[keys.EMAIL_TASK_AUTO_SCHEDULE] = 'false';
  }
  if (existing[keys.DAILY_DIGEST_ENABLED] === undefined) {
    patch[keys.DAILY_DIGEST_ENABLED] = 'false';
  }
  if (existing[keys.SCHEDULE_SUMMARY_EMAIL_ENABLED] === undefined) {
    patch[keys.SCHEDULE_SUMMARY_EMAIL_ENABLED] = 'true';
  }
  if (existing[keys.SCHEDULE_PENDING_TRIGGER_ENABLED] === undefined) {
    patch[keys.SCHEDULE_PENDING_TRIGGER_ENABLED] = 'true';
  }
  if (existing[keys.CALENDAR_SYNC_TRIGGER_ENABLED] === undefined) {
    patch[keys.CALENDAR_SYNC_TRIGGER_ENABLED] = 'true';
  }
  if (!existing[keys.DAILY_DIGEST_TIME]) {
    patch[keys.DAILY_DIGEST_TIME] = CosConstants.DEFAULT_DAILY_DIGEST_TIME;
  }
  if (existing[keys.DIGEST_AI_ENABLED] === undefined) {
    patch[keys.DIGEST_AI_ENABLED] = 'false';
  }
  if (!existing[keys.DIGEST_AI_PROVIDER]) {
    patch[keys.DIGEST_AI_PROVIDER] = 'openai';
  }
  if (!existing[keys.GMAIL_TASK_QUERY]) {
    patch[keys.GMAIL_TASK_QUERY] = CosConstants.DEFAULT_GMAIL_TASK_QUERY;
  }
  if (!existing[keys.GMAIL_LABEL_PROCESSED]) {
    patch[keys.GMAIL_LABEL_PROCESSED] =
      CosConstants.DEFAULT_GMAIL_LABEL_PROCESSED;
  }
  if (!existing[keys.GMAIL_LABEL_ERROR]) {
    patch[keys.GMAIL_LABEL_ERROR] = CosConstants.DEFAULT_GMAIL_LABEL_ERROR;
  }

  if (!existing[keys.BOUND_SPREADSHEET_ID]) {
    patch[keys.BOUND_SPREADSHEET_ID] = spreadsheet.getId();
  }

  if (!existing[keys.CLOSURE_LINK_SECRET]) {
    patch[keys.CLOSURE_LINK_SECRET] =
      Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }
  if (existing[keys.CLOSURE_MAINTENANCE_TRIGGER_ENABLED] === undefined) {
    patch[keys.CLOSURE_MAINTENANCE_TRIGGER_ENABLED] = 'false';
  }
  if (existing[keys.CLOSURE_RECOVERY_RESCHEDULE_STALE] === undefined) {
    patch[keys.CLOSURE_RECOVERY_RESCHEDULE_STALE] = 'false';
  }
  if (!existing[keys.CLOSURE_RECOVERY_GRACE_HOURS]) {
    patch[keys.CLOSURE_RECOVERY_GRACE_HOURS] = '48';
  }

  if (existing[keys.TELEGRAM_CLOSURE_ENABLED] === undefined) {
    patch[keys.TELEGRAM_CLOSURE_ENABLED] = 'false';
  }
  if (existing[keys.TELEGRAM_TASK_CAPTURE_ENABLED] === undefined) {
    patch[keys.TELEGRAM_TASK_CAPTURE_ENABLED] = 'true';
  }
  if (!existing[keys.TELEGRAM_WEBHOOK_SECRET]) {
    patch[keys.TELEGRAM_WEBHOOK_SECRET] =
      Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }
  if (existing[keys.TELEGRAM_USE_POLLING] === undefined) {
    patch[keys.TELEGRAM_USE_POLLING] = 'false';
  }
  if (existing[keys.TELEGRAM_PARSE_AI_ENABLED] === undefined) {
    patch[keys.TELEGRAM_PARSE_AI_ENABLED] = 'false';
  }
  if (existing[keys.TELEGRAM_CONVERSATIONAL_MODE_ENABLED] === undefined) {
    patch[keys.TELEGRAM_CONVERSATIONAL_MODE_ENABLED] = 'false';
  }

  if (Object.keys(patch).length) {
    this._props.setProperties(patch, false);
  }
};

/**
 * Marks install metadata (always writes install version; refreshes installed-at).
 */
CosSettingsRepository.prototype.touchInstallMetadata = function () {
  var keys = CosConstants.PROP_KEYS;
  this._props.setProperties(
    {
      [keys.INSTALLED_AT_ISO]: new Date().toISOString(),
      [keys.INSTALL_VERSION]: CosConstants.SCHEMA_VERSION,
    },
    false
  );
};

/**
 * @param {Object} raw
 * @param {string} key
 * @param {string} defaultValue
 * @returns {string}
 */
CosSettingsRepository._readString = function (raw, key, defaultValue) {
  var v = raw[key];
  if (v === undefined || v === null || v === '') {
    return defaultValue;
  }
  return String(v);
};

/**
 * @param {Object} raw
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
CosSettingsRepository._readBoolean = function (raw, key, defaultValue) {
  var v = raw[key];
  if (v === undefined || v === null || v === '') {
    return defaultValue;
  }
  var s = String(v).toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return defaultValue;
};

/**
 * @param {Object} raw
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
CosSettingsRepository._readPositiveInt_ = function (raw, key, defaultValue) {
  var v = raw[key];
  if (v === undefined || v === null || v === '') {
    return defaultValue;
  }
  var n = parseInt(String(v), 10);
  if (isNaN(n) || n < 1) {
    return defaultValue;
  }
  return n;
};
