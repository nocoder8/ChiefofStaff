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
    var dm = block.duration_minutes;
    if (dm === undefined || dm === null || dm === '') {
      dm = CosConstants.DEFAULT_TASK_DURATION_MINUTES;
    }
    var minutes = parseInt(String(dm), 10);
    if (isNaN(minutes) || minutes < 5 || minutes > 480) {
      return { ok: false, code: 'bad_duration' };
    }
    var pr = CosTelegramParseAiService._normalizePriority_(
      block.priority,
      CosConstants.TASK_PRIORITY.P2
    );
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
      '{"pattern":"single"|"business_day_split"|"clarify"|"reschedule_named"|"drop_named"|"chat"|"none",' +
      '"is_task_request":true|false,' +
      '"response_text":"(butler reply to user)",' +
      '"single":{...},"business_day_split":{...},' +
      '"clarify":{"question":"","options":[{"label":"","interpretation":{"pattern":"single","single":{...}}}]},' +
      '"reschedule_named":{"title_search":"","day_phrase":"thursday"},' +
      '"drop_named":{"title_search":""},' +
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
            '(1) "single" — one new task: is_task_request true; title, priority P0|P1|P2|P3|Follow-up, duration_minutes 5–480, notes optional. ' +
            '(2) "business_day_split" — same minutes each weekday Mon–Fri: base_title, minutes_per_day, business_day_count 1–' +
            CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS +
            ', start_anchor next_day|today, priority. ' +
            '(3) "clarify" — use when ambiguous; provide ONE crisp question and 2–3 plausible options with label and interpretation (each interpretation pattern single or business_day_split with full fields). ' +
            '(4) "reschedule_named" — move an EXISTING task: title_search (keywords from task title), day_phrase (e.g. thursday, tomorrow, next monday, 2026-04-01). is_task_request can be true. ' +
            '(5) "drop_named" — cancel/drop EXISTING task: title_search. ' +
            '(6) "chat" — user is chatting; set is_task_request false; return chat.reply_text and response_text; do NOT create tasks. ' +
            '(7) "none" — not a task command (is_task_request false). ' +
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
      'Patterns: single (new one-off task); business_day_split (same minutes each weekday); ' +
      'clarify (ONE question + 2–3 options with label and interpretation single or business_day_split); ' +
      'reschedule_named {title_search, day_phrase like thursday|tomorrow|next monday|yyyy-MM-dd}; ' +
      'drop_named {title_search}; chat {reply_text}; none. ' +
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
