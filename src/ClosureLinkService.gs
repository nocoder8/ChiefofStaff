/**
 * Signed HTTPS links for task closure (Phase 2). Web app URL + HMAC secret in Script Properties.
 */
var CosClosureLinkService = {
  isConfigured: function (settings) {
    var url = String(settings.closureWebAppUrl || '').trim();
    var sec = String(settings.closureLinkSecret || '').trim();
    return url.length > 8 && sec.length > 8;
  },

  buildActionUrl: function (taskId, action, settings) {
    if (!CosClosureLinkService.isConfigured(settings)) {
      return '';
    }
    var base = String(settings.closureWebAppUrl || '').trim().replace(/\?+$/, '');
    if (base.indexOf('/exec') < 0 && base.indexOf('/dev') < 0) {
      base = base.replace(/\/+$/, '') + '/exec';
    }
    var exp = Math.floor(Date.now() / 1000) + CosConstants.CLOSURE_LINK_TTL_SECONDS;
    var sig = CosClosureLinkService.signPayload(taskId, action, exp, settings);
    var q =
      'taskId=' +
      encodeURIComponent(taskId) +
      '&action=' +
      encodeURIComponent(action) +
      '&exp=' +
      exp +
      '&sig=' +
      encodeURIComponent(sig);
    return base.indexOf('?') >= 0 ? base + '&' + q : base + '?' + q;
  },

  signPayload: function (taskId, action, exp, settings) {
    var secret = String(settings.closureLinkSecret || '').trim();
    var payload = String(taskId) + '|' + String(action).toLowerCase() + '|' + exp;
    var raw = Utilities.computeHmacSha256Signature(payload, secret);
    return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
  },

  verifySignature: function (taskId, action, exp, sig, settings) {
    var nowSec = Math.floor(Date.now() / 1000);
    if (!exp || exp < nowSec) {
      return false;
    }
    if (exp > nowSec + CosConstants.CLOSURE_LINK_TTL_SECONDS + 3600) {
      return false;
    }
    var expected = CosClosureLinkService.signPayload(taskId, action, exp, settings);
    return CosClosureLinkService._safeEq_(String(sig || ''), expected);
  },

  _safeEq_: function (a, b) {
    if (a.length !== b.length) {
      return false;
    }
    var i;
    var out = 0;
    for (i = 0; i < a.length; i++) {
      out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return out === 0;
  },

  /**
   * One signed URL that opens the web app menu (short line in calendar description).
   * @param {string} taskId
   * @param {CosSettings} settings
   * @returns {string}
   */
  buildClosureMenuUrl: function (taskId, settings) {
    if (!CosClosureLinkService.isConfigured(settings)) {
      return '';
    }
    var base = String(settings.closureWebAppUrl || '').trim().replace(/\?+$/, '');
    if (base.indexOf('/exec') < 0 && base.indexOf('/dev') < 0) {
      base = base.replace(/\/+$/, '') + '/exec';
    }
    var menuAct = CosConstants.CLOSURE_SIGN_ACTION_MENU;
    var exp = Math.floor(Date.now() / 1000) + CosConstants.CLOSURE_LINK_TTL_SECONDS;
    var sig = CosClosureLinkService.signPayload(taskId, menuAct, exp, settings);
    var q =
      'cm=1&taskId=' +
      encodeURIComponent(taskId) +
      '&exp=' +
      exp +
      '&sig=' +
      encodeURIComponent(sig);
    return base.indexOf('?') >= 0 ? base + '&' + q : base + '?' + q;
  },

  /**
   * Footer for Jeeves calendar events: one short link → action menu (mobile-friendly).
   * @param {string} taskId
   * @param {CosSettings} settings
   * @returns {string}
   */
  buildCalendarClosureFooter: function (taskId, settings) {
    if (!CosClosureLinkService.isConfigured(settings)) {
      return (
        '\n\n—\nAfter this block ends: Chief of Staff → Process closure queue, ' +
        'then update the task or deploy the closure web app (README).'
      );
    }
    var u = CosClosureLinkService.buildClosureMenuUrl(taskId, settings);
    return (
      '\n\n—\nWhen this time block has ended, open this link once, then tap an action:\n' +
      u +
      '\n\n(Done · Reschedule · Lower priority · Drop)'
    );
  },

  buildCalendarDescription: function (taskId, taskTitle, settings) {
    var head =
      'Jeeves / Chief of Staff\ntaskId=' +
      taskId +
      '\n' +
      (taskTitle ? 'Task: ' + String(taskTitle).substring(0, 200) + '\n' : '') +
      'Managed by Chief of Staff (Google Sheet).';
    return head + CosClosureLinkService.buildCalendarClosureFooter(taskId, settings);
  },

  buildHtmlActionRow: function (taskId, settings) {
    if (!CosClosureLinkService.isConfigured(settings)) {
      return '';
    }
    var url = CosClosureLinkService.buildClosureMenuUrl(taskId, settings);
    return (
      '<div style="margin:8px 0 0;">' +
      '<a href="' +
      CosClosureLinkService._escAttr_(url) +
      '" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff !important;' +
      'text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">' +
      'Choose outcome (Done / Reschedule / Lower / Drop)' +
      '</a></div>'
    );
  },

  _escHtml_: function (s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  _escAttr_: function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  },
};
