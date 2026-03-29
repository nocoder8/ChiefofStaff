/**
 * Phase 7: install/repair time-driven triggers from Script Properties (idempotent).
 * Handlers live in Main.gs: cos_triggerProcessGmail_, cos_triggerSchedulePending_, cos_triggerDailyDigest_.
 */
var CosTriggerService = {
  HANDLER_GMAIL: 'cos_triggerProcessGmail_',
  HANDLER_SCHEDULE: 'cos_triggerSchedulePending_',
  HANDLER_DIGEST: 'cos_triggerDailyDigest_',

  /**
   * Removes Chief-of-Staff triggers for known handlers, then recreates from settings.
   * @param {CosSettings} settings
   * @param {string} spreadsheetTimeZone IANA fallback when settings.timezone is empty
   * @returns {{ ok: boolean, message?: string, installed: string[] }}
   */
  syncFromSettings: function (settings, spreadsheetTimeZone) {
    var installed = [];
    try {
      CosTriggerService._deleteOurTriggers_();

      if (settings.emailTasksEnabled) {
        ScriptApp.newTrigger(CosTriggerService.HANDLER_GMAIL)
          .timeBased()
          .everyMinutes(CosConstants.TRIGGER_GMAIL_EVERY_MINUTES)
          .create();
        installed.push(
          'Gmail every ' + CosConstants.TRIGGER_GMAIL_EVERY_MINUTES + ' min'
        );
      }

      if (settings.schedulePendingTriggerEnabled) {
        ScriptApp.newTrigger(CosTriggerService.HANDLER_SCHEDULE)
          .timeBased()
          .everyHours(CosConstants.TRIGGER_SCHEDULE_PENDING_EVERY_HOURS)
          .create();
        installed.push(
          'Schedule pending every ' +
            CosConstants.TRIGGER_SCHEDULE_PENDING_EVERY_HOURS +
            ' h'
        );
      }

      if (settings.dailyDigestEnabled) {
        var tz =
          String(settings.timezone || '').trim() || spreadsheetTimeZone;
        var hm = CosTriggerService._parseDigestTime_(settings.dailyDigestTime);
        ScriptApp.newTrigger(CosTriggerService.HANDLER_DIGEST)
          .timeBased()
          .everyDays(1)
          .atHour(hm.hour)
          .nearMinute(hm.minute)
          .inTimezone(tz)
          .create();
        installed.push(
          'Daily digest ' +
            CosTriggerService._pad2_(hm.hour) +
            ':' +
            CosTriggerService._pad2_(hm.minute) +
            ' ' +
            tz
        );
      }

      CosLogger.info('Triggers synced', { installed: installed });
      return { ok: true, installed: installed };
    } catch (e) {
      var msg = String(e.message || e);
      CosLogger.error('Trigger sync failed', { error: msg });
      return { ok: false, message: msg, installed: installed };
    }
  },

  /**
   * @private
   */
  _deleteOurTriggers_: function () {
    var handlers = {};
    handlers[CosTriggerService.HANDLER_GMAIL] = true;
    handlers[CosTriggerService.HANDLER_SCHEDULE] = true;
    handlers[CosTriggerService.HANDLER_DIGEST] = true;
    var all = ScriptApp.getProjectTriggers();
    var i;
    for (i = 0; i < all.length; i++) {
      var t = all[i];
      if (handlers[t.getHandlerFunction()]) {
        ScriptApp.deleteTrigger(t);
      }
    }
  },

  /**
   * @param {string} raw e.g. "08:00" or "14:30"
   * @returns {{ hour: number, minute: number }}
   * @private
   */
  _parseDigestTime_: function (raw) {
    var s = String(raw || CosConstants.DEFAULT_DAILY_DIGEST_TIME).trim();
    var p = s.split(':');
    var h = parseInt(p[0], 10);
    var m = p.length > 1 ? parseInt(p[1], 10) : 0;
    if (isNaN(h) || h < 0 || h > 23) {
      h = 8;
    }
    if (isNaN(m) || m < 0 || m > 59) {
      m = 0;
    }
    return { hour: h, minute: m };
  },

  /**
   * @param {number} n
   * @returns {string}
   * @private
   */
  _pad2_: function (n) {
    return n < 10 ? '0' + n : String(n);
  },
};
