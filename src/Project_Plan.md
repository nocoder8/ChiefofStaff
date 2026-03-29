You are a senior software engineer and systems architect.

Your task is to build a production-quality Google Apps Script system from scratch called:

CHIEF OF STAFF

This is a personal productivity automation system bound to a Google Sheet.

You must build it in carefully sequenced phases. Do NOT jump ahead. Do NOT implement future phases early unless explicitly required as a dependency. At the end of each phase, stop, summarize what was built, list files created/changed, explain how to test it manually, and wait for the next instruction.

The goal is to produce a codebase that a seasoned developer would respect: clean architecture, clear naming, strong separation of concerns, idempotent behavior, minimal duplication, practical logging, and safe trigger handling.

==================================================
PRODUCT GOAL
==================================================

Chief of Staff is a Google Apps Script assistant that helps manage my work by doing the following:

1. Maintain a canonical task list in a Google Sheet tab named `Tasks`
2. Schedule pending tasks into Google Calendar within configured work hours
3. Ingest tasks from Gmail using structured markers and configurable rules
4. Optionally send a daily HTML digest summarizing tasks, follow-ups, and errors
5. Expose menu actions in the Google Sheet for install, sync, scheduling, digest, and admin actions
6. Support future voice-style task capture by allowing tasks to be created from email in a structured format

This is not a toy script. Build it like a serious internal system.

==================================================
TECH STACK AND CONSTRAINTS
==================================================

- Google Apps Script (V8)
- Bound to a Google Sheet
- GmailApp / MailApp
- CalendarApp
- Calendar Advanced Service may be enabled later if needed, but do not force it unless necessary
- PropertiesService for settings
- LockService for concurrency control
- Time-based triggers
- Spreadsheet menu + install flow
- Must be quota-aware and Apps-Script-friendly
- Avoid unnecessary abstraction that fights Apps Script

==================================================
CORE PRODUCT BEHAVIOR
==================================================

The system must support these behaviors:

A. TASKS SHEET
- Use a tab named `Tasks` as the canonical task store
- Ensure the sheet exists and has the correct headers
- Include validation where appropriate
- Each task should have a stable internal identity

B. SCHEDULING
- Pending tasks should be schedulable into Google Calendar
- Scheduling must happen only within configured work hours
- Scheduling must be idempotent
- Re-running scheduling must not create duplicate calendar events
- Scheduled event metadata should allow re-linking between Sheet row and Calendar event

C. GMAIL INGESTION
- Gmail messages matching configured rules should create tasks
- Processing must be idempotent
- Use Gmail labels to mark processed / errored items
- Parsing should be isolated from Gmail side effects
- Rules and labels must be centralized in config

D. DAILY DIGEST
- Optional daily HTML digest email
- Show pending tasks, scheduled tasks, follow-ups, and errors
- Digest generation logic should be separated from email send logic

E. MENUS AND TRIGGERS
- Install flow should create required sheets, defaults, and triggers
- Menu actions should be clear and usable
- No trigger should ever point to a non-existent function
- Trigger creation and reset logic must be deliberate and safe

==================================================
NAMING AND DESIGN PRINCIPLES
==================================================

Build this as if you are handing it to another strong engineer.

Required principles:
- Clean, boring, reliable code
- One obvious place for each responsibility
- No duplicate helper functions
- No commented-out legacy blocks
- No mysterious globals sprayed across files
- Centralized config
- JSDoc typedefs for important models
- Log meaningful information
- Make runtime behavior traceable
- Prefer simple service/repository patterns over random utility sprawl

==================================================
PROPOSED ARCHITECTURE
==================================================

Use a structure roughly like this, but adapt if needed:

- `Main.gs`
  - public trigger handlers and menu entrypoints only

- `Bootstrap.gs`
  - dependency wiring / service access / initialization helpers

- `Constants.gs`
  - sheet names, headers, statuses, priorities, property keys, label names, defaults

- `Types.gs`
  - JSDoc typedefs for Task, Settings, EmailTaskInput, SchedulingResult, DigestViewModel, etc.

- `SettingsRepository.gs`
  - read/write script properties and defaults

- `TaskRepository.gs`
  - all sheet access for tasks tab
  - schema setup
  - CRUD and mapping between rows and task objects

- `CalendarRepository.gs`
  - raw calendar operations

- `GmailRepository.gs`
  - raw Gmail search, labels, message/thread operations

- `TaskSchedulerService.gs`
  - scheduling logic, slot finding orchestration, idempotent event linking

- `EmailTaskParserService.gs`
  - parse structured email content into task DTOs

