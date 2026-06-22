/**
 * Map natural day phrases to yyyy-MM-dd in a spreadsheet timezone (Telegram reschedule).
 */
var CosTelegramDayResolve = {
  /**
   * Month names for RegExp alternation (longer tokens first where relevant).
   * @private
   */
  _MONTH_NAME_ALT_:
    'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec',

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
   * @param {string} phrase e.g. tomorrow, thursday, next monday, 13 april, april 13
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
      return CosTelegramDayResolve._calendarMonthPhraseToYmd_(zone, raw, now);
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
   * English calendar dates: "13th April", "April 13", "the 13th of april 2027".
   * Year optional (defaults to current calendar year in tz; if that date is before today, use next year).
   * @param {string} zone IANA
   * @param {string} raw lowercased, single-spaced phrase
   * @param {Date} now
   * @returns {string|null} yyyy-MM-dd
   * @private
   */
  _calendarMonthPhraseToYmd_: function (zone, raw, now) {
    raw = String(raw || '')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) {
      return null;
    }
    var todayYmd = cos_formatYmd_(now, zone);
    var yNow = parseInt(Utilities.formatDate(now, zone, 'yyyy'), 10);
    var monthAlt = CosTelegramDayResolve._MONTH_NAME_ALT_;
    var re1 = new RegExp(
      '^(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(' +
        monthAlt +
        ')(?:\\s+(\\d{4}))?$'
    );
    var re2 = new RegExp(
      '^(' +
        monthAlt +
        ')\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$'
    );
    var m = raw.match(re1);
    var day;
    var monTok;
    var yearOpt;
    if (m) {
      day = parseInt(m[1], 10);
      monTok = m[2];
      yearOpt = m[3] ? parseInt(m[3], 10) : 0;
    } else {
      m = raw.match(re2);
      if (!m) {
        return null;
      }
      monTok = m[1];
      day = parseInt(m[2], 10);
      yearOpt = m[3] ? parseInt(m[3], 10) : 0;
    }
    var monthNum = CosTelegramDayResolve._monthTokenToNum_(monTok);
    if (!monthNum || day < 1 || day > 31) {
      return null;
    }
    function ymdForYear(y) {
      var mm = monthNum < 10 ? '0' + monthNum : String(monthNum);
      var dd = day < 10 ? '0' + day : String(day);
      var ymd = String(y) + '-' + mm + '-' + dd;
      var d = Utilities.parseDate(ymd + ' 12:00', zone, 'yyyy-MM-dd HH:mm');
      if (isNaN(d.getTime())) {
        return null;
      }
      var back = cos_formatYmd_(d, zone);
      return back === ymd ? ymd : null;
    }
    if (yearOpt >= 1900 && yearOpt <= 2100) {
      return ymdForYear(yearOpt);
    }
    var cand = ymdForYear(yNow);
    if (!cand) {
      return null;
    }
    if (cand < todayYmd) {
      cand = ymdForYear(yNow + 1);
    }
    if (!cand) {
      return null;
    }
    if (cand < todayYmd) {
      cand = ymdForYear(yNow + 2);
    }
    return cand || null;
  },

  /**
   * @param {string} tok captured month substring
   * @returns {number} 1–12 or 0
   * @private
   */
  _monthTokenToNum_: function (tok) {
    var t = String(tok || '')
      .toLowerCase()
      .replace(/\./g, '')
      .trim();
    var full = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };
    if (full[t] !== undefined) {
      return full[t];
    }
    var abbr = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      sept: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    if (abbr[t] !== undefined) {
      return abbr[t];
    }
    return 0;
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
