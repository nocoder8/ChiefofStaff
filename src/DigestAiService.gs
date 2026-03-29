/**
 * Optional AI (OpenAI or Gemini) one-line context for follow-ups in the daily digest.
 * Uses task title + Notes (Gmail excerpt from ingest). API key in Script Properties only.
 */
var CosDigestAiService = {
  /**
   * @param {CosTask[]} tasks follow-up tasks (overdue + waiting)
   * @param {CosSettings} settings
   * @param {{ overdue?: boolean }} [opts] per-batch urgency hint
   * @returns {Object<string, { line: string, source: string }>} taskId -> display line + source label
   */
  buildFollowUpContextMap: function (tasks, settings, opts) {
    var map = {};
    var overdueBatch = opts && opts.overdue === true;
    if (!tasks || !tasks.length) {
      return map;
    }
    var enabled =
      settings.digestAiEnabled &&
      String(settings.digestAiApiKey || '').trim().length > 0;
    var provider = String(settings.digestAiProvider || 'openai')
      .trim()
      .toLowerCase();
    var maxN = CosConstants.DIGEST_AI_MAX_TASKS_PER_RUN;
    var i;
    for (i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var id = String(t.taskId || '').trim();
      if (!id) {
        continue;
      }
      if (enabled && i < maxN) {
        try {
          var line = CosDigestAiService._callProvider_(t, settings, provider, overdueBatch);
          line = CosDigestAiService._sanitizeLine_(line);
          if (line) {
            map[id] = { line: line, source: 'ai' };
            continue;
          }
        } catch (e) {
          CosLogger.warn('Digest AI snippet failed', {
            taskId: id,
            error: String(e.message || e),
          });
        }
      }
      map[id] = {
        line: CosDigestAiService.fallbackSnippetForTask(t),
        source: 'notes',
      };
    }
    return map;
  },

  /**
   * Non-AI excerpt for digest when AI is off or fails.
   * @param {CosTask} t
   * @returns {string}
   */
  fallbackSnippetForTask: function (t) {
    var n = String(t.notes || '').trim().replace(/\s+/g, ' ');
    if (n.length > CosConstants.DIGEST_FOLLOWUP_SNIPPET_MAX_CHARS) {
      return n.substring(0, CosConstants.DIGEST_FOLLOWUP_SNIPPET_MAX_CHARS - 1) + '…';
    }
    if (n.length >= 12) {
      return n;
    }
    if (String(t.source || '').trim() === CosConstants.TASK_SOURCE.EMAIL) {
      return 'Open the Gmail thread to see the latest (no excerpt stored on this row).';
    }
    return '';
  },

  /**
   * @param {CosTask} t
   * @param {CosSettings} settings
   * @param {string} provider
   * @param {boolean} overdueBatch
   * @returns {string}
   * @private
   */
  _callProvider_: function (t, settings, provider, overdueBatch) {
    var prompt = CosDigestAiService._buildUserPrompt_(t, overdueBatch);
    if (provider === 'gemini') {
      return CosDigestAiService._geminiGenerate_(settings, prompt);
    }
    return CosDigestAiService._openAiChat_(settings, prompt);
  },

  /**
   * What we send the model (title, notes excerpt, source, age, urgency).
   * Extend the prompt with more fields here as product needs grow.
   * @param {CosTask} t
   * @param {boolean} overdueBatch
   * @returns {string}
   * @private
   */
  _buildUserPrompt_: function (t, overdueBatch) {
    var title = String(t.task || '').trim() || '(no title)';
    var notes = String(t.notes || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (notes.length > CosConstants.DIGEST_AI_MAX_NOTES_CHARS) {
      notes = notes.substring(0, CosConstants.DIGEST_AI_MAX_NOTES_CHARS) + '…';
    }
    var src = String(t.source || '').trim() || 'Unknown';
    var age = CosDigestAiService._approxAgeHours_(t);
    var dl = String(t.deadline || '').trim();
    var lines = [
      'Task title (often an email subject): ' + title,
      'Source: ' + src + (t.sourceRef ? ' (linked external ref)' : ''),
      'Approx. hours since task created: ' + (age !== null ? String(age) : 'unknown'),
      overdueBatch
        ? 'URGENCY: This follow-up is in the OVERDUE bucket (>48h since created).'
        : 'URGENCY: Follow-up still within the first 48h.',
    ];
    if (dl) {
      lines.push('Deadline field on sheet: ' + dl);
    }
    if (notes) {
      lines.push('Email/notes excerpt:\n' + notes);
    } else {
      lines.push('Email/notes excerpt: (empty — infer only from title.)');
    }
    lines.push('');
    lines.push(
      'Write exactly ONE line (max 20 words): the single next action or decision, using words from the title/excerpt where possible. ' +
      'No bullet, no markdown, no quotes, no "Subject:" prefix, no "Follow up on" unless the title already implies it.'
    );
    return lines.join('\n');
  },

  /**
   * @param {CosTask} t
   * @returns {number|null}
   * @private
   */
  _approxAgeHours_: function (t) {
    var c = CosDigestAiService._parseIso_(t.createdAt);
    if (!c) {
      c = CosDigestAiService._parseIso_(t.updatedAt);
    }
    if (!c) {
      return null;
    }
    return Math.floor((new Date().getTime() - c.getTime()) / 3600000);
  },

  /**
   * @param {string} raw
   * @returns {Date|null}
   * @private
   */
  _parseIso_: function (raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    var d = new Date(String(raw).trim());
    return isNaN(d.getTime()) ? null : d;
  },

  /**
   * @param {string} raw
   * @returns {string}
   * @private
   */
  _sanitizeLine_: function (raw) {
    var s = String(raw || '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length > CosConstants.DIGEST_AI_OUTPUT_MAX_CHARS) {
      s = s.substring(0, CosConstants.DIGEST_AI_OUTPUT_MAX_CHARS - 1) + '…';
    }
    return s;
  },

  /**
   * @param {CosSettings} settings
   * @param {string} userPrompt
   * @returns {string}
   * @private
   */
  _openAiChat_: function (settings, userPrompt) {
    var key = String(settings.digestAiApiKey || '').trim();
    var model =
      String(settings.digestAiModel || '').trim() ||
      CosConstants.DEFAULT_DIGEST_OPENAI_MODEL;
    var body = {
      model: model,
      messages: [
        {
          role: 'system',
          content:
            'You write one-line next actions for a mobile digest. Be factual; never invent people or commitments. ' +
            'Use concrete nouns from the title or excerpt. Ban generic filler (e.g. alignment, synergy, timely communication, touch base, circle back). ' +
            'If the excerpt is empty, infer one specific step only from the subject line.',
        },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 100,
      temperature: 0.25,
    };
    var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error('OpenAI HTTP ' + code + ': ' + text.substring(0, 200));
    }
    var json = JSON.parse(text);
    var choice = json.choices && json.choices[0];
    var msg = choice && choice.message && choice.message.content;
    return String(msg || '').trim();
  },

  /**
   * @param {CosSettings} settings
   * @param {string} userPrompt
   * @returns {string}
   * @private
   */
  _geminiGenerate_: function (settings, userPrompt) {
    var key = String(settings.digestAiApiKey || '').trim();
    var model =
      String(settings.digestAiModel || '').trim() ||
      CosConstants.DEFAULT_DIGEST_GEMINI_MODEL;
    var url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent?key=' +
      encodeURIComponent(key);
    var fullText =
      'You write one-line next actions for a mobile digest. Factual only; no invented names or promises. ' +
      'Use concrete terms from the text; avoid generic corporate phrases (alignment, timely communication, touch base).\n\n---\n\n' +
      userPrompt;
    var body = {
      contents: [{ parts: [{ text: fullText }] }],
      generationConfig: {
        maxOutputTokens: 120,
        temperature: 0.25,
      },
    };
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error('Gemini HTTP ' + code + ': ' + text.substring(0, 200));
    }
    var json = JSON.parse(text);
    var cand = json.candidates && json.candidates[0];
    var parts = cand && cand.content && cand.content.parts;
    var p0 = parts && parts[0];
    return String((p0 && p0.text) || '').trim();
  },
};
