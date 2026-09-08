import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { BrowserQueue, bridgeServer } from '../bridge.js';
const input = { question: 'Which language?', original_request: 'Extend TypeScript dashboard' };
const candidate = { answer: 'TypeScript', needs_user: false, assumptions: [] };

test('queue leases are unique, serial, and reject stale or wrong answers', () => {
  const q = new BrowserQueue();
  const first = q.add(input), second = q.add(input);
  const claim = q.claim()!;
  assert.equal(first.id, claim.id); assert.equal(q.claim(), null);
  assert.throws(() => q.finish({ id: first.id, lease: 'wrong', candidate }));
  q.finish({ id: first.id, lease: claim.lease, candidate });
  q.finish({ id: first.id, lease: claim.lease, candidate });
  assert.deepEqual(q.result(first.id)?.candidate, candidate);
  assert.equal(q.claim()?.id, second.id);
});
test('expired jobs fail without requeueing or accepting late output', () => {
  const q = new BrowserQueue(-1); const job = q.add(input);
  assert.equal(q.claim(), null); assert.equal(q.result(job.id)?.state, 'error');
});
test('HTTP bridge enforces auth, role separation, origin, and full question delivery', async () => {
  const config = { port: 43187, clientToken: 'c'.repeat(64), browserToken: 'b'.repeat(64) };
  const server = bridgeServer(config); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number }; config.port = address.port;
  const url = `http://127.0.0.1:${config.port}`;
  const request = (path: string, token: string, data?: unknown, origin?: string) => fetch(url + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  try {
    assert.equal((await request('/health', '')).status, 401);
    assert.equal((await request('/health', config.clientToken, undefined, 'https://evil.example')).status, 403);
    assert.equal((await request('/jobs', config.browserToken, input)).status, 404);
    assert.equal((await request('/jobs', config.clientToken, input)).status, 409);
    await request('/browser/claim', config.browserToken, {});
    const job = await (await request('/jobs', config.clientToken, input)).json();
    const { job: claim } = await (await request('/browser/claim', config.browserToken, {})).json();
    assert.equal(claim.id, job.id); assert.match(claim.prompt, /Which language/);
    assert.equal((await request('/browser/result', config.clientToken, { id: job.id })).status, 404);
    assert.equal((await request('/browser/result', config.browserToken, { id: job.id, lease: claim.lease, candidate })).status, 200);
    const result = await (await request('/jobs/' + job.id, config.clientToken)).json();
    assert.equal(result.state, 'done'); assert.deepEqual(result.candidate, candidate);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
