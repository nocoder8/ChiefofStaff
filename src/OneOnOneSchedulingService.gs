/**
 * Mutual free time for 1:1s and small group meetings: merge primary + all guests’ busy, then find slots.
 */
var CosOneOnOneSchedulingService = {
  /**
   * @param {CosSettings} settings
   * @param {string} attendeeEmail
   * @param {number} durationMin
   * @param {number} horizonDays
   * @param {{ focusTomorrow?: boolean, targetYmd?: string, slotWindow?: string }=} opt  targetYmd yyyy-MM-dd: only that sheet-TZ day (ignores focusTomorrow). slotWindow all|workhours|remote.
   * @returns {{ ok: true, slots: {start:Date,end:Date}[], noTomorrowMatch?: boolean } | { ok: false, code: string, message?: string }}
   */
  findThreeMutualSlots: function (settings, attendeeEmail, durationMin, horizonDays, opt) {
    var email = String(attendeeEmail || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, code: 'bad_email', message: 'Need a valid attendee email.' };
    }
    return CosOneOnOneSchedulingService.findThreeMutualSlotsMulti(
      settings,
      [email],
      durationMin,
      horizonDays,
      opt
    );
  },

  /**
   * Same as findThreeMutualSlots but for one or more guest emails (deduped).
   * @param {CosSettings} settings
   * @param {string[]} attendeeEmails
   * @param {number} durationMin
   * @param {number} horizonDays
   * @param {{ focusTomorrow?: boolean, targetYmd?: string, slotWindow?: string }=} opt
   * @returns {{ ok: true, slots: {start:Date,end:Date}[], noTomorrowMatch?: boolean } | { ok: false, code: string, message?: string }}
   */
  findThreeMutualSlotsMulti: function (
    settings,
    attendeeEmails,
    durationMin,
    horizonDays,
    opt
  ) {
    opt = opt || {};
    var targetYmd = String(opt.targetYmd || '').trim();
    var hasTarget = /^\d{4}-\d{2}-\d{2}$/.test(targetYmd);
    var focusTomorrow = opt.focusTomorrow === true && !hasTarget;
    var raw = attendeeEmails || [];
    var uniq = [];
    var seen = {};
    var g;
    for (g = 0; g < raw.length; g++) {
      var em = String(raw[g] || '')
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        return {
          ok: false,
          code: 'bad_email',
          message: 'Need a valid attendee email for each guest.',
        };
      }
      if (!seen[em]) {
        seen[em] = true;
        uniq.push(em);
      }
    }
    if (!uniq.length) {
      return { ok: false, code: 'bad_email', message: 'Need at least one guest email.' };
    }
    var tz =
      String(settings.timezone || '').trim() || Session.getScriptTimeZone();
    var workModel = CosWorkHoursParser.parseModel(settings.workHoursJson);
    var sw = String(opt.slotWindow || 'all').toLowerCase();
    if (sw === 'workhours' || sw === 'remote') {
      workModel = CosWorkHoursParser.filterModelBySlotWindow(workModel, sw);
    }
    var h = Math.floor(Number(horizonDays));
    if (isNaN(h) || h < 1) {
      h = 14;
    }
    if (h > CosConstants.SCHEDULING_HORIZON_DAYS) {
      h = CosConstants.SCHEDULING_HORIZON_DAYS;
    }
    var now = new Date();
    var targetDayOff = -1;
    if (hasTarget) {
      targetDayOff = cos_dayOffsetFromTodayToYmd_(
        now,
        targetYmd,
        tz,
        CosConstants.SCHEDULING_HORIZON_DAYS + 400
      );
      if (targetDayOff < 0) {
        return {
          ok: false,
          code: 'target_past',
          message:
            'That date (' +
            targetYmd +
            ') is in the past in your sheet timezone. Use yyyy-MM-dd for a future day.',
        };
      }
      h = Math.max(h, targetDayOff + 1);
    }
    var hBusy = h;
    if (focusTomorrow) {
      hBusy = Math.min(
        CosConstants.SCHEDULING_HORIZON_DAYS,
        Math.max(h, CosConstants.ONE_ON_ONE_FALLBACK_MIN_DAYS)
      );
    }
    if (hasTarget) {
      hBusy = Math.max(hBusy, targetDayOff + 2);
    }
    var horizonEnd = cos_addCalendarDays_(now, hBusy + 1);
    var calSelf = CosCalendarRepository.fromSettings(settings);
    var winStart = cos_addCalendarDays_(now, -1);
    var busySelf = calSelf.listBusyIntervals(winStart, horizonEnd);
    var busy = busySelf.slice();
    var gi;
    for (gi = 0; gi < uniq.length; gi++) {
      var other = CosCalendarRepository.tryBusyIntervalsForAttendeeEmail(
        uniq[gi],
        winStart,
        horizonEnd,
        tz
      );
      if (!other.ok) {
        return {
          ok: false,
          code: 'no_attendee_cal',
          message:
            'I could not read free/busy for ' +
            uniq[gi] +
            ' (check the address, Workspace calendar visibility, and that the Calendar API service is enabled).',
        };
      }
      busy = busy.concat(other.busy);
    }
    var stepMin = CosConstants.SCHEDULING_SLOT_STEP_MINUTES;
    if (hasTarget) {
      var slotHorizon = Math.max(h, targetDayOff + 1);
      var onlyDay = CosTaskSchedulerService.findUpToFreeSlots(
        workModel,
        tz,
        stepMin,
        durationMin,
        slotHorizon,
        now,
        busy,
        now,
        3,
        targetDayOff,
        targetDayOff
      );
      return {
        ok: true,
        slots: onlyDay,
        noTomorrowMatch: false,
        targetYmdOnly: true,
      };
    }
    if (focusTomorrow) {
      var tomorrowOnly = CosTaskSchedulerService.findUpToFreeSlots(
        workModel,
        tz,
        stepMin,
        durationMin,
        hBusy,
        now,
        busy,
        now,
        3,
        1,
        1
      );
      if (tomorrowOnly.length) {
        return { ok: true, slots: tomorrowOnly, noTomorrowMatch: false };
      }
      var wide = CosTaskSchedulerService.findUpToFreeSlots(
        workModel,
        tz,
        stepMin,
        durationMin,
        hBusy,
        now,
        busy,
        now,
        3,
        0,
        hBusy
      );
      return {
        ok: true,
        slots: wide,
        noTomorrowMatch: wide.length > 0,
      };
    }
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
