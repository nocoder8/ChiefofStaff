/**
 * Task closure engine (Phase 1): move elapsed scheduled work into Awaiting Closure,
 * apply outcomes (done / reschedule / lower / drop) without opening the sheet UI.
 * Idempotent; uses TaskRepository document lock on writes.
 */
var CosTaskClosureService = {
  /** @type {readonly string[]} */
  OUTCOMES: Object.freeze(['done', 'reschedule', 'lower', 'drop']),

  /**
   * Moves Scheduled tasks whose window has ended into Awaiting Closure (once each).
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @returns {{ ok: boolean, transitioned: number, skipped: number, message?: string }}
   */
  processElapsedScheduledIntoClosure: function (optSs) {
    var ss = optSs || CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      return {
        ok: false,
        transitioned: 0,
        skipped: 0,
        message: 'No spreadsheet',
      };
    }
    var repo = new CosTaskRepository(ss);
    var now = new Date();
    var tasks = repo.fetchAllTasks();
    var transitioned = 0;
    var skipped = 0;
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (String(t.status || '').trim() !== CosConstants.TASK_STATUS.SCHEDULED) {
        skipped++;
        continue;
      }
      var end = CosTaskClosureService._parseIso_(t.scheduledEnd);
      if (!end || isNaN(end.getTime())) {
        skipped++;
        continue;
      }
      if (end.getTime() > now.getTime()) {
        skipped++;
        continue;
      }
      var r = CosTaskClosureService._tryTransitionToAwaiting_(repo, t);
      if (r === 'transitioned') {
        transitioned++;
      } else {
        skipped++;
      }
    }
    CosLogger.info('processElapsedScheduledIntoClosure', {
      transitioned: transitioned,
      skipped: skipped,
    });
    return { ok: true, transitioned: transitioned, skipped: skipped };
  },

  /**
   * Applies a closure outcome for a task that is (or was) in the closure flow.
   * Idempotent for repeated identical success paths.
   * @param {string} taskId
   * @param {string} action done | reschedule | lower | drop
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @param {{ rescheduleDeferDaysFromToday?: number }=} optExtras  Telegram: defer first slot to local day +N (1=tomorrow…).
   * @returns {{ ok: boolean, task?: CosTask, code?: string, message?: string }}
   */
  applyClosureOutcome: function (taskId, action, optSs, optExtras) {
    var id = String(taskId || '').trim();
    var act = String(action || '').trim().toLowerCase();
    if (!id) {
      return { ok: false, code: 'bad_id', message: 'Missing task id' };
    }
    if (CosTaskClosureService.OUTCOMES.indexOf(act) < 0) {
      return { ok: false, code: 'bad_action', message: 'Invalid action' };
    }
    var ss = optSs || CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      return { ok: false, code: 'no_sheet', message: 'No spreadsheet' };
    }
    var repo = new CosTaskRepository(ss);
    var task = repo.fetchByTaskId(id);
    if (!task) {
      return { ok: false, code: 'not_found', message: 'Task not found' };
    }

    if (act === 'done') {
      var stDone = String(task.status || '').trim();
      if (stDone === CosConstants.TASK_STATUS.DONE) {
        var lo0 = String(task.lastOutcome || '').trim();
        if (lo0 === CosConstants.TASK_LAST_OUTCOME.DONE) {
          return { ok: true, task: task, code: 'idempotent' };
        }
      }
    }

    var elig = CosTaskClosureService._ensureAwaitingOrEligible_(repo, task);
    if (!elig.ok) {
      return {
        ok: false,
        code: elig.code || 'not_awaiting_closure',
        message: elig.message || 'Task is not ready for this action',
      };
    }
    task = elig.task;

    if (act === 'done') {
      return CosTaskClosureService._applyDone_(repo, task);
    }
    if (act === 'reschedule') {
      return CosTaskClosureService._applyReschedule_(repo, task, optExtras);
    }
    if (act === 'lower') {
      return CosTaskClosureService._applyLower_(repo, task);
    }
    return CosTaskClosureService._applyDrop_(repo, task);
  },

  /**
   * Phase 3: auto-reschedule rows stuck in Awaiting Closure past grace hours.
   * P0 uses CosConstants.CLOSURE_RECOVERY_GRACE_HOURS_P0; other priorities use script property.
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @returns {{ ok: boolean, recovered: number, skipped?: boolean }}
   */
  runStaleClosureRecovery: function (optSs) {
    var ss = optSs || CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      return { ok: false, recovered: 0 };
    }
    var settings = new CosSettingsRepository().getSettings();
    if (!settings.closureRecoveryRescheduleStale) {
      return { ok: true, recovered: 0, skipped: true };
    }
    var graceNonP0 = settings.closureRecoveryGraceHours;
    if (!graceNonP0 || graceNonP0 < 1) {
      graceNonP0 = 48;
    }
    var graceP0 = CosConstants.CLOSURE_RECOVERY_GRACE_HOURS_P0;
    if (!graceP0 || graceP0 < 1) {
      graceP0 = 6;
    }
    var repo = new CosTaskRepository(ss);
    var tasks = repo.fetchAllTasks();
    var now = new Date();
    var recovered = 0;
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (String(t.status || '').trim() !== CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
        continue;
      }
      var cr = CosTaskClosureService._parseIso_(t.closureRequestedAt);
      if (!cr || isNaN(cr.getTime())) {
        continue;
      }
      var hours = (now.getTime() - cr.getTime()) / 3600000;
      var pr = String(t.priority || '').trim();
      var effectiveGrace =
        pr === CosConstants.TASK_PRIORITY.P0 ? graceP0 : graceNonP0;
      if (hours < effectiveGrace) {
        continue;
      }
      var r = CosTaskClosureService._applyReschedule_(repo, t);
      if (r.ok) {
        recovered++;
      }
    }
    if (recovered) {
      CosLogger.info('runStaleClosureRecovery', { recovered: recovered });
    }
    return { ok: true, recovered: recovered };
  },

  /**
   * @param {CosTaskRepository} repo
   * @param {CosTask} task
   * @returns {{ ok: boolean, task?: CosTask, code?: string, message?: string }}
   * @private
   */
  _ensureAwaitingOrEligible_: function (repo, task) {
    var st = String(task.status || '').trim();
    if (st === CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return { ok: true, task: task };
    }
    if (st !== CosConstants.TASK_STATUS.SCHEDULED) {
      return {
        ok: false,
        code: 'not_awaiting_closure',
        message: 'Task is not awaiting closure',
      };
    }
    var end = CosTaskClosureService._parseIso_(task.scheduledEnd);
    var now = new Date();
    if (!end || isNaN(end.getTime()) || now.getTime() < end.getTime()) {
      return {
        ok: false,
        code: 'too_early',
        message: 'Scheduled block has not ended yet.',
      };
    }
    CosTaskClosureService._tryTransitionToAwaiting_(repo, task);
    var t2 = repo.fetchByTaskId(task.taskId);
    if (
      !t2 ||
      String(t2.status || '').trim() !== CosConstants.TASK_STATUS.AWAITING_CLOSURE
    ) {
      return {
        ok: false,
        code: 'transition_failed',
        message: 'Could not enter closure state',
      };
    }
    CosTaskClosureService._refreshCalendarDescriptionIfPossible_(t2);
    return { ok: true, task: t2 };
  },

  /**
   * @param {CosTask} task
   * @private
   */
  _refreshCalendarDescriptionIfPossible_: function (task) {
    var eid = String(task.calendarEventId || '').trim();
    if (!eid) {
      return;
    }
    var settings = new CosSettingsRepository().getSettings();
    if (!CosClosureLinkService.isConfigured(settings)) {
      return;
    }
    try {
      var cal = CosCalendarRepository.fromSettings(settings);
      var desc = CosClosureLinkService.buildCalendarDescription(
        task.taskId,
        task.task,
        settings
      );
      cal.setEventDescriptionIfExists(eid, desc);
    } catch (err) {
      CosLogger.warn('refreshCalendarDescriptionIfPossible', {
        taskId: task.taskId,
        error: String(err),
      });
    }
  },

  /**
   * Increments Miss Count only while status is Awaiting Closure (Phase 3 nudges).
   * @param {string} taskId
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @returns {{ ok: boolean, task?: CosTask, code?: string }}
   */
  bumpMissCount: function (taskId, optSs) {
    var id = String(taskId || '').trim();
    if (!id) {
      return { ok: false, code: 'bad_id' };
    }
    var ss = optSs || CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      return { ok: false, code: 'no_sheet' };
    }
    var repo = new CosTaskRepository(ss);
    var task = repo.fetchByTaskId(id);
    if (!task) {
      return { ok: false, code: 'not_found' };
    }
    if (String(task.status || '').trim() !== CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return { ok: false, code: 'wrong_status' };
    }
    var n = CosTaskClosureService._parseMissCount_(task.missCount);
    var next = repo.updateTask(id, {
      missCount: String(n + 1),
      lastNudgeAt: new Date().toISOString(),
    });
    return next ? { ok: true, task: next } : { ok: false, code: 'update_failed' };
  },

  /**
   * @param {CosTaskRepository} repo
   * @param {CosTask} t
   * @returns {'transitioned'|'skipped'}
   * @private
   */
  _tryTransitionToAwaiting_: function (repo, t) {
    var st = String(t.status || '').trim();
    if (st === CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return 'skipped';
    }
    if (st !== CosConstants.TASK_STATUS.SCHEDULED) {
      return 'skipped';
    }
    var nowIso = new Date().toISOString();
    var updated = repo.updateTask(t.taskId, {
      status: CosConstants.TASK_STATUS.AWAITING_CLOSURE,
      closureStatus: CosConstants.TASK_CLOSURE_STATUS.AWAITING,
      closureRequestedAt: nowIso,
      missCount: '0',
    });
    if (updated) {
      CosTaskClosureService._refreshCalendarDescriptionIfPossible_(updated);
      try {
        CosTelegramService.notifyAwaitingClosure_(updated);
      } catch (tgErr) {
        CosLogger.warn('Telegram notifyAwaitingClosure failed', {
          taskId: updated.taskId,
          error: String(tgErr),
        });
      }
      return 'transitioned';
    }
    return 'skipped';
  },

  /**
   * @param {CosTaskRepository} repo
   * @param {CosTask} task
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @private
   */
  _applyDone_: function (repo, task) {
    var st = String(task.status || '').trim();
    if (st !== CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return {
        ok: false,
        code: 'not_awaiting_closure',
        message: 'Task is not awaiting closure',
      };
    }
    var nowIso = new Date().toISOString();
    var cal = CosCalendarRepository.fromSettings(
      new CosSettingsRepository().getSettings()
    );
    CosTaskClosureService._deleteCalendarIfLinked_(cal, task);
    var updated = repo.updateTask(task.taskId, {
      status: CosConstants.TASK_STATUS.DONE,
      lastOutcome: CosConstants.TASK_LAST_OUTCOME.DONE,
      completionTimestamp: nowIso,
      completedAt: nowIso,
      finalStatus: CosConstants.TASK_ANALYTICS_FINAL_STATUS.DONE,
      closureType: CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.DONE,
      closureStatus: CosConstants.TASK_CLOSURE_STATUS.RESOLVED,
      scheduledStart: '',
      scheduledEnd: '',
      originalScheduledStart: '',
      originalScheduledEnd: '',
      calendarEventId: '',
    });
    return updated
      ? { ok: true, task: updated }
      : { ok: false, code: 'update_failed' };
  },

  /**
   * @param {CosTaskRepository} repo
   * @param {CosTask} task
   * @param {{ rescheduleDeferDaysFromToday?: number }=} optExtras
   * @private
   */
  _applyReschedule_: function (repo, task, optExtras) {
    if (String(task.status || '').trim() !== CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return {
        ok: false,
        code: 'not_awaiting_closure',
        message: 'Task is not awaiting closure',
      };
    }
    var cal = CosCalendarRepository.fromSettings(
      new CosSettingsRepository().getSettings()
    );
    CosTaskClosureService._deleteCalendarIfLinked_(cal, task);
    var notes = String(task.notes || '');
    notes = CosTaskSchedulerService.stripJeevesDeferTagsFromNotes_(notes);
    var deferDays = 0;
    if (
      optExtras &&
      typeof optExtras.rescheduleDeferDaysFromToday === 'number'
    ) {
      var d = Math.floor(optExtras.rescheduleDeferDaysFromToday);
      if (d >= 1 && d <= 3) {
        deferDays = d;
      }
    }
    if (deferDays >= 1) {
      var tz =
        String(repo._ss.getSpreadsheetTimeZone() || '').trim() ||
        String(new CosSettingsRepository().getSettings().timezone || '').trim() ||
        Session.getScriptTimeZone();
      var ymd = CosTaskSchedulerService.localDateYmdPlusDaysFromNow_(
        tz,
        deferDays
      );
      notes = CosTaskSchedulerService.appendJeevesDeferTagToNotes_(notes, ymd);
    }
    var rc = CosTaskClosureService._parseRescheduleCount_(task.rescheduleCount);
    var hadSlot =
      String(task.scheduledStart || '').trim() &&
      String(task.scheduledEnd || '').trim();
    var updated = repo.updateTask(task.taskId, {
      status: CosConstants.TASK_STATUS.PENDING,
      lastOutcome: CosConstants.TASK_LAST_OUTCOME.RESCHEDULED,
      closureType: CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.RESCHEDULE,
      rescheduleCount: String(rc + 1),
      closureStatus: '',
      closureRequestedAt: '',
      originalScheduledStart: hadSlot ? task.scheduledStart : '',
      originalScheduledEnd: hadSlot ? task.scheduledEnd : '',
      scheduledStart: '',
      scheduledEnd: '',
      calendarEventId: '',
      notes: notes,
    });
    return updated
      ? { ok: true, task: updated }
      : { ok: false, code: 'update_failed' };
  },

  /**
   * @param {CosTaskRepository} repo
   * @param {CosTask} task
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @private
   */
  _applyLower_: function (repo, task) {
    if (String(task.status || '').trim() !== CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return {
        ok: false,
        code: 'not_awaiting_closure',
        message: 'Task is not awaiting closure',
      };
    }
    var cal = CosCalendarRepository.fromSettings(
      new CosSettingsRepository().getSettings()
    );
    CosTaskClosureService._deleteCalendarIfLinked_(cal, task);
    var newPri = CosTaskClosureService._lowerPriority_(task.priority);
    var updated = repo.updateTask(task.taskId, {
      status: CosConstants.TASK_STATUS.PENDING,
      priority: newPri,
      lastOutcome: CosConstants.TASK_LAST_OUTCOME.LOWERED,
      closureType: CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.LOWER,
      closureStatus: '',
      closureRequestedAt: '',
      scheduledStart: '',
      scheduledEnd: '',
      originalScheduledStart: '',
      originalScheduledEnd: '',
      calendarEventId: '',
    });
    return updated
      ? { ok: true, task: updated }
      : { ok: false, code: 'update_failed' };
  },

  /**
   * @param {CosTaskRepository} repo
   * @param {CosTask} task
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @private
   */
  _applyDrop_: function (repo, task) {
    if (String(task.status || '').trim() !== CosConstants.TASK_STATUS.AWAITING_CLOSURE) {
      return {
        ok: false,
        code: 'not_awaiting_closure',
        message: 'Task is not awaiting closure',
      };
    }
    var cal = CosCalendarRepository.fromSettings(
      new CosSettingsRepository().getSettings()
    );
    CosTaskClosureService._deleteCalendarIfLinked_(cal, task);
    var updated = repo.updateTask(task.taskId, {
      status: CosConstants.TASK_STATUS.DROPPED,
      lastOutcome: CosConstants.TASK_LAST_OUTCOME.DROPPED,
      finalStatus: CosConstants.TASK_ANALYTICS_FINAL_STATUS.DROPPED,
      closureType: CosConstants.TASK_ANALYTICS_CLOSURE_TYPE.DROP,
      closureStatus: CosConstants.TASK_CLOSURE_STATUS.RESOLVED,
      scheduledStart: '',
      scheduledEnd: '',
      originalScheduledStart: '',
      originalScheduledEnd: '',
      calendarEventId: '',
    });
    return updated
      ? { ok: true, task: updated }
      : { ok: false, code: 'update_failed' };
  },

  /**
   * @param {CosCalendarRepository} cal
   * @param {CosTask} task
   * @private
   */
  _deleteCalendarIfLinked_: function (cal, task) {
    var eid = String(task.calendarEventId || '').trim();
    if (!eid) {
      return;
    }
    try {
      cal.deleteEventByIdIfExists(eid);
    } catch (err) {
      CosLogger.warn('Closure: calendar delete failed', {
        taskId: task.taskId,
        error: String(err),
      });
    }
  },

  /**
   * @param {string} priority
   * @returns {string}
   * @private
   */
  _lowerPriority_: function (priority) {
    var p = String(priority || '').trim();
    if (p === CosConstants.TASK_PRIORITY.P0) {
      return CosConstants.TASK_PRIORITY.P1;
    }
    if (p === CosConstants.TASK_PRIORITY.P1) {
      return CosConstants.TASK_PRIORITY.P2;
    }
    if (p === CosConstants.TASK_PRIORITY.P2) {
      return CosConstants.TASK_PRIORITY.P3;
    }
    return p || CosConstants.TASK_PRIORITY.P3;
  },

  /**
   * @param {string} raw
   * @returns {number}
   * @private
   */
  _parseMissCount_: function (raw) {
    var n = parseInt(String(raw || '0').trim(), 10);
    return isNaN(n) || n < 0 ? 0 : n;
  },

  /**
   * @param {string} raw
   * @returns {number}
   * @private
   */
  _parseRescheduleCount_: function (raw) {
    var n = parseInt(String(raw || '0').trim(), 10);
    return isNaN(n) || n < 0 ? 0 : n;
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
};
