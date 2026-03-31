/**
 * Telegram Bot API: proactive “awaiting closure” prompts and numeric replies (1–4).
 * Inbound: webhook POST (doPost + cos_tg) or timer-driven getUpdates (CosTelegramPolling).
 */
var CosTelegramService = {
  /**
   * @param {CosSettings} settings
   * @returns {boolean}
   */
  isClosureNudgeConfigured_: function (settings) {
    if (!settings.telegramClosureEnabled) {
      return false;
    }
    var tok = String(settings.telegramBotToken || '').trim();
    var chat = String(settings.telegramChatId || '').trim();
    return tok.length >= 10 && chat.length >= 1;
  },

  /**
   * @param {CosSettings} settings
   * @returns {boolean}
   */
  canRegisterWebhook_: function (settings) {
    var tok = String(settings.telegramBotToken || '').trim();
    var chat = String(settings.telegramChatId || '').trim();
    if (tok.length < 10 || !chat) {
      return false;
    }
    var u = String(settings.closureWebAppUrl || '').trim();
    return u.indexOf('/exec') >= 0 || u.indexOf('/dev') >= 0;
  },

  /**
   * @param {string} baseUrl
   * @param {string} secret
   * @returns {string}
   * @private
   */
  _webhookUrlWithSecret_: function (baseUrl, secret) {
    var b = String(baseUrl || '').trim().replace(/\?+$/, '');
    var sep = b.indexOf('?') >= 0 ? '&' : '?';
    return b + sep + 'cos_tg=' + encodeURIComponent(String(secret || '').trim());
  },

  /**
   * Strip query string for comparing webhook URL to CLOSURE_WEBAPP_URL.
   * @param {string} u
   * @returns {string}
   * @private
   */
  _execUrlWithoutQuery_: function (u) {
    var s = String(u || '').trim();
    var q = s.indexOf('?');
    if (q >= 0) {
      s = s.substring(0, q);
    }
    return s.replace(/\?+$/, '');
  },

  /**
   * Avoid logging the full cos_tg secret.
   * @param {string} url
   * @returns {string}
   * @private
   */
  _redactCosTgInUrl_: function (url) {
    return String(url || '').replace(
      /([?&])cos_tg=[^&]*/gi,
      '$1cos_tg=<redacted>'
    );
  },

  /**
   * Telegram Bot API: current webhook URL and delivery errors (GET).
   * @param {CosSettings} settings
   * @returns {{ ok: boolean, message?: string, result?: Object }}
   */
  fetchWebhookInfo_: function (settings) {
    var tok = String(settings.telegramBotToken || '').trim();
    if (tok.length < 10) {
      return { ok: false, message: 'Set TELEGRAM_BOT_TOKEN first.' };
    }
    var apiUrl =
      'https://api.telegram.org/bot' +
      encodeURIComponent(tok) +
      '/getWebhookInfo';
    try {
      var resp = UrlFetchApp.fetch(apiUrl, {
        method: 'get',
        muteHttpExceptions: true,
      });
      var code = resp.getResponseCode();
      var text = resp.getContentText() || '{}';
      var json;
      try {
        json = JSON.parse(text);
      } catch (je) {
        return { ok: false, message: 'Bad JSON (HTTP ' + code + ')' };
      }
      if (!json.ok) {
        return {
          ok: false,
          message: json.description || 'getWebhookInfo failed',
        };
      }
      return { ok: true, result: json.result || {} };
    } catch (e) {
      return { ok: false, message: String(e.message || e) };
    }
  },

  /**
   * After a task moves to Awaiting Closure, send a reply-to prompt (best-effort).
   * @param {CosTask} task
   * @returns {{ ok: boolean, skipped?: boolean, message?: string }}
   */
  notifyAwaitingClosure_: function (task) {
    var settings = new CosSettingsRepository().getSettings();
    if (!CosTelegramService.isClosureNudgeConfigured_(settings)) {
      return { ok: true, skipped: true };
    }
    var tok = String(settings.telegramBotToken || '').trim();
    var chatId = String(settings.telegramChatId || '').trim();
    var title = String(task.task || 'Task').trim();
    if (title.length > 350) {
      title = title.substring(0, 349) + '…';
    }
    var body =
      '🎩 Jeeves — Your scheduled block is complete\n\n' +
      title +
      '\n\n' +
      '1 — Done\n' +
      '2 — Reschedule (see options below)\n' +
      '3 — Lower priority\n' +
      '4 — Drop\n\n' +
      '↪️ Reply with 1–4, or a reschedule code below.\n\n' +
      'Reschedule options (sheet timezone)\n' +
      '2 — Next free slot by priority (P0 is usually same day)\n' +
      '2t or 2two — On or after tomorrow\n' +
      '2three — On or after the day after tomorrow\n' +
      '2four — On or after three calendar days from today\n\n' +
      '2 tomorrow — same as 2t / 2two.';
    var r = CosTelegramService._apiJson_(
      tok,
      'sendMessage',
      {
        chat_id: chatId,
        text: body,
        disable_web_page_preview: true,
      }
    );
    if (!r.ok || !r.json || !r.json.ok) {
      CosLogger.warn('Telegram sendMessage failed', {
        taskId: task.taskId,
        desc: r.desc || r.json,
      });
      return { ok: false, message: r.desc || 'sendMessage failed' };
    }
    var mid = r.json.result && r.json.result.message_id;
    if (mid === undefined || mid === null) {
      return { ok: false, message: 'No message_id from Telegram' };
    }
    var key =
      CosConstants.TELEGRAM_PENDING_KEY_PREFIX +
      chatId +
      '_' +
      String(mid);
    try {
      PropertiesService.getScriptProperties().setProperty(
        key,
        String(task.taskId || '').trim()
      );
    } catch (pe) {
      CosLogger.warn('Telegram pending key set failed', {
        error: String(pe),
        taskId: task.taskId,
      });
    }
    return { ok: true };
  },

  /**
   * @param {string} token
   * @param {string} method
   * @param {Object} payload
   * @returns {{ ok: boolean, json?: Object, desc?: string }}
   * @private
   */
  _apiJson_: function (token, method, payload) {
    var url =
      'https://api.telegram.org/bot' +
      encodeURIComponent(token) +
      '/' +
      encodeURIComponent(method);
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify(payload),
      });
      var code = resp.getResponseCode();
      var text = resp.getContentText() || '{}';
      var json;
      try {
        json = JSON.parse(text);
      } catch (je) {
        return { ok: false, desc: 'Bad JSON (HTTP ' + code + ')' };
      }
      if (code >= 200 && code < 300 && json.ok) {
        return { ok: true, json: json };
      }
      return {
        ok: false,
        json: json,
        desc:
          (json && json.description) ||
          'HTTP ' + code + ' ' + text.substring(0, 200),
      };
    } catch (e) {
      return { ok: false, desc: String(e.message || e) };
    }
  },

  /**
   * @param {CosSettings} settings
   * @returns {{ ok: boolean, message?: string }}
   */
  sendTestMessage_: function (settings) {
    var tok = String(settings.telegramBotToken || '').trim();
    var chat = String(settings.telegramChatId || '').trim();
    if (tok.length < 10 || !chat) {
      return { ok: false, message: 'Set bot token and chat id first.' };
    }
    var r = CosTelegramService._apiJson_(
      tok,
      'sendMessage',
      {
        chat_id: chat,
        text:
          '🎩 Chief of Staff: Telegram is configured. You will get a prompt when a scheduled block ends.',
        disable_web_page_preview: true,
      }
    );
    if (!r.ok) {
      return { ok: false, message: r.desc || 'sendMessage failed' };
    }
    return { ok: true };
  },

  /**
   * Clears Telegram webhook so getUpdates polling can receive updates.
   * @param {CosSettings} settings
   * @returns {{ ok: boolean, message?: string }}
   */
  deleteWebhook_: function (settings) {
    var tok = String(settings.telegramBotToken || '').trim();
    if (tok.length < 10) {
      return { ok: false, message: 'Set TELEGRAM_BOT_TOKEN first.' };
    }
    var r = CosTelegramService._apiJson_(tok, 'deleteWebhook', {});
    if (!r.ok || !r.json || !r.json.ok) {
      return {
        ok: false,
        message: (r.json && r.json.description) || r.desc || 'deleteWebhook failed',
      };
    }
    return { ok: true };
  },

  /**
   * Registers Telegram webhook to this script’s web app URL (with cos_tg secret).
   * @param {CosSettings} settings
   * @returns {{ ok: boolean, message?: string, registeredUrlRedacted?: string }}
   */
  setWebhookFromSettings_: function (settings) {
    if (settings.telegramUsePolling) {
      return {
        ok: false,
        message:
          'Telegram polling is on — disable it (Chief of Staff menu) before registering a webhook.',
      };
    }
    if (!CosTelegramService.canRegisterWebhook_(settings)) {
      return {
        ok: false,
        message:
          'Need TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and CLOSURE_WEBAPP_URL (web app /exec).',
      };
    }
    var sec = String(settings.telegramWebhookSecret || '').trim();
    if (sec.length < 8) {
      return {
        ok: false,
        message: 'TELEGRAM_WEBHOOK_SECRET missing or too short — run Install / Repair.',
      };
    }
    var base = String(settings.closureWebAppUrl || '').trim();
    var hookUrl = CosTelegramService._webhookUrlWithSecret_(base, sec);
    var tok = String(settings.telegramBotToken || '').trim();
    var r = CosTelegramService._apiJson_(tok, 'setWebhook', {
      url: hookUrl,
      allowed_updates: ['message'],
    });
    if (!r.ok || !r.json || !r.json.ok) {
      return {
        ok: false,
        message: (r.json && r.json.description) || r.desc || 'setWebhook failed',
      };
    }
    return { ok: true, registeredUrlRedacted: CosTelegramService._redactCosTgInUrl_(hookUrl) };
  },

  /**
   * @param {string} chatId
   * @param {string} token
   * @param {string} text
   * @private
   */
  _replyPlain_: function (chatId, token, text) {
    var r = CosTelegramService._apiJson_(token, 'sendMessage', {
      chat_id: chatId,
      text: String(text || '').substring(0, 3900),
      disable_web_page_preview: true,
    });
    if (!r.ok) {
      CosLogger.warn('Telegram sendMessage (reply) failed', {
        chatId: chatId,
        desc: r.desc || r.json,
      });
    }
  },

  /**
   * @param {string} key
   * @private
   */
  _deletePendingKey_: function (key) {
    try {
      PropertiesService.getScriptProperties().deleteProperty(key);
    } catch (de) {
      // ignore
    }
  },

  /**
   * @param {string} raw
   * @param {number} nowMs
   * @param {GoogleAppsScript.Properties.Properties} props
   * @param {string} key
   * @returns {Object|null}
   * @private
   */
  _readTimedPending_: function (raw, nowMs, props, key) {
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || typeof o.exp !== 'number') {
        props.deleteProperty(key);
        return null;
      }
      if (nowMs > o.exp) {
        props.deleteProperty(key);
        return null;
      }
      return o;
    } catch (e) {
      props.deleteProperty(key);
      return null;
    }
  },

  /**
   * Lightweight per-chat context for conversational follow-ups (TTL).
   * @param {string} chatStr
   * @returns {Object} context object
   * @private
   */
  _readChatContext_: function (chatStr) {
    var props = PropertiesService.getScriptProperties();
    var key = 'TGCTX1_' + String(chatStr || '').trim();
    var raw = props.getProperty(key);
    if (!raw) {
      return {};
    }
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') {
        props.deleteProperty(key);
        return {};
      }
      var exp = Number(o.exp || 0);
      if (!exp || Date.now() > exp) {
        props.deleteProperty(key);
        return {};
      }
      return o.ctx && typeof o.ctx === 'object' ? o.ctx : {};
    } catch (e) {
      props.deleteProperty(key);
      return {};
    }
  },

  /**
   * @param {string} chatStr
   * @param {Object} ctx
   * @param {number=} ttlMs
   * @private
   */
  _writeChatContext_: function (chatStr, ctx, ttlMs) {
    var props = PropertiesService.getScriptProperties();
    var key = 'TGCTX1_' + String(chatStr || '').trim();
    var ttl = Math.max(5 * 60 * 1000, Number(ttlMs) || 24 * 60 * 60 * 1000);
    try {
      props.setProperty(
        key,
        JSON.stringify({ exp: Date.now() + ttl, ctx: ctx || {} })
      );
    } catch (e) {
      // ignore
    }
  },

  /**
   * @param {Object} p normalized LLM payload (single or business_day_split)
   * @returns {Object|null}
   * @private
   */
  _slimClarifyPayload_: function (p) {
    if (!p || !p.kind) {
      return null;
    }
    if (p.kind === 'single') {
      return {
        kind: 'single',
        task: p.task,
        priority: p.priority,
        durationMin: p.durationMin,
        notes: p.notes || '',
      };
    }
    if (p.kind === 'business_day_split') {
      return {
        kind: 'business_day_split',
        baseTitle: p.baseTitle,
        minutesPerDay: p.minutesPerDay,
        businessDayCount: p.businessDayCount,
        startAnchor: p.startAnchor,
        priority: p.priority,
      };
    }
    return null;
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {Object} pay slim payload
   * @param {CosSettings} settings
   * @private
   */
  _applyClarifyChoicePayload_: function (chatStr, tok, pay, settings) {
    var ss = CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Spreadsheet not reachable. Open the Tasks sheet once or set BOUND_SPREADSHEET_ID and run Install.'
      );
      return;
    }
    if (pay.kind === 'single') {
      CosTelegramService._createAndConfirmTelegramTask_(
        chatStr,
        tok,
        ss,
        {
          task: pay.task,
          priority: pay.priority,
          durationMin: pay.durationMin,
          notes: pay.notes || '',
        },
        '',
        true
      );
      return;
    }
    if (pay.kind === 'business_day_split') {
      CosTelegramService._handleBusinessDaySplit_(
        chatStr,
        tok,
        {
          ok: true,
          baseTitle: pay.baseTitle,
          minutesPerDay: pay.minutesPerDay,
          businessDayCount: pay.businessDayCount,
          startAnchor: pay.startAnchor,
          priority: pay.priority,
        },
        ss
      );
    }
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {string} text
   * @param {CosSettings} settings
   * @returns {boolean} true if this message was consumed
   * @private
   */
  _consumeTelegramPendingUi_: function (chatStr, tok, text, settings) {
    var t = String(text || '').replace(/^\s+|\s+$/g, '');
    var props = PropertiesService.getScriptProperties();
    var now = Date.now();
    var kCl = CosConstants.TELEGRAM_CLARIFY_PENDING_PREFIX + chatStr;
    var kPk = CosConstants.TELEGRAM_TASK_PICK_PENDING_PREFIX + chatStr;
    var rawCl = props.getProperty(kCl);
    if (rawCl) {
      var cl = CosTelegramService._readTimedPending_(rawCl, now, props, kCl);
      if (!cl) {
        return false;
      }
      if (!/^[1-3]$/.test(t)) {
        return false;
      }
      var idx = parseInt(t, 10) - 1;
      if (!cl.options || idx < 0 || idx >= cl.options.length) {
        CosTelegramService._replyPlain_(chatStr, tok, 'Pick 1, 2, or 3.');
        return true;
      }
      props.deleteProperty(kCl);
      var pay = cl.options[idx];
      CosTelegramService._applyClarifyChoicePayload_(chatStr, tok, pay, settings);
      return true;
    }
    var k1on1 = CosConstants.TELEGRAM_ONEONONE_PENDING_PREFIX + chatStr;
    var rawOo = props.getProperty(k1on1);
    if (rawOo) {
      var oo = CosTelegramService._readTimedPending_(rawOo, now, props, k1on1);
      if (!oo) {
        return false;
      }
      if (!/^[1-3]$/.test(t)) {
        return false;
      }
      var oix = parseInt(t, 10) - 1;
      if (!oo.options || oix < 0 || oix >= oo.options.length) {
        CosTelegramService._replyPlain_(chatStr, tok, 'Pick 1, 2, or 3.');
        return true;
      }
      props.deleteProperty(k1on1);
      CosTelegramService._executeOneOnOnePick_(
        chatStr,
        tok,
        oo.options[oix],
        settings
      );
      return true;
    }
    var rawPk = props.getProperty(kPk);
    if (rawPk) {
      var pk = CosTelegramService._readTimedPending_(rawPk, now, props, kPk);
      if (!pk) {
        return false;
      }
      if (!/^[1-5]$/.test(t)) {
        return false;
      }
      var n = parseInt(t, 10) - 1;
      if (!pk.candidates || n < 0 || n >= pk.candidates.length) {
        CosTelegramService._replyPlain_(chatStr, tok, 'Pick a number from the list.');
        return true;
      }
      props.deleteProperty(kPk);
      var taskId = String(pk.candidates[n].taskId || '').trim();
      if (pk.action === 'reschedule') {
        CosTelegramService._executePickReschedule_(
          chatStr,
          tok,
          taskId,
          pk.targetYmd,
          settings
        );
      } else if (pk.action === 'drop') {
        CosTelegramService._executePickDrop_(chatStr, tok, taskId);
      }
      return true;
    }
    return false;
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {string} taskId
   * @param {string} targetYmd
   * @param {CosSettings} settings
   * @private
   */
  _executePickReschedule_: function (chatStr, tok, taskId, targetYmd, settings) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(90000)) {
      CosTelegramService._replyPlain_(chatStr, tok, 'Busy — try again in a moment.');
      return;
    }
    try {
      var ss = CosBootstrap.getSpreadsheetForRun();
      if (!ss) {
        CosTelegramService._replyPlain_(chatStr, tok, 'Spreadsheet not reachable.');
        return;
      }
      var r = CosTaskSchedulerService.rescheduleTaskToLocalYmd(
        ss,
        taskId,
        targetYmd
      );
      if (r.ok && r.slot) {
        var tz =
          String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          '📅 Moved to ' +
            targetYmd +
            ' · ' +
            Utilities.formatDate(r.slot.start, tz, 'EEE HH:mm') +
            ' (sheet TZ)'
        );
        return;
      }
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Could not reschedule: ' +
          String((r && r.message) || r.code || 'failed').substring(0, 280)
      );
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {string} taskId
   * @param {CosSettings} settings
   * @private
   */
  _executePickDrop_: function (chatStr, tok, taskId) {
    var ss = CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      CosTelegramService._replyPlain_(chatStr, tok, 'Spreadsheet not reachable.');
      return;
    }
    var repo = new CosTaskRepository(ss);
    var updated = repo.dropPendingOrScheduledTask(taskId);
    if (updated) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        '🗑️ Dropped: ' + String(updated.task || '').substring(0, 200)
      );
      return;
    }
    CosTelegramService._replyPlain_(
      chatStr,
      tok,
      'Could not drop that task (wrong status or not found).'
    );
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {Object} ai CosTelegramParseAiService.tryInterpret result with ok true
   * @param {CosSettings} settings
   * @returns {boolean} true if handled
   * @private
   */
  _applyLlmInterpretResult_: function (chatStr, tok, ai, settings) {
    if (!ai || !ai.ok) {
      return false;
    }
    if (ai.kind === 'chat') {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        String(ai.replyText || '').trim() || 'At your service.'
      );
      return true;
    }
    if (ai.kind === 'clarify') {
      var slim = [];
      var i;
      for (i = 0; i < ai.options.length; i++) {
        var sp = CosTelegramService._slimClarifyPayload_(ai.options[i].payload);
        if (sp) {
          slim.push({
            label: ai.options[i].label,
            payload: sp,
          });
        }
      }
      if (slim.length < 2) {
        return false;
      }
      var props = PropertiesService.getScriptProperties();
      var key = CosConstants.TELEGRAM_CLARIFY_PENDING_PREFIX + chatStr;
      props.setProperty(
        key,
        JSON.stringify({
          exp: Date.now() + CosConstants.TELEGRAM_PENDING_UI_TTL_MS,
          options: slim.map(function (x) {
            return x.payload;
          }),
        })
      );
      var lines = [];
      for (i = 0; i < slim.length; i++) {
        lines.push(String(i + 1) + ') ' + slim[i].label);
      }
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        '❔ ' +
          (String(ai.replyText || '').trim() || ai.question) +
          '\n\n' +
          lines.join('\n') +
          '\n\nReply with 1, 2, or 3.'
      );
      return true;
    }
    if (ai.kind === 'reschedule_named') {
      CosTelegramService._runRescheduleNamed_(chatStr, tok, ai, settings);
      return true;
    }
    if (ai.kind === 'drop_named') {
      CosTelegramService._runDropNamed_(chatStr, tok, ai, settings);
      return true;
    }
    if (ai.kind === 'one_on_one_propose') {
      CosTelegramService._handleOneOnOnePropose_(chatStr, tok, ai, settings);
      return true;
    }
    var ss = CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Spreadsheet not reachable. Open the Tasks sheet once or set BOUND_SPREADSHEET_ID and run Install.'
      );
      return true;
    }
    if (ai.kind === 'single') {
      CosTelegramService._createAndConfirmTelegramTask_(
        chatStr,
        tok,
        ss,
        {
          task: ai.task,
          priority: ai.priority,
          durationMin: ai.durationMin,
          notes: ai.notes || '',
        },
        '',
        true,
        ai.replyText || ''
      );
      return true;
    }
    if (ai.kind === 'business_day_split') {
      CosTelegramService._handleBusinessDaySplit_(
        chatStr,
        tok,
        {
          ok: true,
          baseTitle: ai.baseTitle,
          minutesPerDay: ai.minutesPerDay,
          businessDayCount: ai.businessDayCount,
          startAnchor: ai.startAnchor,
          priority: ai.priority,
        },
        ss,
        ai.replyText || ''
      );
      return true;
    }
    return false;
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {{ titleSearch: string, dayPhrase: string }} ai
   * @param {CosSettings} settings
   * @private
   */
  _runRescheduleNamed_: function (chatStr, tok, ai, settings) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(120000)) {
      CosTelegramService._replyPlain_(chatStr, tok, 'Busy — try again in a moment.');
      return;
    }
    try {
      var ss = CosBootstrap.getSpreadsheetForRun();
      if (!ss) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'Spreadsheet not reachable. Open the Tasks sheet once or set BOUND_SPREADSHEET_ID and run Install.'
        );
        return;
      }
      var tz =
        String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
      var ymd = CosTelegramDayResolve.phraseToYmd(tz, ai.dayPhrase);
      if (!ymd) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'Could not parse the day. Try: tomorrow, thursday, next monday, or yyyy-MM-dd (sheet timezone).'
        );
        return;
      }
      var repo = new CosTaskRepository(ss);
      var list = repo.searchTasksForTelegramEdit(ai.titleSearch, 5);
      if (!list.length) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'No Pending/Scheduled task matched “' +
            ai.titleSearch.substring(0, 80) +
            '”.'
        );
        return;
      }
      if (list.length === 1) {
        var r = CosTaskSchedulerService.rescheduleTaskToLocalYmd(
          ss,
          list[0].taskId,
          ymd
        );
        if (r.ok && r.slot) {
          CosTelegramService._replyPlain_(
            chatStr,
            tok,
            '📅 Moved “' +
              String(list[0].task || '').substring(0, 60) +
              '” to ' +
              ymd +
              ' · ' +
              Utilities.formatDate(r.slot.start, tz, 'EEE HH:mm') +
              ' (sheet TZ)'
          );
          return;
        }
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'Could not book that day: ' +
            String((r && r.message) || r.code || '?').substring(0, 250)
        );
        return;
      }
      var props = PropertiesService.getScriptProperties();
      var key = CosConstants.TELEGRAM_TASK_PICK_PENDING_PREFIX + chatStr;
      var cand = [];
      var j;
      for (j = 0; j < list.length; j++) {
        cand.push({
          taskId: list[j].taskId,
          title: String(list[j].task || '').substring(0, 120),
        });
      }
      props.setProperty(
        key,
        JSON.stringify({
          exp: Date.now() + CosConstants.TELEGRAM_PENDING_UI_TTL_MS,
          action: 'reschedule',
          targetYmd: ymd,
          candidates: cand,
        })
      );
      var lines = [];
      for (j = 0; j < cand.length; j++) {
        lines.push(String(j + 1) + ') ' + cand[j].title);
      }
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Which task (→ ' +
          ymd +
          ')?\n' +
          lines.join('\n') +
          '\n\nReply with a number 1–' +
          String(cand.length) +
          '.'
      );
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {{ titleSearch: string }} ai
   * @param {CosSettings} settings
   * @private
   */
  _runDropNamed_: function (chatStr, tok, ai, settings) {
    var ss = CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Spreadsheet not reachable. Open the Tasks sheet once or set BOUND_SPREADSHEET_ID and run Install.'
      );
      return;
    }
    var repo = new CosTaskRepository(ss);
    var list = repo.searchTasksForTelegramEdit(ai.titleSearch, 5);
    if (!list.length) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'No Pending/Scheduled task matched “' +
          ai.titleSearch.substring(0, 80) +
          '”.'
      );
      return;
    }
    if (list.length === 1) {
      var updated = repo.dropPendingOrScheduledTask(list[0].taskId);
      if (updated) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          '🗑️ Dropped: ' + String(updated.task || '').substring(0, 200)
        );
        return;
      }
      CosTelegramService._replyPlain_(chatStr, tok, 'Could not drop that task.');
      return;
    }
    var props = PropertiesService.getScriptProperties();
    var key = CosConstants.TELEGRAM_TASK_PICK_PENDING_PREFIX + chatStr;
    var cand = [];
    var j;
    for (j = 0; j < list.length; j++) {
      cand.push({
        taskId: list[j].taskId,
        title: String(list[j].task || '').substring(0, 120),
      });
    }
    props.setProperty(
      key,
      JSON.stringify({
        exp: Date.now() + CosConstants.TELEGRAM_PENDING_UI_TTL_MS,
        action: 'drop',
        targetYmd: '',
        candidates: cand,
      })
    );
    var lines = [];
    for (j = 0; j < cand.length; j++) {
      lines.push(String(j + 1) + ') ' + cand[j].title);
    }
    CosTelegramService._replyPlain_(
      chatStr,
      tok,
      'Which task to drop?\n' +
        lines.join('\n') +
        '\n\nReply with a number 1–' +
        String(cand.length) +
        '.'
    );
  },

  /**
   * Mutual free time → three options; user replies 1–3 to send invites.
   * @param {string} chatStr
   * @param {string} tok
   * @param {{ attendeeEmail: string, durationMin: number, meetingTitle: string, horizonDays: number, replyText?: string }} ai
   * @param {CosSettings} settings
   * @private
   */
  _handleOneOnOnePropose_: function (chatStr, tok, ai, settings) {
    var r = CosOneOnOneSchedulingService.findThreeMutualSlots(
      settings,
      ai.attendeeEmail,
      ai.durationMin,
      ai.horizonDays
    );
    if (!r.ok) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        (String(ai.replyText || '').trim() ? ai.replyText + '\n\n' : '') +
          (r.message || r.code || 'Could not look up availability.')
      );
      return;
    }
    var slots = r.slots || [];
    if (!slots.length) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        (String(ai.replyText || '').trim() ? ai.replyText + '\n\n' : '') +
          'I could not find a mutual free slot in your work hours within that window. Try a longer horizon or a shorter duration.'
      );
      return;
    }
    var tz =
      String(settings.timezone || '').trim() || Session.getScriptTimeZone();
    var options = [];
    var lines = [];
    var i;
    for (i = 0; i < slots.length && i < 3; i++) {
      var s = slots[i];
      options.push({
        attendeeEmail: ai.attendeeEmail,
        meetingTitle: ai.meetingTitle,
        startIso: s.start.toISOString(),
        endIso: s.end.toISOString(),
      });
      lines.push(
        String(i + 1) +
          ') ' +
          Utilities.formatDate(s.start, tz, 'EEE HH:mm') +
          ' – ' +
          Utilities.formatDate(s.end, tz, 'HH:mm') +
          ' (sheet TZ)'
      );
    }
    var props = PropertiesService.getScriptProperties();
    var key = CosConstants.TELEGRAM_ONEONONE_PENDING_PREFIX + chatStr;
    props.setProperty(
      key,
      JSON.stringify({
        exp: Date.now() + CosConstants.TELEGRAM_PENDING_UI_TTL_MS,
        options: options,
      })
    );
    var intro =
      String(ai.replyText || '').trim() ||
      'Here are three times that work on both calendars (within your work hours):';
    CosTelegramService._replyPlain_(
      chatStr,
      tok,
      intro +
        '\n\n' +
        lines.join('\n') +
        '\n\nReply with 1, 2, or 3 to send the calendar invite.'
    );
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {{ attendeeEmail: string, meetingTitle: string, startIso: string, endIso: string }} opt
   * @param {CosSettings} settings
   * @private
   */
  _executeOneOnOnePick_: function (chatStr, tok, opt, settings) {
    var ae = String(opt.attendeeEmail || '')
      .trim()
      .toLowerCase();
    var startIso = String(opt.startIso || '').trim();
    var endIso = String(opt.endIso || '').trim();
    var title = String(opt.meetingTitle || '1:1').trim();
    if (!ae || !startIso || !endIso) {
      CosTelegramService._replyPlain_(chatStr, tok, 'That option is invalid.');
      return;
    }
    var start = new Date(startIso);
    var end = new Date(endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      CosTelegramService._replyPlain_(chatStr, tok, 'Invalid time.');
      return;
    }
    try {
      var cal = CosCalendarRepository.fromSettings(settings);
      var fullTitle =
        CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX + title.substring(0, 120);
      cal.createMeetingInviteEvent(
        fullTitle,
        start,
        end,
        ae,
        'Scheduled via Jeeves (Telegram).'
      );
      var tz =
        String(settings.timezone || '').trim() || Session.getScriptTimeZone();
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        '📅 Invite sent: ' +
          title.substring(0, 120) +
          '\n' +
          Utilities.formatDate(start, tz, 'EEE HH:mm') +
          ' – ' +
          Utilities.formatDate(end, tz, 'HH:mm') +
          ' (sheet TZ) · ' +
          ae
      );
    } catch (e) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Could not create the invite: ' +
          String(e.message || e).substring(0, 200)
      );
    }
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {{ baseTitle: string, minutesPerDay: number, businessDayCount: number, startAnchor: string, priority: string }} bd
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @private
   */
  _handleBusinessDaySplit_: function (chatStr, tok, bd, ss) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(120000)) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Busy scheduling — try again in a moment.'
      );
      return;
    }
    var replyPrefix = arguments.length >= 5 ? String(arguments[4] || '') : '';
    try {
      var settings = new CosSettingsRepository().getSettings();
      var tz =
        String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
      var anchor = bd.startAnchor === 'today' ? 'today' : 'next_day';
      var ymds = CosBusinessDaySplitService.collectBusinessDayYmds_(
        tz,
        anchor,
        bd.businessDayCount
      );
      if (!ymds || !ymds.length) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'Could not build business-day list (check sheet timezone).'
        );
        return;
      }

      var calRepo = CosCalendarRepository.fromSettings(settings);
      var now = new Date();
      var horizonEnd = cos_addCalendarDays_(now, 56);
      var busyRaw = calRepo.listBusyIntervals(
        cos_addCalendarDays_(now, -1),
        horizonEnd
      );
      var busy = busyRaw.map(function (b) {
        return {
          start: b.start,
          end: b.end,
          id: b.id,
          title: b.title,
        };
      });

      var repo = new CosTaskRepository(ss);
      var okLines = [];
      var badLines = [];
      var i;
      var n = ymds.length;
      var maxSlip =
        CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_FORWARD_SLIP_BUSINESS_DAYS;
      for (i = 0; i < n; i++) {
        var intendedYmd = ymds[i];
        var rowTitle =
          bd.baseTitle + ' (' + String(i + 1) + '/' + String(n) + ')';
        var task = repo.createTask({
          task: rowTitle,
          priority: bd.priority,
          durationMin: bd.minutesPerDay,
          source: CosConstants.TASK_SOURCE.TELEGRAM,
          notes: '[Jeeves split:' + intendedYmd + ']',
        });
        var tryYmd = intendedYmd;
        var sch = null;
        var slip;
        for (slip = 0; slip <= maxSlip; slip++) {
          if (slip > 0) {
            tryYmd = CosBusinessDaySplitService.nextWeekdayAfterYmd_(tz, tryYmd);
            var tagUp = repo.updateTask(task.taskId, {
              notes: '[Jeeves split:' + tryYmd + ']',
            });
            if (tagUp) {
              task = tagUp;
            }
          }
          sch = CosTaskSchedulerService.schedulePendingTaskOnLocalYmd(
            ss,
            task.taskId,
            tryYmd,
            busy
          );
          if (sch.result === 'scheduled' && sch.slot) {
            break;
          }
        }
        if (sch && sch.result === 'scheduled' && sch.slot) {
          busy.push({
            start: sch.slot.start,
            end: sch.slot.end,
            id: '',
            title:
              CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX +
              '(split batch)',
          });
          var line =
            '• ' +
            tryYmd +
            ' row ' +
            task.rowNumber +
            ' · ' +
            Utilities.formatDate(sch.slot.start, tz, 'EEE HH:mm');
          if (tryYmd !== intendedYmd) {
            line += ' (no slot on ' + intendedYmd + '; slipped forward)';
          }
          okLines.push(line);
        } else {
          badLines.push(
            '• intended ' +
              intendedYmd +
              ' row ' +
              task.rowNumber +
              ' — tried through ' +
              tryYmd +
              ' — ' +
              String((sch.detail && sch.detail.reason) || sch.result || '?')
          );
        }
      }

      var msg =
        '📅 Business-day split: ' +
        String(okLines.length) +
        '/' +
        String(n) +
        ' scheduled\n' +
        okLines.join('\n');
      if (badLines.length) {
        msg += '\n\nNot booked (still Pending):\n' + badLines.join('\n');
      }
      msg += '\n\nSheet TZ: ' + tz + ' · weekdays only';
      if (replyPrefix) {
        msg = replyPrefix + '\n\n' + msg;
      }
      CosTelegramService._replyPlain_(chatStr, tok, msg);
      CosTelegramService._writeChatContext_(chatStr, {
        lastKind: 'business_day_split',
        lastBaseTitle: bd.baseTitle,
        lastMinutesPerDay: bd.minutesPerDay,
        lastBusinessDayCount: bd.businessDayCount,
        lastStartAnchor: bd.startAnchor,
        lastPriority: bd.priority,
        lastOkCount: okLines.length,
        lastBadCount: badLines.length,
        lastAtIso: new Date().toISOString(),
      });
      CosLogger.info('Telegram business-day split', {
        booked: okLines.length,
        failed: badLines.length,
        anchor: anchor,
      });
    } catch (err) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Split booking failed: ' + String(err.message || err).substring(0, 300)
      );
      CosLogger.error('Telegram business-day split', { error: String(err) });
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {string} chatStr
   * @param {string} tok
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {{ task: string, priority: string, durationMin: string, notes?: string }} fields
   * @param {string} raw
   * @param {boolean} usedAi
   * @private
   */
  _createAndConfirmTelegramTask_: function (
    chatStr,
    tok,
    ss,
    fields,
    raw,
    usedAi
  ) {
    var replyPrefix = arguments.length >= 7 ? String(arguments[6] || '') : '';
    try {
      var repo = new CosTaskRepository(ss);
      var task = repo.createTask({
        task: fields.task,
        priority: fields.priority,
        durationMin: fields.durationMin,
        source: CosConstants.TASK_SOURCE.TELEGRAM,
        notes: fields.notes || '',
      });
      var confirm;
      if (replyPrefix) {
        confirm =
          replyPrefix +
          '\n\n' +
          'Added (row ' +
          task.rowNumber +
          '): ' +
          task.task.substring(0, 240) +
          '\n' +
          task.priority +
          ' · ' +
          task.durationMin +
          ' min';
      } else {
        confirm =
          'Task added (row ' +
          task.rowNumber +
          ')\n' +
          task.task +
          '\nPriority: ' +
          task.priority +
          '\nDuration: ' +
          task.durationMin +
          ' min\nSource: Telegram' +
          (usedAi ? '\n(Interpreted with AI)' : '');
      }
      CosTelegramService._replyPlain_(chatStr, tok, confirm);
      CosTelegramService._writeChatContext_(chatStr, {
        lastKind: 'single',
        lastTaskId: task.taskId,
        lastTitle: task.task,
        lastPriority: task.priority,
        lastDurationMin: task.durationMin,
        lastRowNumber: task.rowNumber,
        lastAtIso: new Date().toISOString(),
      });
      CosLogger.info('Telegram task capture: created', {
        raw: raw,
        parsed: fields,
        taskId: task.taskId,
        row: task.rowNumber,
        ai: usedAi,
      });
    } catch (err) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Could not save the task: ' + String(err.message || err).substring(0, 200)
      );
      CosLogger.error('Telegram task capture: createTask failed', {
        raw: raw,
        parsed: fields,
        error: String(err),
      });
    }
  },

  /**
   * Web app POST may expose URL query as e.parameter, e.parameters, or e.queryString.
   * @param {Object} e
   * @returns {string}
   * @private
   */
  _cosTgFromPostEvent_: function (e) {
    if (!e) {
      return '';
    }
    if (e.parameter && e.parameter.cos_tg !== undefined && e.parameter.cos_tg !== null) {
      return String(e.parameter.cos_tg).trim();
    }
    if (
      e.parameters &&
      e.parameters.cos_tg &&
      e.parameters.cos_tg.length &&
      e.parameters.cos_tg[0] !== undefined
    ) {
      return String(e.parameters.cos_tg[0]).trim();
    }
    var qs = e.queryString ? String(e.queryString) : '';
    if (qs) {
      var parts = qs.split('&');
      var i;
      for (i = 0; i < parts.length; i++) {
        var pair = parts[i].split('=');
        if (pair[0] === 'cos_tg' && pair.length > 1) {
          try {
            return decodeURIComponent(pair.slice(1).join('=')).trim();
          } catch (de) {
            return pair.slice(1).join('=').trim();
          }
        }
      }
    }
    return '';
  },
};

