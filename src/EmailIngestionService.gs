/**
 * Gmail → Tasks: threads under Jeeves task/follow-up labels (via GmailLabel.getThreads).
 * Does not rely on GmailApp.search, so bracketed names like [Jeeves]/follow-up work reliably.
 */
var CosEmailIngestionService = {
  /** @type {readonly string[]} */
  _JEEVES_PRIORITY_: Object.freeze([
    '[Jeeves]/P0',
    '[Jeeves]/P1',
    '[Jeeves]/P2',
  ]),

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} optSs
   * @param {{ force?: boolean }} [opts] force=true runs even when EMAIL_TASKS_ENABLED is false (menu).
   * @returns {{ ok: boolean, message?: string, scanned: number, created: number, skipped: number, failed: number, details: Object[] }}
   */
  processInbox: function (optSs, opts) {
    var force = opts && opts.force === true;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(45000)) {
      CosLogger.warn('processInbox: script lock timeout');
      return {
        ok: false,
        message: 'Lock timeout',
        scanned: 0,
        created: 0,
        skipped: 0,
        failed: 0,
        details: [],
      };
    }
    try {
      var settings = new CosSettingsRepository().getSettings();
      if (!force && !settings.emailTasksEnabled) {
        CosLogger.info('processInbox: EMAIL_TASKS_ENABLED is false (use menu to run anyway)');
        return {
          ok: true,
          message: 'Email ingestion disabled in script properties.',
          scanned: 0,
          created: 0,
          skipped: 0,
          failed: 0,
          details: [],
        };
      }

      var ss = optSs || CosBootstrap.getSpreadsheetForRun();
      if (!ss) {
        return {
          ok: false,
          message: 'No spreadsheet (open the bound Sheet or run Install).',
          scanned: 0,
          created: 0,
          skipped: 0,
          failed: 0,
          details: [],
        };
      }

      var processedName = String(settings.gmailLabelProcessed || '').trim();
      var errorName = String(settings.gmailLabelError || '').trim();
      var processedLabel = processedName
        ? GmailApp.getUserLabelByName(processedName)
        : null;
      var errorLabel = errorName ? GmailApp.getUserLabelByName(errorName) : null;
      if (!processedLabel || !errorLabel) {
        CosGmailLabelService.ensureJeevesLabels();
        processedLabel = processedName
          ? GmailApp.getUserLabelByName(processedName)
          : null;
        errorLabel = errorName ? GmailApp.getUserLabelByName(errorName) : null;
      }
      if (!processedLabel || !errorLabel) {
        return {
          ok: false,
          message:
            'Missing Gmail labels for processed/error — run “Create / repair Gmail labels”.',
          scanned: 0,
          created: 0,
          skipped: 0,
          failed: 0,
          details: [],
        };
      }

      var maxThreads = CosConstants.GMAIL_INGEST_MAX_THREADS;
      var threads = CosEmailIngestionService._collectThreadsForIngest_(
        processedName,
        maxThreads
      );
      CosLogger.info('processInbox (label-based)', {
        threadCount: threads.length,
        maxThreads: maxThreads,
        savedQueryNote:
          'GMAIL_TASK_QUERY is not used for ingest; threads come from Jeeves task/follow-up labels.',
      });

      var taskRepo = new CosTaskRepository(ss);
      var existingByThread = CosEmailIngestionService._emailTasksBySourceRef_(
        taskRepo
      );

      var created = 0;
      var skipped = 0;
      var failed = 0;
      /** @type {Object[]} */
      var details = [];

      for (var i = 0; i < threads.length; i++) {
        var thread = threads[i];
        var threadId = thread.getId();
        var d = CosEmailIngestionService._processOneThread_(
          thread,
          threadId,
          existingByThread,
          taskRepo,
          processedLabel,
          errorLabel,
          ss,
          settings
        );
        details.push(d);
        if (d.result === 'created') {
          created++;
        } else if (d.result === 'skipped') {
          skipped++;
        } else {
          failed++;
        }
      }

      if (settings.emailTaskAutoSchedule && created > 0) {
        CosTaskSchedulerService.scheduleAllPending(ss);
      }

      return {
        ok: true,
        scanned: threads.length,
        created: created,
        skipped: skipped,
        failed: failed,
        details: details,
      };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Union threads from each ingest label, dedupe, drop threads already marked processed.
   * @param {string} processedName
   * @param {number} maxThreads
   * @returns {GoogleAppsScript.Gmail.GmailThread[]}
   * @private
   */
  _collectThreadsForIngest_: function (processedName, maxThreads) {
    var labelNames = CosEmailIngestionService._uniqueLabelNamesForIngest_();
    /** @type {Object<string, boolean>} */
    var seenThread = {};
    /** @type {*[]} */
    var candidates = [];
    var i;
    var j;
    for (i = 0; i < labelNames.length; i++) {
      var lab = GmailApp.getUserLabelByName(labelNames[i]);
      if (!lab) {
        continue;
      }
      var batch = lab.getThreads(0, maxThreads);
      for (j = 0; j < batch.length; j++) {
        candidates.push(batch[j]);
      }
    }
    /** @type {GoogleAppsScript.Gmail.GmailThread[]} */
    var out = [];
    for (i = 0; i < candidates.length && out.length < maxThreads; i++) {
      var t = candidates[i];
      var id = t.getId();
      if (seenThread[id]) {
        continue;
      }
      seenThread[id] = true;
      if (
        processedName &&
        CosEmailIngestionService._threadHasLabelName_(t, processedName)
      ) {
        continue;
      }
      out.push(t);
    }
    return out;
  },

  /**
   * @returns {string[]}
   * @private
   */
  _uniqueLabelNamesForIngest_: function () {
    var a = CosConstants.GMAIL_TASK_TYPE_LABEL_NAMES;
    var b = CosConstants.GMAIL_FOLLOW_UP_TYPE_LABEL_NAMES;
    /** @type {Object<string, boolean>} */
    var seen = {};
    /** @type {string[]} */
    var out = [];
    var i;
    for (i = 0; i < a.length; i++) {
      if (!seen[a[i]]) {
        seen[a[i]] = true;
        out.push(a[i]);
      }
    }
    for (i = 0; i < b.length; i++) {
      if (!seen[b[i]]) {
        seen[b[i]] = true;
        out.push(b[i]);
      }
    }
    return out;
  },

  /**
   * @param {*} thread
   * @param {string} name
   * @returns {boolean}
   * @private
   */
  _threadHasLabelName_: function (thread, name) {
    var labels = thread.getLabels();
    var n = String(name);
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].getName() === n) {
        return true;
      }
    }
    return false;
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {CosSettings} settings
   * @returns {string|undefined} ISO end-of-day or omit
   * @private
   */
  _defaultDeadlineForEmail_: function (ss, settings) {
    var n = CosConstants.DEFAULT_EMAIL_TASK_DEADLINE_DAYS_FROM_NOW;
    if (!n || n < 1) {
      return undefined;
    }
    var tz =
      String(settings.timezone || '').trim() || ss.getSpreadsheetTimeZone();
    var startYmd = cos_formatYmd_(new Date(), tz);
    var endYmd = cos_ymdAddCalendarDays_(startYmd, n, tz);
    var endLocal = Utilities.parseDate(
      endYmd + ' 23:59',
      tz,
      'yyyy-MM-dd HH:mm'
    );
    return endLocal.toISOString();
  },

  /**
   * GmailThread has no getSnippet() in Apps Script; use latest message plain body.
   * @param {*} thread
   * @returns {string}
   * @private
   */
  _threadSnippet_: function (thread) {
    try {
      var msgs = thread.getMessages();
      if (!msgs || msgs.length === 0) {
        return '';
      }
      var m = msgs[msgs.length - 1];
      var plain = m.getPlainBody();
      if (!plain) {
        plain = m.getBody() || '';
      }
      plain = String(plain)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (plain.length > 400) {
        return plain.substring(0, 397) + '...';
      }
      return plain;
    } catch (e) {
      return '';
    }
  },

  /**
   * @param {Object<string, boolean>} nameSet
   * @param {readonly string[]} names
   * @returns {boolean}
   * @private
   */
  _nameSetHasAny_: function (nameSet, names) {
    for (var n = 0; n < names.length; n++) {
      if (nameSet[names[n]]) {
        return true;
      }
    }
    return false;
  },

  /**
   * @param {CosTaskRepository} taskRepo
   * @returns {Object<string, CosTask>}
   * @private
   */
  _emailTasksBySourceRef_: function (taskRepo) {
    var map = {};
    var all = taskRepo.fetchAllTasks();
    var email = CosConstants.TASK_SOURCE.EMAIL;
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (t.source === email && t.sourceRef) {
        map[String(t.sourceRef).trim()] = t;
      }
    }
    return map;
  },

  /**
   * @param {Object<string, boolean>} nameSet
   * @returns {number}
   * @private
   */
  _durationFromLabels_: function (nameSet) {
    var pairs = CosConstants.GMAIL_DURATION_LABEL_MINUTES;
    var best = null;
    for (var i = 0; i < pairs.length; i++) {
      if (nameSet[pairs[i][0]]) {
        var m = pairs[i][1];
        if (best === null || m > best) {
          best = m;
        }
      }
    }
    return best !== null ? best : CosConstants.DEFAULT_TASK_DURATION_MINUTES;
  },

  /**
   * @param {*} thread
   * @param {string} threadId
   * @param {Object<string, CosTask>} existingByThread
   * @param {CosTaskRepository} taskRepo
   * @param {*} processedLabel
   * @param {*} errorLabel
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {CosSettings} settings
   * @returns {{ threadId: string, result: string, reason?: string }}
   * @private
   */
  _processOneThread_: function (
    thread,
    threadId,
    existingByThread,
    taskRepo,
    processedLabel,
    errorLabel,
    ss,
    settings
  ) {
    var labels = thread.getLabels();
    var nameSet = {};
    for (var i = 0; i < labels.length; i++) {
      nameSet[labels[i].getName()] = true;
    }

    var hasTask = CosEmailIngestionService._nameSetHasAny_(
      nameSet,
      CosConstants.GMAIL_TASK_TYPE_LABEL_NAMES
    );
    var hasFup = CosEmailIngestionService._nameSetHasAny_(
      nameSet,
      CosConstants.GMAIL_FOLLOW_UP_TYPE_LABEL_NAMES
    );
    if (hasTask && hasFup) {
      CosEmailIngestionService._removeErrApplyErr_(
        thread,
        errorLabel,
        processedLabel
      );
      return {
        threadId: threadId,
        result: 'failed',
        reason: 'both_task_and_followup',
      };
    }
    if (!hasTask && !hasFup) {
      return { threadId: threadId, result: 'skipped', reason: 'no_jeeves_type' };
    }

    if (existingByThread[threadId]) {
      CosEmailIngestionService._ensureProcessedClearErr_(
        thread,
        processedLabel,
        errorLabel
      );
      return { threadId: threadId, result: 'skipped', reason: 'already_in_sheet' };
    }

    var priority;
    if (hasFup) {
      priority = CosConstants.TASK_PRIORITY.FOLLOW_UP;
    } else {
      priority = CosConstants.TASK_PRIORITY.P2;
      var pr = CosEmailIngestionService._JEEVES_PRIORITY_;
      for (var p = 0; p < pr.length; p++) {
        if (nameSet[pr[p]]) {
          if (pr[p] === '[Jeeves]/P0') {
            priority = CosConstants.TASK_PRIORITY.P0;
          } else if (pr[p] === '[Jeeves]/P1') {
            priority = CosConstants.TASK_PRIORITY.P1;
          } else {
            priority = CosConstants.TASK_PRIORITY.P2;
          }
          break;
        }
      }
    }

    var durationMin = CosEmailIngestionService._durationFromLabels_(nameSet);
    var subject = thread.getFirstMessageSubject() || '(no subject)';
    var snippet = CosEmailIngestionService._threadSnippet_(thread);

    try {
      var createPayload = {
        task: subject,
        priority: priority,
        durationMin: durationMin,
        source: CosConstants.TASK_SOURCE.EMAIL,
        sourceRef: threadId,
        notes: snippet ? snippet : '',
      };
      var autoDl = CosEmailIngestionService._defaultDeadlineForEmail_(ss, settings);
      if (autoDl) {
        createPayload.deadline = autoDl;
      }
      taskRepo.createTask(createPayload);
      CosEmailIngestionService._ensureProcessedClearErr_(
        thread,
        processedLabel,
        errorLabel
      );
      CosLogger.info('Gmail thread ingested', { threadId: threadId });
      return { threadId: threadId, result: 'created' };
    } catch (e) {
      CosEmailIngestionService._removeErrApplyErr_(
        thread,
        errorLabel,
        processedLabel
      );
      CosLogger.error('Gmail ingest failed for thread', {
        threadId: threadId,
        error: String(e),
      });
      return {
        threadId: threadId,
        result: 'failed',
        reason: String(e.message || e),
      };
    }
  },

  /**
   * @param {*} thread
   * @param {*} processedLabel
   * @param {*} errorLabel
   * @private
   */
  _ensureProcessedClearErr_: function (thread, processedLabel, errorLabel) {
    var labels = thread.getLabels();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].getName() === errorLabel.getName()) {
        thread.removeLabel(errorLabel);
        break;
      }
    }
    thread.addLabel(processedLabel);
  },

  /**
   * @param {*} thread
   * @param {*} errorLabel
   * @param {*} processedLabel
   * @private
   */
  _removeErrApplyErr_: function (thread, errorLabel, processedLabel) {
    var labels = thread.getLabels();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].getName() === processedLabel.getName()) {
        thread.removeLabel(processedLabel);
        break;
      }
    }
    thread.addLabel(errorLabel);
  },
};
