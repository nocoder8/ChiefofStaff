/**
 * Optional LLM interpretation for Telegram task capture when rule-based parsing fails.
 * Reuses DIGEST_AI_API_KEY, DIGEST_AI_PROVIDER, DIGEST_AI_MODEL; gated by TELEGRAM_PARSE_AI_ENABLED.
 */
var CosTelegramParseAiService = {
  /**
   * @param {CosSettings} settings
   * @returns {boolean}
   */
  isEnabled_: function (settings) {
    return (
      !!settings.telegramParseAiEnabled &&
      String(settings.digestAiApiKey || '').trim().length > 0
    );
  },

  /**
   * @param {CosSettings} settings
   * @param {string} rawText
   * @returns {{ ok: true, kind: string } | { ok: false, code: string }}
   */
  tryInterpret: function (settings, rawText) {
    if (!CosTelegramParseAiService.isEnabled_(settings)) {
      return { ok: false, code: 'disabled' };
    }
    var text = String(rawText || '').replace(/^\s+|\s+$/g, '');
    if (!text) {
      return { ok: false, code: 'empty' };
    }
    var maxC = CosConstants.TELEGRAM_PARSE_AI_MAX_INPUT_CHARS;
    if (text.length > maxC) {
      text = text.substring(0, maxC);
    }
    var provider = String(settings.digestAiProvider || 'openai')
      .trim()
      .toLowerCase();
    var jsonText;
    try {
      jsonText =
        provider === 'gemini'
          ? CosTelegramParseAiService._geminiJson_(settings, text)
          : CosTelegramParseAiService._openAiJson_(settings, text);
    } catch (e) {
      CosLogger.warn('Telegram parse AI: request failed', {
        error: String(e.message || e),
      });
      return { ok: false, code: 'network' };
    }
    var obj = CosTelegramParseAiService._parseJsonLoose_(jsonText);
    return CosTelegramParseAiService._routeParsedModel_(obj);
  },

  /**
   * Conversational interpretation (butler tone + optional chat reply).
   * Returns the same action kinds as tryInterpret, plus:
   * - kind: 'chat' with replyText when no sheet/calendar action should occur.
   *
   * @param {CosSettings} settings
   * @param {string} rawText
   * @param {Object=} optContext context blob (recent actions, settings hints)
   * @returns {{ ok: true, kind: string, replyText?: string } | { ok: false, code: string }}
   */
  tryInterpretConversational: function (settings, rawText, optContext) {
    if (!CosTelegramParseAiService.isEnabled_(settings)) {
      return { ok: false, code: 'disabled' };
    }
    var text = String(rawText || '').replace(/^\s+|\s+$/g, '');
    if (!text) {
      return { ok: false, code: 'empty' };
    }
    var maxC = CosConstants.TELEGRAM_PARSE_AI_MAX_INPUT_CHARS;
    if (text.length > maxC) {
      text = text.substring(0, maxC);
    }
    var provider = String(settings.digestAiProvider || 'openai')
      .trim()
      .toLowerCase();
    var ctx = '';
    if (optContext && typeof optContext === 'object') {
      try {
        ctx = JSON.stringify(optContext);
      } catch (e) {
        ctx = '';
      }
    }
    var jsonText;
    try {
      jsonText =
        provider === 'gemini'
          ? CosTelegramParseAiService._geminiJson_(settings, text, ctx, true)
          : CosTelegramParseAiService._openAiJson_(settings, text, ctx, true);
    } catch (e2) {
      CosLogger.warn('Telegram parse AI (conversational): request failed', {
        error: String(e2.message || e2),
      });
      return { ok: false, code: 'network' };
    }
    var obj = CosTelegramParseAiService._parseJsonLoose_(jsonText);
    var routed = CosTelegramParseAiService._routeParsedModel_(obj);
    if (!routed || !routed.ok) {
      return routed;
    }
    var rt = CosTelegramParseAiService._extractReplyText_(obj);
    if (rt) {
      routed.replyText = rt;
    }
    return routed;
  },

  /**
   * @param {Object|null} obj
   * @returns {string}
   * @private
   */
  _extractReplyText_: function (obj) {
    if (!obj || typeof obj !== 'object') {
      return '';
    }
    var top = String(obj.response_text || obj.reply_text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (top) {
      return top.substring(0, 1200);
    }
    if (obj.chat && typeof obj.chat === 'object') {
      var c = String(obj.chat.reply_text || obj.chat.response_text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (c) {
        return c.substring(0, 1200);
      }
    }
    if (obj.clarify && typeof obj.clarify === 'object') {
      var q = String(obj.clarify.question || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (q) {
        return q.substring(0, 1200);
      }
    }
    return '';
  },

  /**
   * @param {Object|null} obj
   * @returns {{ ok: true, kind: string } | { ok: false, code: string }}
   * @private
   */
  _routeParsedModel_: function (obj) {
    if (!obj || typeof obj !== 'object') {
      return { ok: false, code: 'bad_json' };
    }
    var pattern = String(obj.pattern || 'none')
      .trim()
      .toLowerCase();
    if (pattern === 'chat') {
      var reply = CosTelegramParseAiService._extractReplyText_(obj);
      if (!reply) {
        return { ok: false, code: 'bad_chat' };
      }
      return { ok: true, kind: 'chat', replyText: reply };
    }
    if (pattern === 'clarify') {
      return CosTelegramParseAiService._normalizeClarify_(obj.clarify);
    }
    if (pattern === 'reschedule_named') {
      return CosTelegramParseAiService._normalizeRescheduleNamed_(
        obj.reschedule_named
      );
    }
    if (pattern === 'drop_named') {
      return CosTelegramParseAiService._normalizeDropNamed_(obj.drop_named);
    }
    if (pattern === 'one_on_one_batch') {
      return CosTelegramParseAiService._normalizeOneOnOneBatch_(
        obj.one_on_one_batch || obj
      );
    }
    if (pattern === 'propose_one_on_one' || pattern === 'one_on_one_propose') {
      return CosTelegramParseAiService._normalizeProposeOneOnOne_(
        obj.propose_one_on_one || obj.one_on_one || obj
      );
    }
    if (pattern === 'none') {
      var txt = CosTelegramParseAiService._extractReplyText_(obj);
      if (txt) {
        return { ok: true, kind: 'chat', replyText: txt };
      }
      return { ok: false, code: 'not_task' };
    }
    var wantsTask = obj.is_task_request;
    if (wantsTask !== true && wantsTask !== 'true') {
      var txt2 = CosTelegramParseAiService._extractReplyText_(obj);
      if (txt2) {
        return { ok: true, kind: 'chat', replyText: txt2 };
      }
      return { ok: false, code: 'not_task' };
    }
    if (pattern === 'business_day_split') {
      return CosTelegramParseAiService._normalizeSplit_(obj.business_day_split);
    }
    if (pattern === 'single') {
      return CosTelegramParseAiService._normalizeSingle_(obj.single);
    }
    return { ok: false, code: 'not_task' };
  },

  /**
   * @param {*} block
   * @returns {{ ok: true, kind: string } | { ok: false, code: string }}
   * @private
   */
  _normalizeClarify_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_clarify' };
    }
    var q = String(block.question || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!q || q.length < 4) {
      return { ok: false, code: 'bad_clarify' };
    }
    var opts = block.options;
    if (!opts || !opts.length) {
      return { ok: false, code: 'bad_clarify' };
    }
    var out = [];
    var i;
    for (i = 0; i < opts.length && out.length < 3; i++) {
      var o = opts[i];
      if (!o || typeof o !== 'object') {
        continue;
      }
      var label = String(o.label || '')
        .replace(/\s+/g, ' ')
        .trim();
      var interp = o.interpretation;
      if (!label || !interp || typeof interp !== 'object') {
        continue;
      }
      var pat = String(interp.pattern || '')
        .trim()
        .toLowerCase();
      var pl = null;
      if (pat === 'single') {
        pl = CosTelegramParseAiService._normalizeSingle_(interp.single);
      } else if (pat === 'business_day_split') {
        pl = CosTelegramParseAiService._normalizeSplit_(interp.business_day_split);
      }
      if (!pl || !pl.ok) {
        continue;
      }
      out.push({
        label: label.substring(0, 120),
        payload: pl,
      });
    }
    if (out.length >= 2) {
      return {
        ok: true,
        kind: 'clarify',
        question: q.substring(0, 400),
        options: out,
      };
    }
    if (out.length === 1) {
      return out[0].payload;
    }
    return { ok: false, code: 'bad_clarify' };
  },

  /**
   * @param {*} block
   * @returns {{ ok: true, kind: string, titleSearch: string, dayPhrase: string } | { ok: false, code: string }}
   * @private
   */
  _normalizeRescheduleNamed_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_edit' };
    }
    var ts = String(block.title_search || block.titleSearch || '')
      .replace(/\s+/g, ' ')
      .trim();
    var dp = String(block.day_phrase || block.dayPhrase || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (ts.length < 2 || !dp) {
      return { ok: false, code: 'bad_edit' };
    }
    return {
      ok: true,
      kind: 'reschedule_named',
      titleSearch: ts.substring(0, 200),
      dayPhrase: dp.substring(0, 80),
    };
  },

  /**
   * @param {*} block
   * @returns {{ ok: true, kind: string, titleSearch: string } | { ok: false, code: string }}
   * @private
   */
  _normalizeDropNamed_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_edit' };
    }
    var ts = String(block.title_search || block.titleSearch || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (ts.length < 2) {
      return { ok: false, code: 'bad_edit' };
    }
    return {
      ok: true,
      kind: 'drop_named',
      titleSearch: ts.substring(0, 200),
    };
  },

  /**
   * Guest names for propose_one_on_one: array from model, else single attendee_name, else split "A and B".
   * @param {*} block
   * @returns {string[]}
   * @private
   */
  _extractAttendeeNamesList_: function (block) {
    var maxN = CosConstants.TELEGRAM_MEETING_ATTENDEES_MAX || 5;
    var out = [];
    var raw = block.attendee_names || block.attendeeNames;
    if (raw && typeof raw.length === 'number') {
      var i;
      for (i = 0; i < raw.length && out.length < maxN; i++) {
        var s = String(raw[i] || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (s.length >= 2) {
          out.push(s.substring(0, 200));
        }
      }
    }
    var single = String(block.attendee_name || block.attendeeName || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!out.length && single.length >= 2) {
      if (single.indexOf(',') >= 0) {
        var cparts = single.split(',');
        var cj;
        for (cj = 0; cj < cparts.length && out.length < maxN; cj++) {
          var pc = String(cparts[cj] || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^[,;\s]+|[,;\s]+$/g, '');
          if (pc.length >= 2) {
            out.push(pc.substring(0, 200));
          }
        }
      } else if (/\s+and\s+/i.test(single)) {
        var parts = single.split(/\s+and\s+/i);
        var j;
        for (j = 0; j < parts.length && out.length < maxN; j++) {
          var p = String(parts[j] || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^[,;\s]+|[,;\s]+$/g, '');
          if (p.length >= 2) {
            out.push(p.substring(0, 200));
          }
        }
      } else {
        out.push(single.substring(0, 200));
      }
    }
    if (out.length > maxN) {
      out = out.slice(0, maxN);
    }
    return out;
  },

  /**
   * Domains that must not skip Workspace directory (models often emit user@example.com).
   * @param {string} email lowercased valid address
   * @returns {boolean}
   * @private
   */
  _isDocumentationOrInvalidAttendeeDomain_: function (email) {
    var e = String(email || '').trim().toLowerCase();
    var at = e.lastIndexOf('@');
    if (at < 1) {
      return false;
    }
    var host = e.substring(at + 1);
    if (
      host === 'example.com' ||
      host === 'example.org' ||
      host === 'example.net' ||
      host === 'example.edu'
    ) {
      return true;
    }
    if (host === 'test' || host === 'invalid' || host === 'localhost') {
      return true;
    }
    if (host.length >= 8 && host.substring(host.length - 8) === '.invalid') {
      return true;
    }
    if (host.length >= 8 && host.substring(host.length - 8) === '.example') {
      return true;
    }
    return false;
  },

  /**
   * Schedule a 1:1 with a Workspace colleague: find mutual free time, propose 3 options.
   * @param {*} block
   * @returns {{ ok: true, kind: string, attendeeEmail: string, durationMin: number, meetingTitle: string, horizonDays: number, focusDay: string } | { ok: false, code: string }}
   * @private
   */
  _normalizeProposeOneOnOne_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_1on1' };
    }
    var attendeeNames = CosTelegramParseAiService._extractAttendeeNamesList_(
      block
    );
    var email = String(block.attendee_email || block.attendeeEmail || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      email = '';
    }
    if (
      email &&
      CosTelegramParseAiService._isDocumentationOrInvalidAttendeeDomain_(email)
    ) {
      if (!attendeeNames.length) {
        var local = email
          .split('@')[0]
          .replace(/[.+_]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (local.length >= 2) {
          attendeeNames = [local.substring(0, 200)];
        }
      }
      email = '';
    }
    if (!attendeeNames.length && !email) {
      return { ok: false, code: 'bad_1on1' };
    }
    var dm = parseInt(
      String(block.duration_minutes || block.durationMin || '30'),
      10
    );
    if (isNaN(dm) || dm < 15 || dm > 480) {
      dm = 30;
    }
    var title = CosTelegramParseAiService._cleanTitle_(
      block.meeting_title || block.meetingTitle || '1:1'
    );
    if (!title || title.length < 2) {
      title = '1:1';
    }
    var hd = parseInt(String(block.horizon_days || block.horizonDays || '14'), 10);
    if (isNaN(hd) || hd < 1) {
      hd = 14;
    }
    if (hd > CosConstants.SCHEDULING_HORIZON_DAYS) {
      hd = CosConstants.SCHEDULING_HORIZON_DAYS;
    }
    var fd = String(block.focus_day || block.focusDay || '')
      .trim()
      .toLowerCase();
    var focusDay = fd === 'tomorrow' ? 'tomorrow' : '';
    if (attendeeNames.length >= 1) {
      email = '';
    }
    var displayNameField = '';
    if (attendeeNames.length === 1) {
      displayNameField = attendeeNames[0].substring(0, 200);
    } else if (attendeeNames.length > 1) {
      displayNameField = attendeeNames.join(', ').substring(0, 200);
    }
    var targetYmd = CosTelegramParseAiService._parseTargetYmdFromBlock_(block);
    var targetDatePhrase =
      CosTelegramParseAiService._collectLooseTargetDatePhraseFromBlock_(block);
    if (targetYmd && focusDay === 'tomorrow') {
      focusDay = '';
    }
    var slotWindow = CosTelegramParseAiService._normalizeSlotWindowFromBlock_(
      block
    );
    return {
      ok: true,
      kind: 'one_on_one_propose',
      attendeeEmail: email,
      attendeeName: displayNameField,
      attendeeNames: attendeeNames,
      durationMin: dm,
      meetingTitle: title.substring(0, 200),
      horizonDays: hd,
      focusDay: focusDay,
      targetYmd: targetYmd,
      targetDatePhrase: targetDatePhrase,
      slotWindow: slotWindow,
    };
  },

  /**
   * @param {*} block
   * @returns {string} yyyy-MM-dd or ""
   * @private
   */
  _parseTargetYmdFromBlock_: function (block) {
    var a = String(block.target_ymd || block.targetYmd || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) {
      return a;
    }
    var b = String(block.target_date || block.targetDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(b)) {
      return b;
    }
    return '';
  },

  /**
   * Non-ISO date text from the model (resolved later with sheet TZ in TelegramService).
   * Prefers explicit target_date over a non-ISO target_ymd.
   * @param {*} block
   * @returns {string}
   * @private
   */
  _collectLooseTargetDatePhraseFromBlock_: function (block) {
    var iso = /^\d{4}-\d{2}-\d{2}$/;
    var tExtra = String(
      block.target_date || block.targetDate || block.target_date_phrase || ''
    ).trim();
    if (tExtra && !iso.test(tExtra)) {
      return tExtra;
    }
    var tY = String(block.target_ymd || block.targetYmd || '').trim();
    if (tY && !iso.test(tY)) {
      return tY;
    }
    return '';
  },

  /**
   * Separate 1:1s with each person (not one group invite). Requires ≥2 names.
   * @param {*} block
   * @returns {Object}
   * @private
   */
  _normalizeOneOnOneBatch_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_batch' };
    }
    var attendeeNames = CosTelegramParseAiService._extractAttendeeNamesList_(
      block
    );
    if (attendeeNames.length < 2) {
      return { ok: false, code: 'bad_batch' };
    }
    var dm = parseInt(
      String(block.duration_minutes || block.durationMin || '30'),
      10
    );
    if (isNaN(dm) || dm < 15 || dm > 480) {
      dm = 30;
    }
    var title = CosTelegramParseAiService._cleanTitle_(
      block.meeting_title || block.meetingTitle || '1:1'
    );
    if (!title || title.length < 2) {
      title = '1:1';
    }
    var hd = parseInt(String(block.horizon_days || block.horizonDays || '14'), 10);
    if (isNaN(hd) || hd < 1) {
      hd = 14;
    }
    if (hd > CosConstants.SCHEDULING_HORIZON_DAYS) {
      hd = CosConstants.SCHEDULING_HORIZON_DAYS;
    }
    var fd = String(block.focus_day || block.focusDay || '')
      .trim()
      .toLowerCase();
    var focusDay = fd === 'tomorrow' ? 'tomorrow' : '';
    var targetYmd = CosTelegramParseAiService._parseTargetYmdFromBlock_(block);
    var targetDatePhrase =
      CosTelegramParseAiService._collectLooseTargetDatePhraseFromBlock_(block);
    if (targetYmd && focusDay === 'tomorrow') {
      focusDay = '';
    }
    var slotWindowB = CosTelegramParseAiService._normalizeSlotWindowFromBlock_(
      block
    );
    return {
      ok: true,
      kind: 'one_on_one_batch',
      attendeeNames: attendeeNames,
      durationMin: dm,
      meetingTitle: title.substring(0, 200),
      horizonDays: hd,
      focusDay: focusDay,
      targetYmd: targetYmd,
      targetDatePhrase: targetDatePhrase,
      slotWindow: slotWindowB,
    };
  },

  /**
   * @param {*} block
   * @returns {'all'|'workhours'|'remote'}
   * @private
   */
  _normalizeSlotWindowFromBlock_: function (block) {
    var s = String(block.slot_window || block.slotWindow || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (
      s === 'workhours' ||
      s === 'work_hours' ||
      s === 'work' ||
      s === 'day' ||
      s === 'daytime' ||
      s === 'office' ||
      s === 'during_work_hours'
    ) {
      return 'workhours';
    }
    if (
      s === 'remote' ||
      s === 'evening' ||
      s === 'evenings' ||
      s === 'night' ||
      s === 'nights'
    ) {
      return 'remote';
    }
    return 'all';
  },

  /**
   * @param {string} raw
   * @returns {Object|null}
   * @private
   */
  _parseJsonLoose_: function (raw) {
    var s = String(raw || '').trim();
    if (!s) {
      return null;
    }
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    try {
      return JSON.parse(s);
    } catch (e1) {
      var a = s.indexOf('{');
      var b = s.lastIndexOf('}');
      if (a >= 0 && b > a) {
        try {
          return JSON.parse(s.substring(a, b + 1));
        } catch (e2) {
          return null;
        }
      }
      return null;
    }
  },

  /**
   * @param {*} block
   * @returns {{ ok: true, kind: string } | { ok: false, code: string }}
   * @private
   */
  _normalizeSplit_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_shape' };
    }
    var title = CosTelegramParseAiService._cleanTitle_(
      String(block.base_title || block.baseTitle || '').trim()
    );
    if (!title || title.length < 2) {
      return { ok: false, code: 'bad_title' };
    }
    var n = parseInt(String(block.business_day_count || block.businessDayCount), 10);
    var maxD = CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS;
    if (isNaN(n) || n < 1 || n > maxD) {
      return { ok: false, code: 'bad_count' };
    }
    var minutes = parseInt(
      String(block.minutes_per_day || block.minutesPerDay),
      10
    );
    if (isNaN(minutes) || minutes < 5 || minutes > 480) {
      return { ok: false, code: 'bad_duration' };
    }
    var sa = String(block.start_anchor || block.startAnchor || 'next_day')
      .trim()
      .toLowerCase();
    var startAnchor = sa === 'today' ? 'today' : 'next_day';
    var pr = CosTelegramParseAiService._normalizePriority_(
      block.priority,
      CosConstants.TASK_PRIORITY.P2
    );
    return {
      ok: true,
      kind: 'business_day_split',
      baseTitle: title.substring(0, CosTelegramTaskCaptureParser.MAX_TITLE_LEN),
      minutesPerDay: minutes,
      businessDayCount: n,
      startAnchor: startAnchor,
      priority: pr,
    };
  },

  /**
   * @param {*} block
   * @returns {{ ok: true, kind: string } | { ok: false, code: string }}
   * @private
   */
  _normalizeSingle_: function (block) {
    if (!block || typeof block !== 'object') {
      return { ok: false, code: 'bad_shape' };
    }
    var title = CosTelegramParseAiService._cleanTitle_(
      String(block.title || '').trim()
    );
    if (!title || title.length < 2) {
      return { ok: false, code: 'bad_title' };
    }
    var pr = CosTelegramParseAiService._normalizePriority_(
      block.priority,
      CosConstants.TASK_PRIORITY.P2
    );
    if (pr === CosConstants.TASK_PRIORITY.FOLLOW_UP) {
      var notesFu = String(block.notes || '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (notesFu.length > 2000) {
        notesFu = notesFu.substring(0, 1999) + '…';
      }
      var fuEmail = String(
        block.follow_up_contact_email || block.followUpContactEmail || ''
      )
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fuEmail)) {
        fuEmail = '';
      }
      var fuName = String(
        block.follow_up_contact_name ||
          block.followUpContactName ||
          block.contact_name ||
          ''
      )
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (fuName.length > 120) {
        fuName = fuName.substring(0, 119) + '…';
      }
      return {
        ok: true,
        kind: 'single',
        task: title.substring(0, CosTelegramTaskCaptureParser.MAX_TITLE_LEN),
        priority: pr,
        durationMin: '',
        notes: notesFu,
        followUpContactEmail: fuEmail,
        followUpContactName: fuName,
      };
    }
    var dm = block.duration_minutes;
    if (dm === undefined || dm === null || dm === '') {
      dm = CosConstants.DEFAULT_TASK_DURATION_MINUTES;
    }
    var minutes = parseInt(String(dm), 10);
    if (isNaN(minutes) || minutes < 5 || minutes > 480) {
      return { ok: false, code: 'bad_duration' };
    }
    var notes = String(block.notes || '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (notes.length > 2000) {
      notes = notes.substring(0, 1999) + '…';
    }
    return {
      ok: true,
      kind: 'single',
      task: title.substring(0, CosTelegramTaskCaptureParser.MAX_TITLE_LEN),
      priority: pr,
      durationMin: String(minutes),
      notes: notes,
    };
  },

  /**
   * @param {*} raw
   * @param {string} fallback
   * @returns {string}
   * @private
   */
  _normalizePriority_: function (raw, fallback) {
    var s = String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (
      s === 'FOLLOW-UP' ||
      s === 'FOLLOWUP' ||
      s === 'FOLLOW_UP'
    ) {
      return CosConstants.TASK_PRIORITY.FOLLOW_UP;
    }
    if (s === 'P0' || s === 'P1' || s === 'P2' || s === 'P3') {
      return s;
    }
    return fallback;
  },

  /**
   * @param {string} t
   * @returns {string}
   * @private
   */
  _cleanTitle_: function (t) {
    return String(t || '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * @param {CosSettings} settings
   * @param {string} userLine
   * @returns {string} raw JSON text
   * @private
   */
  _openAiJson_: function (settings, userLine) {
    var key = String(settings.digestAiApiKey || '').trim();
    var model =
      String(settings.digestAiModel || '').trim() ||
      CosConstants.DEFAULT_TELEGRAM_PARSE_OPENAI_MODEL;
    var ctx = arguments.length >= 3 ? String(arguments[2] || '') : '';
    var conversational = arguments.length >= 4 ? arguments[3] === true : false;
    var schemaHint =
      '{"pattern":"single"|"business_day_split"|"clarify"|"reschedule_named"|"drop_named"|"propose_one_on_one"|"one_on_one_batch"|"chat"|"none",' +
      '"is_task_request":true|false,' +
      '"response_text":"(butler reply to user)",' +
      '"single":{title,priority,notes?,duration_minutes?,follow_up_contact_email?,follow_up_contact_name?},' +
      '"business_day_split":{...},' +
      '"clarify":{"question":"","options":[{"label":"","interpretation":{"pattern":"single","single":{...}}}]},' +
      '"reschedule_named":{"title_search":"","day_phrase":"thursday"},' +
      '"drop_named":{"title_search":""},' +
      '"propose_one_on_one":{"attendee_email":"","attendee_name":"","attendee_names":[],"duration_minutes":30,"meeting_title":"","horizon_days":14,"focus_day":"","target_ymd":"","target_date":"","slot_window":""},' +
      '"one_on_one_batch":{"attendee_names":[],"duration_minutes":30,"meeting_title":"","horizon_days":14,"focus_day":"","target_ymd":"","target_date":"","slot_window":""},' +
      '"chat":{"reply_text":""}}';
    var body = {
      model: model,
      messages: [
        {
          role: 'system',
          content:
            (conversational
              ? 'You are Jeeves, a warm and competent butler for a personal task scheduler (Google Sheet + calendar). Output ONE JSON object only, no markdown. Always include response_text: a short, friendly reply in Jeeves tone. '
              : 'You interpret Telegram messages for a personal task scheduler (Google Sheet + calendar). Output ONE JSON object only, no markdown. ') +
            'Patterns: ' +
            '(1) "single" — one new task: is_task_request true; title, priority P0|P1|P2|P3|Follow-up, notes optional. For P0–P3 include duration_minutes 5–480. For Follow-up omit duration_minutes (digest-only, not calendar). When the user names who to follow up with, set follow_up_contact_name and/or follow_up_contact_email on single (directory lookup uses the name). ' +
            '(2) "business_day_split" — same minutes each weekday Mon–Fri: base_title, minutes_per_day, business_day_count 1–' +
            CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS +
            ', start_anchor next_day|today, priority. ' +
            '(3) "clarify" — use when ambiguous; provide ONE crisp question and 2–3 plausible options with label and interpretation (each interpretation pattern single or business_day_split with full fields). ' +
            '(4) "reschedule_named" — move an EXISTING task: title_search (keywords from task title), day_phrase (e.g. thursday, tomorrow, next monday, yyyy-MM-dd, or 13 April / April 13 in sheet timezone). is_task_request can be true. ' +
            '(5) "drop_named" — cancel/drop EXISTING task: title_search. ' +
            '(6) "propose_one_on_one" — one calendar invite: one person (attendee_name) OR one meeting with several guests (attendee_names array OR comma/"and" in attendee_name). Never invent emails. target_ymd optional: yyyy-MM-dd or a calendar phrase (e.g. 13 April, April 13) in sheet timezone when user names a specific day (omit focus_day tomorrow if set). Optional target_date for the same phrase if needed. slot_window optional: empty or all (default), workhours when user wants daytime/office hours only (exclude evening remote block), remote for evening-only. duration_minutes, meeting_title, horizon_days, focus_day optional tomorrow. ' +
            '(7) "one_on_one_batch" — user wants SEPARATE 1:1 meetings with each person (e.g. "1:1 with A, B, and C" meaning three invites). attendee_names array (or comma-separated names). Same optional target_ymd / target_date, slot_window (workhours = daytime only), duration_minutes, meeting_title, horizon_days, focus_day. Do NOT use batch for one group meeting with everyone at once (use propose_one_on_one). ' +
            '(8) "chat" — user is chatting; set is_task_request false; return chat.reply_text and response_text; do NOT create tasks. ' +
            '(9) "none" — not a task command (is_task_request false). ' +
            'For (4)(5) do not invent task titles; use words the user said. Phrases like "next 5 days" for new recurring work → usually business_day_split. ' +
            (ctx ? 'Context JSON (recent chat state; may be empty): ' + ctx + ' ' : '') +
            'Example schema: ' +
            schemaHint,
        },
        {
          role: 'user',
          content: userLine,
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    };
    var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error('OpenAI HTTP ' + code + ': ' + text.substring(0, 200));
    }
    var json = JSON.parse(text);
    var choice = json.choices && json.choices[0];
    var msg = choice && choice.message && choice.message.content;
    return String(msg || '').trim();
  },

  /**
   * @param {CosSettings} settings
   * @param {string} userLine
   * @returns {string} raw JSON text
   * @private
   */
  _geminiJson_: function (settings, userLine) {
    var key = String(settings.digestAiApiKey || '').trim();
    var model =
      String(settings.digestAiModel || '').trim() ||
      CosConstants.DEFAULT_DIGEST_GEMINI_MODEL;
    var url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent?key=' +
      encodeURIComponent(key);
    var ctx = arguments.length >= 3 ? String(arguments[2] || '') : '';
    var conversational = arguments.length >= 4 ? arguments[3] === true : false;
    var sys =
      (conversational
        ? 'You are Jeeves, a warm and competent butler for a task scheduler (sheet + calendar). JSON only, no markdown. Always include response_text (short, friendly). '
        : 'You interpret Telegram for a task scheduler (sheet + calendar). JSON only, no markdown. ') +
      'Patterns: single (new task: P0–P3 include duration_minutes 5–480; Follow-up omit duration_minutes; for Follow-up set follow_up_contact_name and/or follow_up_contact_email when user names the person); business_day_split (same minutes each weekday); ' +
      'clarify (ONE question + 2–3 options with label and interpretation single or business_day_split); ' +
      'reschedule_named {title_search, day_phrase: thursday|tomorrow|next monday|yyyy-MM-dd|13 April|April 13}; ' +
      'drop_named {title_search}; propose_one_on_one {one invite: attendee_name or attendee_names for group meeting; target_ymd or target_date; slot_window all|workhours|remote when user restricts daytime vs evening; never invent emails; max ' +
      CosConstants.TELEGRAM_MEETING_ATTENDEES_MAX +
      ' guests; duration_minutes, meeting_title, horizon_days, focus_day optional tomorrow}; one_on_one_batch {separate 1:1s: attendee_names; target_ymd or target_date; slot_window workhours when user says during work hours / daytime only; not for one joint meeting}; chat {reply_text}; none. ' +
      'business_day_split business_day_count max ' +
      CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS +
      '. For new tasks set is_task_request true when pattern single or business_day_split. ' +
      'reschedule_named/drop_named: use user words for title_search; do not invent. ' +
      (ctx ? 'Context JSON: ' + ctx : '');
    var body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: userLine }] }],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    };
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var http = res.getResponseCode();
    var text = res.getContentText();
    if (http < 200 || http >= 300) {
      throw new Error('Gemini HTTP ' + http + ': ' + text.substring(0, 200));
    }
    var json = JSON.parse(text);
    var cand = json.candidates && json.candidates[0];
    if (!cand || !cand.content) {
      throw new Error('Gemini: no candidates in response');
    }
    var parts = cand.content.parts;
    var p0 = parts && parts[0];
    return String((p0 && p0.text) || '').trim();
  },
};
