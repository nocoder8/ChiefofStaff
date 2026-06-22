/**
 * Central configuration for Chief of Staff (bound spreadsheet automation).
 * Operator documentation: README.md at repository root.
 * @namespace
 */
var CosConstants = {
  PRODUCT_NAME: 'Chief of Staff',

  /**
   * Gmail "From" display name for script-sent mail (address remains the script user).
   * Helps avoid the inbox showing "me" when sending digest to yourself.
   */
  ASSISTANT_EMAIL_DISPLAY_NAME: 'Jeeves',

  /**
   * Calendar event title prefix for scheduler-created tasks (emoji + [Jeeves]-).
   * 🎩 = Jeeves/butler motif; alternatives: 📋 tasks, 📅 schedule, 🤖 automation.
   * Visual style: Sage via CalendarApp.EventColor.PALE_GREEN in CalendarRepository.createTaskEvent.
   */
  CALENDAR_JEEVES_EVENT_TITLE_PREFIX: '🎩 [Jeeves]-',

  /** Maximum length for the full calendar title (prefix + truncated task text). */
  CALENDAR_JEEVES_EVENT_TITLE_MAX_LEN: 200,

  /** Telegram 1:1 invites: title ends with this (no emoji; does not use CALENDAR_JEEVES_EVENT_TITLE_PREFIX). */
  CALENDAR_ONE_ON_ONE_INVITE_TITLE_SUFFIX: ' [Scheduled by Jeeves]',

  TASKS_SHEET_NAME: 'Tasks',
  TASKS_HEADER_ROW: 1,
  TASKS_FIRST_DATA_ROW: 2,

  /**
   * Display format for date/time columns (sheet timezone, not UTC text).
   * Ordinals ("31st") are not supported by Sheets number formats; day shows as "31".
   */
  TASK_DATETIME_DISPLAY_FORMAT: 'h:mm AM/PM, d mmmm yyyy',

  /** 1-based column indexes matching TASK_HEADERS (datetime-like cells). */
  DATETIME_DISPLAY_COLUMNS: Object.freeze([
    5, 9, 10, 11, 12, 15, 16, 18, 19, 22, 26, 27,
  ]),

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
    'Original Scheduled Start',
    'Original Scheduled End',
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
    'Follow-up Contact Email',
    'Follow-up Contact Name',
    'Reschedule Count',
    'First Scheduled At',
    'Completed At',
    'Final Status',
    'Closure Type',
  ]),

  /** Column count before performance analytics fields (for migration / health tail). */
  TASK_HEADERS_PRE_ANALYTICS_COLUMN_COUNT: 24,

  /** Terminal sheet values for analytics (Final Status column). */
  TASK_ANALYTICS_FINAL_STATUS: Object.freeze({
    DONE: 'Done',
    DROPPED: 'Dropped',
  }),

  TASK_ANALYTICS_FINAL_STATUS_LIST: Object.freeze(['Done', 'Dropped']),

  /** Last closure path (Closure Type column); empty allowed for legacy rows. */
  TASK_ANALYTICS_CLOSURE_TYPE: Object.freeze({
    DONE: 'Done',
    RESCHEDULE: 'Reschedule',
    LOWER: 'Lower',
    DROP: 'Drop',
  }),

  TASK_ANALYTICS_CLOSURE_TYPE_LIST: Object.freeze([
    'Done',
    'Reschedule',
    'Lower',
    'Drop',
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
    /**
     * Optional: your first name for Telegram 1:1 invite titles (e.g. Pavan).
     * If unset, the title uses the first token derived from your work email local part.
     */
    USER_DISPLAY_FIRST_NAME: 'USER_DISPLAY_FIRST_NAME',
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
    /** When true, weekly Saturday 9:00 (sheet TZ) sends task performance report. */
    WEEKLY_PERFORMANCE_REPORT_ENABLED: 'WEEKLY_PERFORMANCE_REPORT_ENABLED',
    /** yyyy-MM-dd in spreadsheet TZ; avoids duplicate weekly sends the same local day. */
    WEEKLY_PERFORMANCE_LAST_SENT_DATE: 'WEEKLY_PERFORMANCE_LAST_SENT_DATE',
    /**
     * When true, weekly Sun ~05:00 (sheet TZ) prunes RAW_TIMING_ACTIVITY + TIMING_ACTIVITY_IMPORT_LOG
     * older than a rolling TIMING_ACTIVITY_RETENTION_DAYS calendar-day window (default 45). Set false to disable.
     */
    TIMING_ACTIVITY_PRUNE_TRIGGER_ENABLED: 'TIMING_ACTIVITY_PRUNE_TRIGGER_ENABLED',
    /** Rolling calendar days of Timing activity/log rows to keep (min 7 in manual prune menu; default 45). */
    TIMING_ACTIVITY_RETENTION_DAYS: 'TIMING_ACTIVITY_RETENTION_DAYS',
  }),

  /** Default rolling keep window for Timing activity (Script Property TIMING_ACTIVITY_RETENTION_DAYS overrides). */
  DEFAULT_TIMING_ACTIVITY_RETENTION_DAYS: 45,

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

  /** TG1OBATCH_{chatId} → separate 1:1s with multiple people (sequential directory + slots). */
  TELEGRAM_ONEONONE_BATCH_PREFIX: 'TG1OBATCH_',

  /** TGDIR1_{chatId} → JSON pending pick when directory search returns multiple people for a 1:1. */
  TELEGRAM_DIRECTORY_PICK_PENDING_PREFIX: 'TGDIR1_',

  /** TGFWU1_{chatId} → awaiting “who to follow up with?” after Telegram Follow-up task created. */
  TELEGRAM_FOLLOWUP_CONTACT_PENDING_PREFIX: 'TGFWU1_',

  /** TGFWD1_{chatId} → directory disambiguation for follow-up contact (taskId + candidates). */
  TELEGRAM_FOLLOWUP_DIRECTORY_PICK_PREFIX: 'TGFWD1_',

  /** Max people shown when directory search returns multiple matches (must match searchDirectoryPeople page size). */
  TELEGRAM_DIRECTORY_DISAMBIG_MAX: 8,

  /** TGMTRES1_{chatId} → chained directory picks when scheduling a meeting with 2+ named attendees. */
  TELEGRAM_MEETING_RESOLVE_PENDING_PREFIX: 'TGMTRES1_',

  /** After no mutual slots on a chosen day: user may reply next day / another date. */
  TELEGRAM_MEETING_DATE_RETRY_PREFIX: 'TG1ODR_',

  /**
   * Split “workhours” vs “remote” blocks by block start time (minutes from midnight).
   * Default 19:00 — matches 12–17 then 19:30–23:30 in DEFAULT_WORK_HOURS_JSON.
   */
  WORK_HOURS_REMOTE_SPLIT_START_MINUTES: 19 * 60,

  /** Max guests (excluding you) for Telegram “meeting with A and B” scheduling. */
  TELEGRAM_MEETING_ATTENDEES_MAX: 5,

  /** Ms: clarify / disambiguation replies stay valid this long. */
  TELEGRAM_PENDING_UI_TTL_MS: 15 * 60 * 1000,

  /** Sent immediately before LLM or heavy sheet/calendar work (one per inbound message). */
  TELEGRAM_PROGRESS_ACK_TEXT: 'I am working on it — one moment.',

  /** Signed closure links remain valid this many seconds (~45 days). */
  CLOSURE_LINK_TTL_SECONDS: 45 * 24 * 60 * 60,

  /**
   * HMAC “action” for one-line calendar/digest links that open the closure menu page.
   * Must not match real closure outcomes (done, reschedule, lower, drop).
   */
  CLOSURE_SIGN_ACTION_MENU: 'menu',

  /**
   * Signed action for daily digest: mark a Pending Follow-up row Done (bypasses calendar closure).
   */
  CLOSURE_SIGN_ACTION_DIGEST_DONE: 'digest_done',

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

  SCHEMA_VERSION: '4',

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

  /** Max threads processed in one ingest run (follow-ups reserved first, then tasks). */
  GMAIL_INGEST_MAX_THREADS: 60,

  /**
   * How many threads to page through per Jeeves label before sorting/filtering.
   * Without this, only the first page from Gmail is seen (old labeled threads can be missed).
   */
  GMAIL_INGEST_MAX_LABEL_SCAN: 200,

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

  /** Max RAW_TIMING_ACTIVITY data rows scanned per digest (day filter in memory). */
  DIGEST_ABANDONED_MAX_ACTIVITY_ROWS: 12000,
  /** Top N Timing project names shown for “what you did instead” (day-level rollup). */
  DIGEST_ABANDONED_TOP_PROJECTS: 5,
  /** Sample activity hierarchy lines shown under each abandoned slot. */
  DIGEST_ABANDONED_SAMPLE_LINES: 6,

  /** Max RAW_TIMING_ENTRIES data rows scanned (newest tail) for per-slot overlap with abandoned windows. */
  DIGEST_ABANDONED_MAX_TIME_ENTRY_SCAN_ROWS: 20000,
  /** Per abandoned window: max Timing projects (by overlap minutes) in the digest line. */
  DIGEST_ABANDONED_SLOT_MAX_PROJECTS: 5,
  /** Per project within a window: max distinct entry titles listed. */
  DIGEST_ABANDONED_SLOT_MAX_TITLES_PER_PROJECT: 8,
  /** Per abandoned slot: max RAW_TIMING_ACTIVITY line_text samples (matching slot timing_project_name). */
  DIGEST_ABANDONED_SLOT_ACTIVITY_LINES: 12,

  /** Donut chart: max segments (remainder rolls into “Other”). */
  DIGEST_TIMING_CHART_MAX_SEGMENTS: 12,
  /** QuickChart image width/height (px) for digest donut. */
  DIGEST_QUICKCHART_WIDTH: 520,
  DIGEST_QUICKCHART_HEIGHT: 340,

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
    ORIGINAL_SCHEDULED_START: 11,
    ORIGINAL_SCHEDULED_END: 12,
    CALENDAR_EVENT_ID: 13,
    NOTES: 14,
    CREATED_AT: 15,
    UPDATED_AT: 16,
    CLOSURE_STATUS: 17,
    CLOSURE_REQUESTED_AT: 18,
    COMPLETION_TIMESTAMP: 19,
    MISS_COUNT: 20,
    LAST_OUTCOME: 21,
    LAST_NUDGE_AT: 22,
    FOLLOW_UP_CONTACT_EMAIL: 23,
    FOLLOW_UP_CONTACT_NAME: 24,
    RESCHEDULE_COUNT: 25,
    FIRST_SCHEDULED_AT: 26,
    COMPLETED_AT: 27,
    FINAL_STATUS: 28,
    CLOSURE_TYPE: 29,
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