var CosTelegramWebhook = {
  /**
   * @param {Object} e Apps Script POST event
   * @returns {GoogleAppsScript.Content.TextOutput}
   */
  handlePost: function (e) {
    var okOut = function () {
      return ContentService.createTextOutput('OK').setMimeType(
        ContentService.MimeType.TEXT
      );
    };
    var settings;
    try {
      settings = new CosSettingsRepository().getSettings();
    } catch (se) {
      return okOut();
    }
    if (
      !settings.telegramClosureEnabled &&
      !settings.telegramTaskCaptureEnabled
    ) {
      CosLogger.warn(
        'Telegram webhook: ignored (TELEGRAM_CLOSURE_ENABLED and TELEGRAM_TASK_CAPTURE_ENABLED both false)'
      );
      return okOut();
    }
    var want = String(settings.telegramWebhookSecret || '').trim();
    var got = CosTelegramService._cosTgFromPostEvent_(e);
    if (!want || want.length < 8 || got !== want) {
      CosLogger.warn('Telegram webhook: bad or missing cos_tg', {
        hasQueryString: !!(e && e.queryString),
        hasParameterObject: !!(e && e.parameter),
        gotLength: got.length,
      });
      return okOut();
    }
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    var update;
    try {
      update = JSON.parse(raw || '{}');
    } catch (je) {
      return okOut();
    }
    if (update.message) {
      CosTelegramWebhook._onMessage_(update.message, settings);
    } else if (update.edited_message) {
      CosTelegramWebhook._onMessage_(update.edited_message, settings);
    }
    return okOut();
  },

  /**
   * @param {Object} message Telegram Message
   * @param {CosSettings} settings
   * @private
   */
  _onMessage_: function (message, settings) {
    var tok = String(settings.telegramBotToken || '').trim();
    var expectChat = String(settings.telegramChatId || '').trim();
    var fromChat = message.chat && message.chat.id;
    var chatStr =
      fromChat === undefined || fromChat === null ? '' : String(fromChat);
    if (!expectChat || chatStr !== expectChat) {
      CosLogger.warn('Telegram webhook: chat id mismatch (ignoring update)', {
        gotChatId: chatStr,
        expectedChatId: expectChat,
      });
      return;
    }
    if (tok.length < 10) {
      CosLogger.warn('Telegram webhook: bot token missing or too short');
      return;
    }
    var text = String(message.text || '').replace(/^\s+|\s+$/g, '');
    var replyTo = message.reply_to_message;
    var hasReply =
      replyTo && replyTo.message_id !== undefined && replyTo.message_id !== null;

    if (hasReply) {
      var key =
        CosConstants.TELEGRAM_PENDING_KEY_PREFIX +
        chatStr +
        '_' +
        String(replyTo.message_id);
      var pendingClosureId = '';
      try {
        pendingClosureId = String(
          PropertiesService.getScriptProperties().getProperty(key) || ''
        ).trim();
      } catch (ge) {
        pendingClosureId = '';
      }
      if (pendingClosureId) {
        var t = text.trim();
        var action = '';
        var deferDays = 0;
        if (/^1$/.test(t)) {
          action = 'done';
        } else if (/^3$/.test(t)) {
          action = 'lower';
        } else if (/^4$/.test(t)) {
          action = 'drop';
        } else if (/^2$/i.test(t)) {
          action = 'reschedule';
          deferDays = 0;
        } else {
          var mWord = /^2\s*(two|three|four)$/i.exec(t);
          if (mWord) {
            action = 'reschedule';
            var w = String(mWord[1] || '').toLowerCase();
            deferDays = w === 'two' ? 1 : w === 'three' ? 2 : 3;
          } else if (
            /^2t$/i.test(t) ||
            /^2\s+t$/i.test(t) ||
            /^2\s+tomorrow$/i.test(t)
          ) {
            action = 'reschedule';
            deferDays = 1;
          }
        }
        if (!action) {
          CosTelegramService._replyPlain_(
            chatStr,
            tok,
            'Jeeves closure: reply 1–4, or 2two / 2three / 2four (defer 1–3 local days), or 2t / 2 tomorrow (=2two). New tasks: send a non-reply message.'
          );
          return;
        }
        var extras =
          action === 'reschedule' && deferDays >= 1
            ? { rescheduleDeferDaysFromToday: deferDays }
            : undefined;
        var result = CosTaskClosureService.applyClosureOutcome(
          pendingClosureId,
          action,
          undefined,
          extras
        );
        if (result.ok) {
          CosTelegramService._deletePendingKey_(key);
          var line =
            action === 'done'
              ? '✅ Marked done.'
              : action === 'reschedule'
                ? deferDays === 0
                  ? '📅 Back in queue — next free slot (P0 often same day).'
                  : deferDays === 1
                    ? '📅 First slot on or after tomorrow (sheet TZ).'
                    : deferDays === 2
                      ? '📅 First slot on or after the day after tomorrow (sheet TZ).'
                      : '📅 First slot on or after three calendar days from today (sheet TZ).'
                : action === 'lower'
                  ? '⬇️ Priority lowered; back in the queue.'
                  : '🗑️ Dropped.';
          CosTelegramService._replyPlain_(chatStr, tok, line);
          return;
        }
        var friendly =
          result.code === 'too_early'
            ? 'That block has not ended yet in the sheet — try again after the scheduled end.'
            : result.code === 'not_awaiting_closure'
              ? 'This task is no longer waiting for closure (maybe already updated).'
              : result.message || result.code || 'Could not apply that choice.';
        CosTelegramService._replyPlain_(chatStr, tok, friendly);
        return;
      }
      if (settings.telegramTaskCaptureEnabled) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'That isn’t a Jeeves closure prompt. To add a task, send a new top-level message, e.g. /task P2 30m My task or Create task: … . Closure answers must reply to the numbered prompt.'
        );
      } else if (settings.telegramClosureEnabled) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'Reply to the Jeeves closure message with 1–4, or 2two / 2three / 2four to defer (sheet TZ).'
        );
      }
      return;
    }

    if (CosTelegramService._consumeTelegramPendingUi_(chatStr, tok, text, settings)) {
      return;
    }

    if (!settings.telegramTaskCaptureEnabled) {
      if (settings.telegramClosureEnabled) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'New tasks here are off. Reply to the Jeeves prompt with 1–4 (or 2two / 2three / 2four), or enable task capture / use the sheet.'
        );
      }
      return;
    }

    // Conversational mode: LLM-first (when enabled) + friendly chat replies.
    if (
      settings.telegramConversationalModeEnabled &&
      CosTelegramParseAiService.isEnabled_(settings)
    ) {
      var ctx = CosTelegramService._readChatContext_(chatStr);
      var aiConv = CosTelegramParseAiService.tryInterpretConversational(
        settings,
        text,
        {
          chat_id: chatStr,
          context: ctx,
          sheet_timezone: settings.timezone || '',
          hints: {
            business_day_split_max:
              CosConstants.TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS,
          },
        }
      );
      if (aiConv && aiConv.ok) {
        if (aiConv.kind === 'chat') {
          CosTelegramService._replyPlain_(chatStr, tok, aiConv.replyText || '');
          CosTelegramService._writeChatContext_(chatStr, {
            lastKind: 'chat',
            lastAtIso: new Date().toISOString(),
            lastUserText: String(text || '').substring(0, 400),
          });
          return;
        }
        if (CosTelegramService._applyLlmInterpretResult_(chatStr, tok, aiConv, settings)) {
          CosLogger.info('Telegram task capture: LLM (conversational mode)', {
            raw: text,
            kind: aiConv.kind,
          });
          return;
        }
      }
      // Fall through to deterministic parsing when LLM fails or returns unusable output.
    }

    var bd = CosTelegramTaskCaptureParser.parseBusinessDaySplit(text);
    if (bd.ok) {
      var ssBd = CosBootstrap.getSpreadsheetForRun();
      if (!ssBd) {
        CosTelegramService._replyPlain_(
          chatStr,
          tok,
          'Spreadsheet not reachable. Open the Tasks sheet once or set BOUND_SPREADSHEET_ID and run Install.'
        );
        return;
      }
      CosTelegramService._handleBusinessDaySplit_(chatStr, tok, bd, ssBd);
      return;
    }
    if (
      bd.code !== 'no_match' &&
      bd.code !== 'slash' &&
      bd.code !== 'empty_or_long'
    ) {
      var aiRescue = CosTelegramParseAiService.tryInterpret(settings, text);
      if (
        aiRescue.ok &&
        CosTelegramParseAiService.isEnabled_(settings) &&
        CosTelegramService._applyLlmInterpretResult_(
          chatStr,
          tok,
          aiRescue,
          settings
        )
      ) {
        CosLogger.info('Telegram task capture: LLM (bd rescue path)', {
          raw: text,
        });
        return;
      }
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        bd.helpText ||
          'Could not parse weekday split. Say duration per day (e.g. 1 hour a day), number of workdays, and the work (e.g. “… to …” or “… on the …”).'
      );
      return;
    }

    var parsed = CosTelegramTaskCaptureParser.parse(text);
    if (!parsed.ok) {
      var tryLlm =
        (parsed.code === 'no_intent' || parsed.code === 'no_title') &&
        CosTelegramParseAiService.isEnabled_(settings);
      if (tryLlm) {
        var ai2 = CosTelegramParseAiService.tryInterpret(settings, text);
        if (CosTelegramService._applyLlmInterpretResult_(chatStr, tok, ai2, settings)) {
          CosLogger.info('Telegram task capture: LLM after rule parse fail', {
            raw: text,
            afterCode: parsed.code,
          });
          return;
        }
        if (ai2.ok === false && ai2.code === 'not_task') {
          CosTelegramService._replyPlain_(
            chatStr,
            tok,
            'That doesn’t look like a task request. Send /task P2 30m … or a phrase like “Create task: …”.'
          );
          CosLogger.info('Telegram task capture: LLM not_task', {
            raw: text,
            ruleCode: parsed.code,
          });
          return;
        }
      }
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        parsed.helpText || CosTelegramTaskCaptureParser._helpText_()
      );
      CosLogger.info('Telegram task capture: parse failed', {
        code: parsed.code,
        raw: text,
      });
      return;
    }

    var ss = CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Spreadsheet not reachable. Open the Tasks sheet once or set BOUND_SPREADSHEET_ID and run Install.'
      );
      CosLogger.warn('Telegram task capture: no spreadsheet', { raw: text });
      return;
    }

    CosTelegramService._createAndConfirmTelegramTask_(
      chatStr,
      tok,
      ss,
      {
        task: parsed.task,
        priority: parsed.priority,
        durationMin: parsed.durationMin,
        notes: parsed.notes || '',
      },
      text,
      false
    );
  },
};

