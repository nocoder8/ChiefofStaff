/**
 * Phase 1: rule-based parse of Telegram text → task fields (no LLM).
 * Extensible: swap in richer logic or an LLM later behind the same shape.
 */
var CosTelegramTaskCaptureParser = {
  MAX_TITLE_LEN: 500,
  MAX_INPUT_LEN: 4000,

  /**
   * “1h per day for the next 5 business days to …” → book one row per weekday (sheet TZ).
   * @param {string} rawText
   * @returns {{ ok: true, baseTitle: string, minutesPerDay: number, businessDayCount: number, startAnchor: string, priority: string } | { ok: false, code: string, helpText?: string }}
   */
  parseBusinessDaySplit: function (rawText) {
    var raw = String(rawText || '').replace(/^\s+|\s+$/g, '');
    if (!raw || raw.length > CosTelegramTaskCaptureParser.MAX_INPUT_LEN) {
      return { ok: false, code: 'empty_or_long' };
    }
    if (/^\//.test(raw)) {
      return { ok: false, code: 'slash' };
    }
    var lower = raw.toLowerCase();
    if (!/business\s+days?/.test(lower)) {
      return { ok: false, code: 'no_match' };
    }
    if (!/per\s+day|each\s+day|every\s+day|a\s+day\b/.test(lower)) {
      return { ok: false, code: 'no_match' };
    }

    var countM =
      /\b(?:the\s+)?next\s+(\d{1,2})\s+business\s+days?\b/i.exec(raw) ||
      /\bfor\s+the\s+next\s+(\d{1,2})\s+business\s+days?\b/i.exec(raw) ||
      /\bfor\s+(\d{1,2})\s+business\s+days?\b/i.exec(raw);
    if (!countM) {
      return {
        ok: false,
        code: 'no_count',
        helpText:
          'Say how many weekdays, e.g. “for the next 5 business days”.',
      };
    }
    var n = parseInt(countM[1], 10);
    if (
      isNaN(n) ||
      n < 1 ||
      n > CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS
    ) {
      return {
        ok: false,
        code: 'bad_count',
        helpText:
          'Use 1–' +
          CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS +
          ' business days.',
      };
    }

    var minutes = null;
    var hPer = /\b(\d{1,2})\s*(?:hours?|hrs?)\s+per\s+day\b/i.exec(raw);
    if (hPer) {
      minutes = parseInt(hPer[1], 10) * 60;
    } else {
      var mPer =
        /\b(\d{1,3})\s*(?:min|minutes|mins)\s+per\s+day\b/i.exec(raw);
      if (mPer) {
        minutes = parseInt(mPer[1], 10);
      }
    }
    if (minutes === null || minutes < 5 || minutes > 480) {
      return {
        ok: false,
        code: 'bad_duration',
        helpText:
          'Include duration per day, e.g. “1 hour per day” or “45 minutes per day”.',
      };
    }

    var startAnchor = /\bstarting\s+today\b/i.test(raw) ? 'today' : 'next_day';
    var pr = CosTelegramTaskCaptureParser._extractPriority_(raw);
    var title = CosTelegramTaskCaptureParser._titleFromBusinessSplit_(raw);
    title = CosTelegramTaskCaptureParser._cleanTitle_(title);
    if (!title || title.length < 2) {
      return {
        ok: false,
        code: 'no_title',
        helpText:
          'End with what you’re doing, e.g. “… to build a deck for the CEO”.',
      };
    }

    return {
      ok: true,
      baseTitle: title.substring(0, CosTelegramTaskCaptureParser.MAX_TITLE_LEN),
      minutesPerDay: minutes,
      businessDayCount: n,
      startAnchor: startAnchor,
      priority: pr || CosConstants.TASK_PRIORITY.P2,
    };
  },

  /**
   * @param {string} raw one line normalized optional
   * @returns {string}
   * @private
   */
  _titleFromBusinessSplit_: function (raw) {
    var oneLine = String(raw || '').replace(/\s+/g, ' ').trim();
    var m = /\bto\s+(.+)$/i.exec(oneLine);
    if (m) {
      return CosTelegramTaskCaptureParser._stripDurationFromTail_(m[1].trim());
    }
    m = /\bfor\s+the\s+next\s+\d+\s+business\s+days?\s+to\s+(.+)/i.exec(
      oneLine
    );
    if (m) {
      return CosTelegramTaskCaptureParser._stripDurationFromTail_(m[1].trim());
    }
    return '';
  },

  /**
   * @param {string} rawText
   * @returns {{ ok: true, task: string, priority: string, durationMin: string, notes: string } | { ok: false, code: string, helpText?: string }}
   */
  parse: function (rawText) {
    var raw = String(rawText || '').replace(/^\s+|\s+$/g, '');
    if (!raw) {
      return {
        ok: false,
        code: 'empty',
        helpText: CosTelegramTaskCaptureParser._helpText_(),
      };
    }
    if (raw.length > CosTelegramTaskCaptureParser.MAX_INPUT_LEN) {
      return { ok: false, code: 'too_long', helpText: 'Message too long.' };
    }
    var isSlashTask = /^\/task(?:@\w+)?\b/i.test(raw);
    if (/^\//.test(raw) && !isSlashTask) {
      return {
        ok: false,
        code: 'unknown_command',
        helpText: 'Unknown command. Use /task … or a phrase like “Create task: …”.',
      };
    }
    var work = isSlashTask
      ? raw.replace(/^\/task(?:@\w+)?\s*/i, '').trim()
      : raw;
    var lowerFull = raw.toLowerCase();
    var lowerWork = work.toLowerCase();
    if (
      !isSlashTask &&
      !CosTelegramTaskCaptureParser._looksLikeTaskIntent_(raw, lowerFull, work, lowerWork)
    ) {
      return {
        ok: false,
        code: 'no_intent',
        helpText: CosTelegramTaskCaptureParser._helpText_(),
      };
    }
    var pr = CosTelegramTaskCaptureParser._extractPriority_(work);
    var dur = CosTelegramTaskCaptureParser._extractDurationMinutes_(work);
    var title = '';
    if (isSlashTask) {
      title = CosTelegramTaskCaptureParser._titleFromSlashBody_(work, pr, dur);
    } else {
      title = CosTelegramTaskCaptureParser._extractTitle_(work, pr, dur);
    }
    title = CosTelegramTaskCaptureParser._cleanTitle_(title);
    if (!title || title.length < 2) {
      return {
        ok: false,
        code: 'no_title',
        helpText:
          'Couldn’t find a task title. Example: /task P0 30m Prepare for CEO meeting',
      };
    }
    var pri = pr || CosConstants.TASK_PRIORITY.P2;
    var dm =
      dur !== null && dur !== undefined
        ? String(dur)
        : String(CosConstants.DEFAULT_TASK_DURATION_MINUTES);
    return {
      ok: true,
      task: title.substring(0, CosTelegramTaskCaptureParser.MAX_TITLE_LEN),
      priority: pri,
      durationMin: dm,
      notes: '',
    };
  },

  /**
   * @returns {string}
   * @private
   */
  _helpText_: function () {
    return (
      '📝 Add a task (send as a new message at the top level, not a reply):\n' +
      '• /task P0 30m Prepare for CEO meeting\n' +
      '• Create a P0 task for 30 mins. I need to prepare slides\n' +
      '• Task P1 45 mins: Finish CHRO deck\n' +
      '• Create task: Review scorecard\n' +
      '• Follow up with finance\n' +
      '• Remind me to prepare notes for 20 mins\n' +
      '• 1 hour per day for the next 5 business days to build a deck for the CEO\n' +
      '  (add “starting today” to include today if it’s a weekday)\n\n' +
      'Defaults: priority P2, duration 30 min. Closure replies (1–4) must be replies to the Jeeves prompt.'
    );
  },

  /**
   * @param {string} raw
   * @param {string} lowerFull
   * @param {string} work
   * @param {string} lowerWork
   * @returns {boolean}
   * @private
   */
  _looksLikeTaskIntent_: function (raw, lowerFull, work, lowerWork) {
    if (/^\/task(?:@\w+)?\b/i.test(raw)) {
      return true;
    }
    if (/^create\s+a\s+p[0-3]\s+task\b/i.test(lowerWork)) {
      return true;
    }
    if (/^create\s+a\s+follow[- ]?up\s+task\b/i.test(lowerWork)) {
      return true;
    }
    if (/^create\s+task\b/i.test(lowerWork)) {
      return true;
    }
    if (/^task\s+p[0-3]\b/i.test(lowerWork)) {
      return true;
    }
    if (/^task\s+follow[- ]?up\b/i.test(lowerWork)) {
      return true;
    }
    if (/^follow\s+up\b/i.test(lowerWork)) {
      return true;
    }
    if (/^remind\s+me\b/i.test(lowerWork)) {
      return true;
    }
    if (/business\s+days?/.test(lowerFull) && /per\s+day|each\s+day|every\s+day/.test(lowerFull)) {
      return true;
    }
    return false;
  },

  /**
   * @param {string} work
   * @returns {string|null}
   * @private
   */
  _extractPriority_: function (work) {
    var u = work.toUpperCase();
    if (/\bP0\b/.test(u)) {
      return CosConstants.TASK_PRIORITY.P0;
    }
    if (/\bP1\b/.test(u)) {
      return CosConstants.TASK_PRIORITY.P1;
    }
    if (/\bP2\b/.test(u)) {
      return CosConstants.TASK_PRIORITY.P2;
    }
    if (/\bP3\b/.test(u)) {
      return CosConstants.TASK_PRIORITY.P3;
    }
    if (/\bfOLLOW[- ]?UP\b/i.test(work) || /^follow\s+up\b/i.test(work)) {
      return CosConstants.TASK_PRIORITY.FOLLOW_UP;
    }
    return null;
  },

  /**
   * @param {string} work
   * @returns {number|null}
   * @private
   */
  _extractDurationMinutes_: function (work) {
    var re =
      /\b(\d{1,3})\s*(?:min|mins|minute|minutes)\b|\b(\d{1,3})\s*m\b(?!\w)/gi;
    var best = null;
    var m;
    while ((m = re.exec(work)) !== null) {
      var n = parseInt(m[1] || m[2], 10);
      if (!isNaN(n) && n >= 1 && n <= 999) {
        best = n;
      }
    }
    return best;
  },

  /**
   * @param {string} work
   * @param {string|null} pr
   * @param {number|null} dur
   * @returns {string}
   * @private
   */
  _extractTitle_: function (work, pr, dur) {
    var colon = work.indexOf(':');
    if (colon >= 0) {
      var after = work.substring(colon + 1).trim();
      if (after.length >= 2) {
        return CosTelegramTaskCaptureParser._stripDurationFromTail_(after);
      }
    }
    var m = /\bi\s+need\s+to\s+(.+)/i.exec(work);
    if (m) {
      return CosTelegramTaskCaptureParser._stripDurationFromTail_(m[1]);
    }
    m = /\bremind\s+me\s+(?:that\s+)?to\s+(.+)/i.exec(work);
    if (m) {
      return CosTelegramTaskCaptureParser._stripDurationFromTail_(m[1]);
    }
    var t = work;
    t = t.replace(/^create\s+a\s+p[0-3]\s+task\s+for\s+\d{1,3}\s*(?:min|mins|minutes|m)\.?\s*/i, '');
    t = t.replace(/^create\s+a\s+follow[- ]?up\s+task\s+for\s+\d{1,3}\s*(?:min|mins|minutes|m)\.?\s*/i, '');
    t = t.replace(/^create\s+a\s+p[0-3]\s+task\.?\s*/i, '');
    t = t.replace(/^create\s+a\s+follow[- ]?up\s+task\.?\s*/i, '');
    t = t.replace(/^create\s+task\s*:?\s*/i, '');
    t = t.replace(/^task\s+p[0-3]\s+\d{1,3}\s*(?:min|mins|minutes|m)\s*:?\s*/i, '');
    t = t.replace(/^task\s+follow[- ]?up\s+\d{1,3}\s*(?:min|mins|minutes|m)\s*:?\s*/i, '');
    t = t.replace(/^task\s+p[0-3]\s*:?\s*/i, '');
    t = t.replace(/^task\s+follow[- ]?up\s*:?\s*/i, '');
    t = t.replace(/^follow[- ]?up\s+/i, '');
    t = t.replace(/^remind\s+me\s+(?:that\s+)?to\s+/i, '');
    return CosTelegramTaskCaptureParser._stripDurationFromTail_(t);
  },

  /**
   * @param {string} s
   * @returns {string}
   * @private
   */
  _stripDurationFromTail_: function (s) {
    return String(s || '')
      .replace(/\s+for\s+\d{1,3}\s*(?:min|mins|minutes|m)\b\.?$/i, '')
      .trim();
  },

  /**
   * @param {string} work
   * @param {string|null} pr
   * @param {number|null} dur
   * @returns {string}
   * @private
   */
  _titleFromSlashBody_: function (work, pr, dur) {
    var t = work;
    t = t.replace(/\bP0\b/gi, '');
    t = t.replace(/\bP1\b/gi, '');
    t = t.replace(/\bP2\b/gi, '');
    t = t.replace(/\bP3\b/gi, '');
    t = t.replace(/\bfollow[- ]?up\b/gi, '');
    t = t.replace(
      /\b\d{1,3}\s*(?:min|mins|minute|minutes)\b|\b\d{1,3}\s*m\b(?!\w)/gi,
      ''
    );
    return t.replace(/\s+/g, ' ').replace(/^[\s.,;:]+|[\s.,;:]+$/g, '').trim();
  },

  /**
   * @param {string} s
   * @returns {string}
   * @private
   */
  _cleanTitle_: function (s) {
    var t = String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.,;:\-–—]+|[\s.,;:\-–—]+$/g, '')
      .trim();
    return t;
  },

  /**
   * Self-test for script editor / menu. Returns counts and logs failures.
   * @returns {{ passed: number, failed: number, failures: string[] }}
   */
  runSelfTest: function () {
    var cases = [
      {
        in:
          'Create a P0 task for 30 mins. I need to prepare for the meeting with the CEO',
        want: { priority: 'P0', durationMin: '30', sub: 'CEO' },
      },
      {
        in: 'Task P1 45 mins: Finish CHRO deck',
        want: { priority: 'P1', durationMin: '45', sub: 'CHRO' },
      },
      {
        in: 'Create task: Review recruiter scorecard',
        want: { priority: 'P2', durationMin: '30', sub: 'scorecard' },
      },
      {
        in: 'Follow up with finance tomorrow',
        want: { priority: 'Follow-up', durationMin: '30', sub: 'finance' },
      },
      {
        in: 'Remind me to prepare candidate notes for 20 mins',
        want: { priority: 'P2', durationMin: '20', sub: 'candidate' },
      },
      { in: '/task P0 30m CEO prep', want: { priority: 'P0', durationMin: '30', sub: 'CEO' } },
      { in: 'Hello world', want: null },
      { in: '', want: null },
    ];
    var passed = 0;
    var failed = 0;
    var failures = [];
    var i;
    var bs = CosTelegramTaskCaptureParser.parseBusinessDaySplit(
      'I need to dedicate 1 hour per day for the next 5 business days to build a deck for the CEO'
    );
    if (
      bs.ok &&
      bs.businessDayCount === 5 &&
      bs.minutesPerDay === 60 &&
      bs.startAnchor === 'next_day' &&
      /deck/i.test(bs.baseTitle)
    ) {
      passed++;
    } else {
      failed++;
      failures.push('business-day split CEO deck example');
    }

    for (i = 0; i < cases.length; i++) {
      var c = cases[i];
      var r = CosTelegramTaskCaptureParser.parse(c.in);
      if (c.want === null) {
        if (!r.ok) {
          passed++;
        } else {
          failed++;
          failures.push('Expected fail for: ' + JSON.stringify(c.in).substring(0, 80));
        }
        continue;
      }
      if (!r.ok) {
        failed++;
        failures.push('Fail parse: ' + c.in + ' → ' + (r.code || ''));
        continue;
      }
      var bad = false;
      if (r.priority !== c.want.priority) {
        bad = true;
      }
      if (String(r.durationMin) !== String(c.want.durationMin)) {
        bad = true;
      }
      if (c.want.sub && r.task.toLowerCase().indexOf(c.want.sub.toLowerCase()) < 0) {
        bad = true;
      }
      if (bad) {
        failed++;
        failures.push(
          'Mismatch: ' +
            c.in +
            ' → got p=' +
            r.priority +
            ' d=' +
            r.durationMin +
            ' t=' +
            r.task
        );
      } else {
        passed++;
      }
    }
    CosLogger.info('TelegramTaskCaptureParser self-test', {
      passed: passed,
      failed: failed,
      failures: failures,
    });
    return { passed: passed, failed: failed, failures: failures };
  },
};
