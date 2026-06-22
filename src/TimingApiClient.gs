/**
 * Timing Web API v1 — UrlFetchApp only. Time entries + activity hierarchy.
 * @see https://web.timingapp.com/docs/ — GET api/v1/time-entries, GET api/v1/activity-hierarchy
 */
var CosTimingApiClient = {
  /**
   * @returns {{ apiKey: string, baseUrl: string } | { error: string }}
   */
  readConfig_: function () {
    var props = PropertiesService.getScriptProperties();
    var apiKey = String(
      props.getProperty(CosTimingConstants.PROP_KEYS.TIMING_API_KEY) || ''
    ).trim();
    if (!apiKey) {
      return { error: 'Missing script property TIMING_API_KEY' };
    }
    var base = String(
      props.getProperty(CosTimingConstants.PROP_KEYS.TIMING_API_BASE_URL) ||
        ''
    ).trim();
    if (!base) {
      base = CosTimingConstants.DEFAULT_API_BASE_URL;
    }
    base = base.replace(/\/+$/, '');
    return { apiKey: apiKey, baseUrl: base };
  },

  /**
   * Lightweight GET (no body). Returns parsed JSON or throws with message.
   * @param {string} url Absolute URL
   * @param {string} apiKey
   * @returns {Object}
   * @private
   */
  _getJson_: function (url, apiKey) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText() || '';
    if (code < 200 || code >= 300) {
      throw new Error('Timing API HTTP ' + code + ': ' + body.substring(0, 500));
    }
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error('Timing API: invalid JSON body');
    }
  },

  /**
   * GET returning plain text (activity-hierarchy). Unwraps JSON wrapper if the server sends one.
   * @param {string} url
   * @param {string} apiKey
   * @returns {string}
   * @private
   */
  _getPlainText_: function (url, apiKey) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json, text/plain, */*',
      },
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText() || '';
    if (code < 200 || code >= 300) {
      throw new Error('Timing API HTTP ' + code + ': ' + body.substring(0, 500));
    }
    var t = String(body).trim();
    if (t.charAt(0) === '{') {
      try {
        var j = JSON.parse(t);
        if (typeof j === 'string') {
          return j;
        }
        if (j && typeof j.data === 'string') {
          return j.data;
        }
        if (j && typeof j.text === 'string') {
          return j.text;
        }
        if (j && typeof j.hierarchy === 'string') {
          return j.hierarchy;
        }
      } catch (e2) {
        /* fall through */
      }
    }
    return body;
  },

  /**
   * Resolves pagination next URL (absolute or path-relative to API host).
   * @param {string} baseUrl e.g. https://web.timingapp.com/api/v1
   * @param {string|null|undefined} nextHref from response.links.next
   * @returns {string}
   * @private
   */
  _resolveNextUrl_: function (baseUrl, nextHref) {
    var n = String(nextHref || '').trim();
    if (!n) {
      return '';
    }
    if (/^https?:\/\//i.test(n)) {
      return n;
    }
    var root = String(baseUrl || '').replace(/\/+$/, '');
    if (n.charAt(0) === '/') {
      var m = /^https?:\/\/[^/]+/i.exec(root);
      if (m) {
        return m[0] + n;
      }
    }
    return root + (n.indexOf('/') === 0 ? '' : '/') + n;
  },

  /**
   * Fetches all time entries with start_date in [startYmd, endYmd] (date-only, Timing user TZ per docs).
   * Uses include_project_data=1 for project title on each row.
   *
   * @param {string} startYmd yyyy-MM-dd
   * @param {string} endYmd yyyy-MM-dd
   * @returns {{ ok: boolean, entries?: Object[], error?: string, pageCount?: number }}
   */
  fetchTimeEntriesDateRange: function (startYmd, endYmd) {
    var cfg = CosTimingApiClient.readConfig_();
    if (cfg.error) {
      return { ok: false, error: cfg.error };
    }
    var apiKey = cfg.apiKey;
    var base = cfg.baseUrl;
    var qs = [
      'start_date_min=' + encodeURIComponent(String(startYmd).trim()),
      'start_date_max=' + encodeURIComponent(String(endYmd).trim()),
      'include_project_data=1',
    ].join('&');
    var firstUrl = base + '/time-entries?' + qs;
    /** @type {Object[]} */
    var all = [];
    var url = firstUrl;
    var pages = 0;
    var maxPages = 500;
    try {
      while (url && pages < maxPages) {
        pages++;
        var json = CosTimingApiClient._getJson_(url, apiKey);
        var chunk = json && json.data ? json.data : [];
        if (!Array.isArray(chunk)) {
          return {
            ok: false,
            error: 'Timing API: expected data[] array in response',
          };
        }
        var i;
        for (i = 0; i < chunk.length; i++) {
          all.push(chunk[i]);
        }
        var next =
          json.links && json.links.next ? String(json.links.next).trim() : '';
        url = next ? CosTimingApiClient._resolveNextUrl_(base, next) : '';
      }
      if (pages >= maxPages) {
        CosLogger.warn('Timing fetch: pagination safety cap reached', {
          maxPages: maxPages,
          rowsSoFar: all.length,
        });
      }
      return { ok: true, entries: all, pageCount: pages };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  },

  /**
   * Same as {@link CosTimingApiClient.fetchTimeEntriesDateRange} but with ISO8601 bounds
   * (e.g. UTC `...Z`) so the window can be sub-day. Per Timing docs, use ISO with timezone
   * for time-sensitive time-entry queries.
   *
   * @param {string} startIso ISO8601 start (inclusive min start_date)
   * @param {string} endIso ISO8601 end (inclusive max start_date)
   * @returns {{ ok: boolean, entries?: Object[], error?: string, pageCount?: number }}
   */
  fetchTimeEntriesIsoRange: function (startIso, endIso) {
    var cfg = CosTimingApiClient.readConfig_();
    if (cfg.error) {
      return { ok: false, error: cfg.error };
    }
    var apiKey = cfg.apiKey;
    var base = cfg.baseUrl;
    var qs = [
      'start_date_min=' + encodeURIComponent(String(startIso).trim()),
      'start_date_max=' + encodeURIComponent(String(endIso).trim()),
      'include_project_data=1',
    ].join('&');
    var firstUrl = base + '/time-entries?' + qs;
    /** @type {Object[]} */
    var all = [];
    var url = firstUrl;
    var pages = 0;
    var maxPages = 500;
    try {
      while (url && pages < maxPages) {
        pages++;
        var json = CosTimingApiClient._getJson_(url, apiKey);
        var chunk = json && json.data ? json.data : [];
        if (!Array.isArray(chunk)) {
          return {
            ok: false,
            error: 'Timing API: expected data[] array in response',
          };
        }
        var i;
        for (i = 0; i < chunk.length; i++) {
          all.push(chunk[i]);
        }
        var next =
          json.links && json.links.next ? String(json.links.next).trim() : '';
        url = next ? CosTimingApiClient._resolveNextUrl_(base, next) : '';
      }
      if (pages >= maxPages) {
        CosLogger.warn('Timing fetch: pagination safety cap reached', {
          maxPages: maxPages,
          rowsSoFar: all.length,
        });
      }
      return { ok: true, entries: all, pageCount: pages };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  },

  /**
   * GET /time-entries with a minimal date window (single day) to verify auth and connectivity.
   * @returns {{ ok: boolean, statusCode?: number, sampleCount?: number, error?: string }}
   */
  ping: function () {
    var cfg = CosTimingApiClient.readConfig_();
    if (cfg.error) {
      return { ok: false, error: cfg.error };
    }
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var r = CosTimingApiClient.fetchTimeEntriesDateRange(today, today);
    if (!r.ok) {
      return { ok: false, error: r.error || 'unknown' };
    }
    return {
      ok: true,
      sampleCount: (r.entries && r.entries.length) || 0,
      pageCount: r.pageCount,
    };
  },

  /**
   * GET /activity-hierarchy — tab-indented tree of app usage + projects (not the same as /time-entries).
   * Finest API granularity is {@link CosTimingConstants.ACTIVITY_BLOCK_SIZE} (5min). Max 32 days per request.
   *
   * @param {string} startYmd yyyy-MM-dd
   * @param {string} endYmd yyyy-MM-dd
   * @param {{
   *   blockSize?: string,
   *   minDurationSeconds?: number,
   *   maxLines?: number,
   *   groupByProject?: boolean,
   *   includeMobileDevices?: boolean
   * }} [opt]
   * @returns {{ ok: boolean, text?: string, error?: string }}
   */
  fetchActivityHierarchyText: function (startYmd, endYmd, opt) {
    opt = opt || {};
    var cfg = CosTimingApiClient.readConfig_();
    if (cfg.error) {
      return { ok: false, error: cfg.error };
    }
    var ml = Number(opt.maxLines);
    if (isNaN(ml) || ml < 1) {
      ml = CosTimingConstants.ACTIVITY_HIERARCHY_MAX_LINES;
    }
    ml = Math.min(1000, Math.max(1, Math.floor(ml)));
    var minSec = Number(opt.minDurationSeconds);
    if (isNaN(minSec) || minSec < 0) {
      minSec = CosTimingConstants.ACTIVITY_MIN_DURATION_SECONDS;
    }
    minSec = Math.floor(minSec);
    var blockSize = String(
      opt.blockSize || CosTimingConstants.ACTIVITY_BLOCK_SIZE
    ).trim();
    var groupBy = opt.groupByProject === false ? 'false' : 'true';
    var mobile = opt.includeMobileDevices === true ? 'true' : 'false';
    var qs = [
      'start_date=' + encodeURIComponent(String(startYmd).trim()),
      'end_date=' + encodeURIComponent(String(endYmd).trim()),
      'block_size=' + encodeURIComponent(blockSize),
      'minimum_duration_seconds=' + encodeURIComponent(String(minSec)),
      'group_by_project=' + encodeURIComponent(groupBy),
      'max_depth=0',
      'max_lines=' + encodeURIComponent(String(ml)),
      'include_mobile_devices=' + encodeURIComponent(mobile),
      'include_subprojects=true',
    ].join('&');
    var url = cfg.baseUrl + '/activity-hierarchy?' + qs;
    try {
      return {
        ok: true,
        text: CosTimingApiClient._getPlainText_(url, cfg.apiKey),
      };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  },
};
