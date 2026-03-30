# Chief of Staff

Personal productivity automation bound to a Google Sheet: **Tasks** as the source of truth, **Google Calendar** scheduling, **Gmail → Tasks** ingestion (Jeeves labels), optional **daily digest** and **post-schedule summary** email, optional **Telegram** prompts for task closure, and **time-driven triggers**.

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
| Jeeves calendar → sheet time sync | `CalendarJeevesSyncService.gs` |
| Scheduling engine | `TaskSchedulerService.gs`, `WorkHoursParser.gs`, `SchedulingLogService.gs` |
| Gmail → tasks | `EmailIngestionService.gs`, `GmailLabelService.gs` |
| Daily digest email | `DailyDigestService.gs` |
| Task closure engine + recovery | `TaskClosureService.gs` |
| Signed closure links | `ClosureLinkService.gs` |
| Web app `doGet` / `doPost` (closure + Telegram webhook) | `WebAppEntry.gs` |
| Closure HTML handlers | `ClosureWebApp.gs` |
| Telegram closure nudges + webhook + task capture | `TelegramService.gs` |
| Telegram task text parser (rule-based) | `TelegramTaskCaptureParser.gs` |
| Digest AI snippets (optional) | `DigestAiService.gs` |
| After-schedule email | `ScheduleSummaryEmailService.gs` |
| Time triggers | `TriggerService.gs` |
| Health check | `HealthCheckService.gs` |
| Logging | `LoggerService.gs` |

**Data flow (simplified)**

1. **Tasks** sheet rows ↔ `CosTask` via `TaskRepository`.
2. **Schedule pending** reads pending tasks, loads busy intervals from the primary calendar, finds slots inside **work hours** (`WORK_HOURS_JSON`), creates Sage-colored **Jeeves** events, writes back event id and times.
3. **Gmail** uses label-based thread collection (`[Jeeves]/task`, follow-up, priority, duration labels); processed threads get `[Jeeves]/ok` or `[Jeeves]/err`.
4. **Triggers** call `cos_triggerProcessGmail_`, `cos_triggerSchedulePending_`, `cos_triggerDailyDigest_`, optionally `cos_triggerCalendarJeevesSync_` (every **15 min** when enabled), and optionally `cos_triggerClosureMaintenance_` per script properties; **Sync time triggers** re-applies them after you change flags.
5. **Jeeves calendar sync** (optional): reads **your** Google Calendar for linked Jeeves events and updates **Scheduled Start/End** on the sheet when you drag an event; if the row was **Awaiting Closure** but you moved the event so its **end is in the future**, the row returns to **Scheduled** and closure fields clear (Telegram nudge can be ignored).
6. **Telegram** (optional): when a scheduled block ends and the row moves to **Awaiting Closure**, the script can `sendMessage` with numbered options; your **reply** to that message (digits `1`–`4`) is delivered to the same web app deployment via `doPost` and calls the same closure engine as calendar links. **Task capture:** top-level bot messages (when enabled) are rule-parsed and create **Pending** rows with `Source = Telegram` via `TaskRepository.createTask`.

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
| `CALENDAR_SYNC_TRIGGER_ENABLED` | `true` (default) → every **15 min** `cos_triggerCalendarJeevesSync_` pulls Jeeves event times into the sheet; set `false` to disable |
| `BOUND_SPREADSHEET_ID` | Sheet for headless triggers |
| `DEBUG_VERBOSE` | `true` → log to **both** `Logger` and `console` (duplicate Cloud lines). Default behavior: **console only** |
| `DIGEST_AI_ENABLED` | `true` + API key → one-line **AI summary** for each follow-up in the daily digest (see below) |
| `DIGEST_AI_PROVIDER` | `openai` (default) or `gemini` |
| `DIGEST_AI_API_KEY` | **Secret** — OpenAI key or Gemini API key; never commit |
| `DIGEST_AI_MODEL` | Optional override (defaults: `gpt-4o-mini`, `gemini-2.0-flash`) |
| `CLOSURE_WEBAPP_URL` | Web app deployment URL (ends with `/exec`) for signed tap-to-close links |
| `CLOSURE_LINK_SECRET` | HMAC secret (seeded on Install if missing; do not share) |
| `CLOSURE_MAINTENANCE_TRIGGER_ENABLED` | `true` → `cos_triggerClosureMaintenance_` every **15 min** (queue + recovery; cadence: `TRIGGER_CLOSURE_MAINTENANCE_EVERY_MINUTES` in `Constants.gs`) |
| `CLOSURE_RECOVERY_RESCHEDULE_STALE` | `true` → auto-**reschedule** tasks stuck in **Awaiting Closure** past grace hours |
| `CLOSURE_RECOVERY_GRACE_HOURS` | Hours after **Closure Requested At** before recovery for **non-P0** tasks (default `48` if unset/invalid). **P0** uses a fixed **6 hours** (`CLOSURE_RECOVERY_GRACE_HOURS_P0` in `Constants.gs`). |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) (**secret**; never commit) |
| `TELEGRAM_CHAT_ID` | Numeric chat id for your private chat with the bot (e.g. from @userinfobot) |
| `TELEGRAM_CLOSURE_ENABLED` | `true` → send a Telegram prompt when a task enters **Awaiting Closure** |
| `TELEGRAM_TASK_CAPTURE_ENABLED` | `true` (default after Install seeds) → **new** (non-reply) bot messages can create **Tasks** rows (`Source = Telegram`) via rule-based parsing |
| `TELEGRAM_WEBHOOK_SECRET` | Random string; appended as query param `cos_tg` on the webhook URL (seeded on Install if missing) |
| `TELEGRAM_USE_POLLING` | `true` → **getUpdates** on a timer instead of webhook POST (Google Workspace when public web app is blocked); set via menu **Enable Telegram polling** |

