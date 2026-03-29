/**
 * Parses WORK_HOURS_JSON and resolves day keys in a given IANA timezone.
 */
var CosWorkHoursParser = {
  /**
   * @param {string} jsonStr
   * @returns {CosWorkHoursWeek}
   */
  parseModel: function (jsonStr) {
    var raw = {};
    try {
      raw = JSON.parse(jsonStr || '{}');
    } catch (e) {
      CosLogger.warn('Work hours JSON invalid; using empty week', {
        error: String(e),
      });
      raw = {};
    }
    var keys = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    /** @type {CosWorkHoursWeek} */
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var blocks = raw[k];
      out[k] = Array.isArray(blocks) ? blocks : [];
    }
    return out;
  },

  /**
   * @param {Date} date  Any instant on that calendar day (timezone interpreted via formatDate).
   * @param {string} timeZone IANA id
   * @returns {string} e.g. "monday"
   */
  dayKeyForDate: function (date, timeZone) {
    return Utilities.formatDate(date, timeZone, 'EEEE').toLowerCase();
  },

  /**
   * @param {CosWorkHoursWeek} model
   * @param {string} dayKey
   * @returns {CosWorkTimeBlock[]}
   */
  blocksForDay: function (model, dayKey) {
    var blocks = model[dayKey];
    return Array.isArray(blocks) ? blocks : [];
  },

  /**
   * @param {string} hhmm "HH:mm"
   * @returns {{ h: number, m: number }|null}
   */
  parseClock: function (hhmm) {
    if (!hhmm || typeof hhmm !== 'string') {
      return null;
    }
    var p = hhmm.trim().split(':');
    if (p.length < 2) {
      return null;
    }
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return null;
    }
    return { h: h, m: m };
  },
};

/**
 * @param {string} yyyyMmDd
 * @param {string} hhmm
 * @param {string} timeZone
 * @returns {Date}
 */
function cos_combineDateAndTime_(yyyyMmDd, hhmm, timeZone) {
  return Utilities.parseDate(
    yyyyMmDd + ' ' + hhmm,
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
}

/**
 * @param {Date} date
 * @param {string} timeZone
 * @returns {string}
 */
function cos_formatYmd_(date, timeZone) {
  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

/**
 * @param {Date} d
 * @param {number} minutes
 * @returns {Date}
 */
function cos_addMinutes_(d, minutes) {
  return new Date(d.getTime() + minutes * 60000);
}

/**
 * Coarse offset from a Date (e.g. calendar API windows). Do not use for iterating
 * work days in a user timezone — getDate/setDate follow the script project TZ, not IANA tz.
 * @param {Date} d
 * @param {number} days
 * @returns {Date}
 */
function cos_addCalendarDays_(d, days) {
  var x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Add whole calendar days to yyyy-MM-dd in a specific IANA timezone (noon anchor; DST-safe enough for day keys).
 * @param {string} ymd
 * @param {number} deltaDays
 * @param {string} timeZone
 * @returns {string}
 */
function cos_ymdAddCalendarDays_(ymd, deltaDays, timeZone) {
  var d = Utilities.parseDate(ymd + ' 12:00', timeZone, 'yyyy-MM-dd HH:mm');
  d.setTime(d.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return Utilities.formatDate(d, timeZone, 'yyyy-MM-dd');
}
