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
