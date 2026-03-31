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
    var busySelf = calSelf.listBusyIntervals(
      cos_addCalendarDays_(now, -1),
      horizonEnd
    );
    var calOther = CosCalendarRepository.fromEmailOrNull(email);
    if (!calOther) {
      return {
        ok: false,
        code: 'no_attendee_cal',
        message:
          'I could not read that colleague’s calendar (check the email, or that they share availability in Workspace).',
      };
    }
    var busyOther = calOther.listBusyIntervals(
      cos_addCalendarDays_(now, -1),
      horizonEnd
    );
    var busy = busySelf.concat(busyOther);
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
