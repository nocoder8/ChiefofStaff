# Chief of Staff

Personal productivity automation bound to a Google Sheet: **Tasks** as the source of truth, **Google Calendar** scheduling, **Gmail → Tasks** ingestion (Jeeves labels), optional **daily digest** and **post-schedule summary** email, and **time-driven triggers**.

Stack: **Google Apps Script (V8)**, `clasp`-friendly source under `src/`.

---

## Architecture (high level)

| Area | Files |
|------|--------|
| Entry / menu / triggers | `Main.gs` |
| Install, spreadsheet binding | `Bootstrap.gs` |
| Config & property keys | `Constants.gs` |
| JSDoc models | `Types.gs` |
| Script properties | `SettingsRepository.gs` |
| Tasks sheet CRUD & schema | `TaskRepository.gs` |
| Calendar I/O | `CalendarRepository.gs` |
| Scheduling engine | `TaskSchedulerService.gs`, `WorkHoursParser.gs`, `SchedulingLogService.gs` |
| Gmail → tasks | `EmailIngestionService.gs`, `GmailLabelService.gs` |
| Daily digest email | `DailyDigestService.gs` |
| Digest AI snippets (optional) | `DigestAiService.gs` |
| After-schedule email | `ScheduleSummaryEmailService.gs` |
| Time triggers | `TriggerService.gs` |
| Health check | `HealthCheckService.gs` |
| Logging | `LoggerService.gs` |

**Data flow (simplified)**

1. **Tasks** sheet rows ↔ `CosTask` via `TaskRepository`.
2. **Schedule pending** reads pending tasks, loads busy intervals from the primary calendar, finds slots inside **work hours** (`WORK_HOURS_JSON`), creates Sage-colored **Jeeves** events, writes back event id and times.
3. **Gmail** uses label-based thread collection (`[Jeeves]/task`, follow-up, priority, duration labels); processed threads get `[Jeeves]/ok` or `[Jeeves]/err`.
4. **Triggers** call `cos_triggerProcessGmail_`, `cos_triggerSchedulePending_`, `cos_triggerDailyDigest_` according to script properties; **Sync time triggers** re-applies them after you change flags.

**Concurrency:** `LockService` on ingest, schedule, digest, and install where appropriate.

---

## Setup (full)

### 1. Prerequisites

