/**
 * Verbose scheduling traces (Executions / Logger). Toggle via CosConstants.SCHEDULING_VERBOSE_LOG.
 */
var CosSchedulingLog = {
  /**
   * @returns {boolean}
   */
  enabled: function () {
    return CosConstants.SCHEDULING_VERBOSE_LOG === true;
  },

  /**
   * @param {string} message
   * @param {Object=} meta
   */
  log: function (message, metadata) {
    if (!CosSchedulingLog.enabled()) {
      return;
    }
    CosLogger.info('[Scheduling] ' + message, metadata || {});
  },
};
