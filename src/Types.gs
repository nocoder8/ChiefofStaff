/**
 * Shared JSDoc models for Chief of Staff.
 * Apps Script has no build step; typedefs document contracts across files.
 */

/**
 * A task row as stored in the Tasks sheet (string-oriented for sheet round-trip).
 * @typedef {Object} CosTask
 * @property {string} taskId
 * @property {string} task
 * @property {string} priority
 * @property {string} durationMin
 * @property {string} deadline
 * @property {string} status
 * @property {string} source Manual | Email | System | Telegram
 * @property {string} sourceRef
 * @property {string} scheduledStart
 * @property {string} scheduledEnd
 * @property {string} originalScheduledStart Latest abandoned Jeeves window (sheet TZ display / ISO)
 * @property {string} originalScheduledEnd
 * @property {string} calendarEventId
 * @property {string} notes
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} closureStatus Awaiting | Resolved | ''
 * @property {string} closureRequestedAt
 * @property {string} completionTimestamp
 * @property {string} missCount
 * @property {string} lastOutcome Done | Rescheduled | Lowered | Dropped | ''
 * @property {string} lastNudgeAt
 * @property {string} followUpContactEmail Resolved contact for Telegram follow-ups (digest mailto).
 * @property {string} followUpContactName Display name when known from directory.
 * @property {string} rescheduleCount Times moved/rescheduled (closure + calendar reschedule).
 * @property {string} firstScheduledAt First calendar booking (ISO or sheet display).
 * @property {string} completedAt When marked Done (analytics).
 * @property {string} finalStatus Done | Dropped | ''
 * @property {string} closureType Done | Reschedule | Lower | Drop | ''
 * @property {number} rowNumber 1-based sheet row when loaded from the sheet
 */

/**
 * Fields accepted by createTask (omissions use defaults).
 * @typedef {Object} CosTaskCreateInput
 * @property {string} task  Required title/description.
 * @property {string} [priority]
 * @property {number|string} [durationMin]
 * @property {Date|string} [deadline]
 * @property {string} [status]
 * @property {string} [source]
 * @property {string} [sourceRef]
 * @property {string} [notes]
 * @property {string} [followUpContactEmail]
 * @property {string} [followUpContactName]
 */

/**
 * Partial update by task id; do not pass taskId or rowNumber.
 * @typedef {Object} CosTaskUpdatePatch
 * @property {string} [task]
 * @property {string} [priority]
 * @property {number|string} [durationMin]
 * @property {Date|string} [deadline]
 * @property {string} [status]
 * @property {string} [source]
 * @property {string} [sourceRef]
 * @property {string} [scheduledStart]
 * @property {string} [scheduledEnd]
 * @property {string} [originalScheduledStart]
 * @property {string} [originalScheduledEnd]
 * @property {string} [calendarEventId]
 * @property {string} [notes]
 * @property {string} [closureStatus]
 * @property {string|Date} [closureRequestedAt]
 * @property {string|Date} [completionTimestamp]
 * @property {number|string} [missCount]
 * @property {string} [lastOutcome]
 * @property {string|Date} [lastNudgeAt]
 * @property {string} [followUpContactEmail]
 * @property {string} [followUpContactName]
 * @property {number|string} [rescheduleCount]
 * @property {string|Date} [firstScheduledAt]
 * @property {string|Date} [completedAt]
 * @property {string} [finalStatus]
 * @property {string} [closureType]
 */

/**
 * @typedef {Object} CosNormalizeTasksResult
 * @property {number} rowsScanned
 * @property {number} rowsUpdated
 * @property {number} duplicateIdsFixed
 */

/**
 * Outcome of a scheduling pass (single task or batch).
 * @typedef {Object} CosScheduleBatchResult
 * @property {boolean} ok
 * @property {string} [message]
 * @property {number} scheduled
 * @property {number} skipped
 * @property {number} failed
 * @property {Object[]} details
 */

