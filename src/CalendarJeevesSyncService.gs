/**
 * Pulls start/end from Google Calendar into the Tasks sheet for Jeeves-linked rows.
 * If a task was Awaiting Closure but the event was moved so its end is in the future,
 * returns the row to Scheduled and clears closure fields (Telegram prompt can be ignored).
 */
var CosCalendarJeevesSyncService = {
  /** @const */
  _TIME_TOLERANCE_MS_: 60 * 1000,

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @returns {{ ok: boolean, scanned: number, timeUpdated: number, revertedToScheduled: number }}
   */
  syncJeevesEventsFromCalendar: function (optSs) {
    var ss = optSs || CosBootstrap.getSpreadsheetForRun();
    if (!ss) {
      CosLogger.warn('CalendarJeevesSync: no spreadsheet');
      return {
        ok: false,
        scanned: 0,
        timeUpdated: 0,
        revertedToScheduled: 0,
      };
    }
    var settings = new CosSettingsRepository().getSettings();
    var cal = CosCalendarRepository.fromSettings(settings);
    var repo = new CosTaskRepository(ss);
    var tasks = repo.fetchAllTasks();
    var prefix = CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX;
    var now = new Date();
    var tol = CosCalendarJeevesSyncService._TIME_TOLERANCE_MS_;
    var scanned = 0;
    var timeUpdated = 0;
    var revertedToScheduled = 0;
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var st = String(t.status || '').trim();
      if (
        st !== CosConstants.TASK_STATUS.SCHEDULED &&
        st !== CosConstants.TASK_STATUS.AWAITING_CLOSURE
      ) {
        continue;
      }
      var eid = String(t.calendarEventId || '').trim();
      if (!eid) {
        continue;
      }
      scanned++;
      var ev = cal.getEventByIdIfExists(eid);
      if (!ev) {
        CosLogger.warn('CalendarJeevesSync: event not found', {
          taskId: t.taskId,
          calendarEventId: eid,
        });
        continue;
      }
      var title = '';
      try {
        title = String(ev.getTitle() || '');
      } catch (te) {
        title = '';
      }
      if (title.indexOf(prefix) !== 0) {
        continue;
      }
      var start;
      var end;
      try {
        start = ev.getStartTime();
        end = ev.getEndTime();
      } catch (te2) {
        continue;
      }
      if (
        !start ||
        !end ||
        isNaN(start.getTime()) ||
        isNaN(end.getTime())
      ) {
        continue;
      }
      var sheetStart = CosCalendarJeevesSyncService._parseIso_(t.scheduledStart);
      var sheetEnd = CosCalendarJeevesSyncService._parseIso_(t.scheduledEnd);
      var sameStart =
        sheetStart &&
        Math.abs(sheetStart.getTime() - start.getTime()) <= tol;
      var sameEnd =
        sheetEnd && Math.abs(sheetEnd.getTime() - end.getTime()) <= tol;
      if (sameStart && sameEnd) {
        continue;
      }
      var startIso = start.toISOString();
      var endIso = end.toISOString();
      var patch = {
        scheduledStart: startIso,
        scheduledEnd: endIso,
      };
      var revert =
        st === CosConstants.TASK_STATUS.AWAITING_CLOSURE &&
        end.getTime() > now.getTime();
      if (revert) {
        patch.status = CosConstants.TASK_STATUS.SCHEDULED;
        patch.closureStatus = '';
        patch.closureRequestedAt = '';
        patch.missCount = '0';
        patch.lastOutcome = '';
        revertedToScheduled++;
      }
      var updated = repo.updateTask(t.taskId, patch);
      if (updated) {
        timeUpdated++;
        CosCalendarJeevesSyncService._refreshEventDescriptionIfPossible_(
          cal,
          settings,
          updated,
          eid
        );
        CosLogger.info('CalendarJeevesSync: updated row from calendar', {
          taskId: t.taskId,
          revertedToScheduled: revert,
        });
      }
    }
    return {
      ok: true,
      scanned: scanned,
      timeUpdated: timeUpdated,
      revertedToScheduled: revertedToScheduled,
    };
  },

  /**
   * @param {CosCalendarRepository} cal
   * @param {CosSettings} settings
   * @param {CosTask} task
   * @param {string} eventId
   * @private
   */
  _refreshEventDescriptionIfPossible_: function (cal, settings, task, eventId) {
    if (!CosClosureLinkService.isConfigured(settings)) {
      return;
    }
    try {
      var desc = CosClosureLinkService.buildCalendarDescription(
        task.taskId,
        task.task,
        settings
      );
      cal.setEventDescriptionIfExists(eventId, desc);
    } catch (err) {
      CosLogger.warn('CalendarJeevesSync: setDescription failed', {
        taskId: task.taskId,
        error: String(err),
      });
    }
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
