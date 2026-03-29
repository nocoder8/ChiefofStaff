/**
 * Phase 6 (Project Plan): operational health — spreadsheet, Tasks schema, properties,
 * calendar, Gmail labels (when enabled), and time triggers vs settings.
 */
var CosHealthCheckService = {
  /**
   * @returns {CosHealthCheckResult}
   */
  run: function () {
    var items = [];
    var ss = CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      items.push({
        id: 'spreadsheet',
        status: 'fail',
        message:
          'No spreadsheet: open the bound Sheet from Drive, or set BOUND_SPREADSHEET_ID and run Install.',
      });
      return CosHealthCheckService._finalize_(items);
    }

    items.push({
      id: 'spreadsheet',
      status: 'pass',
      message: 'Spreadsheet reachable: ' + ss.getName(),
      detail: { spreadsheetId: ss.getId() },
    });

    var props = PropertiesService.getScriptProperties();
    var boundId = props.getProperty(CosConstants.PROP_KEYS.BOUND_SPREADSHEET_ID);
    if (!String(boundId || '').trim()) {
      items.push({
        id: 'bound_spreadsheet_id',
        status: 'warn',
        message:
          'BOUND_SPREADSHEET_ID is empty — time triggers may fail without an open sheet. Run Install.',
      });
    } else if (String(boundId).trim() !== ss.getId()) {
      items.push({
        id: 'bound_spreadsheet_id',
        status: 'warn',
        message:
          'BOUND_SPREADSHEET_ID does not match active spreadsheet id (triggers use bound id).',
        detail: { bound: boundId, active: ss.getId() },
      });
    } else {
      items.push({
        id: 'bound_spreadsheet_id',
        status: 'pass',
        message: 'BOUND_SPREADSHEET_ID matches this spreadsheet.',
      });
    }

    var settings;
    try {
      settings = new CosSettingsRepository().getSettings();
      items.push({
        id: 'settings',
        status: 'pass',
        message: 'Script settings load OK.',
        detail: {
          timezone: settings.timezone || '(default: sheet)',
          emailTasksEnabled: settings.emailTasksEnabled,
          dailyDigestEnabled: settings.dailyDigestEnabled,
          schedulePendingTriggerEnabled: settings.schedulePendingTriggerEnabled,
        },
      });
    } catch (se) {
      items.push({
        id: 'settings',
        status: 'fail',
        message: 'Failed to read settings: ' + String(se.message || se),
      });
      return CosHealthCheckService._finalize_(items);
    }

    if (String(settings.installedAtIso || '').trim()) {
      items.push({
        id: 'install_metadata',
        status: 'pass',
        message: 'Install metadata present.',
        detail: {
          installedAtIso: settings.installedAtIso,
          installVersion: settings.installVersion || '',
        },
      });
    } else {
      items.push({
        id: 'install_metadata',
        status: 'warn',
        message: 'INSTALLED_AT_ISO missing — run Install / Repair once.',
      });
    }

    var email =
      String(settings.userEmail || '').trim() ||
      String(Session.getActiveUser().getEmail() || '').trim();
    if (!email) {
      items.push({
        id: 'user_email',
        status: 'warn',
        message:
          'USER_EMAIL is empty and no active user email — digests / summaries may have no recipient.',
      });
    } else {
      items.push({
        id: 'user_email',
        status: 'pass',
        message: 'Recipient email available: ' + email,
      });
    }

    var taskRepo = new CosTaskRepository(ss);
    var v = taskRepo.validateSheet();
    if (!v.ok) {
      items.push({
        id: 'tasks_sheet',
        status: 'fail',
        message: 'Tasks sheet validation failed.',
        detail: { messages: v.messages },
      });
    } else {
      items.push({
        id: 'tasks_sheet',
        status: 'pass',
        message: 'Tasks sheet exists and headers look valid.',
      });
    }

    try {
      var calRepo = CosCalendarRepository.fromSettings(settings);
      var desc = calRepo.describeCalendar();
      items.push({
        id: 'calendar',
        status: 'pass',
        message: 'Primary calendar: ' + desc,
      });
    } catch (ce) {
      items.push({
        id: 'calendar',
        status: 'fail',
        message: 'Calendar access failed: ' + String(ce.message || ce),
      });
    }

    if (settings.emailTasksEnabled) {
      try {
        var procName = String(settings.gmailLabelProcessed || '').trim();
        var errName = String(settings.gmailLabelError || '').trim();
        var procLabel = procName ? GmailApp.getUserLabelByName(procName) : null;
        var errLabel = errName ? GmailApp.getUserLabelByName(errName) : null;
        var missing = [];
        if (!procLabel) {
          missing.push(procName || '(processed label name empty)');
        }
        if (!errLabel) {
          missing.push(errName || '(error label name empty)');
        }
        if (missing.length) {
          items.push({
            id: 'gmail_labels',
            status: 'warn',
            message:
              'EMAIL_TASKS_ENABLED is true but required label(s) are missing — run “Create / repair Gmail labels”.',
            detail: { missing: missing },
          });
        } else {
          items.push({
            id: 'gmail_labels',
            status: 'pass',
            message: 'Gmail processed/error labels found.',
            detail: { processed: procName, error: errName },
          });
        }
      } catch (ge) {
        items.push({
          id: 'gmail_labels',
          status: 'warn',
          message:
            'Gmail not available (authorize Gmail or disable EMAIL_TASKS_ENABLED): ' +
            String(ge.message || ge),
        });
      }
    } else {
      items.push({
        id: 'gmail_labels',
        status: 'pass',
        message: 'Gmail ingestion disabled — label check skipped.',
      });
    }

    CosHealthCheckService._checkTriggers_(items, settings);

    return CosHealthCheckService._finalize_(items);
  },

  /**
   * @param {CosHealthCheckItem[]} items
   * @param {CosSettings} settings
   * @private
   */
  _checkTriggers_: function (items, settings) {
    var gmailN = CosHealthCheckService._triggerCount_(
      CosTriggerService.HANDLER_GMAIL
    );
    var schedN = CosHealthCheckService._triggerCount_(
      CosTriggerService.HANDLER_SCHEDULE
    );
    var digestN = CosHealthCheckService._triggerCount_(
      CosTriggerService.HANDLER_DIGEST
    );

    CosHealthCheckService._expectTrigger_(
      items,
      'trigger_gmail',
      settings.emailTasksEnabled,
      gmailN,
      CosTriggerService.HANDLER_GMAIL
    );
    CosHealthCheckService._expectTrigger_(
      items,
      'trigger_schedule_pending',
      settings.schedulePendingTriggerEnabled,
      schedN,
      CosTriggerService.HANDLER_SCHEDULE
    );
    CosHealthCheckService._expectTrigger_(
      items,
      'trigger_daily_digest',
      settings.dailyDigestEnabled,
      digestN,
      CosTriggerService.HANDLER_DIGEST
    );

    if (gmailN > 1 || schedN > 1 || digestN > 1) {
      items.push({
        id: 'trigger_duplicates',
        status: 'warn',
        message:
          'Duplicate time trigger(s) detected for the same handler — run “Sync time triggers”.',
        detail: { gmail: gmailN, schedule: schedN, digest: digestN },
      });
    }
  },

  /**
   * @param {CosHealthCheckItem[]} items
   * @param {string} id
   * @param {boolean} want
   * @param {number} count
   * @param {string} handler
   * @private
   */
  _expectTrigger_: function (items, id, want, count, handler) {
    if (!want) {
      if (count === 0) {
        items.push({
          id: id,
          status: 'pass',
          message: 'No trigger for ' + handler + ' (disabled in settings).',
        });
      } else {
        items.push({
          id: id,
          status: 'warn',
          message:
            'Trigger still installed for ' +
            handler +
            ' but setting is off — run “Sync time triggers” to remove.',
          detail: { handler: handler, count: count },
        });
      }
      return;
    }
    if (count === 1) {
      items.push({
        id: id,
        status: 'pass',
        message: 'Time trigger present: ' + handler,
      });
      return;
    }
    if (count === 0) {
      items.push({
        id: id,
        status: 'warn',
        message:
          'Setting expects a time trigger for ' +
          handler +
          ' but none found — run “Sync time triggers”.',
        detail: { handler: handler },
      });
      return;
    }
    items.push({
      id: id,
      status: 'warn',
      message: 'Multiple triggers for ' + handler + ' (count=' + count + ').',
      detail: { handler: handler, count: count },
    });
  },

  /**
   * @param {string} handlerName
   * @returns {number}
   * @private
   */
  _triggerCount_: function (handlerName) {
    var n = 0;
    var all = ScriptApp.getProjectTriggers();
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i].getHandlerFunction() === handlerName) {
        n++;
      }
    }
    return n;
  },

  /**
   * @param {CosHealthCheckItem[]} items
   * @returns {CosHealthCheckResult}
   * @private
   */
  _finalize_: function (items) {
    var pass = 0;
    var warn = 0;
    var fail = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      var st = items[i].status;
      if (st === 'fail') {
        fail++;
      } else if (st === 'warn') {
        warn++;
      } else {
        pass++;
      }
    }
    var ok = fail === 0;
    var summaryLine =
      (ok ? 'OK' : 'FAILED') +
      ' — ' +
      pass +
      ' passed, ' +
      warn +
      ' warn, ' +
      fail +
      ' fail';
    return {
      ok: ok,
      items: items,
      passCount: pass,
      warnCount: warn,
      failCount: fail,
      summaryLine: summaryLine,
    };
  },
};
