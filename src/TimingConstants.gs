/**
 * Timing Web API integration — sheet names, script property keys, column headers.
 * API: https://web.timingapp.com/docs/ — time-entries + activity-hierarchy (granular app usage).
 *
 * Quota: Timing documents roughly 500 HTTP requests per hour per API key.
 * Each import uses 1 request per page of results; prefer smaller time windows
 * and/or less frequent triggers if you approach that cap across all callers.
 * @namespace
 */
var CosTimingConstants = {
  /** Default lookback when running a rolling hourly-window import (e.g. time trigger every 4h). */
  DEFAULT_IMPORT_LOOKBACK_HOURS: 4,

  /** Default inclusive calendar-day window for time-entry + activity imports (menu + test helpers). */
  DEFAULT_TIMING_IMPORT_CALENDAR_DAYS: 45,
  RAW_SHEET_NAME: 'RAW_TIMING_ENTRIES',
  LOG_SHEET_NAME: 'TIMING_IMPORT_LOG',
  /** Plain-text hierarchy lines (GET /activity-hierarchy); finer than time-entries alone. */
  RAW_ACTIVITY_SHEET_NAME: 'RAW_TIMING_ACTIVITY',
  ACTIVITY_LOG_SHEET_NAME: 'TIMING_ACTIVITY_IMPORT_LOG',
  HEADER_ROW: 1,
  FIRST_DATA_ROW: 2,

  /** Finest block_size supported by Timing for activity-hierarchy (see API docs). */
  ACTIVITY_BLOCK_SIZE: '5min',
  /** Pass 1 to include very short segments (API default is 60). */
  ACTIVITY_MIN_DURATION_SECONDS: 1,
  /** API allows 1–1000; higher = more leaf lines per request. */
  ACTIVITY_HIERARCHY_MAX_LINES: 1000,
  /**
   * Timing allows up to 32 calendar days per activity-hierarchy request; the importer uses **one day
   * per request** so `max_lines` applies per day (not shared across the whole window).
   */
  ACTIVITY_HIERARCHY_MAX_RANGE_DAYS: 32,

  /** Default when TIMING_API_BASE_URL script property is unset. */
  DEFAULT_API_BASE_URL: 'https://web.timingapp.com/api/v1',

  PROP_KEYS: Object.freeze({
    TIMING_API_KEY: 'TIMING_API_KEY',
    TIMING_API_BASE_URL: 'TIMING_API_BASE_URL',
  }),

  /**
   * One row per Timing time entry (GET /time-entries item + import metadata).
   * app_name / domain / path_or_url: not returned by list time-entries (see Timing docs); left blank for phase 1.
   * updated_ts: populated only if the API adds such a field later; otherwise empty.
   */
  RAW_HEADERS: Object.freeze([
    'timing_entry_id',
    'import_run_id',
    'start_ts',
    'end_ts',
    'duration_minutes',
    'title',
    'timing_project_name',
    'app_name',
    'domain',
    'path_or_url',
    'notes',
    'updated_ts',
    'raw_json',
    'imported_at',
  ]),

  /**
   * One row per import run.
   */
  LOG_HEADERS: Object.freeze([
    'import_run_id',
    'started_at',
    'ended_at',
    'date_from',
    'date_to',
    'rows_fetched',
    'rows_inserted',
    'rows_skipped_existing',
    'status',
    'error_message',
  ]),

  /**
   * One row per non-empty line from GET /activity-hierarchy (tab depth = nesting).
   * Jeeves / digest can join this to calendar P0 blocks by overlapping timestamps later.
   */
  ACTIVITY_HEADERS: Object.freeze([
    'import_run_id',
    'window_start_ymd',
    'window_end_ymd',
    'block_size',
    'min_duration_sec',
    'max_lines',
    'line_no',
    'indent_level',
    'line_text',
    'timing_project_name',
    /** Remainder after first {@code |} on indent-0 roots: e.g. {@code Google Chrome | app.eightfold.ai}. */
    'details',
    'imported_at',
  ]),

  ACTIVITY_LOG_HEADERS: Object.freeze([
    'import_run_id',
    'started_at',
    'ended_at',
    'date_from',
    'date_to',
    'lines_written',
    'status',
    'error_message',
  ]),
};

