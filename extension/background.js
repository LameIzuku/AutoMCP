const base = 'http://127.0.0.1:43187';
let lock = false;
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function config() { return chrome.storage.local.get(['token', 'enabled', 'tabId']); }
async function api(path, data) {
  const c = await config();
  if (!c.token) throw new Error('Paste your pairing code first.');
  const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Bridge returned ${response.status}; restart the bridge or check pairing.`);
  return response.json();
}
async function tick(sender) {
  const c = await config();
  if (!c.enabled || sender.tab?.id !== c.tabId) return { idle: true };
  let { active } = await chrome.storage.session.get('active');
  if (active) {
    if (active.expires < Date.now()) { await chrome.storage.session.remove('active'); return { idle: true }; }
    if (active.delivery) {
      await api('/browser/result', active.delivery);
      await chrome.storage.session.remove('active');
      return { idle: true };
    }
    return { job: active };
  }
  const { job } = await api('/browser/claim', {});
  if (!job) return { idle: true };
  active = { ...job, phase: 'prepare' };
  await chrome.storage.session.set({ active });
  // Only the extension's dedicated tab is navigated, never the user's other chats.
  await chrome.tabs.update(c.tabId, { url: 'https://claude.ai/new' });
  return { idle: true };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    const isPopup = !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
    if (isPopup) {
      if (message.type === 'pair') {
        if (!/^[a-f0-9]{64}$/.test(message.token)) throw new Error('Pairing code should be 64 hexadecimal characters.');
        await chrome.storage.local.set({ token: message.token }); await api('/health');
        return { ok: true };
      }
      if (message.type === 'start') {
        await api('/health');
        const c = await config();
        let tab;
        try { if (c.tabId) tab = await chrome.tabs.get(c.tabId); } catch {}
        if (!tab || !tab.url?.startsWith('https://claude.ai/')) tab = await chrome.tabs.create({ url: 'https://claude.ai/new' });
        await chrome.storage.local.set({ enabled: true, tabId: tab.id });
        await chrome.alarms.create('bhoot-poll', { periodInMinutes: 0.5 });
        return { ok: true };
      }
      if (message.type === 'stop') {
        await chrome.storage.local.set({ enabled: false }); await chrome.alarms.clear('bhoot-poll');
        return { ok: true };
      }
      if (message.type === 'status') {
        const c = await config(); const health = await api('/health');
        return { enabled: !!c.enabled, connected: health.ok, active: !!(await chrome.storage.session.get('active')).active };
      }
      throw new Error('Unknown popup request');
    }
    const c = await config();
    if (sender.tab?.id !== c.tabId || !sender.url?.startsWith('https://claude.ai/')) throw new Error('Not the BhootMCP tab');
    if (message.type === 'tick') {
      if (lock) return { idle: true };
      lock = true; try { return await tick(sender); } finally { lock = false; }
    }
    const { active } = await chrome.storage.session.get('active');
    if (!active || active.id !== message.id) throw new Error('Stale browser job');
    if (message.type === 'submitted') {
      if (!c.enabled) throw new Error('Bridge paused');
      if (active.phase !== 'prepare') throw new Error('Question already submitted');
      active.phase = 'submitted'; await chrome.storage.session.set({ active }); return { ok: true };
    }
    if (message.type === 'result') {
      if (!active.delivery) {
        active.delivery = { id: active.id, lease: active.lease,
          ...(message.error ? { error: String(message.error).slice(0,500) } : { candidate: message.candidate }) };
        await chrome.storage.session.set({ active });
      }
      await api('/browser/result', active.delivery);
      await chrome.storage.session.remove('active'); return { ok: true };
    }
    throw new Error('Unknown content request');
  })().then(reply, error => reply({ error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'bhoot-poll') return;
  const c = await config();
  if (c.enabled && c.tabId) chrome.tabs.sendMessage(c.tabId, { type: 'wake' }).catch(() => {});
});