**Task closure (calendar + digest + web app):** After **Install / Repair**, deploy the script as a **Web app** (Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone**). Copy the `/exec` URL into **Chief of Staff → Set closure web app URL…** (or set `CLOSURE_WEBAPP_URL`). **Redeploy** the web app after pulling updates so the closure **menu** handler is live. New Jeeves events put **one short signed URL** in the **description**; opening it shows large **Done / Reschedule / Lower / Drop** buttons (cleaner than raw URLs in Calendar, which does not reliably render custom link text in descriptions). Outcome links still apply only after the scheduled **end** (or once the task is in **Awaiting Closure**). The script also adds a **popup reminder a few minutes before the event starts** (`CALENDAR_JEEVES_POPUP_REMINDER_MINUTES_BEFORE_START` in `Constants.gs`; Google Calendar has no built-in “when the event ends” reminder—use that nudge or your own defaults). The **daily digest** **Awaiting closure** section uses the same single menu URL when the web app is configured. Closure maintenance **refreshes** existing event descriptions when it updates closure links.

**Telegram closure (mobile nudge):** Create a bot with @BotFather, start a chat with it, and obtain your **chat id**. Use the menu to save **Set Telegram bot token…** and **Set Telegram chat id…**, then **Enable Telegram closure nudges**.

- **Webhook (default when public web app is allowed):** Use the **same** deployed web app URL as `CLOSURE_WEBAPP_URL` (must end with `/exec`). Run **Register Telegram webhook** so Telegram posts updates to `…/exec?cos_tg=…` (Google Apps Script does not expose the `X-Telegram-Bot-Api-Secret-Token` header, so verification uses that query param). **Redeploy** the web app after adding `doPost`.
- **Polling (Google Workspace without “Anyone” on the web app):** Run **Enable Telegram polling (no public web app)**. The script calls Telegram **getUpdates** about every minute (time trigger), clears the webhook, and processes the same messages as `doPost` (closure replies **1–4** and task capture). **Disable Telegram polling** before **Register Telegram webhook** if you later get a public `/exec` URL.

When a block ends, you get a short message: **1** Done, **2** Reschedule (next free slot; P0 may book today), **2two** / **2three** / **2four** (defer first slot to **+1 / +2 / +3** local calendar days in the **sheet timezone**), **3** Lower, **4** Drop — **reply to that message**. **`2t`** or **`2 tomorrow`** is the same as **2two**. First `UrlFetchApp` calls may prompt for **external requests**.

**Telegram task capture (Phase 1):** You do **not** need a second bot — the same bot and **webhook or polling** handle closure **replies** and **new** task messages. With `TELEGRAM_TASK_CAPTURE_ENABLED=true`, send a **top-level** message (not a reply) such as `/task P0 30m Prepare for CEO meeting`, `Create a P0 task for 30 mins. I need to …`, `Task P1 45 mins: Finish deck`, `Create task: …`, `Follow up with …`, or `Remind me to … for 20 mins`. Defaults: **P2**, **30 min** if omitted. Malformed or unrelated text gets a short help message (no row created). **Closure** still requires **replying** to the Jeeves prompt with `1`–`4`. Menu: **Log: Telegram capture parser self-test** runs built-in examples and logs results to Executions.

**Business-day split (Telegram):** One message can create **several** Tasks rows and **book one calendar block per weekday** (Mon–Fri in the **spreadsheet timezone**). Example: *“I need to dedicate 1 hour per day for the next 5 business days to build a deck for the CEO”* — starts from **tomorrow’s calendar date** (weekends skipped); add **starting today** to anchor from today. Requires duration **per day** (e.g. `1 hour per day`, `45 minutes per day`), a **business day count**, and a **to …** phrase for the work. Max days: `TELEGRAM_BUSINESS_DAY_SPLIT_MAX_DAYS` in `Constants.gs`. Rows that cannot be placed on a given day stay **Pending**; the bot reply lists successes and failures.

