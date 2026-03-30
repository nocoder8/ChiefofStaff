/**
 * Schedules Pending tasks into the primary calendar within work hours (Phase 3).
 */
var CosTaskSchedulerService = {
  /** Notes tag: do not schedule before start of this local calendar day (sheet TZ). */
  JEEVES_DEFER_NOTE_RE: /\[Jeeves defer:\d{4}-\d{2}-\d{2}\]/g,

  /**
   * @param {string} notes
   * @returns {string}
   */
  stripJeevesDeferTagsFromNotes_: function (notes) {
    var s = String(notes || '').replace(
      CosTaskSchedulerService.JEEVES_DEFER_NOTE_RE,
      ''
    );
    s = s.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
    return s;
  },

  /**
   * @param {string} notes
   * @param {string} ymd yyyy-MM-dd
   * @returns {string}
   */
  appendJeevesDeferTagToNotes_: function (notes, ymd) {
    var base = CosTaskSchedulerService.stripJeevesDeferTagsFromNotes_(notes);
    var tag = '[Jeeves defer:' + ymd + ']';
    return base ? base + '\n' + tag : tag;
  },

  /**
   * Local calendar date yyyy-MM-dd approx. N×24h from now in IANA tz (N ≥ 1).
   * @param {string} tz
   * @param {number} dayCount 1 = tomorrow, 2 = day after, etc.
   * @returns {string}
   */
  localDateYmdPlusDaysFromNow_: function (tz, dayCount) {
    var z = String(tz || '').trim() || Session.getScriptTimeZone();
    var n = Math.max(1, Math.floor(Number(dayCount)) || 1);
    var ms = new Date().getTime() + n * 24 * 60 * 60 * 1000;
    return Utilities.formatDate(new Date(ms), z, 'yyyy-MM-dd');
  },

  /**
   * Next calendar date (approx. +24h) in IANA tz, yyyy-MM-dd.
   * @param {string} tz
   * @returns {string}
   */
  nextLocalTomorrowYmd_: function (tz) {
    return CosTaskSchedulerService.localDateYmdPlusDaysFromNow_(tz, 1);
  },

  /**
   * @param {string} notes
   * @returns {string|null} yyyy-MM-dd
   */
  extractDeferYmdFromNotes_: function (notes) {
    var m = /\[Jeeves defer:(\d{4}-\d{2}-\d{2})\]/.exec(String(notes || ''));
    return m ? m[1] : null;
  },

  /**
   * Earliest instant that falls on ymd in tz (15-min scan).
   * @param {string} ymd
   * @param {string} tz
   * @returns {Date|null}
   * @private
   */
  _localDayStartForYmdInTz_: function (ymd, tz) {
    var zone = String(tz || '').trim() || Session.getScriptTimeZone();
    var t = new Date().getTime() - 36 * 3600000;
    var end = new Date().getTime() + 400 * 24 * 3600000;
    var step = 15 * 60 * 1000;
    var first = null;
    while (t <= end) {
      if (Utilities.formatDate(new Date(t), zone, 'yyyy-MM-dd') === ymd) {
        first = t;
        break;
      }
      t += step;
    }
    if (first === null) {
      return null;
    }
    while (
      first - step >= 0 &&
      Utilities.formatDate(new Date(first - step), zone, 'yyyy-MM-dd') === ymd
    ) {
      first -= step;
    }
    return new Date(first);
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @returns {CosScheduleBatchResult}
   */
  scheduleAllPending: function (optSs) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(45000)) {
      CosLogger.warn('scheduleAllPending: script lock timeout');
      return {
        ok: false,
        message: 'Lock timeout',
        scheduled: 0,
        skipped: 0,
        failed: 0,
        details: [],
      };
    }
    try {
      var ss = optSs || CosBootstrap.getSpreadsheetForRun();
      if (!ss) {
        return {
          ok: false,
          message: 'No spreadsheet (open the bound Sheet or run Install).',
          scheduled: 0,
          skipped: 0,
          failed: 0,
          details: [],
        };
      }
      return CosTaskSchedulerService._runBatch_(ss);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} taskId
   * @returns {CosScheduleBatchResult}
   */
  scheduleOneById: function (ss, taskId) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(45000)) {
      CosLogger.warn('scheduleOneById: script lock timeout');
      return {
        ok: false,
        message: 'Lock timeout',
        scheduled: 0,
        skipped: 0,
        failed: 0,
        details: [],
      };
    }
    try {
      return CosTaskSchedulerService._runBatch_(ss, String(taskId || '').trim());
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string=} onlyTaskId optional
   * @returns {CosScheduleBatchResult}
   * @private
   */
  _runBatch_: function (ss, onlyTaskId) {
    var details = [];
    var scheduled = 0;
    var skipped = 0;
    var failed = 0;

    try {
      var settings = new CosSettingsRepository().getSettings();
      var tz =
        String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
      var workModel = CosWorkHoursParser.parseModel(settings.workHoursJson);
      var calRepo = CosCalendarRepository.fromSettings(settings);
      var taskRepo = new CosTaskRepository(ss);

      var pending = taskRepo.fetchPendingTasks();
      if (onlyTaskId) {
        pending = pending.filter(function (t) {
          return t.taskId === onlyTaskId;
        });
        if (!pending.length) {
          details.push({
            taskId: onlyTaskId,
            result: 'failed',
            reason: 'not_pending_or_missing',
          });
          failed++;
          return {
            ok: true,
            message: 'Task not found or not Pending.',
            scheduled: 0,
            skipped: 0,
            failed: 1,
            details: details,
          };
        }
      }

      CosTaskSchedulerService._sortPending_(pending);

      var now = new Date();
      var horizonDays = CosConstants.SCHEDULING_HORIZON_DAYS;
      var horizonEnd = cos_addCalendarDays_(now, horizonDays + 1);
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

      CosSchedulingLog.log('batch start', {
        timezone: tz,
        pendingCount: pending.length,
        horizonDays: horizonDays,
        busyIntervalCount: busy.length,
        nowIso: now.toISOString(),
      });
      var qi;
      for (qi = 0; qi < pending.length && CosSchedulingLog.enabled(); qi++) {
        CosSchedulingLog.log('queue order', {
          index: qi,
          taskId: pending[qi].taskId,
          priority: pending[qi].priority,
          deadline: pending[qi].deadline || '',
          title: pending[qi].task,
        });
      }

      var stepMin = CosConstants.SCHEDULING_SLOT_STEP_MINUTES;

      for (var i = 0; i < pending.length; i++) {
        var task = pending[i];
        var one = CosTaskSchedulerService._scheduleSingleTask_(
          task,
          taskRepo,
          calRepo,
          workModel,
          tz,
          now,
          horizonDays,
          stepMin,
          busy
        );
        details.push(one.detail);
        if (one.result === 'scheduled') {
          scheduled++;
          busy.push({
            start: one.slot.start,
            end: one.slot.end,
            id: '',
            title:
              CosConstants.CALENDAR_JEEVES_EVENT_TITLE_PREFIX +
              '(just booked in this batch)',
          });
        } else if (one.result === 'skipped') {
          skipped++;
        } else {
          failed++;
        }
      }

      CosLogger.info('schedule batch complete', {
        scheduled: scheduled,
        skipped: skipped,
        failed: failed,
      });

      var batchResult = {
        ok: true,
        message: 'Done',
        scheduled: scheduled,
        skipped: skipped,
        failed: failed,
        details: details,
      };
      try {
        CosScheduleSummaryEmailService.sendIfNeeded(settings, ss, batchResult);
      } catch (sumErr) {
        CosLogger.warn('schedule summary email hook failed', {
          error: String(sumErr),
        });
      }
      return batchResult;
    } catch (e) {
      CosLogger.error('schedule batch error', { error: String(e) });
      return {
        ok: false,
        message: String(e),
        scheduled: scheduled,
        skipped: skipped,
        failed: failed,
        details: details,
      };
    }
  },

  /**
   * @param {CosTask[]} list
   * @private
   */
  _sortPending_: function (list) {
    list.sort(function (a, b) {
      var da = CosTaskSchedulerService._parseDeadline_(a.deadline);
      var db = CosTaskSchedulerService._parseDeadline_(b.deadline);
      var ta = da ? da.getTime() : Number.POSITIVE_INFINITY;
      var tb = db ? db.getTime() : Number.POSITIVE_INFINITY;
      if (ta !== tb) {
        return ta - tb;
      }
      return (
        CosTaskSchedulerService._priorityRank_(a.priority) -
        CosTaskSchedulerService._priorityRank_(b.priority)
      );
    });
  },

  /**
   * @param {string} p
   * @returns {number}
   * @private
   */
  /**
   * Minimum hours after "now" before a slot may start (by priority label).
   * @param {string} priority
   * @returns {number}
   * @private
   */
  _priorityDelayHours_: function (priority) {
    var raw = String(priority || '').trim();
    var u = raw.toUpperCase();
    if (u === 'P0') {
      return CosConstants.SCHEDULE_PRIORITY_DELAY_HOURS_P0;
    }
    if (u === 'P1') {
      return CosConstants.SCHEDULE_PRIORITY_DELAY_HOURS_P1;
    }
    if (u === 'P2') {
      return CosConstants.SCHEDULE_PRIORITY_DELAY_HOURS_P2;
    }
    if (u === 'P3') {
      return CosConstants.SCHEDULE_PRIORITY_DELAY_HOURS_P3;
    }
    CosSchedulingLog.log('unknown priority; using 0h delay', { priority: raw });
    return 0;
  },

  /**
   * @param {string} priority
   * @returns {boolean}
   * @private
   */
  _isFollowUpPriority_: function (priority) {
    return (
      String(priority || '').trim().toLowerCase() ===
      String(CosConstants.TASK_PRIORITY.FOLLOW_UP).toLowerCase()
    );
  },

  _priorityRank_: function (p) {
    var s = String(p || '').trim();
    if (s === CosConstants.TASK_PRIORITY.P0) {
      return 0;
    }
    if (s === CosConstants.TASK_PRIORITY.P1) {
      return 1;
    }
    if (s === CosConstants.TASK_PRIORITY.P2) {
      return 2;
    }
    if (s === CosConstants.TASK_PRIORITY.P3) {
      return 3;
    }
    if (s === CosConstants.TASK_PRIORITY.FOLLOW_UP) {
      return 4;
    }
    return 9;
  },

  /**
   * @param {string} raw
   * @returns {Date|null}
   * @private
   */
  _parseDeadline_: function (raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    var d = new Date(String(raw).trim());
    if (isNaN(d.getTime())) {
      return null;
    }
    return d;
  },

  /**
   * @param {CosTask} task
   * @param {CosTaskRepository} taskRepo
   * @param {CosCalendarRepository} calRepo
   * @param {CosWorkHoursWeek} workModel
   * @param {string} tz
   * @param {Date} now
   * @param {number} horizonDays
   * @param {number} stepMin
   * @param {{start:Date,end:Date}[]} busy
   * @param {string=} restrictToYmd If set, only search this local yyyy-MM-dd (business-day split).
   * @returns {{ result: string, slot: {start:Date,end:Date}|null, detail: Object }}
   * @private
   */
  _scheduleSingleTask_: function (
    task,
    taskRepo,
    calRepo,
    workModel,
    tz,
    now,
    horizonDays,
    stepMin,
    busy,
    restrictToYmd
  ) {
    var taskId = task.taskId;
    var baseDetail = { taskId: taskId, title: task.task };

    if (task.status !== CosConstants.TASK_STATUS.PENDING) {
      return {
        result: 'skipped',
        slot: null,
        detail: Object.assign({}, baseDetail, {
          result: 'skipped',
          reason: 'not_pending',
        }),
      };
    }

    if (CosTaskSchedulerService._isFollowUpPriority_(task.priority)) {
      CosSchedulingLog.log('skip Follow-up (daily digest only, not calendar)', {
        taskId: taskId,
      });
      return {
        result: 'skipped',
        slot: null,
        detail: Object.assign({}, baseDetail, {
          result: 'skipped',
          reason: 'follow_up_not_scheduled',
        }),
      };
    }

    var dur = CosTaskRepository._parseDurationNumber_(task.durationMin);
    if (dur === null || dur <= 0) {
      CosLogger.warn('skip task: invalid duration', baseDetail);
      return {
        result: 'skipped',
        slot: null,
        detail: Object.assign({}, baseDetail, {
          result: 'skipped',
          reason: 'invalid_duration',
        }),
      };
    }

    var linked = CosTaskSchedulerService._handleExistingEventLink_(
      task,
      taskRepo,
      calRepo
    );
    if (linked.handled) {
      return {
        result: 'skipped',
        slot: null,
        detail: Object.assign({}, baseDetail, linked.detail),
      };
    }

    var deadline = CosTaskSchedulerService._parseDeadline_(task.deadline);
    var delayH = CosTaskSchedulerService._priorityDelayHours_(task.priority);
    var minSlotStart = new Date(now.getTime() + delayH * 3600000);
    var deferYmd = CosTaskSchedulerService.extractDeferYmdFromNotes_(task.notes);
    if (deferYmd) {
      var deferStart = CosTaskSchedulerService._localDayStartForYmdInTz_(
        deferYmd,
        tz
      );
      if (deferStart && !isNaN(deferStart.getTime())) {
        if (deferStart.getTime() > minSlotStart.getTime()) {
          minSlotStart = deferStart;
        }
      }
    }
    CosSchedulingLog.log('earliest allowed slot start', {
      taskId: taskId,
      title: task.task,
      priority: task.priority,
      delayHours: delayH,
      minSlotStartIso: minSlotStart.toISOString(),
      jeevesDeferYmd: deferYmd || '',
      restrictToYmd: restrictToYmd || '',
      deadline: task.deadline || '',
      durationMin: dur,
    });

    var ry = String(restrictToYmd || '').trim();
    var slot =
      ry && /^\d{4}-\d{2}-\d{2}$/.test(ry)
        ? CosTaskSchedulerService._trySlotOnYmd_(
            workModel,
            ry,
            tz,
            stepMin,
            dur,
            busy,
            deadline,
            minSlotStart
          )
        : CosTaskSchedulerService._findEarliestSlot_(
            workModel,
            tz,
            stepMin,
            dur,
            horizonDays,
            now,
            busy,
            deadline,
            minSlotStart
          );

    if (!slot) {
      if (ry) {
        CosSchedulingLog.log('no slot on restricted day', {
          taskId: taskId,
          ymd: ry,
          minSlotStartIso: minSlotStart.toISOString(),
        });
      } else {
        CosSchedulingLog.log('no slot in horizon', {
          taskId: taskId,
          priority: task.priority,
          delayHours: delayH,
          minSlotStartIso: minSlotStart.toISOString(),
        });
      }
      CosLogger.warn('no slot for task', baseDetail);
      return {
        result: 'failed',
        slot: null,
        detail: Object.assign({}, baseDetail, {
          result: 'failed',
          reason: ry ? 'no_slot_on_day' : 'no_slot',
          ymd: ry || undefined,
        }),
      };
    }

    try {
      var ev = calRepo.createTaskEvent(task.task, slot.start, slot.end, taskId);
      var updated = taskRepo.markScheduled(taskId, {
        scheduledStart: ev.getStartTime().toISOString(),
        scheduledEnd: ev.getEndTime().toISOString(),
        calendarEventId: ev.getId(),
      });
      if (!updated) {
        CosLogger.error('markScheduled returned null', baseDetail);
        return {
          result: 'failed',
          slot: slot,
          detail: Object.assign({}, baseDetail, {
            result: 'failed',
            reason: 'sheet_write_failed',
          }),
        };
      }
      CosSchedulingLog.log('slot booked', {
        taskId: taskId,
        priority: task.priority,
        delayHoursApplied: delayH,
        startIso: ev.getStartTime().toISOString(),
        endIso: ev.getEndTime().toISOString(),
        eventId: ev.getId(),
      });
      CosLogger.info('task scheduled', {
        taskId: taskId,
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        eventId: ev.getId(),
      });
      return {
        result: 'scheduled',
        slot: slot,
        detail: Object.assign({}, baseDetail, {
          result: 'scheduled',
          eventId: ev.getId(),
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString(),
        }),
      };
    } catch (e) {
      CosLogger.error('createEvent failed', {
        taskId: taskId,
        error: String(e),
      });
      return {
        result: 'failed',
        slot: slot,
        detail: Object.assign({}, baseDetail, {
          result: 'failed',
          reason: 'calendar_error',
          error: String(e),
        }),
      };
    }
  },

  /**
   * @param {CosTask} task
   * @param {CosTaskRepository} taskRepo
   * @param {CosCalendarRepository} calRepo
   * @returns {{ handled: boolean, detail: Object }}
   * @private
   */
  _handleExistingEventLink_: function (task, taskRepo, calRepo) {
    var id = String(task.calendarEventId || '').trim();
    if (!id) {
      return { handled: false, detail: {} };
    }

    var ev = calRepo.getEventByIdIfExists(id);
    if (ev) {
      var tol = CosConstants.SCHEDULE_TIME_MATCH_TOLERANCE_MS;
      var sheetOk =
        CosTaskSchedulerService._sheetTimesMatchEvent_(task, ev, tol);
      if (sheetOk) {
        return {
          handled: true,
          detail: {
            result: 'skipped',
            reason: 'already_scheduled_same_window',
            eventId: id,
          },
        };
      }
      taskRepo.updateTask(task.taskId, {
        status: CosConstants.TASK_STATUS.SCHEDULED,
        scheduledStart: ev.getStartTime().toISOString(),
        scheduledEnd: ev.getEndTime().toISOString(),
        calendarEventId: ev.getId(),
      });
      return {
        handled: true,
        detail: {
          result: 'skipped',
          reason: 'repaired_sheet_from_calendar',
          eventId: ev.getId(),
        },
      };
    }

    taskRepo.updateTask(task.taskId, {
      calendarEventId: '',
      scheduledStart: '',
      scheduledEnd: '',
    });
    return {
      handled: false,
      detail: { result: 'cleared_stale_event_id' },
    };
  },

  /**
   * @param {CosTask} task
   * @param {GoogleAppsScript.Calendar.CalendarEvent} ev
   * @param {number} tolMs
   * @returns {boolean}
   * @private
   */
  _sheetTimesMatchEvent_: function (task, ev, tolMs) {
    var s = new Date(String(task.scheduledStart || '').trim());
    var e = new Date(String(task.scheduledEnd || '').trim());
    if (isNaN(s.getTime()) || isNaN(e.getTime())) {
      return false;
    }
    return (
      Math.abs(s.getTime() - ev.getStartTime().getTime()) <= tolMs &&
      Math.abs(e.getTime() - ev.getEndTime().getTime()) <= tolMs
    );
  },

  /**
   * First grid slot on ymd (same order as _findEarliestSlot_) that passes min/deadline filters
   * and collides with busy; used only for verbose diagnostics.
   * @param {CosWorkHoursWeek} workModel
   * @param {string} ymd
   * @param {string} dayKey
   * @param {string} tz
   * @param {number} stepMin
   * @param {number} durationMin
   * @param {Date} minSlotStart
   * @param {Date|null} deadline
   * @param {{start:Date,end:Date,id?:string,title?:string}[]} busy
   * @returns {{ ymd: string, slotLocal: string, durationMin: number, collidesWith: Object }|null}
   * @private
   */
  _firstCollisionSampleForDay_: function (
    workModel,
    ymd,
    dayKey,
    tz,
    stepMin,
    durationMin,
    minSlotStart,
    deadline,
    busy
  ) {
    var blocks = CosWorkHoursParser.blocksForDay(workModel, dayKey);
    var bi;
    for (bi = 0; bi < blocks.length; bi++) {
      var blk = blocks[bi];
      var cs = CosWorkHoursParser.parseClock(blk.start);
      var ce = CosWorkHoursParser.parseClock(blk.end);
      if (!cs || !ce) {
        continue;
      }
      var blockStart = cos_combineDateAndTime_(
        ymd,
        cos_pad2_(cs.h) + ':' + cos_pad2_(cs.m),
        tz
      );
      var blockEnd = cos_combineDateAndTime_(
        ymd,
        cos_pad2_(ce.h) + ':' + cos_pad2_(ce.m),
        tz
      );
      if (blockEnd.getTime() <= blockStart.getTime()) {
        continue;
      }
      var t;
      for (
        t = new Date(blockStart.getTime());
        t.getTime() < blockEnd.getTime();
        t = cos_addMinutes_(t, stepMin)
      ) {
        var slotEnd = cos_addMinutes_(t, durationMin);
        if (slotEnd.getTime() > blockEnd.getTime()) {
          break;
        }
        if (t.getTime() < minSlotStart.getTime() - 60000) {
          continue;
        }
        if (deadline && slotEnd.getTime() > deadline.getTime()) {
          continue;
        }
        if (!cos_rangeCollidesBusy_(t, slotEnd, busy)) {
          return null;
        }
        var c = cos_firstBusyCollider_(t, slotEnd, busy);
        return {
          ymd: ymd,
          slotLocal: Utilities.formatDate(t, tz, 'yyyy-MM-dd HH:mm'),
          durationMin: durationMin,
          collidesWith: c,
        };
      }
    }
    return null;
  },

  /**
   * First viable slot on a single local calendar day (work hours + busy + min start + deadline).
   * @param {CosWorkHoursWeek} workModel
   * @param {string} ymd yyyy-MM-dd
   * @param {string} tz
   * @param {number} stepMin
   * @param {number} durationMin
   * @param {{start:Date,end:Date,id?:string,title?:string}[]} busy
   * @param {Date|null} deadline
   * @param {Date} minSlotStart
   * @returns {{start:Date,end:Date}|null}
   * @private
   */
  _trySlotOnYmd_: function (
    workModel,
    ymd,
    tz,
    stepMin,
    durationMin,
    busy,
    deadline,
    minSlotStart
  ) {
    var dayProbe = Utilities.parseDate(ymd + ' 12:00', tz, 'yyyy-MM-dd HH:mm');
    var dayKey = CosWorkHoursParser.dayKeyForDate(dayProbe, tz);
    var blocks = CosWorkHoursParser.blocksForDay(workModel, dayKey);
    var verboseDay = CosSchedulingLog.enabled();
    /** @type {{ ymd: string, dayKey: string, viable: number, busyRejections: number }|null} */
    var dayStat = null;
    if (verboseDay && blocks.length > 0) {
      dayStat = {
        ymd: ymd,
        dayKey: dayKey,
        viable: 0,
        busyRejections: 0,
      };
    }

    var bi;
    for (bi = 0; bi < blocks.length; bi++) {
      var blk = blocks[bi];
      var cs = CosWorkHoursParser.parseClock(blk.start);
      var ce = CosWorkHoursParser.parseClock(blk.end);
      if (!cs || !ce) {
        continue;
      }
      var blockStart = cos_combineDateAndTime_(
        ymd,
        cos_pad2_(cs.h) + ':' + cos_pad2_(cs.m),
        tz
      );
      var blockEnd = cos_combineDateAndTime_(
        ymd,
        cos_pad2_(ce.h) + ':' + cos_pad2_(ce.m),
        tz
      );
      if (blockEnd.getTime() <= blockStart.getTime()) {
        continue;
      }

      var t;
      for (
        t = new Date(blockStart.getTime());
        t.getTime() < blockEnd.getTime();
        t = cos_addMinutes_(t, stepMin)
      ) {
        var slotEnd = cos_addMinutes_(t, durationMin);
        if (slotEnd.getTime() > blockEnd.getTime()) {
          break;
        }
        if (t.getTime() < minSlotStart.getTime() - 60000) {
          continue;
        }
        if (deadline && slotEnd.getTime() > deadline.getTime()) {
          continue;
        }
        if (dayStat) {
          dayStat.viable++;
        }
        if (!cos_rangeCollidesBusy_(t, slotEnd, busy)) {
          if (dayStat) {
            CosSchedulingLog.log('slot found', {
              ymd: ymd,
              dayKey: dayKey,
              localStart: Utilities.formatDate(t, tz, 'yyyy-MM-dd HH:mm'),
              durationMin: durationMin,
              viableGridStartsToday: dayStat.viable,
              busyRejectionsBeforePick: dayStat.busyRejections,
            });
          }
          return { start: t, end: slotEnd };
        }
        if (dayStat) {
          dayStat.busyRejections++;
        }
      }
    }

    if (dayStat) {
      if (dayStat.viable === 0) {
        CosSchedulingLog.log('work day skipped (no grid start passes min time + deadline)', {
          ymd: dayStat.ymd,
          dayKey: dayStat.dayKey,
          durationMin: durationMin,
          minSlotLocal: Utilities.formatDate(minSlotStart, tz, 'yyyy-MM-dd HH:mm'),
        });
      } else {
        CosSchedulingLog.log(
          'work day exhausted (every viable slot collides with calendar)',
          {
            ymd: dayStat.ymd,
            dayKey: dayStat.dayKey,
            durationMin: durationMin,
            viableGridStarts: dayStat.viable,
            busyRejections: dayStat.busyRejections,
          }
        );
        var sample = CosTaskSchedulerService._firstCollisionSampleForDay_(
          workModel,
          dayStat.ymd,
          dayStat.dayKey,
          tz,
          stepMin,
          durationMin,
          minSlotStart,
          deadline,
          busy
        );
        if (sample && sample.collidesWith) {
          CosSchedulingLog.log(
            'exhausted day: first viable slot blocked by (primary calendar event)',
            sample
          );
        }
      }
    }
    return null;
  },

  /**
   * @param {CosWorkHoursWeek} workModel
   * @param {string} tz
   * @param {number} stepMin
   * @param {number} durationMin
   * @param {number} horizonDays
   * @param {Date} now
   * @param {{start:Date,end:Date,id?:string,title?:string}[]} busy
   * @param {Date|null} deadline
   * @param {Date} minSlotStart  Earliest instant a slot may begin (priority delay).
   * @returns {{start:Date,end:Date}|null}
   * @private
   */
  _findEarliestSlot_: function (
    workModel,
    tz,
    stepMin,
    durationMin,
    horizonDays,
    now,
    busy,
    deadline,
    minSlotStart
  ) {
    var startYmd = cos_formatYmd_(now, tz);
    var dayOffset;
    for (dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
      var ymd = cos_ymdAddCalendarDays_(startYmd, dayOffset, tz);
      var slot = CosTaskSchedulerService._trySlotOnYmd_(
        workModel,
        ymd,
        tz,
        stepMin,
        durationMin,
        busy,
        deadline,
        minSlotStart
      );
      if (slot) {
        return slot;
      }
    }
    return null;
  },

  /**
   * Schedule one Pending task on a specific local date (Telegram business-day split).
   * Mutates busy in place when scheduling succeeds (same batch semantics as _runBatch_).
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} taskId
   * @param {string} localYmd yyyy-MM-dd
   * @param {{start:Date,end:Date,id?:string,title?:string}[]} busy
   * @returns {{ result: string, slot?: {start:Date,end:Date}, detail: Object }}
   */
  schedulePendingTaskOnLocalYmd: function (ss, taskId, localYmd, busy) {
    var id = String(taskId || '').trim();
    var ymd = String(localYmd || '').trim();
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return {
        result: 'failed',
        detail: { taskId: id, result: 'failed', reason: 'bad_args' },
      };
    }
    var settings = new CosSettingsRepository().getSettings();
    var tz =
      String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
    var workModel = CosWorkHoursParser.parseModel(settings.workHoursJson);
    var calRepo = CosCalendarRepository.fromSettings(settings);
    var taskRepo = new CosTaskRepository(ss);
    var task = taskRepo.fetchByTaskId(id);
    if (!task) {
      return {
        result: 'failed',
        detail: { taskId: id, result: 'failed', reason: 'not_found' },
      };
    }
    var now = new Date();
    var horizonDays = CosConstants.SCHEDULING_HORIZON_DAYS;
    var one = CosTaskSchedulerService._scheduleSingleTask_(
      task,
      taskRepo,
      calRepo,
      workModel,
      tz,
      now,
      horizonDays,
      CosConstants.SCHEDULING_SLOT_STEP_MINUTES,
      busy,
      ymd
    );
    return {
      result: one.result,
      slot: one.slot || undefined,
      detail: one.detail,
    };
  },
};

