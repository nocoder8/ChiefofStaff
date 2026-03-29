/**
 * Central configuration for Chief of Staff (bound spreadsheet automation).
 * Operator documentation: README.md at repository root.
 * @namespace
 */
var CosConstants = {
  PRODUCT_NAME: 'Chief of Staff',

  /**
   * Calendar event title prefix for scheduler-created tasks (emoji + [Jeeves]-).
   * 🎩 = Jeeves/butler motif; alternatives: 📋 tasks, 📅 schedule, 🤖 automation.
   * Visual style: Sage via CalendarApp.EventColor.PALE_GREEN in CalendarRepository.createTaskEvent.
   */
  CALENDAR_JEEVES_EVENT_TITLE_PREFIX: '🎩 [Jeeves]-',

  /** Maximum length for the full calendar title (prefix + truncated task text). */
  CALENDAR_JEEVES_EVENT_TITLE_MAX_LEN: 200,

  TASKS_SHEET_NAME: 'Tasks',
  TASKS_HEADER_ROW: 1,
  TASKS_FIRST_DATA_ROW: 2,

  /**
   * Display format for date/time columns (sheet timezone, not UTC text).
   * Ordinals ("31st") are not supported by Sheets number formats; day shows as "31".
   */
  TASK_DATETIME_DISPLAY_FORMAT: 'h:mm AM/PM, d mmmm yyyy',

  /** 1-based column indexes matching TASK_HEADERS (Deadline … Updated At). */
  DATETIME_DISPLAY_COLUMNS: Object.freeze([5, 9, 10, 13, 14]),

  TASK_HEADERS: Object.freeze([
    'Task ID',
    'Task',
    'Priority',
    'Duration Min',
    'Deadline',
    'Status',
    'Source',
    'Source Ref',
    'Scheduled Start',
    'Scheduled End',
    'Calendar Event ID',
    'Notes',
    'Created At',
    'Updated At',
  ]),

  TASK_PRIORITY: Object.freeze({
    P0: 'P0',
    P1: 'P1',
    P2: 'P2',
    P3: 'P3',
    FOLLOW_UP: 'Follow-up',
  }),

  TASK_PRIORITY_LIST: Object.freeze(['P0', 'P1', 'P2', 'P3', 'Follow-up']),

  TASK_STATUS: Object.freeze({
    PENDING: 'Pending',
    SCHEDULED: 'Scheduled',
    DONE: 'Done',
    PAUSED: 'Paused',
    ERROR: 'Error',
    FOLLOW_UP: 'Follow-up',
  }),

  TASK_STATUS_LIST: Object.freeze([
    'Pending',
    'Scheduled',
    'Done',
    'Paused',
    'Error',
    'Follow-up',
  ]),

  TASK_SOURCE: Object.freeze({
    MANUAL: 'Manual',
    EMAIL: 'Email',
    SYSTEM: 'System',
  }),

  TASK_SOURCE_LIST: Object.freeze(['Manual', 'Email', 'System']),

  PROP_KEYS: Object.freeze({
    USER_EMAIL: 'USER_EMAIL',
    PRIMARY_CALENDAR_ID: 'PRIMARY_CALENDAR_ID',
    TIMEZONE: 'TIMEZONE',
    WORK_HOURS_JSON: 'WORK_HOURS_JSON',
    EMAIL_TASKS_ENABLED: 'EMAIL_TASKS_ENABLED',
    EMAIL_TASK_AUTO_SCHEDULE: 'EMAIL_TASK_AUTO_SCHEDULE',
    DAILY_DIGEST_ENABLED: 'DAILY_DIGEST_ENABLED',
    DAILY_DIGEST_TIME: 'DAILY_DIGEST_TIME',
    /** openai | gemini — follow-up digest lines (requires DIGEST_AI_API_KEY). */
    DIGEST_AI_ENABLED: 'DIGEST_AI_ENABLED',
    DIGEST_AI_PROVIDER: 'DIGEST_AI_PROVIDER',
    DIGEST_AI_API_KEY: 'DIGEST_AI_API_KEY',
    DIGEST_AI_MODEL: 'DIGEST_AI_MODEL',
    /** When true, send one email after each scheduling run that books ≥1 task. */
    SCHEDULE_SUMMARY_EMAIL_ENABLED: 'SCHEDULE_SUMMARY_EMAIL_ENABLED',
    /** When true, time trigger runs cos_triggerSchedulePending_ on an hourly cadence. */
    SCHEDULE_PENDING_TRIGGER_ENABLED: 'SCHEDULE_PENDING_TRIGGER_ENABLED',
    GMAIL_TASK_QUERY: 'GMAIL_TASK_QUERY',
    GMAIL_LABEL_PROCESSED: 'GMAIL_LABEL_PROCESSED',
    GMAIL_LABEL_ERROR: 'GMAIL_LABEL_ERROR',
    INSTALLED_AT_ISO: 'INSTALLED_AT_ISO',
    INSTALL_VERSION: 'INSTALL_VERSION',
    BOUND_SPREADSHEET_ID: 'BOUND_SPREADSHEET_ID',
    /** yyyy-MM-dd in spreadsheet TZ; avoids duplicate trigger sends the same day. */
    DAILY_DIGEST_LAST_SENT_DATE: 'DAILY_DIGEST_LAST_SENT_DATE',
    /**
     * When true, CosLogger writes to both Logger and console (duplicate lines in Cloud logs).
     * Default false: console only — one line per message in Executions.
     */
    DEBUG_VERBOSE: 'DEBUG_VERBOSE',
  }),

  SCHEMA_VERSION: '1',

  DEFAULT_GMAIL_LABEL_PROCESSED: '[Jeeves]/ok',
  DEFAULT_GMAIL_LABEL_ERROR: '[Jeeves]/err',

  GMAIL_JEEVES_LABELS: Object.freeze([
    '[Jeeves]/task',
    '[Jeeves]/follow-up',
    '[Jeeves]/P0',
    '[Jeeves]/P1',
    '[Jeeves]/P2',
    '[Jeeves]/15m',
    '[Jeeves]/30m',
    '[Jeeves]/45m',
    '[Jeeves]/60m',
    '[Jeeves]/120m',
    '[Jeeves]/ok',
    '[Jeeves]/err',
  ]),

  GMAIL_INGEST_MAX_THREADS: 40,

  GMAIL_DURATION_LABEL_MINUTES: Object.freeze([
    ['[Jeeves]/120m', 120],
    ['[Jeeves]/60m', 60],
    ['[Jeeves]/45m', 45],
    ['[Jeeves]/30m', 30],
    ['[Jeeves]/15m', 15],
  ]),

  /**
   * Gmail label names that mean “task” for ingest (exact name match).
   * @type {readonly string[]}
   */
  GMAIL_TASK_TYPE_LABEL_NAMES: Object.freeze(['[Jeeves]/task']),

  /**
   * Gmail label names that mean “follow-up” (sheet Priority → Follow-up).
   * @type {readonly string[]}
   */
  GMAIL_FOLLOW_UP_TYPE_LABEL_NAMES: Object.freeze([
    '[Jeeves]/follow-up',
    'followup',
    'Followup',
    'follow-up',
    'Follow-up',
  ]),

  DEFAULT_DAILY_DIGEST_TIME: '08:00',

  DEFAULT_WORK_HOURS_JSON: JSON.stringify({
    monday: [
      { start: '12:00', end: '17:00' },
      { start: '19:30', end: '23:30' },
    ],
    tuesday: [
      { start: '12:00', end: '17:00' },
      { start: '19:30', end: '23:30' },
    ],
    wednesday: [
      { start: '12:00', end: '17:00' },
      { start: '19:30', end: '23:30' },
    ],
    thursday: [
      { start: '12:00', end: '17:00' },
      { start: '19:30', end: '23:30' },
    ],
    friday: [
      { start: '12:00', end: '17:00' },
      { start: '19:30', end: '23:30' },
    ],
    saturday: [],
    sunday: [],
  }),

  DEFAULT_TASK_DURATION_MINUTES: 30,

  /**
   * Email-ingested tasks get Deadline set to end of day N calendar days from ingest (in sheet TZ).
   * 0 = leave Deadline blank. Improves scheduling order without opening the sheet.
   */
  DEFAULT_EMAIL_TASK_DEADLINE_DAYS_FROM_NOW: 7,

  /**
   * Time trigger: Gmail ingest cadence. Allowed values: 1, 5, 10, 15, 30 (Apps Script).
   */
  TRIGGER_GMAIL_EVERY_MINUTES: 30,

  /** Time trigger: run Schedule pending on this hourly cadence (≥1). */
  TRIGGER_SCHEDULE_PENDING_EVERY_HOURS: 1,

  SCHEDULING_HORIZON_DAYS: 21,
  SCHEDULING_SLOT_STEP_MINUTES: 15,
  SCHEDULE_TIME_MATCH_TOLERANCE_MS: 120000,

  /**
   * Shrink each calendar busy interval by this many ms on both ends when testing overlap.
   * Avoids false “busy” when the API returns an end time slightly after the visible boundary
   * (e.g. 12:00:00.400) so a 12:00–13:00 task does not collide with a meeting that shows as
   * ending at 12:00. Keep small (seconds) so real overlaps still block.
   */
  SCHEDULING_BUSY_BOUNDARY_TOLERANCE_MS: 3000,

  /** Log detailed scheduling decisions to Executions (set false to reduce noise). */
  SCHEDULING_VERBOSE_LOG: true,

  /**
   * Earliest slot start = now + delay (hours). P0 ≈ ASAP within work hours; P1/P2 stagger load.
   */
  SCHEDULE_PRIORITY_DELAY_HOURS_P0: 0,
  SCHEDULE_PRIORITY_DELAY_HOURS_P1: 48,
  SCHEDULE_PRIORITY_DELAY_HOURS_P2: 96,
  SCHEDULE_PRIORITY_DELAY_HOURS_P3: 96,

  /** Follow-up tasks: digest flags overdue after this many hours from Created At (not calendar-scheduled). */
  FOLLOW_UP_DIGEST_OVERDUE_HOURS: 48,

  /** Calendar days in digest “Jeeves week” window (inclusive of today for range end). */
  DIGEST_JEEVES_WEEK_DAYS: 7,

  /** Max follow-ups per digest that may call an external AI (cost/latency cap). */
  DIGEST_AI_MAX_TASKS_PER_RUN: 8,

  /** Notes body sent to the model (chars). */
  DIGEST_AI_MAX_NOTES_CHARS: 2800,

  /** Stored / displayed non-AI excerpt length. */
  DIGEST_FOLLOWUP_SNIPPET_MAX_CHARS: 220,

  /** Model output clamp. */
  DIGEST_AI_OUTPUT_MAX_CHARS: 220,

  DEFAULT_DIGEST_OPENAI_MODEL: 'gpt-4o-mini',
  DEFAULT_DIGEST_GEMINI_MODEL: 'gemini-2.0-flash',

  COL: Object.freeze({
    TASK_ID: 1,
    TASK: 2,
    PRIORITY: 3,
    DURATION_MIN: 4,
    DEADLINE: 5,
    STATUS: 6,
    SOURCE: 7,
    SOURCE_REF: 8,
    SCHEDULED_START: 9,
    SCHEDULED_END: 10,
    CALENDAR_EVENT_ID: 11,
    NOTES: 12,
    CREATED_AT: 13,
    UPDATED_AT: 14,
  }),
};

/**
 * @param {string} labelName
 * @returns {string}
 */
function cos_gmailSearchLabelTerm_(labelName) {
  return 'label:"' + String(labelName).replace(/"/g, '') + '"';
}

/**
 * Saved-search style query (script property). Ingestion uses GmailLabel.getThreads instead.
 * @returns {string}
 */
function cos_buildDefaultGmailTaskQuery_() {
  var parts = [];
  var i;
  var task = CosConstants.GMAIL_TASK_TYPE_LABEL_NAMES;
  var fup = CosConstants.GMAIL_FOLLOW_UP_TYPE_LABEL_NAMES;
  for (i = 0; i < task.length; i++) {
    parts.push(cos_gmailSearchLabelTerm_(task[i]));
  }
  for (i = 0; i < fup.length; i++) {
    parts.push(cos_gmailSearchLabelTerm_(fup[i]));
  }
  return (
    '(' +
    parts.join(' OR ') +
    ') -label:"' +
    String(CosConstants.DEFAULT_GMAIL_LABEL_PROCESSED).replace(/"/g, '') +
    '"'
  );
}

/**
 * @type {string}
 */
CosConstants.DEFAULT_GMAIL_TASK_QUERY = cos_buildDefaultGmailTaskQuery_();
