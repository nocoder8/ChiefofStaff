/**
 * Expand Mon–Fri calendar dates for “per business day” booking (sheet timezone).
 */
var CosBusinessDaySplitService = {
  /**
   * @param {string} tz IANA
   * @param {'next_day'|'today'} anchor next_day = first candidate is tomorrow’s date; today = today’s date (weekends skipped when collecting).
   * @param {number} count how many weekdays to collect
   * @returns {string[]|null} yyyy-MM-dd list or null if not enough days within guard
   */
  collectBusinessDayYmds_: function (tz, anchor, count) {
    var zone = String(tz || '').trim() || Session.getScriptTimeZone();
    var n = Math.floor(Number(count));
    if (n < 1 || n > CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS) {
      return null;
    }
    var todayYmd = cos_formatYmd_(new Date(), zone);
    var ymd =
      anchor === 'today'
        ? todayYmd
        : cos_ymdAddCalendarDays_(todayYmd, 1, zone);
    var out = [];
    var guard = 0;
    while (out.length < n && guard < 400) {
      guard++;
      var probe = Utilities.parseDate(ymd + ' 12:00', zone, 'yyyy-MM-dd HH:mm');
      var dk = CosWorkHoursParser.dayKeyForDate(probe, zone);
      if (dk !== 'saturday' && dk !== 'sunday') {
        out.push(ymd);
      }
      ymd = cos_ymdAddCalendarDays_(ymd, 1, zone);
    }
    if (out.length < n) {
      return null;
    }
    return out;
  },
};