- Google account, Google Sheet, Calendar, Gmail.
- [clasp](https://github.com/google/clasp) (optional, for pushing `src/` to Apps Script).

### 2. Bind the script

Create or open a **container-bound** script on your Chief of Staff spreadsheet (or clone this project and `clasp create --type sheets --rootDir src` then bind).

Copy all `.gs` files from `src/` into the script project. Ensure `appsscript.json` matches (V8, timezone if desired).

### 3. First run

1. Open the **Tasks** spreadsheet.
2. **Chief of Staff → Install / Repair**  
   - Creates/validates **Tasks** tab and headers.  
   - Seeds **Script properties** (does not overwrite existing keys).  
   - Sets **BOUND_SPREADSHEET_ID**.  
   - Ensures Jeeves Gmail labels (authorize **Gmail** when prompted).  
   - **Syncs time triggers** from current settings.

3. Authorize **Calendar** on first schedule.

### 4. Script properties (reference)

| Property | Purpose |
|----------|---------|
| `USER_EMAIL` | Digest / summary recipient fallback |
| `PRIMARY_CALENDAR_ID` | Usually same as email; primary calendar for busy + events |
| `TIMEZONE` | IANA tz for digest time & scheduling context |
| `WORK_HOURS_JSON` | Weekday blocks `12:00–17:00`, `19:30–23:30` (default) |
| `EMAIL_TASKS_ENABLED` | `true` to allow **triggered** Gmail ingest |
| `EMAIL_TASK_AUTO_SCHEDULE` | After ingest, run scheduling if new tasks |
| `DAILY_DIGEST_ENABLED` | Daily digest trigger + send |
| `DAILY_DIGEST_TIME` | Local time `HH:mm` |
| `SCHEDULE_SUMMARY_EMAIL_ENABLED` | One email per run when ≥1 task scheduled |
| `SCHEDULE_PENDING_TRIGGER_ENABLED` | Hourly `cos_triggerSchedulePending_` |
| `BOUND_SPREADSHEET_ID` | Sheet for headless triggers |
| `DEBUG_VERBOSE` | `true` → log to **both** `Logger` and `console` (duplicate Cloud lines). Default behavior: **console only** |
| `DIGEST_AI_ENABLED` | `true` + API key → one-line **AI summary** for each follow-up in the daily digest (see below) |
| `DIGEST_AI_PROVIDER` | `openai` (default) or `gemini` |
| `DIGEST_AI_API_KEY` | **Secret** — OpenAI key or Gemini API key; never commit |
| `DIGEST_AI_MODEL` | Optional override (defaults: `gpt-4o-mini`, `gemini-2.0-flash`) |

**Daily digest AI (follow-ups):** With `DIGEST_AI_ENABLED=true` and a key set, each follow-up sends the model the **task title**, **Notes** (Gmail excerpt when ingested via Jeeves), **source** (Manual / Email / System), **approx. age in hours**, **overdue vs waiting** flag, and **deadline** if present. Without AI, the digest still shows a **non-AI excerpt** from Notes when available. First `UrlFetchApp` call may prompt for **external request** authorization. Use the spreadsheet menu **Set digest AI API key…** to save the key and enable AI (or set properties manually). **Install / Repair** seeds `DIGEST_AI_ENABLED=false` and `DIGEST_AI_PROVIDER=openai` when those keys are missing.

Jeeves label names default to `[Jeeves]/ok`, `[Jeeves]/err`, etc. (see `Constants.gs`).

### 5. Menus you will use often

- **Sync time triggers** — after toggling digest / Gmail / schedule-trigger flags.  
- **Run system health check** — sheets, properties, calendar, labels, triggers.  
- **Process Gmail → Tasks** / **Schedule pending tasks** — manual runs.  
- **Set digest AI API key…** — stores the key in Script Properties and sets `DIGEST_AI_ENABLED=true`. **Turn off digest AI** disables summaries without deleting the key.

---

## Migration / upgrades

- **`INSTALL_VERSION` / `SCHEMA_VERSION`**: bumped in `Constants.gs` when schema or install semantics change. Re-run **Install / Repair** after pulling code; it remains idempotent for existing keys.
- **New properties**: `seedDefaultsIfMissing` only writes keys that are **missing**. Pull new code → **Install** or set new keys manually.
- **Trigger shape changed**: **Sync time triggers** (or Install) to drop stale handlers and recreate.
- **Calendar event title format** changed (e.g. Jeeves prefix): old events keep old titles until rescheduled or edited.

---

## Debugging

- **Scheduling detail:** `SCHEDULING_VERBOSE_LOG` in `Constants.gs` (verbose slot search in Executions).
- **Duplicate log lines:** leave `DEBUG_VERBOSE` unset or `false` (default). Set `DEBUG_VERBOSE=true` only if you want **Logger + console** for legacy tooling.

---

## Sample task shape (for tests / manual rows)

Conceptually a **CosTask** row (see `Types.gs`):

```text
taskId: (uuid, filled by sheet/repo)
task: "Review Q3 plan"
priority: "P1"
durationMin: "30"
deadline: "" or ISO / Sheets datetime
status: "Pending"
source: "Manual"
sourceRef: ""
scheduledStart/End/calendarEventId: "" until scheduled
```

---

## Manual regression checklist

After code or settings changes, run through:

1. **Install / Repair** — completes without error; toast mentions triggers where applicable.
2. **Validate Tasks sheet** — passes.
3. **Run system health check** — 0 failures; fix warnings (labels, triggers) as needed.
4. **Add sample task** — row appears with Task ID.
5. **Schedule pending tasks** (or **Schedule selected task**) — calendar event created (Sage, `🎩 [Jeeves]-…` title); sheet shows scheduled times and event id; re-run does not duplicate.
6. **Process Gmail → Tasks** (with a test thread labeled `[Jeeves]/task` and not `ok`) — task created; thread labeled `ok` or `err`.
7. **Send daily digest now** — email received when forced from menu.
8. **Sync time triggers** — health check shows trigger counts matching `EMAIL_TASKS_ENABLED`, `DAILY_DIGEST_ENABLED`, `SCHEDULE_PENDING_TRIGGER_ENABLED`.

---

## Source file list (`src/`)

| File |
|------|
| `appsscript.json` |
| `Bootstrap.gs` |
| `CalendarRepository.gs` |
| `Constants.gs` |
| `DailyDigestService.gs` |
| `EmailIngestionService.gs` |
| `GmailLabelService.gs` |
| `HealthCheckService.gs` |
| `LoggerService.gs` |
| `Main.gs` |
| `ScheduleSummaryEmailService.gs` |
| `SchedulingLogService.gs` |
| `SettingsRepository.gs` |
| `TaskRepository.gs` |
| `TaskSchedulerService.gs` |
| `TriggerService.gs` |
| `Types.gs` |
| `WorkHoursParser.gs` |
| `DigestAiService.gs` |
| `Project_Plan.md` (spec; not loaded by Apps Script) |

---

## Product spec

See `src/Project_Plan.md` for the original phased build plan and requirements.
