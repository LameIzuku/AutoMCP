// Runs in Chrome's isolated extension world. No cookies, private APIs, or page scripts are used.
(() => {
  let busy = false;
  let submittedHere = null;
  let stableAnswer = null;
  let captureDetail = 'not_started';
  let invalidSince = 0;
  const send = async data => {
    const response = await chrome.runtime.sendMessage(data);
    if (response?.error) throw new Error(response.error);
    return response;
  };
  const text = node => node?.textContent || '';
  const modelLabel = () => document.querySelector('[data-testid="model-selector-dropdown"]')?.getAttribute('aria-label') || '';
  const modelOK = () => /^Model: Sonnet 5 Medium$/.test(modelLabel());
  function parseCandidate(raw) {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const result = JSON.parse(cleaned);
    if (typeof result.answer !== 'string' || typeof result.needs_user !== 'boolean' || !Array.isArray(result.assumptions)
      || !result.assumptions.every(x => typeof x === 'string')) throw new Error('Claude returned an invalid answer format');
    return { answer: result.answer, needs_user: result.needs_user, assumptions: result.assumptions };
  }
  function extractCandidate(raw) {
    // Locate complete JSON objects without treating braces inside quoted strings as delimiters.
    const candidates = [];
    let start = -1, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (start < 0) { if (c === '{') { start = i; depth = 1; quoted = false; escaped = false; } continue; }
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { candidates.push(parseCandidate(raw.slice(start, i + 1))); } catch {}
        start = -1;
      }
    }
    if (candidates.length !== 1) throw new Error('Claude completed but its JSON answer was missing, malformed, or ambiguous');
    return candidates[0];
  }
  async function run() {
    if (busy) return;
    busy = true;
    let job;
    try {
      const response = await send({ type: 'tick' }); job = response?.job;
      if (!job) return;
      if (location.pathname.startsWith('/login')) throw new Error('Sign into Claude in the BhootMCP tab');
      // Let the page finish loading rather than assuming missing controls imply a model mismatch.
      const editor = document.querySelector('[data-testid="chat-input"][contenteditable="true"]');
      if (!editor || !modelLabel()) return;
      if (!modelOK()) throw new Error('Select Sonnet 5 Medium in the dedicated Claude tab, then retry the request');
      if (job.phase === 'prepare') {
        if (location.pathname !== '/new') return;
        if (text(editor).trim()) throw new Error('The dedicated Claude composer contains a draft; clear it before retrying');
        editor.focus();
        // execCommand updates the contenteditable editor and emits its normal editing events.
        document.execCommand('insertText', false, job.prompt);
        if (!text(editor).includes(job.id)) throw new Error('Could not insert question into the Claude editor');
        await new Promise(resolve => setTimeout(resolve, 150));
        const button = document.querySelector('[data-testid="chat-input-send"]');
        if (!button || button.disabled) throw new Error('Claude send button is unavailable');
        // Record before clicking. An interrupted submission is never silently sent twice.
        await send({ type: 'submitted', id: job.id });
        submittedHere = job.id; button.click(); return;
      }
      const articles = [...document.querySelectorAll('[role="article"]')];
      const questionIndex = articles.findIndex(a => text(a).includes(`BhootMCP request ${job.id}`));
      if (questionIndex < 0) {
        if (submittedHere !== job.id) throw new Error('Submission was interrupted or tab changed; inspect the Claude tab before retrying');
        return;
      }
      const statuses = [...document.querySelectorAll('[role="status"]')].map(text);
      if (document.querySelector('button[aria-label="Stop response"]') || !statuses.some(t => t.trim() === 'Claude finished the response')) { stableAnswer = null; return; }
      const answer = articles[questionIndex + 1];
      if (!answer) return;
      if (answer.querySelector('[data-is-streaming="true"]')) { stableAnswer = null; return; }
      // Claude's sr-only heading contains a truncated JSON preview with unmatched braces/quotes.
      // Use the observed reply body, not the article's accessibility announcement.
      const clean = (answer.querySelector('[data-perf-reply-text]') || answer).cloneNode(true);
      clean.querySelectorAll('[role="toolbar"],button,[data-find-omitted],.sr-only,[aria-hidden="true"]').forEach(node => node.remove());
      const raw = text(clean);
      captureDetail = `chars=${raw.length};body=${answer.querySelector('[data-perf-reply-text]') ? 1 : 0};articles=${articles.length}`;
      // Completion announcements can precede the final DOM render. Wait for two matching observations.
      if (!stableAnswer || stableAnswer.id !== job.id || stableAnswer.raw !== raw) { stableAnswer = { id: job.id, raw }; return; }
      let candidate;
      try { candidate = extractCandidate(raw); invalidSince = 0; }
      catch {
        // An earlier completion announcement may coexist with unfinished React rendering.
        if (!invalidSince) invalidSince = Date.now();
        if (Date.now() - invalidSince < 15000) return;
        throw new Error('BHOOT_CAPTURE_v0.2.3:' + captureDetail);
      }
      await send({ type: 'result', id: job.id, candidate });
      stableAnswer = null;
      submittedHere = null;
    } catch (error) {
      if (job) {
        try { await send({ type: 'result', id: job.id, error: String(error.message).slice(0,500) }); } catch {}
      }
      // No repeated posting and no scraping of unrelated chats on failure.
    } finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'wake') void run(); });
  setInterval(run, 2000);
  void run();
})();
