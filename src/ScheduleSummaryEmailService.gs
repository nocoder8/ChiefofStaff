/**
 * Phase 6: after a scheduling run, send one email if at least one task was booked.
 */
var CosScheduleSummaryEmailService = {
  /**
   * @param {CosSettings} settings
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {CosScheduleBatchResult} batchResult
   */
  sendIfNeeded: function (settings, ss, batchResult) {
    if (!batchResult || !batchResult.ok || batchResult.scheduled <= 0) {
      return;
    }
    if (!settings.scheduleSummaryEmailEnabled) {
      return;
    }
    var to = String(settings.userEmail || '').trim();
    if (!to) {
      to = String(Session.getActiveUser().getEmail() || '').trim();
    }
    if (!to) {
      CosLogger.warn('schedule summary email: no recipient');
      return;
    }
    var tz =
      String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
    var booked = batchResult.details.filter(function (d) {
      return d && d.result === 'scheduled';
    });
    if (!booked.length) {
      return;
    }

    var n = booked.length;
    var subject =
      '[' +
      CosConstants.PRODUCT_NAME +
      '] Jeeves scheduled ' +
      n +
      ' task' +
      (n === 1 ? '' : 's');
    var plain = CosScheduleSummaryEmailService._buildPlain_(
      booked,
      tz,
      batchResult,
      ss
    );
    var html = CosScheduleSummaryEmailService._buildHtml_(
      booked,
      tz,
      batchResult,
      ss
    );

    try {
      GmailApp.sendEmail(to, subject, plain, {
        htmlBody: html,
        name: CosConstants.PRODUCT_NAME,
      });
      CosLogger.info('schedule summary email sent', { to: to, count: n });
    } catch (e) {
      CosLogger.warn('schedule summary email failed', { error: String(e) });
    }
  },

  /**
   * @param {Object[]} booked
   * @param {string} tz
   * @param {CosScheduleBatchResult} batchResult
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @returns {string}
   * @private
   */
  _buildPlain_: function (booked, tz, batchResult, ss) {
    var lines = [];
    lines.push(
      'Jeeves added ' +
        booked.length +
        ' task(s) to your calendar (' +
        tz +
        ').'
    );
    lines.push(
      'Skipped: ' +
        batchResult.skipped +
        ' · Failed: ' +
        batchResult.failed
    );
    lines.push('');
    var i;
    for (i = 0; i < booked.length; i++) {
      lines.push('• ' + CosScheduleSummaryEmailService._linePlain_(booked[i], tz));
    }
    lines.push('');
    lines.push('Tasks sheet: ' + ss.getUrl());
    lines.push('');
    lines.push('— ' + CosConstants.PRODUCT_NAME);
    return lines.join('\n');
  },

  /**
   * @param {Object} d
   * @param {string} tz
   * @returns {string}
   * @private
   */
  _formatRange_: function (d, tz) {
    var s = CosScheduleSummaryEmailService._parseIso_(d.start);
    var e = CosScheduleSummaryEmailService._parseIso_(d.end);
    var fmt = 'EEE, MMM d, yyyy h:mm a';
    var ts = s ? Utilities.formatDate(s, tz, fmt) : '?';
    var te = e ? Utilities.formatDate(e, tz, fmt) : '?';
    return ts + ' – ' + te;
  },

  /**
   * @param {Object} d
   * @param {string} tz
   * @returns {string}
   * @private
   */
  _linePlain_: function (d, tz) {
    var title = String(d.title || d.taskId || '(task)');
    return title + ' — ' + CosScheduleSummaryEmailService._formatRange_(d, tz);
  },

  /**
   * @param {Object[]} booked
   * @param {string} tz
   * @param {CosScheduleBatchResult} batchResult
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @returns {string}
   * @private
   */
  _buildHtml_: function (booked, tz, batchResult, ss) {
    var parts = [];
    parts.push(
      '<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;color:#333;">Jeeves added <b>' +
        booked.length +
        '</b> task(s) to your calendar (<span style="color:#666;">' +
        CosScheduleSummaryEmailService._esc_(tz) +
        '</span>).</p>'
    );
    parts.push(
      '<p style="margin:0 0 12px;font-family:sans-serif;font-size:13px;color:#666;">Skipped: ' +
        batchResult.skipped +
        ' · Failed: ' +
        batchResult.failed +
        '</p>'
    );
    parts.push(
      '<ul style="margin:0;padding-left:20px;font-family:sans-serif;font-size:13px;color:#333;">'
    );
    var i;
    for (i = 0; i < booked.length; i++) {
      parts.push(
        '<li style="margin:6px 0;"><b>' +
          CosScheduleSummaryEmailService._esc_(String(booked[i].title || '')) +
          '</b><br/><span style="color:#666;">' +
          CosScheduleSummaryEmailService._esc_(
            CosScheduleSummaryEmailService._formatRange_(booked[i], tz)
          ) +
          '</span></li>'
      );
    }
    parts.push('</ul>');
    parts.push(
      '<p style="margin:16px 0 0;font-family:sans-serif;font-size:13px;"><a href="' +
        CosScheduleSummaryEmailService._esc_(ss.getUrl()) +
        '">Open Tasks sheet</a></p>'
    );
    parts.push(
      '<p style="margin:16px 0 0;font-family:sans-serif;font-size:12px;color:#999;">— ' +
        CosScheduleSummaryEmailService._esc_(CosConstants.PRODUCT_NAME) +
        '</p>'
    );
    return parts.join('');
  },

  /**
   * @param {string} raw
   * @returns {Date|null}
   * @private
   */
  _parseIso_: function (raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    var d = new Date(String(raw).trim());
    return isNaN(d.getTime()) ? null : d;
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
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
