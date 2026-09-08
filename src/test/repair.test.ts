import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesBridgeProcess } from '../repair.js';
import { stopVerifiedBridge } from '../repair.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkBridge } from '../bridge-health.js';
import { setTimeout as delay } from 'node:timers/promises';

test('repair only accepts exact Node executable and bridge script, never unrelated processes', () => {
  const exe = 'C:\\Program Files\\nodejs\\node.exe';
  const script = 'C:\\test\\BhootMCP\\dist\\bridge.js';
  const info = { ProcessId: 1234, ExecutablePath: exe, CommandLine: `"${exe}" "${script}"` };
  assert.equal(matchesBridgeProcess(info, exe, script), true);
  assert.equal(matchesBridgeProcess({ ...info, CommandLine: `"${exe}" C:\\unrelated\\bridge.js` }, exe, script), false);
  assert.equal(matchesBridgeProcess({ ...info, ExecutablePath: 'C:\\other\\node.exe' }, exe, script), false);
  assert.equal(matchesBridgeProcess({ ...info, CommandLine: `"${exe}" "${script}" --other` }, exe, script), false);
  assert.equal(matchesBridgeProcess({ ...info, ProcessId: 0 }, exe, script), false);
});

test('repair recovers an actual HTTP 401 caused by stale in-memory credentials', { skip: process.platform !== 'win32' }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'bhoot-repair-test-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const script = fileURLToPath(new URL('../bridge.js', import.meta.url));
  const configFile = join(temp, 'bridge.json');
  const initial = { port, clientToken: 'a'.repeat(64), browserToken: 'b'.repeat(64) };
  const updated = { port, clientToken: 'c'.repeat(64), browserToken: 'd'.repeat(64) };
  await writeFile(configFile, JSON.stringify(initial));
  const env = { ...process.env, BHOOT_BRIDGE_CONFIG: configFile };
  const child = spawn(process.execPath, [script], { env, windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  try {
    for (let i=0; i<30 && !(await checkBridge(initial)).ready; i++) await delay(100);
    assert.equal((await checkBridge(initial)).ready, true);
    await writeFile(configFile, JSON.stringify(updated));
    assert.match((await checkBridge(updated)).detail, /HTTP 401/);
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../launcher.js', import.meta.url)), '--repair', '--no-clipboard'], { env, windowsHide: true, timeout: 30000 });
    assert.match(result.stdout, /Stopped the BhootMCP bridge/);
    assert.equal((await checkBridge(updated)).ready, true);
  } finally {
    await stopVerifiedBridge(port, script);
    await delay(200);
    await rm(temp, { recursive: true, force: true });
  }
});
