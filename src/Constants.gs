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

  /** 1-based column indexes matching TASK_HEADERS (datetime-like cells). */
  DATETIME_DISPLAY_COLUMNS: Object.freeze([5, 9, 10, 13, 14, 16, 17, 20]),

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
    'Closure Status',
    'Closure Requested At',
    'Completion Timestamp',
    'Miss Count',
    'Last Outcome',
    'Last Nudge At',
  ]),

  /** First N columns equal pre-closure schema (for sheet migration). */
  TASK_HEADERS_LEGACY_COLUMN_COUNT: 14,

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
    AWAITING_CLOSURE: 'Awaiting Closure',
    DONE: 'Done',
    DROPPED: 'Dropped',
    PAUSED: 'Paused',
    ERROR: 'Error',
    FOLLOW_UP: 'Follow-up',
  }),

  TASK_STATUS_LIST: Object.freeze([
    'Pending',
    'Scheduled',
    'Awaiting Closure',
    'Done',
    'Dropped',
    'Paused',
    'Error',
    'Follow-up',
  ]),

  /** Sub-state while row is in the closure engine (sheet column). */
  TASK_CLOSURE_STATUS: Object.freeze({
    AWAITING: 'Awaiting',
    RESOLVED: 'Resolved',
  }),

  TASK_CLOSURE_STATUS_LIST: Object.freeze(['Awaiting', 'Resolved']),

  /** Most recent closure decision (sheet column). */
  TASK_LAST_OUTCOME: Object.freeze({
    DONE: 'Done',
    RESCHEDULED: 'Rescheduled',
    LOWERED: 'Lowered',
    DROPPED: 'Dropped',
  }),

  TASK_LAST_OUTCOME_LIST: Object.freeze([
    'Done',
    'Rescheduled',
    'Lowered',
    'Dropped',
  ]),

  TASK_SOURCE: Object.freeze({
    MANUAL: 'Manual',
    EMAIL: 'Email',
    SYSTEM: 'System',
    TELEGRAM: 'Telegram',
  }),

  TASK_SOURCE_LIST: Object.freeze(['Manual', 'Email', 'System', 'Telegram']),

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
    /** Full web app URL ending in /exec (Deploy → Web app). */
    CLOSURE_WEBAPP_URL: 'CLOSURE_WEBAPP_URL',
    /** HMAC secret for closure links; seeded on Install if missing. */
    CLOSURE_LINK_SECRET: 'CLOSURE_LINK_SECRET',
    /** Time trigger: every N min, sync Jeeves calendar event times → sheet. */
    CALENDAR_SYNC_TRIGGER_ENABLED: 'CALENDAR_SYNC_TRIGGER_ENABLED',
    /** Time trigger: hourly closure queue + optional stale recovery. */
    CLOSURE_MAINTENANCE_TRIGGER_ENABLED: 'CLOSURE_MAINTENANCE_TRIGGER_ENABLED',
    /** Auto-reschedule tasks stuck in Awaiting Closure past grace (Phase 3). */
    CLOSURE_RECOVERY_RESCHEDULE_STALE: 'CLOSURE_RECOVERY_RESCHEDULE_STALE',
    /** Hours after Closure Requested At before recovery runs (default 48). */
    CLOSURE_RECOVERY_GRACE_HOURS: 'CLOSURE_RECOVERY_GRACE_HOURS',
    /** From @BotFather; never commit. */
    TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
    /** Your numeric Telegram chat id (private chat with the bot). */
    TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
    /** When true, send a Telegram prompt when a block moves to Awaiting Closure. */
    TELEGRAM_CLOSURE_ENABLED: 'TELEGRAM_CLOSURE_ENABLED',
    /** When true, plain (non-reply) messages can create tasks via rule-based parser. */
    TELEGRAM_TASK_CAPTURE_ENABLED: 'TELEGRAM_TASK_CAPTURE_ENABLED',
    /**
     * When true + DIGEST_AI_API_KEY set, rule-based Telegram capture can call the LLM on hard parses
     * (after deterministic rules fail or business-day wording is incomplete).
     */
    TELEGRAM_PARSE_AI_ENABLED: 'TELEGRAM_PARSE_AI_ENABLED',
    /**
     * When true, Telegram replies are more conversational and the LLM is used earlier (when enabled).
     * Non-command chat will be answered without creating sheet rows unless an explicit action is returned.
     */
    TELEGRAM_CONVERSATIONAL_MODE_ENABLED: 'TELEGRAM_CONVERSATIONAL_MODE_ENABLED',
    /** Query param cos_tg on webhook URL; Apps Script doPost cannot read custom headers. */
    TELEGRAM_WEBHOOK_SECRET: 'TELEGRAM_WEBHOOK_SECRET',
    /**
     * When true, inbound Telegram uses getUpdates on a timer (Workspace-safe; no public web app POST).
     */
    TELEGRAM_USE_POLLING: 'TELEGRAM_USE_POLLING',
    /** Next getUpdates offset (last processed update_id + 1). */
    TELEGRAM_GET_UPDATES_OFFSET: 'TELEGRAM_GET_UPDATES_OFFSET',
  }),

  /**
   * Script Properties key: TGMP1_{chatId}_{messageId} → taskId (pending numeric reply).
   */
  TELEGRAM_PENDING_KEY_PREFIX: 'TGMP1_',

  /** TGCLAR2_{chatId} → JSON pending numeric choice after LLM “clarify” (see TelegramService). */
  TELEGRAM_CLARIFY_PENDING_PREFIX: 'TGCLAR2_',

  /** TGTPICK2_{chatId} → JSON pick task row after ambiguous reschedule/drop match. */
  TELEGRAM_TASK_PICK_PENDING_PREFIX: 'TGTPICK2_',

  /** TG1ON1_{chatId} → JSON pending pick after 3 mutual slot options for a 1:1 invite. */
  TELEGRAM_ONEONONE_PENDING_PREFIX: 'TG1ON1_',

  /** TGDIR1_{chatId} → JSON pending pick when directory search returns multiple people for a 1:1. */
  TELEGRAM_DIRECTORY_PICK_PENDING_PREFIX: 'TGDIR1_',

  /** Ms: clarify / disambiguation replies stay valid this long. */
  TELEGRAM_PENDING_UI_TTL_MS: 15 * 60 * 1000,

  /** Signed closure links remain valid this many seconds (~45 days). */
  CLOSURE_LINK_TTL_SECONDS: 45 * 24 * 60 * 60,

  /**
   * HMAC “action” for one-line calendar/digest links that open the closure menu page.
   * Must not match real closure outcomes (done, reschedule, lower, drop).
   */
  CLOSURE_SIGN_ACTION_MENU: 'menu',

  /**
   * Popup reminder N minutes before the **start** of Jeeves calendar events (Calendar API limitation).
   * Set to -1 to skip adding a reminder in code (your calendar default may still apply).
   */
  CALENDAR_JEEVES_POPUP_REMINDER_MINUTES_BEFORE_START: 10,

  /**
   * P0 tasks stuck in Awaiting Closure: auto-reschedule after this many hours when
   * CLOSURE_RECOVERY_RESCHEDULE_STALE is true. Other priorities use CLOSURE_RECOVERY_GRACE_HOURS.
   */
  CLOSURE_RECOVERY_GRACE_HOURS_P0: 6,

  /** Telegram “N business days × M min/h per day” split; max rows created in one message. */
  TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS: 14,

  /**
   * When the intended weekday has no slot, try this many **additional** Mon–Fri dates
   * (forward only) before leaving the row Pending. Keeps split order: earlier rows
   * consume earlier free weekdays so later rows can use the next ones.
   */
  TELEGRAM_BUSINESS_DAY_SPLIT_FORWARD_SLIP_BUSINESS_DAYS: 14,

  /** Max chars sent to the Telegram parse LLM (truncated). */
  TELEGRAM_PARSE_AI_MAX_INPUT_CHARS: 3500,

  /** OpenAI default when DIGEST_AI_MODEL is empty and provider is openai. */
  DEFAULT_TELEGRAM_PARSE_OPENAI_MODEL: 'gpt-4o-mini',

  SCHEMA_VERSION: '2',

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

  /** Jeeves calendar → sheet time sync when CALENDAR_SYNC_TRIGGER_ENABLED. */
  TRIGGER_CALENDAR_JEEVES_SYNC_EVERY_MINUTES: 15,

  /**
   * Time trigger: elapsed Scheduled → Awaiting Closure + stale recovery when
   * CLOSURE_MAINTENANCE_TRIGGER_ENABLED. Apps Script allows 1, 5, 10, 15, 30.
   */
  TRIGGER_CLOSURE_MAINTENANCE_EVERY_MINUTES: 15,

  /** Time trigger: Telegram getUpdates when TELEGRAM_USE_POLLING (allowed: 1, 5, 10, …). */
  TRIGGER_TELEGRAM_POLL_EVERY_MINUTES: 1,

  SCHEDULING_HORIZON_DAYS: 21,

  /**
   * When a 1:1 is requested for “tomorrow” but that day has no mutual slot, widen free/busy
   * search to at least this many calendar days so we can propose alternatives.
   */
  ONE_ON_ONE_FALLBACK_MIN_DAYS: 7,
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
    CLOSURE_STATUS: 15,
    CLOSURE_REQUESTED_AT: 16,
    COMPLETION_TIMESTAMP: 17,
    MISS_COUNT: 18,
    LAST_OUTCOME: 19,
    LAST_NUDGE_AT: 20,
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
