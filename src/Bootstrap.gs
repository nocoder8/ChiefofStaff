/**
 * Wiring and orchestration for install/setup (Tasks schema, properties, optional Gmail labels).
 */
var CosBootstrap = {
  /**
   * Active UI context when opened from the Sheet; otherwise openById from install property
   * (required for time-driven triggers).
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null}
   */
  getSpreadsheetForRun: function () {
    var id = PropertiesService.getScriptProperties().getProperty(
      CosConstants.PROP_KEYS.BOUND_SPREADSHEET_ID
    );
    if (id) {
      try {
        return SpreadsheetApp.openById(id);
      } catch (e) {
        CosLogger.error('getSpreadsheetForRun: openById failed', {
          id: id,
          error: String(e),
        });
      }
    }
    var active = SpreadsheetApp.getActiveSpreadsheet();
    return active || null;
  },

  /**
   * Runs idempotent install: Tasks schema + seeded script properties + install metadata.
   * Uses a script lock to avoid overlapping installs from menu + triggers later.
   */
  installChiefOfStaff: function () {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      CosLogger.warn('Install aborted: could not acquire script lock within 30s.');
      return { ok: false, message: 'Lock timeout' };
    }
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) {
        var noSs = 'No active spreadsheet (open this script from the bound Sheet).';
        CosLogger.error('Install failed', { error: noSs });
        return { ok: false, message: noSs };
      }
      var settingsRepo = new CosSettingsRepository();
      var taskRepo = new CosTaskRepository(ss);

      settingsRepo.seedDefaultsIfMissing(ss);
      taskRepo.ensureSchema();
      settingsRepo.touchInstallMetadata();
      PropertiesService.getScriptProperties().setProperty(
        CosConstants.PROP_KEYS.BOUND_SPREADSHEET_ID,
        ss.getId()
      );

      /** @type {{ ok: boolean, created: string[], existing: string[], error?: string }} */
      var gmailLabels = { ok: false, created: [], existing: [] };
      try {
        gmailLabels = CosGmailLabelService.ensureJeevesLabels();
        CosLogger.info('Gmail [Jeeves] labels ensured', gmailLabels);
      } catch (e) {
        gmailLabels = {
          ok: false,
          created: [],
          existing: [],
          error: String(e),
        };
        CosLogger.warn('Gmail label setup failed (authorize Gmail and use menu or re-run Install)', {
          error: gmailLabels.error,
        });
      }

      var settingsAfter = settingsRepo.getSettings();
      /** @type {{ ok: boolean, message?: string, installed: string[] }} */
      var triggers = { ok: true, installed: [] };
      try {
        triggers = CosTriggerService.syncFromSettings(
          settingsAfter,
          ss.getSpreadsheetTimeZone()
        );
      } catch (te) {
        triggers = {
          ok: false,
          message: String(te.message || te),
          installed: [],
        };
        CosLogger.warn('Install: trigger sync threw', { error: String(te) });
      }

      CosLogger.info('Install completed', {
        spreadsheetId: ss.getId(),
        timezone: ss.getSpreadsheetTimeZone(),
        triggersOk: triggers.ok,
      });
      return {
        ok: true,
        message: 'Install completed',
        gmailLabels: gmailLabels,
        triggers: triggers,
      };
    } catch (e) {
      CosLogger.error('Install failed', { error: String(e) });
      return { ok: false, message: String(e) };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @returns {CosSettingsRepository}
   */
  createSettingsRepository: function () {
    return new CosSettingsRepository();
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @returns {CosTaskRepository}
   */
  createTaskRepository: function (ss) {
    return new CosTaskRepository(ss);
  },
};