- `EmailIngestionService.gs`
  - orchestrate Gmail -> parsed task -> task repo -> labeling

- `DigestService.gs`
  - build digest model and HTML

- `TriggerService.gs`
  - create/reset/list required triggers

- `MenuService.gs`
  - menu composition if needed, or keep menu creation in Main.gs if simpler

- `LoggerService.gs` or lightweight logging helpers
  - optional, but if used, keep it simple

If a lighter structure is better for Apps Script, keep it lighter. But keep responsibilities clear.

==================================================
CANONICAL SHEET MODEL
==================================================

Create a `Tasks` tab with these default headers:

- Task ID
- Task
- Priority
- Duration Min
- Deadline
- Status
- Source
- Source Ref
- Scheduled Start
- Scheduled End
- Calendar Event ID
- Notes
- Created At
- Updated At

Definitions:
- Task ID = internal stable unique id
- Task = task description
- Priority = P1 / P2 / P3 / Follow-up
- Duration Min = integer duration in minutes
- Deadline = optional datetime/date
- Status = Pending / Scheduled / Done / Paused / Error / Follow-up
- Source = Manual / Email / System
- Source Ref = email thread id or other external reference
- Scheduled Start / End = values written after scheduling
- Calendar Event ID = event link key for idempotency
- Notes = freeform notes
- Created At / Updated At = timestamps

You may add additional hidden/system columns only if truly necessary, but call them out.

==================================================
SETTINGS MODEL
==================================================

Use Script Properties for settings, seeded by install flow.

Include at minimum:
- USER_EMAIL
- PRIMARY_CALENDAR_ID
- TIMEZONE
- WORK_HOURS_JSON
- EMAIL_TASKS_ENABLED
- EMAIL_TASK_AUTO_SCHEDULE
- DAILY_DIGEST_ENABLED
- DAILY_DIGEST_TIME
- GMAIL_TASK_QUERY
- GMAIL_LABEL_PROCESSED
- GMAIL_LABEL_ERROR

Default work hours should support weekdays with one or two work blocks per day.
Represent this cleanly as JSON in properties.

==================================================
EMAIL TASK FORMAT
==================================================

Support structured email task creation.

Primary use case:
I can email myself a task in a structured way and the system will create it.

Baseline subject markers:
- `#td` for task
- `#fup` for follow-up

Example subjects:
- `#td Build CEO deck`
- `#fup Follow up with finance on budget`

Body should optionally support structured fields like:
Task: Build CEO deck
Priority: P1
Duration: 60
Deadline: 2026-03-30 18:00
Notes: Need first draft ready before review

Parsing rules:
- Subject can provide fallback task title
- Body fields override inferred values
- Missing duration should use a safe default, for example 30 min
- Missing priority should default to P2
- Parser must be pure and testable

==================================================
SCHEDULING RULES
==================================================

Build sensible initial scheduling behavior:

- Only schedule tasks with status `Pending`
- Skip tasks with missing or invalid duration
- Schedule within configured work hours only
- Do not double-book over existing calendar events
- Prefer earliest feasible slot
- Respect task deadline if provided
- If task already has a valid Calendar Event ID and matching scheduled window, do not duplicate
- If rescheduling is later added, it should update instead of duplicating where appropriate

Start with one primary calendar.

==================================================
DIGEST RULES
==================================================

Build a daily digest that summarizes:
- Pending tasks
- Scheduled tasks for today / upcoming
- Follow-ups
- Error tasks

Keep the HTML clean and plain. No flashy nonsense.

==================================================
PHASED BUILD PLAN
==================================================

Build in the following phases and STOP after each phase.

############################
PHASE 1 — FOUNDATION
############################

Goal:
Set up the core scaffold, constants, types, settings, sheet schema, menu, and install flow.

Build:
- File structure
- Constants
- JSDoc types
- Settings repository
- Task repository
- install/setup flow
- menu
- task sheet creation
- data validation
- basic logging helpers
- trigger-safe public entrypoints stubbed where needed

Deliverables:
- clean project skeleton
- working install action
- `Tasks` sheet auto-created with correct headers
- script properties seeded with defaults
- menu visible on open

Do NOT build Gmail ingestion or Calendar scheduling logic yet beyond harmless stubs.

At the end of Phase 1:
1. summarize what was built
2. list files created
3. give exact manual test steps
4. list open assumptions
5. stop

############################
PHASE 2 — TASK REPOSITORY + MANUAL TASK OPERATIONS
############################

Goal:
Implement robust task CRUD and row-object mapping.