**Daily digest AI (follow-ups):** With `DIGEST_AI_ENABLED=true` and a key set, each follow-up sends the model the **task title**, **Notes** (Gmail excerpt when ingested via Jeeves), **source** (Manual / Email / System), **approx. age in hours**, **overdue vs waiting** flag, and **deadline** if present. Without AI, the digest still shows a **non-AI excerpt** from Notes when available. First `UrlFetchApp` call may prompt for **external request** authorization. Use the spreadsheet menu **Set digest AI API key…** to save the key and enable AI (or set properties manually). **Install / Repair** seeds `DIGEST_AI_ENABLED=false` and `DIGEST_AI_PROVIDER=openai` when those keys are missing.

Jeeves label names default to `[Jeeves]/ok`, `[Jeeves]/err`, etc. (see `Constants.gs`).

### 5. Menus you will use often

- **Sync time triggers** — after toggling digest / Gmail / schedule-trigger flags.  
- **Run system health check** — sheets, properties, calendar, labels, triggers.  
- **Process Gmail → Tasks** / **Schedule pending tasks** — manual runs.  
- **Sync Jeeves calendar → sheet** — same logic as the 15 min trigger, on demand.  
- **Set digest AI API key…** — stores the key in Script Properties and sets `DIGEST_AI_ENABLED=true`. **Turn off digest AI** disables summaries without deleting the key.  
- **Process closure queue (+ recovery)** / **Set closure web app URL…** — task closure (see script properties table above).  
- **Telegram** — bot token, chat id, enable/disable closure nudges and **task capture**, **Enable / Disable Telegram polling**, **Register Telegram webhook**, **Send Telegram test**, parser self-test (see Telegram sections above).

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
closureStatus / closureRequestedAt: "" until closure flow
completionTimestamp, missCount, lastOutcome, lastNudgeAt: "" until used
```

---

## Manual regression checklist

After code or settings changes, run through:

1. **Install / Repair** — completes without error; toast mentions triggers where applicable.
2. **Validate Tasks sheet** — passes.
3. **Run system health check** — 0 failures; fix warnings (labels, triggers, closure links if you use tap-to-close) as needed.
4. **Add sample task** — row appears with Task ID.
5. **Schedule pending tasks** (or **Schedule selected task**) — calendar event created (Sage, `🎩 [Jeeves]-…` title); sheet shows scheduled times and event id; re-run does not duplicate.
6. **Process Gmail → Tasks** (with a test thread labeled `[Jeeves]/task` and not `ok`) — task created; thread labeled `ok` or `err`.
7. **Send daily digest now** — email received when forced from menu.
8. **Sync time triggers** — health check shows trigger counts matching `EMAIL_TASKS_ENABLED`, `DAILY_DIGEST_ENABLED`, `SCHEDULE_PENDING_TRIGGER_ENABLED`, and `CLOSURE_MAINTENANCE_TRIGGER_ENABLED` when each is enabled.
9. **Closure (optional)** — with web app deployed and URL saved: health check **passes** closure signed-links item; open a Jeeves event description link (menu) after the block ends, tap **Done** (or another outcome); sheet updates; repeat tap shows a stable “no change” / idempotent outcome where implemented.
10. **Schedule summary email** — if `SCHEDULE_SUMMARY_EMAIL_ENABLED` is true, scheduling at least one task sends the summary email (verify recipient / spam).
11. **Telegram (optional)** — test message, register webhook, run **Process closure queue** (or wait for trigger) after a block ends; **reply to the bot prompt** with `1`–`4`; sheet updates.

---

## Source file list (`src/`)

| File |
|------|
| `appsscript.json` |
| `Bootstrap.gs` |
| `CalendarJeevesSyncService.gs` |
| `CalendarRepository.gs` |
| `ClosureLinkService.gs` |
| `ClosureWebApp.gs` |
| `Constants.gs` |
| `DailyDigestService.gs` |
| `DigestAiService.gs` |
| `EmailIngestionService.gs` |
| `GmailLabelService.gs` |
| `HealthCheckService.gs` |
| `LoggerService.gs` |
| `Main.gs` |
| `ScheduleSummaryEmailService.gs` |
| `SchedulingLogService.gs` |
| `SettingsRepository.gs` |
| `TaskClosureService.gs` |
| `TaskRepository.gs` |
| `TaskSchedulerService.gs` |
| `TelegramService.gs` |
| `TelegramTaskCaptureParser.gs` |
| `TriggerService.gs` |
| `Types.gs` |
| `WebAppEntry.gs` |
| `WorkHoursParser.gs` |
| `Project_Plan.md` (spec; not loaded by Apps Script) |

Other files under `src/` (e.g. `Thoughts.txt`) are not part of the Apps Script bundle unless you copy them manually.

---

## Product spec

See `src/Project_Plan.md` for the original phased build plan and requirements.
