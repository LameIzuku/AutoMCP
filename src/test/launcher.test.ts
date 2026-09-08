import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { bridgeServer } from '../bridge.js';
import { checkBridge } from '../bridge-health.js';

test('launcher recognizes existing bridge and distinguishes wrong credentials from a stopped server', async () => {
  const config = { port: 43187, clientToken: 'c'.repeat(64), browserToken: 'b'.repeat(64) };
  const server = bridgeServer(config); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.port = (server.address() as { port: number }).port;
  try {
    assert.equal((await checkBridge(config)).ready, true);
    const invalid = await checkBridge({ ...config, clientToken: 'wrong' });
    assert.equal(invalid.ready, false); assert.match(invalid.detail, /HTTP 401/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  const stopped = await checkBridge(config);
  assert.equal(stopped.ready, false); assert.match(stopped.detail, /ECONNREFUSED/);
});
