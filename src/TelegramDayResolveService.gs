/**
 * Map natural day phrases to yyyy-MM-dd in a spreadsheet timezone (Telegram reschedule).
 */
var CosTelegramDayResolve = {
  /** @type {Object<string, number>} JS Sunday=0 … Saturday=6 */
  _DOW_TO_NUM_: {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  },

  /**
   * @param {string} tz IANA
   * @param {string} phrase e.g. tomorrow, thursday, next monday
   * @param {Date=} optNow
   * @returns {string|null} yyyy-MM-dd
   */
  phraseToYmd: function (tz, phrase, optNow) {
    var zone = String(tz || '').trim() || Session.getScriptTimeZone();
    var now = optNow || new Date();
    var raw = String(phrase || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (!raw) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    var todayYmd = cos_formatYmd_(now, zone);
    if (raw === 'today') {
      return todayYmd;
    }
    if (raw === 'tomorrow') {
      return cos_ymdAddCalendarDays_(todayYmd, 1, zone);
    }
    var skipFirst = false;
    if (/^next\s+/.test(raw)) {
      skipFirst = true;
      raw = raw.replace(/^next\s+/, '').trim();
    }
    var want = CosTelegramDayResolve._DOW_TO_NUM_[raw];
    if (want === undefined) {
      return null;
    }
    var found = 0;
    var d;
    for (d = 0; d <= 21; d++) {
      var ymd = cos_ymdAddCalendarDays_(todayYmd, d, zone);
      if (CosTelegramDayResolve._ymdJsDay_(ymd, zone) !== want) {
        continue;
      }
      found++;
      if (skipFirst && found === 1) {
        continue;
      }
      return ymd;
    }
    return null;
  },

  /**
   * @param {string} ymd
   * @param {string} tz
   * @returns {number} 0 Sun … 6 Sat (matches Date.getDay)
   * @private
   */
  _ymdJsDay_: function (ymd, tz) {
    var d = Utilities.parseDate(ymd + ' 12:00', tz, 'yyyy-MM-dd HH:mm');
    var iso = parseInt(Utilities.formatDate(d, tz, 'u'), 10);
    if (!isNaN(iso) && iso >= 1 && iso <= 7) {
      return iso === 7 ? 0 : iso;
    }
    return d.getDay();
  },
};
