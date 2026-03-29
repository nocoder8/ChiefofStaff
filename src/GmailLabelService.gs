/**
 * Creates the [Jeeves] label tree in Gmail (idempotent).
 * Uses GmailApp; first run triggers OAuth for Gmail.
 * @namespace
 */
var CosGmailLabelService = {
  /**
   * Ensures every path in CosConstants.GMAIL_JEEVES_LABELS exists.
   * Nested names (Parent/child) create the parent automatically in Gmail.
   * @returns {{ ok: boolean, created: string[], existing: string[], error?: string }}
   */
  ensureJeevesLabels: function () {
    /** @type {string[]} */
    var created = [];
    /** @type {string[]} */
    var existing = [];
    var names = CosConstants.GMAIL_JEEVES_LABELS;
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var label = GmailApp.getUserLabelByName(name);
      if (label) {
        existing.push(name);
      } else {
        GmailApp.createLabel(name);
        created.push(name);
      }
    }
    return { ok: true, created: created, existing: existing };
  },
};
