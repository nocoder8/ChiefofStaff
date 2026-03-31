/**
 * Mutual free time for 1:1s: merge primary + attendee busy, then find slots in work hours.
 */
var CosOneOnOneSchedulingService = {
  /**
   * @param {CosSettings} settings
   * @param {string} attendeeEmail
   * @param {number} durationMin
   * @param {number} horizonDays
   * @returns {{ ok: true, slots: {start:Date,end:Date}[] } | { ok: false, code: string, message?: string }}
   */
  findThreeMutualSlots: function (settings, attendeeEmail, durationMin, horizonDays) {
    var email = String(attendeeEmail || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, code: 'bad_email', message: 'Need a valid attendee email.' };
    }
    var tz =
      String(settings.timezone || '').trim() || Session.getScriptTimeZone();
    var workModel = CosWorkHoursParser.parseModel(settings.workHoursJson);
    var h = Math.floor(Number(horizonDays));
    if (isNaN(h) || h < 1) {
      h = 14;
    }
    if (h > CosConstants.SCHEDULING_HORIZON_DAYS) {
      h = CosConstants.SCHEDULING_HORIZON_DAYS;
    }
    var now = new Date();
    var horizonEnd = cos_addCalendarDays_(now, h + 1);
    var calSelf = CosCalendarRepository.fromSettings(settings);
    var winStart = cos_addCalendarDays_(now, -1);
    var busySelf = calSelf.listBusyIntervals(winStart, horizonEnd);
    var other = CosCalendarRepository.tryBusyIntervalsForAttendeeEmail(
      email,
      winStart,
      horizonEnd,
      tz
    );
    if (!other.ok) {
      return {
        ok: false,
        code: 'no_attendee_cal',
        message:
          'I could not read that colleague’s free/busy (check the email, Workspace calendar visibility, and that the Calendar API service is enabled in the script project).',
      };
    }
    var busy = busySelf.concat(other.busy);
    var stepMin = CosConstants.SCHEDULING_SLOT_STEP_MINUTES;
    var slots = CosTaskSchedulerService.findUpToFreeSlots(
      workModel,
      tz,
      stepMin,
      durationMin,
      h,
      now,
      busy,
      now,
      3
    );
    return { ok: true, slots: slots };
  },
};
