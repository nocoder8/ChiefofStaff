/**
 * Gmail → Tasks: threads under Jeeves task/follow-up labels (via GmailLabel.getThreads).
 * Does not rely on GmailApp.search, so bracketed names like [Jeeves]/follow-up work reliably.
 * [Jeeves]/ok is ignored during collection unless the thread has no sheet row (stale ok) or the
 * row is an Email task being upgraded to Follow-up from Gmail labels.
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
   * @returns {{ ok: boolean, message?: string, scanned: number, created: number, upgraded: number, skipped: number, failed: number, details: Object[] }}
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
        upgraded: 0,
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
          upgraded: 0,
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
          upgraded: 0,
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
          upgraded: 0,
          skipped: 0,
          failed: 0,
          details: [],
        };
      }

      var taskRepo = new CosTaskRepository(ss);
      var existingByThread = CosEmailIngestionService._gmailIngestMapBySourceRefKey_(
        taskRepo
      );

      var maxThreads = CosConstants.GMAIL_INGEST_MAX_THREADS;
      var threads = CosEmailIngestionService._collectThreadsForIngest_(
        processedName,
        maxThreads,
        existingByThread
      );
      CosLogger.info('processInbox (label-based)', {
        threadCount: threads.length,
        maxThreads: maxThreads,
        savedQueryNote:
          'GMAIL_TASK_QUERY is not used for ingest; threads come from Jeeves task/follow-up labels.',
      });

      var created = 0;
      var upgraded = 0;
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
          if (d.task) {
            existingByThread[
              String(threadId).trim().toLowerCase()
            ] = d.task;
          }
        } else if (d.result === 'updated') {
          upgraded++;
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
        upgraded: upgraded,
        skipped: skipped,
        failed: failed,
        details: details,
      };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Sheet row for this Gmail thread should become Follow-up (same thread id, labels changed).
   * @param {*} thread
   * @param {CosTask|null|undefined} existing
   * @returns {boolean}
   * @private
   */
  _emailIngestFollowUpUpgrade_: function (thread, existing) {
    if (!existing) {
      return false;
    }
    if (String(existing.source || '').trim() !== CosConstants.TASK_SOURCE.EMAIL) {
      return false;
    }
    var st = String(existing.status || '').trim();
    if (
      st === CosConstants.TASK_STATUS.DONE ||
      st === CosConstants.TASK_STATUS.DROPPED
    ) {
      return false;
    }
    if (
      String(existing.priority || '').trim() === CosConstants.TASK_PRIORITY.FOLLOW_UP
    ) {
      return false;
    }
    var labels = thread.getLabels();
    var nameSet = {};
    var i;
    for (i = 0; i < labels.length; i++) {
      nameSet[labels[i].getName()] = true;
    }
    return CosEmailIngestionService._nameSetHasAny_(
      nameSet,
      CosConstants.GMAIL_FOLLOW_UP_TYPE_LABEL_NAMES
    );
  },

  /**
   * Skip in collect when [Jeeves]/ok means “done” — unless ok is stale (no row) or row needs follow-up upgrade.
   * @param {*} thread
   * @param {string} processedName
   * @param {Object<string, CosTask>} existingByThread
   * @returns {boolean}
   * @private
   */
  _processedOkBlocksCollect_: function (thread, processedName, existingByThread) {
    if (!processedName) {
      return false;
    }
    if (!CosEmailIngestionService._threadHasLabelName_(thread, processedName)) {
      return false;
    }
    var id = String(thread.getId()).trim().toLowerCase();
    var ex = existingByThread && existingByThread[id];
    if (!ex) {
      return false;
    }
    if (
      String(ex.source || '').trim() === CosConstants.TASK_SOURCE.EMAIL &&
      CosEmailIngestionService._emailIngestFollowUpUpgrade_(thread, ex)
    ) {
      return false;
    }
    return true;
  },

  /**
   * Threads from a set of label names: dedupe by id, paginate each label, filter [Jeeves]/ok vs sheet.
   * @param {readonly string[]} labelNames
   * @param {string} processedName
   * @param {number} maxThreads max to return after filters
   * @param {boolean=} newestFirst if false (follow-ups), stale threads ingest before active ones
   * @param {Object<string, CosTask>=} existingByThread
   * @returns {GoogleAppsScript.Gmail.GmailThread[]}
   * @private
   */
  _threadsFromLabelNames_: function (
    labelNames,
    processedName,
    maxThreads,
    newestFirst,
    existingByThread
  ) {
    var preferNew = newestFirst !== false;
    var scanCap = CosConstants.GMAIL_INGEST_MAX_LABEL_SCAN;
    var pageSize = 50;
    /** @type {Object<string, GoogleAppsScript.Gmail.GmailThread>} */
    var byId = {};
    var i;
    var j;
    for (i = 0; i < labelNames.length; i++) {
      var lab = GmailApp.getUserLabelByName(labelNames[i]);
      if (!lab) {
        continue;
      }
      var start = 0;
      var pulledForLabel = 0;
      while (pulledForLabel < scanCap) {
        var want = Math.min(pageSize, scanCap - pulledForLabel);
        var batch = lab.getThreads(start, want);
        if (!batch || batch.length === 0) {
          break;
        }
        for (j = 0; j < batch.length; j++) {
          byId[batch[j].getId()] = batch[j];
        }
        pulledForLabel += batch.length;
        start += batch.length;
        if (batch.length < want) {
          break;
        }
      }
    }
    /** @type {GoogleAppsScript.Gmail.GmailThread[]} */
    var arr = [];
    for (var id in byId) {
      if (Object.prototype.hasOwnProperty.call(byId, id)) {
        arr.push(byId[id]);
      }
    }
    arr.sort(function (a, b) {
      try {
        var ta = a.getLastMessageDate().getTime();
        var tb = b.getLastMessageDate().getTime();
        return preferNew ? tb - ta : ta - tb;
      } catch (e) {
        return 0;
      }
    });
    /** @type {GoogleAppsScript.Gmail.GmailThread[]} */
    var out = [];
    for (i = 0; i < arr.length && out.length < maxThreads; i++) {
      var th = arr[i];
      if (
        CosEmailIngestionService._processedOkBlocksCollect_(
          th,
          processedName,
          existingByThread || {}
        )
      ) {
        continue;
      }
      out.push(th);
    }
    return out;
  },

  /**
   * Union threads from ingest labels. Follow-up labels are filled first so a large
   * [Jeeves]/task backlog cannot starve [Jeeves]/follow-up threads within the scan cap.
   * @param {string} processedName
   * @param {number} maxThreads
   * @param {Object<string, CosTask>} existingByThread
   * @returns {GoogleAppsScript.Gmail.GmailThread[]}
   * @private
   */
  _collectThreadsForIngest_: function (processedName, maxThreads, existingByThread) {
    var fupNames = CosConstants.GMAIL_FOLLOW_UP_TYPE_LABEL_NAMES;
    var taskNames = CosConstants.GMAIL_TASK_TYPE_LABEL_NAMES;
    var fupThreads = CosEmailIngestionService._threadsFromLabelNames_(
      fupNames,
      processedName,
      maxThreads,
      false,
      existingByThread
    );
    /** @type {Object<string, boolean>} */
    var seen = {};
    var i;
    for (i = 0; i < fupThreads.length; i++) {
      seen[fupThreads[i].getId()] = true;
    }
    /** @type {GoogleAppsScript.Gmail.GmailThread[]} */
    var out = fupThreads.slice();
    if (out.length >= maxThreads) {
      return out;
    }
    var taskThreads = CosEmailIngestionService._threadsFromLabelNames_(
      taskNames,
      processedName,
      maxThreads,
      true,
      existingByThread
    );
    for (i = 0; i < taskThreads.length && out.length < maxThreads; i++) {
      var t = taskThreads[i];
      if (seen[t.getId()]) {
        continue;
      }
      seen[t.getId()] = true;
      out.push(t);
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
   * One row per Gmail thread id: any Source counts (Manual rows with a thread id still dedupe).
   * Keys are lowercased trimmed sourceRef so lookup matches thread.getId() reliably.
   * @param {CosTaskRepository} taskRepo
   * @returns {Object<string, CosTask>}
   * @private
   */
  _gmailIngestMapBySourceRefKey_: function (taskRepo) {
    var map = {};
    var all = taskRepo.fetchAllTasks();
    var i;
    for (i = 0; i < all.length; i++) {
      var t = all[i];
      var ref = String(t.sourceRef || '').trim();
      if (!ref) {
        continue;
      }
      var key = ref.toLowerCase();
      if (!map[key]) {
        map[key] = t;
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
    if (!hasTask && !hasFup) {
      return { threadId: threadId, result: 'skipped', reason: 'no_jeeves_type' };
    }
    if (hasTask && hasFup) {
      CosLogger.info(
        'Gmail ingest: thread has both task and follow-up labels; using Follow-up',
        { threadId: threadId }
      );
    }

    var threadKey = String(threadId).trim().toLowerCase();
    var existingRow = existingByThread[threadKey];
    if (existingRow) {
      if (
        CosEmailIngestionService._emailIngestFollowUpUpgrade_(thread, existingRow)
      ) {
        try {
          taskRepo.updateTask(existingRow.taskId, {
            priority: CosConstants.TASK_PRIORITY.FOLLOW_UP,
            durationMin: '',
          });
          CosEmailIngestionService._ensureProcessedClearErr_(
            thread,
            processedLabel,
            errorLabel
          );
          CosLogger.info('Gmail ingest: upgraded row to Follow-up', {
            threadId: threadId,
            taskId: existingRow.taskId,
          });
          return {
            threadId: threadId,
            result: 'updated',
            reason: 'follow_up_upgrade',
          };
        } catch (upE) {
          CosEmailIngestionService._removeErrApplyErr_(
            thread,
            errorLabel,
            processedLabel
          );
          return {
            threadId: threadId,
            result: 'failed',
            reason: String(upE.message || upE),
          };
        }
      }
      CosEmailIngestionService._ensureProcessedClearErr_(
        thread,
        processedLabel,
        errorLabel
      );
      var srcEx = String(existingRow.source || '').trim();
      return {
        threadId: threadId,
        result: 'skipped',
        reason:
          srcEx === CosConstants.TASK_SOURCE.EMAIL
            ? 'already_in_sheet'
            : 'duplicate_source_ref',
      };
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
        sourceRef: String(threadId).trim(),
        notes: snippet ? snippet : '',
      };
      var newTask = taskRepo.createTask(createPayload);
      CosEmailIngestionService._ensureProcessedClearErr_(
        thread,
        processedLabel,
        errorLabel
      );
      CosLogger.info('Gmail thread ingested', { threadId: threadId });
      return { threadId: threadId, result: 'created', task: newTask };
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