Build:
- create task
- update task
- fetch all tasks
- fetch pending tasks
- fetch by task id
- mark scheduled
- mark done
- mark error
- maintain updated timestamps
- ensure row mapping is stable and safe

Also build a few menu actions for:
- Add sample task
- Validate sheet
- Normalize existing rows if needed

Do NOT build calendar scheduling yet.

At the end of Phase 2:
1. summarize what was built
2. list files changed
3. give manual test steps
4. explain idempotency choices for task identity
5. stop

############################
PHASE 3 — CALENDAR SCHEDULING ENGINE
############################

Goal:
Implement scheduling of pending tasks into calendar time slots.

Build:
- calendar repository
- work hours parser
- slot finding logic
- schedule single task
- schedule all pending tasks
- save Calendar Event ID and scheduled times back to sheet
- skip already scheduled tasks safely
- lock usage where appropriate

Menu actions:
- Schedule pending tasks
- Schedule selected row if practical, otherwise skip this feature

Requirements:
- deterministic behavior
- no duplicate events on re-run
- log scheduling decisions
- handle no-slot-found gracefully

At the end of Phase 3:
1. summarize what was built
2. list files changed
3. give concrete manual test cases
4. explain duplicate prevention logic
5. stop

############################
PHASE 4 — GMAIL INGESTION
############################

Goal:
Create tasks from Gmail based on markers and structured email bodies.

Build:
- gmail repository
- ensure label exists helper
- query settings
- processed/error labeling
- pure email task parser
- ingestion service
- create task from matching email thread
- source/sourceRef tracking
- optional auto-schedule if setting enabled
- cap processing per run for quota safety

Menu actions:
- Process task emails now
- Show current Gmail config in logs

Requirements:
- do not create duplicate tasks from already-processed emails
- use labels for idempotency
- centralize labels and query config
- separate parsing from Gmail side effects

At the end of Phase 4:
1. summarize what was built
2. list files changed
3. give manual Gmail test steps with sample emails
4. explain duplicate prevention logic
5. stop

############################
PHASE 5 — DAILY DIGEST
############################

Goal:
Implement daily digest generation and sending.

Build:
- digest view model creation
- HTML generation
- send digest now
- daily trigger setup
- enable/disable digest settings support

Requirements:
- clear sections
- no noisy formatting
- handle empty states
- only send when enabled

At the end of Phase 5:
1. summarize what was built
2. list files changed
3. give manual test steps
4. explain trigger behavior
5. stop

############################
PHASE 6 — TRIGGERS, OPERATIONS, AND HARDENING
############################

Goal:
Make the system operationally safe.

Build:
- trigger service
- install/reset/list required triggers
- locking strategy for ingestion and scheduling
- better error handling
- status normalization
- central logging cleanup
- cleanup utilities
- admin menu actions

Add:
- reset triggers
- initialize settings
- run system health check
- verify required labels/sheets/properties

At the end of Phase 6:
1. summarize what was built
2. list files changed
3. give operational checklist
4. call out remaining risks
5. stop

############################
PHASE 7 — POLISH AND DEVELOPER EXPERIENCE
############################

Goal:
Make the system easier to maintain.

Build:
- README inside code comments or a dedicated project overview file
- architecture notes
- migration notes
- clearer naming cleanup
- dead code sweep
- optional debug mode property
- sample test fixtures in comments if useful

At the end of Phase 7:
1. summarize what was improved
2. list final file structure
3. provide full setup instructions
4. provide full manual regression checklist
5. stop

==================================================
GENERAL IMPLEMENTATION RULES
==================================================

1. Every phase must result in runnable code.
2. Do not leave placeholders like TODO for core phase scope.
3. Do not introduce code that depends on future files unless you create safe stubs.
4. Prefer small composable functions.
5. Keep public trigger handlers in one obvious place.
6. Keep raw Google service calls inside repository-style files where practical.
7. Use JSDoc heavily for important object models and service contracts.
8. Handle Apps Script date/time formatting carefully.
9. Use batch reads/writes for sheet operations wherever practical.
10. Be explicit about assumptions.

==================================================
OUTPUT FORMAT FOR EACH PHASE
==================================================

For each phase, respond in this order:

1. Phase summary
2. Architecture notes for that phase
3. Full code for every new or changed file
4. Manual test plan
5. Known limitations / next-phase dependencies

Then STOP.

==================================================
START NOW
==================================================

Start with PHASE 1 only.

Before writing code:
- briefly restate the phase scope
- list the files you plan to create
- then output the full code for Phase 1