/**
 * Parsed script settings (derived from Script Properties + defaults).
 * @typedef {Object} CosSettings
 * @property {string} userEmail
 * @property {string} userDisplayFirstName optional; used for 1:1 calendar title “you” side when set
 * @property {string} primaryCalendarId
 * @property {string} timezone
 * @property {string} workHoursJson
 * @property {boolean} emailTasksEnabled
 * @property {boolean} emailTaskAutoSchedule
 * @property {boolean} dailyDigestEnabled
 * @property {string} dailyDigestTime
 * @property {boolean} digestAiEnabled
 * @property {string} digestAiProvider openai | gemini
 * @property {string} digestAiApiKey
 * @property {string} digestAiModel optional override
 * @property {boolean} scheduleSummaryEmailEnabled
 * @property {boolean} schedulePendingTriggerEnabled
 * @property {boolean} calendarSyncTriggerEnabled  Jeeves event times → sheet on a timer.
 * @property {boolean} debugVerbose  Both Logger + console when true (see DEBUG_VERBOSE property).
 * @property {string} gmailTaskQuery
 * @property {string} gmailLabelProcessed
 * @property {string} gmailLabelError
 * @property {string} [installedAtIso]
 * @property {string} [installVersion]
 * @property {string} closureWebAppUrl
 * @property {string} closureLinkSecret
 * @property {boolean} closureMaintenanceTriggerEnabled
 * @property {boolean} closureRecoveryRescheduleStale
 * @property {number} closureRecoveryGraceHours
 * @property {string} telegramBotToken
 * @property {string} telegramChatId
 * @property {boolean} telegramClosureEnabled
 * @property {boolean} telegramTaskCaptureEnabled
 * @property {string} telegramWebhookSecret  Validated via cos_tg query on webhook POST.
 * @property {boolean} telegramUsePolling  When true, use getUpdates timer instead of webhook POST.
 * @property {boolean} telegramParseAiEnabled  LLM fallback for Telegram task capture (uses digest AI key).
 * @property {boolean} telegramConversationalModeEnabled  When true, LLM-first + butler-like replies + chat.
 * @property {boolean} weeklyPerformanceReportEnabled  Saturday 9:00 sheet TZ weekly report (property missing ⇒ false; Install seeds true).
 * @property {boolean} timingActivityPruneTriggerEnabled  Weekly Sun ~05:00 sheet TZ prune for activity + import log (default false).
 * @property {number} timingActivityRetentionDays  Rolling calendar days of activity rows to keep (default 45).
 */

/**
 * One row in a system health report.
 * @typedef {Object} CosHealthCheckItem
 * @property {string} id
 * @property {'pass'|'warn'|'fail'} status
 * @property {string} message
 * @property {Object} [detail]
 */

/**
 * @typedef {Object} CosHealthCheckResult
 * @property {boolean} ok  True when no check has status fail.
 * @property {CosHealthCheckItem[]} items
 * @property {number} passCount
 * @property {number} warnCount
 * @property {number} failCount
 * @property {string} summaryLine
 */

/**
 * Result of validating the Tasks sheet schema.
 * @typedef {Object} CosTasksSheetValidation
 * @property {boolean} ok
 * @property {string[]} messages
 */

/**
 * @typedef {Object} CosWorkTimeBlock
 * @property {string} start  "HH:mm" local
 * @property {string} end    "HH:mm" local
 */

/**
 * @typedef {Object} CosWorkHoursWeek
 * @property {CosWorkTimeBlock[]} [monday]
 * @property {CosWorkTimeBlock[]} [tuesday]
 * @property {CosWorkTimeBlock[]} [wednesday]
 * @property {CosWorkTimeBlock[]} [thursday]
 * @property {CosWorkTimeBlock[]} [friday]
 * @property {CosWorkTimeBlock[]} [saturday]
 * @property {CosWorkTimeBlock[]} [sunday]
 */
