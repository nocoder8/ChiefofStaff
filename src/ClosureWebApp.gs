/**
 * Signed closure actions (GET). Global doGet/doPost live in WebAppEntry.gs.
 * Deploy: Web app → Execute as: Me, Who has access: Anyone.
 */
var CosClosureWebApp = {
  /**
   * @param {Object} e Apps Script event
   * @returns {GoogleAppsScript.HTML.HtmlOutput}
   */
  handleGet: function (e) {
    var p = e && e.parameter ? e.parameter : {};
    var taskId = String(p.taskId || '').trim();
    var action = String(p.action || '').trim().toLowerCase();
    var exp = parseInt(String(p.exp || '0'), 10);
    var sig = String(p.sig || '').trim();
    var cm = String(p.cm || '').trim();
    var settings = new CosSettingsRepository().getSettings();

    var err = function (title, detail) {
      return CosClosureWebApp._page_(false, title, detail, '');
    };

    if (cm === '1') {
      if (!taskId) {
        return err(
          'Invalid link',
          'This link is incomplete. Use the latest link from your calendar or daily digest.'
        );
      }
      if (
        !CosClosureLinkService.verifySignature(
          taskId,
          CosConstants.CLOSURE_SIGN_ACTION_MENU,
          exp,
          sig,
          settings
        )
      ) {
        return err(
          'Link expired or invalid',
          'Request a fresh link from your calendar event or Chief of Staff digest.'
        );
      }
      return CosClosureWebApp._closureMenuPage_(taskId, settings);
    }

    if (!taskId || CosTaskClosureService.OUTCOMES.indexOf(action) < 0) {
      return err('Invalid link', 'This link is incomplete or expired. Use the latest link from your calendar or daily digest.');
    }
    if (!CosClosureLinkService.verifySignature(taskId, action, exp, sig, settings)) {
      return err('Link expired or invalid', 'Request a fresh link from your calendar event description or Chief of Staff digest.');
    }

    var result = CosTaskClosureService.applyClosureOutcome(taskId, action);
    if (!result.ok) {
      var msg =
        result.code === 'too_early'
          ? 'This time block has not ended yet. Try again after the scheduled end.'
          : result.code === 'not_awaiting_closure'
            ? 'This task is no longer waiting for closure (it may already be updated).'
            : result.message || result.code || 'Could not apply this action.';
      return err('No change made', msg);
    }

    var okMsg =
      action === 'done'
        ? 'Marked done.'
        : action === 'reschedule'
          ? 'Put back in the queue — scheduler picks the next free slot (see README / Telegram for next-day defer).'
          : action === 'lower'
            ? 'Priority lowered and put back in the queue.'
            : 'Task dropped.';
    return CosClosureWebApp._page_(true, 'Updated', okMsg, taskId);
  },

  /**
   * @param {boolean} ok
   * @param {string} title
   * @param {string} body
   * @param {string} taskId
   * @returns {GoogleAppsScript.HTML.HtmlOutput}
   * @private
   */
  _page_: function (ok, title, body, taskId) {
    var color = ok ? '#188038' : '#c5221f';
    var html =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Chief of Staff</title></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f8f9fa;padding:24px 16px;">' +
      '<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:12px;padding:22px;">' +
      '<p style="margin:0 0 8px;font-size:18px;font-weight:600;color:' +
      color +
      ';">' +
      CosClosureWebApp._esc_(title) +
      '</p>' +
      '<p style="margin:0;font-size:15px;line-height:1.5;color:#3c4043;">' +
      CosClosureWebApp._esc_(body) +
      '</p>' +
      '<p style="margin:16px 0 0;font-size:12px;color:#80868b;">Chief of Staff</p>' +
      '</div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('Chief of Staff').setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
  },

  /**
   * HTML page with four outcome links (calendar + digest “menu” URL).
   * @param {string} taskId
   * @param {CosSettings} settings
   * @returns {GoogleAppsScript.HTML.HtmlOutput}
   * @private
   */
  _closureMenuPage_: function (taskId, settings) {
    var titleLine = 'Task';
    var ss = CosBootstrap.getSpreadsheetForRun();
    if (ss) {
      try {
        var t = new CosTaskRepository(ss).fetchByTaskId(taskId);
        if (t && String(t.task || '').trim()) {
          titleLine = String(t.task).trim();
        }
      } catch (fetchErr) {
        // Keep generic title if sheet read fails.
      }
    }
    var pairs = [
      ['Done', 'done', '#188038'],
      ['Reschedule', 'reschedule', '#1a73e8'],
      ['Lower priority', 'lower', '#e65100'],
      ['Drop', 'drop', '#5f6368'],
    ];
    var btn = [];
    var i;
    for (i = 0; i < pairs.length; i++) {
      var url = CosClosureLinkService.buildActionUrl(taskId, pairs[i][1], settings);
      btn.push(
        '<a href="' +
          CosClosureLinkService._escAttr_(url) +
          '" style="display:block;margin:10px 0;padding:14px 16px;border-radius:10px;' +
          'text-align:center;text-decoration:none;font-size:16px;font-weight:600;color:#fff !important;' +
          'background:' +
          pairs[i][2] +
          ';">' +
          CosClosureWebApp._esc_(pairs[i][0]) +
          '</a>'
      );
    }
    var html =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Chief of Staff</title></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f8f9fa;padding:24px 16px;">' +
      '<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:12px;padding:22px;">' +
      '<p style="margin:0 0 4px;font-size:12px;color:#80868b;">After this time block ends</p>' +
      '<p style="margin:0 0 16px;font-size:17px;font-weight:600;color:#202124;line-height:1.35;">' +
      CosClosureWebApp._esc_(titleLine.substring(0, 240)) +
      '</p>' +
      '<p style="margin:0 0 8px;font-size:14px;color:#3c4043;">Tap one action:</p>' +
      btn.join('') +
      '<p style="margin:20px 0 0;font-size:12px;color:#80868b;">Chief of Staff</p>' +
      '</div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('Chief of Staff').setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
  },

  /**
   * @param {string} s
   * @returns {string}
   * @private
   */
  _esc_: function (s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },
};
