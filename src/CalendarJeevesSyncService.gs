/**
 * Pulls start/end from Google Calendar into the Tasks sheet for Jeeves-linked rows.
 * If a task was Awaiting Closure but the event was moved so its end is in the future,
 * returns the row to Scheduled and clears closure fields (Telegram prompt can be ignored).
 * If the linked calendar event was deleted or cancelled, marks the task Dropped. Calendar API v3
 * detects real cancellations; API 404 alone does not drop if CalendarApp still resolves the event
 * (avoids false drops right after scheduling or when API calendar id lags).
 */
var CosCalendarJeevesSyncService = {
  /** @const */
  _TIME_TOLERANCE_MS_: 60 * 1000,

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @returns {{ ok: boolean, scanned: number, timeUpdated: number, revertedToScheduled: number, rowsDropped: number, rowsRemoved: number }}
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
        rowsDropped: 0,
        rowsRemoved: 0,
      };
    }
    var settings = new CosSettingsRepository().getSettings();
    var cal = CosCalendarRepository.fromSettings(settings);
    var calApiId = CosCalendarRepository.getAdvancedApiCalendarId(settings);
    var repo = new CosTaskRepository(ss);
    var tasks = repo.fetchAllTasks();
    var prefix = CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX;
    var now = new Date();
    var tol = CosCalendarJeevesSyncService._TIME_TOLERANCE_MS_;
    var scanned = 0;
    var timeUpdated = 0;
    var revertedToScheduled = 0;
    var rowsDropped = 0;
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
      var resolved = CosCalendarRepository.resolveLinkedEventForSync(
        calApiId,
        eid
      );
      if (resolved.kind === 'cancelled') {
        if (repo.markDroppedBecauseLinkedCalendarEventRemoved(t.taskId)) {
          rowsDropped++;
        }
        CosLogger.info('CalendarJeevesSync: linked event cancelled (Calendar API)', {
          taskId: t.taskId,
          calendarEventId: eid,
        });
        continue;
      }

      /** @type {GoogleAppsScript.Calendar.CalendarEvent|null} */
      var evCalHint = null;
      if (resolved.kind === 'missing') {
        evCalHint = cal.getEventByIdIfExists(eid);
        if (!evCalHint) {
          if (repo.markDroppedBecauseLinkedCalendarEventRemoved(t.taskId)) {
            rowsDropped++;
          }
          CosLogger.info('CalendarJeevesSync: linked event missing (API + CalendarApp)', {
            taskId: t.taskId,
            calendarEventId: eid,
          });
          continue;
        }
        CosLogger.info(
          'CalendarJeevesSync: API missing but CalendarApp resolves — syncing times, not dropping',
          {
            taskId: t.taskId,
            calendarEventId: eid,
          }
        );
      }

      var start = null;
      var end = null;
      var title = '';
      if (resolved.kind === 'active') {
        title = String(resolved.resource.summary || '');
        var parsed = CosCalendarRepository.parseEventStartEndFromApiResource_(
          resolved.resource
        );
        start = parsed.start;
        end = parsed.end;
      }

      if (
        !start ||
        !end ||
        isNaN(start.getTime()) ||
        isNaN(end.getTime())
      ) {
        var evFb = evCalHint || cal.getEventByIdIfExists(eid);
        if (!evFb) {
          if (repo.markDroppedBecauseLinkedCalendarEventRemoved(t.taskId)) {
            rowsDropped++;
          }
          CosLogger.info('CalendarJeevesSync: linked event gone (CalendarApp fallback)', {
            taskId: t.taskId,
            calendarEventId: eid,
          });
          continue;
        }
        try {
          title = String(evFb.getTitle() || '');
        } catch (te) {
          title = '';
        }
        try {
          start = evFb.getStartTime();
          end = evFb.getEndTime();
        } catch (te2) {
          start = null;
          end = null;
        }
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
      if (sheetStart && sheetEnd && (!sameStart || !sameEnd)) {
        patch.originalScheduledStart = String(t.scheduledStart || '').trim();
        patch.originalScheduledEnd = String(t.scheduledEnd || '').trim();
      }
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
        if (title.indexOf(prefix) === 0) {
          CosCalendarJeevesSyncService._refreshEventDescriptionIfPossible_(
            cal,
            settings,
            updated,
            eid
          );
        }
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
      rowsDropped: rowsDropped,
      rowsRemoved: rowsDropped,
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