/**
 * Workspace-friendly inbound Telegram: timer-driven getUpdates (no public web app POST).
 */
var CosTelegramPolling = {
  /**
   * One poll: fetch updates, run same handlers as webhook POST.
   */
  runOnce_: function () {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      CosLogger.info('Telegram poll: skipped (lock held)');
      return;
    }
    try {
      CosTelegramPolling._runOnceUnlocked_();
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @private
   */
  _runOnceUnlocked_: function () {
    var settings;
    try {
      settings = new CosSettingsRepository().getSettings();
    } catch (se) {
      return;
    }
    if (!settings.telegramUsePolling) {
      return;
    }
    if (!settings.telegramClosureEnabled && !settings.telegramTaskCaptureEnabled) {
      return;
    }
    var tok = String(settings.telegramBotToken || '').trim();
    var chat = String(settings.telegramChatId || '').trim();
    if (tok.length < 10 || !chat) {
      return;
    }

    var keys = CosConstants.PROP_KEYS;
    var props = PropertiesService.getScriptProperties();
    var offStr = props.getProperty(keys.TELEGRAM_GET_UPDATES_OFFSET);
    var offset = 0;
    if (offStr !== undefined && offStr !== null && offStr !== '') {
      var n = parseInt(String(offStr), 10);
      if (!isNaN(n) && n >= 0) {
        offset = n;
      }
    }

    var apiUrl =
      'https://api.telegram.org/bot' +
      encodeURIComponent(tok) +
      '/getUpdates?' +
      'timeout=0' +
      '&limit=100' +
      '&offset=' +
      encodeURIComponent(String(offset));

    var resp;
    try {
      resp = UrlFetchApp.fetch(apiUrl, {
        method: 'get',
        muteHttpExceptions: true,
      });
    } catch (fe) {
      CosLogger.warn('Telegram poll: getUpdates fetch failed', {
        error: String(fe.message || fe),
      });
      return;
    }

    var code = resp.getResponseCode();
    var text = resp.getContentText() || '{}';
    var json;
    try {
      json = JSON.parse(text);
    } catch (je) {
      CosLogger.warn('Telegram poll: bad JSON from getUpdates', {
        http: code,
        snippet: text.substring(0, 200),
      });
      return;
    }
    if (!json.ok) {
      CosLogger.warn('Telegram poll: getUpdates not ok', {
        desc: json.description || text.substring(0, 200),
      });
      return;
    }

    var results = json.result || [];
    if (!results.length) {
      return;
    }

    var maxId = offset;
    var i;
    for (i = 0; i < results.length; i++) {
      var u = results[i];
      if (!u || u.update_id === undefined || u.update_id === null) {
        continue;
      }
      var uid = parseInt(String(u.update_id), 10);
      if (!isNaN(uid) && uid >= maxId) {
        maxId = uid;
      }
      if (u.message) {
        CosTelegramWebhook._onMessage_(u.message, settings);
      } else if (u.edited_message) {
        CosTelegramWebhook._onMessage_(u.edited_message, settings);
      }
    }

    props.setProperty(keys.TELEGRAM_GET_UPDATES_OFFSET, String(maxId + 1));
  },
};