/**
 * @param {Date} slotStart
 * @param {Date} slotEnd
 * @param {{start:Date,end:Date}[]} busy
 * @returns {boolean} true if collides
 */
function cos_rangeCollidesBusy_(slotStart, slotEnd, busy) {
  return cos_firstBusyCollider_(slotStart, slotEnd, busy) !== null;
}

/**
 * @param {Date} slotStart
 * @param {Date} slotEnd
 * @param {{start:Date,end:Date,title?:string,id?:string}[]} busy
 * @returns {{title:string,startIso:string,endIso:string,id:string}|null}
 */
function cos_firstBusyCollider_(slotStart, slotEnd, busy) {
  var tol = CosConstants.SCHEDULING_BUSY_BOUNDARY_TOLERANCE_MS || 0;
  var s = slotStart.getTime();
  var e = slotEnd.getTime();
  var i;
  for (i = 0; i < busy.length; i++) {
    var b = busy[i];
    var bs = b.start.getTime() + tol;
    var be = b.end.getTime() - tol;
    if (be <= bs) {
      continue;
    }
    if (e > bs && be > s) {
      return {
        title: String((b.title != null && b.title) || '(no title)'),
        startIso: b.start.toISOString(),
        endIso: b.end.toISOString(),
        id: String((b.id != null && b.id) || ''),
      };
    }
  }
  return null;
}

/**
 * @param {number} n
 * @returns {string}
 */
function cos_pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}
