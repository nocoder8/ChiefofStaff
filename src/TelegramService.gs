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
      for (i = 0; i < n; i++) {
        var ymd = ymds[i];
        var rowTitle =
          bd.baseTitle + ' (' + String(i + 1) + '/' + String(n) + ')';
        var task = repo.createTask({
          task: rowTitle,
          priority: bd.priority,
          durationMin: bd.minutesPerDay,
          source: CosConstants.TASK_SOURCE.TELEGRAM,
          notes: '',
        });
        var sch = CosTaskSchedulerService.schedulePendingTaskOnLocalYmd(
          ss,
          task.taskId,
          ymd,
          busy
        );
        if (sch.result === 'scheduled' && sch.slot) {
          busy.push({
            start: sch.slot.start,
            end: sch.slot.end,
            id: '',
            title:
              CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX +
              '(split batch)',
          });
          okLines.push(
            '• ' +
              ymd +
              ' row ' +
              task.rowNumber +
              ' · ' +
              Utilities.formatDate(sch.slot.start, tz, 'EEE HH:mm')
          );
        } else {
          badLines.push(
            '• ' +
              ymd +
              ' row ' +
              task.rowNumber +
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
      CosTelegramService._replyPlain_(chatStr, tok, msg);
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
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        bd.helpText ||
          'Could not parse business-day split. Say duration per day + number of business days + “to …” for the work.'
      );
      return;
    }

    var parsed = CosTelegramTaskCaptureParser.parse(text);
    if (!parsed.ok) {
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

    try {
      var repo = new CosTaskRepository(ss);
      var task = repo.createTask({
        task: parsed.task,
        priority: parsed.priority,
        durationMin: parsed.durationMin,
        source: CosConstants.TASK_SOURCE.TELEGRAM,
        notes: parsed.notes || '',
      });
      var confirm =
        'Task added (row ' +
        task.rowNumber +
        ')\n' +
        task.task +
        '\nPriority: ' +
        task.priority +
        '\nDuration: ' +
        task.durationMin +
        ' min\nSource: Telegram';
      CosTelegramService._replyPlain_(chatStr, tok, confirm);
      CosLogger.info('Telegram task capture: created', {
        raw: text,
        parsed: parsed,
        taskId: task.taskId,
        row: task.rowNumber,
      });
    } catch (err) {
      CosTelegramService._replyPlain_(
        chatStr,
        tok,
        'Could not save the task: ' + String(err.message || err).substring(0, 200)
      );
      CosLogger.error('Telegram task capture: createTask failed', {
        raw: text,
        parsed: parsed,
        error: String(err),
      });
    }
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
