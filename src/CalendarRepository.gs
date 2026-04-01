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
 * Another user’s calendar (same Workspace): calendar id is typically their email.
 * @param {string} email
 * @returns {CosCalendarRepository|null}
 */
CosCalendarRepository.fromEmailOrNull = function (email) {
  var e = String(email || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return null;
  }
  try {
    var cal = CalendarApp.getCalendarById(e);
    if (!cal) {
      return null;
    }
    return new CosCalendarRepository(cal);
  } catch (err) {
    CosLogger.warn('fromEmailOrNull: calendar not accessible', {
      email: e,
      error: String(err),
    });
    return null;
  }
};

/**
 * Busy intervals for another user’s calendar: try event list first, then Calendar API FreeBusy.
 * FreeBusy often works in Workspace when getCalendarById does not (no “subscribe” needed).
 *
 * @param {string} attendeeEmail
 * @param {Date} start
 * @param {Date} end
 * @param {string} timeZone IANA
 * @returns {{ ok: true, busy: {start:Date,end:Date,id:string,title:string}[], source: string } | { ok: false, code: string }}
 */
CosCalendarRepository.tryBusyIntervalsForAttendeeEmail = function (
  attendeeEmail,
  start,
  end,
  timeZone
) {
  var e = String(attendeeEmail || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, code: 'bad_email' };
  }
  var cal = CosCalendarRepository.fromEmailOrNull(e);
  if (cal) {
    return {
      ok: true,
      busy: cal.listBusyIntervals(start, end),
      source: 'calendar_events',
    };
  }
  if (typeof Calendar === 'undefined' || !Calendar.Freebusy) {
    CosLogger.warn('Calendar advanced service (v3) not available; enable Calendar API in Services.');
    return { ok: false, code: 'no_advanced_calendar' };
  }
  try {
    var tMin = start instanceof Date && !isNaN(start.getTime()) ? start.toISOString() : '';
    var tMax = end instanceof Date && !isNaN(end.getTime()) ? end.toISOString() : '';
    if (!tMin || !tMax) {
      CosLogger.warn('tryBusyIntervalsForAttendeeEmail: invalid window', {
        email: e,
        tMin: tMin,
        tMax: tMax,
      });
      return { ok: false, code: 'freebusy_bad_window' };
    }
    // Advanced Calendar service: request body is the argument object (not nested under "resource").
    var body = Calendar.Freebusy.query({
      timeMin: tMin,
      timeMax: tMax,
      timeZone: String(timeZone || '').trim() || Session.getScriptTimeZone(),
      items: [{ id: e }],
    });
    var calendars = body && body.calendars ? body.calendars : {};
    var entry = calendars[e];
    if (!entry) {
      var k;
      for (k in calendars) {
        if (calendars.hasOwnProperty(k) && k.toLowerCase() === e) {
          entry = calendars[k];
          break;
        }
      }
    }
    if (!entry) {
      var calKeys = Object.keys(calendars);
      if (calKeys.length === 1) {
        entry = calendars[calKeys[0]];
      }
    }
    if (!entry) {
      return { ok: false, code: 'freebusy_no_calendar' };
    }
    if (entry.errors && entry.errors.length) {
      CosLogger.warn('FreeBusy: calendar entry has errors', {
        email: e,
        errors: entry.errors,
      });
      return { ok: false, code: 'freebusy_denied' };
    }
    var busyRaw = entry.busy ? entry.busy : [];
    var out = [];
    var i;
    for (i = 0; i < busyRaw.length; i++) {
      var b = busyRaw[i];
      if (!b || !b.start || !b.end) {
        continue;
      }
      out.push({
        start: new Date(b.start),
        end: new Date(b.end),
        id: '',
        title: '(busy)',
      });
    }
    return { ok: true, busy: out, source: 'freebusy' };
  } catch (err) {
    CosLogger.warn('tryBusyIntervalsForAttendeeEmail: FreeBusy failed', {
      email: e,
      error: String(err),
    });
    return { ok: false, code: 'freebusy_failed' };
  }
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
 * Declined invites, “Show as Free” (transparent) events, and Google “working location” blocks
 * do not count as busy for scheduling.
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
    if (e.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT) {
      return false;
    }
  } catch (errTr) {
    // If transparency is unavailable, treat as busy (opaque default).
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
  var settings = new CosSettingsRepository().getSettings();
  var desc = CosClosureLinkService.buildCalendarDescription(
    taskId,
    safeTitle,
    settings
  );
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
  try {
    var rm = CosConstants.CALENDAR_JEEVES_POPUP_REMINDER_MINUTES_BEFORE_START;
    if (rm >= 0) {
      ev.addPopupReminder(rm);
    }
  } catch (remErr) {
    CosLogger.warn('createTaskEvent: addPopupReminder failed', {
      error: String(remErr),
    });
  }
  return ev;
};

/**
 * Creates a meeting and sends calendar invites (Workspace).
 * @param {string} title Full title (caller may include Jeeves prefix).
 * @param {Date} start
 * @param {Date} end
 * @param {string} guestEmailsCommaSeparated One or more emails, comma-separated.
 * @param {string=} description
 * @returns {GoogleAppsScript.Calendar.CalendarEvent}
 */
CosCalendarRepository.prototype.createMeetingInviteEvent = function (
  title,
  start,
  end,
  guestEmailsCommaSeparated,
  description
) {
  var guests = String(guestEmailsCommaSeparated || '').trim();
  var ev = this._cal.createEvent(String(title || 'Meeting'), start, end, {
    guests: guests,
    sendInvites: true,
    description: String(description || ''),
  });
  try {
    ev.setColor(CalendarApp.EventColor.PALE_GREEN);
  } catch (colorErr) {
    CosLogger.warn('createMeetingInviteEvent: setColor failed', {
      error: String(colorErr),
    });
  }
  try {
    var rm = CosConstants.CALENDAR_JEEVES_POPUP_REMINDER_MINUTES_BEFORE_START;
    if (rm >= 0) {
      ev.addPopupReminder(rm);
    }
  } catch (remErr) {
    CosLogger.warn('createMeetingInviteEvent: addPopupReminder failed', {
      error: String(remErr),
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

/**
 * Deletes a calendar event by id if it still exists (closure / reschedule paths).
 * @param {string} eventId
 * @returns {boolean} true if an event was deleted
 */
CosCalendarRepository.prototype.deleteEventByIdIfExists = function (eventId) {
  var ev = this.getEventByIdIfExists(eventId);
  if (!ev) {
    return false;
  }
  try {
    ev.deleteEvent();
    return true;
  } catch (e) {
    CosLogger.warn('deleteEventByIdIfExists failed', {
      error: String(e),
    });
    return false;
  }
};

/**
 * Updates event description (closure links refresh) if the event exists.
 * @param {string} eventId
 * @param {string} description
 * @returns {boolean}
 */
CosCalendarRepository.prototype.setEventDescriptionIfExists = function (
  eventId,
  description
) {
  var ev = this.getEventByIdIfExists(eventId);
  if (!ev) {
    return false;
  }
  try {
    ev.setDescription(String(description || ''));
    return true;
  } catch (e) {
    CosLogger.warn('setEventDescriptionIfExists failed', {
      error: String(e),
    });
    return false;
  }
};
