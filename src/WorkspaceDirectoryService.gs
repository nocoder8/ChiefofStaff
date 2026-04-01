/**
 * Google Workspace directory search (People API) — resolve names → emails.
 * Requires oauth scope directory.readonly in appsscript.json; user re-authorizes once.
 */
var CosWorkspaceDirectoryService = {
  /**
   * @param {string} query name or partial name
   * @param {number} maxResults 1–10
   * @returns {{ ok: true, people: {email:string, displayName:string}[] } | { ok: false, code: string, message?: string }}
   */
  searchDirectoryPeople: function (query, maxResults) {
    var q = String(query || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (q.length < 2) {
      return { ok: false, code: 'bad_query', message: 'Name too short.' };
    }
    var max = Math.min(10, Math.max(1, Math.floor(Number(maxResults) || 8)));
    try {
      // DirectorySourceType enum (not the legacy "DIRECTORY" string).
      var srcProfile = 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE';
      var srcContact = 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT';
      var url =
        'https://people.googleapis.com/v1/people:searchDirectoryPeople?' +
        'query=' +
        encodeURIComponent(q) +
        '&readMask=' +
        encodeURIComponent('names,emailAddresses') +
        '&sources=' +
        encodeURIComponent(srcProfile) +
        '&sources=' +
        encodeURIComponent(srcContact) +
        '&pageSize=' +
        String(max);
      var token = ScriptApp.getOAuthToken();
      var res = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + token,
        },
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      var txt = res.getContentText();
      if (code < 200 || code >= 300) {
        CosLogger.warn('searchDirectoryPeople HTTP', {
          code: code,
          body: txt.substring(0, 400),
        });
        return {
          ok: false,
          code: 'http',
          message:
            'Directory search failed (HTTP ' +
            code +
            '). Re-run the script to authorize Directory access if prompted.',
        };
      }
      var data = JSON.parse(txt);
      var raw = data.people || [];
      var seen = {};
      var out = [];
      var i;
      for (i = 0; i < raw.length; i++) {
        var email = CosWorkspaceDirectoryService._primaryEmailFromPerson_(raw[i]);
        if (!email) {
          continue;
        }
        var low = email.toLowerCase();
        if (seen[low]) {
          continue;
        }
        seen[low] = true;
        out.push({
          email: low,
          displayName:
            CosWorkspaceDirectoryService._displayNameFromPerson_(raw[i]) ||
            email,
        });
        if (out.length >= max) {
          break;
        }
      }
      return { ok: true, people: out };
    } catch (e) {
      CosLogger.warn('searchDirectoryPeople', { error: String(e) });
      return {
        ok: false,
        code: 'error',
        message: String(e.message || e),
      };
    }
  },

  /**
   * @param {Object} person People API person object
   * @returns {string}
   * @private
   */
  _primaryEmailFromPerson_: function (person) {
    if (!person || typeof person !== 'object') {
      return '';
    }
    var addrs = person.emailAddresses || [];
    var j;
    for (j = 0; j < addrs.length; j++) {
      var a = addrs[j];
      if (a && a.metadata && a.metadata.primary && a.value) {
        return String(a.value).trim();
      }
    }
    if (addrs.length && addrs[0].value) {
      return String(addrs[0].value).trim();
    }
    return '';
  },

  /**
   * @param {Object} person
   * @returns {string}
   * @private
   */
  _displayNameFromPerson_: function (person) {
    if (!person || typeof person !== 'object') {
      return '';
    }
    var names = person.names || [];
    if (names.length && names[0].displayName) {
      return String(names[0].displayName).trim();
    }
    if (names.length) {
      var n = names[0];
      var parts = [];
      if (n.givenName) {
        parts.push(String(n.givenName));
      }
      if (n.familyName) {
        parts.push(String(n.familyName));
      }
      if (parts.length) {
        return parts.join(' ').trim();
      }
    }
    return '';
  },
};
