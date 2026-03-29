/**
 * Thin wrapper around CalendarApp for the primary work calendar.
 * @constructor
 * @param {GoogleAppsScript.Calendar.Calendar} calendar
 */
function CosCalendarRepository(calendar) {
  /** @type {GoogleAppsScript.Calendar.Calendar} */
  this._cal = calendar;
}

/**
 * @param {CosSettings} settings
 * @returns {CosCalendarRepository}
 */
CosCalendarRepository.fromSettings = function (settings) {
  var calId =
    String(settings.primaryCalendarId || '').trim() ||
    String(settings.userEmail || '').trim();
  var cal = null;
  if (calId) {
    try {
      cal = CalendarApp.getCalendarById(calId);
    } catch (e) {
      CosLogger.warn('getCalendarById failed; trying default', {
        calId: calId,
        error: String(e),
      });
    }
  }
  if (!cal) {
    cal = CalendarApp.getDefaultCalendar();
  }
  if (!cal) {
    throw new Error(
      'No calendar available. Set PRIMARY_CALENDAR_ID or USER_EMAIL in script properties.'
    );
  }
  return new CosCalendarRepository(cal);
};

/**
 * @returns {string} Human-readable primary calendar name and id (for health / logs).
 */
CosCalendarRepository.prototype.describeCalendar = function () {
  var name = this._cal.getName();
  var id = '';
  try {
    id = this._cal.getId();
  } catch (e) {
    id = '';
  }
  return id ? name + ' [' + id + ']' : name;
};

/**
 * @param {Date} start inclusive
 * @param {Date} end exclusive upper bound for query window
 * @returns {{ start: Date, end: Date, id: string, title: string }[]}
 */
CosCalendarRepository.prototype.listBusyIntervals = function (start, end) {
  var events = this._cal.getEvents(start, end);
  var out = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (!cos_calendarEventCountsAsBusy_(e)) {
      continue;
    }
    var title = '';
    try {
      title = String(e.getTitle() || '');
    } catch (err1) {
      title = '';
    }
    out.push({
      start: e.getStartTime(),
      end: e.getEndTime(),
      id: e.getId(),
      title: title,
    });
  }
  return out;
};

/**
 * Declined invites and Google “working location” blocks do not count as busy for scheduling.
 * Working location uses CalendarApp.EventType.WORKING_LOCATION from getEventType(), not title matching.
 * @param {GoogleAppsScript.Calendar.CalendarEvent} e
 * @returns {boolean}
 */
function cos_calendarEventCountsAsBusy_(e) {
  try {
    if (e.getMyStatus() === CalendarApp.GuestStatus.NO) {
      return false;
    }
  } catch (err) {
    // If status is unavailable, keep the event as busy.
  }
  try {
    if (e.getEventType() === CalendarApp.EventType.WORKING_LOCATION) {
      return false;
    }
  } catch (errT) {
    // Older or unusual events may not support getEventType; treat as busy.
  }
  return true;
}

/**
 * @param {string} title
 * @param {Date} start
 * @param {Date} end
 * @param {string} taskId
 * @returns {GoogleAppsScript.Calendar.CalendarEvent}
 */
CosCalendarRepository.prototype.createTaskEvent = function (
  title,
  start,
  end,
  taskId
) {
  var prefix = CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX;
  var maxLen = CosConstants.CALENDAR_JEEVES_EVENT_TITLE_MAX_LEN;
  var budget = Math.max(0, maxLen - prefix.length);
  var raw = String(title || '');
  var safeTitle =
    raw.length > budget
      ? raw.substring(0, Math.max(0, budget - 1)) + '…'
      : raw;
  var fullTitle = prefix + safeTitle;
  var desc =
    'Jeeves / Chief of Staff taskId=' +
    taskId +
    '\nManaged by Chief of Staff (Google Sheet).';
  var ev = this._cal.createEvent(fullTitle, start, end, {
    description: desc,
  });
  try {
    ev.setColor(CalendarApp.EventColor.PALE_GREEN);
  } catch (colorErr) {
    CosLogger.warn('createTaskEvent: setColor failed', {
      error: String(colorErr),
    });
  }
  return ev;
};

/**
 * @param {string} eventId
 * @returns {GoogleAppsScript.Calendar.CalendarEvent|null}
 */
CosCalendarRepository.prototype.getEventByIdIfExists = function (eventId) {
  var id = String(eventId || '').trim();
  if (!id) {
    return null;
  }
  try {
    return CalendarApp.getEventById(id);
  } catch (e) {
    return null;
  }
};
