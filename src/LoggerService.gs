/**
 * Lightweight logging with a stable prefix for Stackdriver / Executions filtering.
 * Default: one sink (console) to avoid duplicate Info + Debug lines in Cloud logs.
 * Set script property DEBUG_VERBOSE=true for Logger + console (legacy dual logging).
 */
var CosLogger = {
  PREFIX: '[ChiefOfStaff]',
  /** @type {boolean|undefined} resolved once per cold start */
  _dualLogResolved: undefined,

  /**
   * @returns {boolean}
   * @private
   */
  _dualLogEnabled_: function () {
    if (CosLogger._dualLogResolved !== undefined) {
      return CosLogger._dualLogResolved;
    }
    try {
      var v = PropertiesService.getScriptProperties().getProperty(
        CosConstants.PROP_KEYS.DEBUG_VERBOSE
      );
      CosLogger._dualLogResolved = String(v || '').toLowerCase() === 'true';
    } catch (e) {
      CosLogger._dualLogResolved = false;
    }
    return CosLogger._dualLogResolved;
  },

  /**
   * @param {string} message
   * @param {Object=} metadata
   */
  info: function (message, metadata) {
    CosLogger._log('INFO', message, metadata);
  },

  /**
   * @param {string} message
   * @param {Object=} metadata
   */
  warn: function (message, metadata) {
    CosLogger._log('WARN', message, metadata);
  },

  /**
   * @param {string} message
   * @param {Object=} metadata
   */
  error: function (message, metadata) {
    CosLogger._log('ERROR', message, metadata);
  },

  /**
   * @param {string} level
   * @param {string} message
   * @param {Object=} metadata
   */
  _log: function (level, message, metadata) {
    var payload = CosLogger.PREFIX + ' ' + level + ' ' + message;
    if (metadata && typeof metadata === 'object') {
      try {
        payload += ' | ' + JSON.stringify(metadata);
      } catch (e) {
        payload += ' | [metadata not serializable]';
      }
    }
    var dual = CosLogger._dualLogEnabled_();
    if (level === 'ERROR') {
      if (dual) {
        Logger.log(payload);
      }
      console.error(payload);
      return;
    }
    if (level === 'WARN') {
      if (dual) {
        Logger.log(payload);
      }
      console.warn(payload);
      return;
    }
    if (dual) {
      Logger.log(payload);
    }
    console.log(payload);
  },
};
