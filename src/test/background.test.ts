import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { bridgeServer } from '../bridge.js';

const source = await readFile(new URL('../../extension/background.js', import.meta.url), 'utf8');
test('extension worker pairs, claims once, persists submission and returns result over HTTP', async () => {
  const configuration = { port: 43187, clientToken: 'c'.repeat(64), browserToken: 'b'.repeat(64) };
  const server = bridgeServer(configuration); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  configuration.port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${configuration.port}`;
  const state: Record<string, any> = {}, session: Record<string, any> = {};
  const storage = (data: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async (keys: string|string[]) => Object.fromEntries((Array.isArray(keys)? keys : [keys]).map(k=>[k,data[k]])),
    set: async (values: any) => Object.assign(data, structuredClone(values)),
    remove: async (key: string) => { delete data[key]; }
  });
  let listener: any; let navigations = 0;
  const chrome = { storage: { local: storage(state), session: storage(session) },
    runtime: { getURL: (p: string) => 'chrome-extension://' + 'a'.repeat(32) + '/' + p,
      onMessage: { addListener: (fn: any) => { listener = fn; } } },
    tabs: { create: async () => ({ id: 42, url: 'https://claude.ai/new' }), get: async () => ({ id: 42, url: 'https://claude.ai/new' }),
      update: async () => { navigations++; }, sendMessage: async () => {} },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } }
  };
  const context = { chrome, AbortSignal, console,
    fetch: (url: string, options: any) => fetch(url.replace('http://127.0.0.1:43187', base), options) };
  vm.runInNewContext(source, { ...context });
  const popup = { url: chrome.runtime.getURL('popup.html') };
  const tab = { tab: { id: 42 }, url: 'https://claude.ai/new' };
  const send = (message: any, sender: any = tab): Promise<any> => new Promise(resolve => listener(message, sender, resolve));
  const request = async (path: string, data?: any) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${configuration.clientToken}` }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return response.json();
  };
  try {
    assert.equal((await send({ type: 'pair', token: configuration.browserToken }, popup)).ok, true);
    assert.equal((await send({ type: 'start' }, popup)).ok, true);
    assert.match((await send({ type: 'tick' }, { ...tab, tab: { id: 999 } })).error, /Not the BhootMCP tab/);
    await send({ type: 'tick' });
    const job = await request('/jobs', { question: 'Which language?', original_request: 'Extend the dashboard' });
    await send({ type: 'tick' }); assert.equal(navigations, 1);
    const claimed = await send({ type: 'tick' }); assert.equal(claimed.job.id, job.id);
    await send({ type: 'submitted', id: job.id });
    // Restart the service worker with the same persisted storage.
    vm.runInNewContext(source, { ...context });
    assert.equal((await send({ type: 'tick' })).job.phase, 'submitted');
    assert.match((await send({ type: 'submitted', id: job.id })).error, /already submitted/);
    const candidate = { answer: 'TypeScript', needs_user: false, assumptions: [] };
    assert.equal((await send({ type: 'result', id: job.id, candidate })).ok, true);
    const result = await request('/jobs/' + job.id);
    assert.equal(result.state, 'done'); assert.deepEqual(result.candidate, candidate);
    assert.equal(session.active, undefined);
    await send({ type: 'stop' }, popup);
    assert.equal((await send({ type: 'tick' })).idle, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
