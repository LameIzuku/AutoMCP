import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { configPath, ensureConfig } from './bridge.js';
import { checkBridge } from './bridge-health.js';
import { stopVerifiedBridge } from './repair.js';

try {
  const config = await ensureConfig();
  let health = await checkBridge(config);
  if (!health.ready && health.detail.includes('HTTP 401') && process.argv.includes('--repair')) {
    await stopVerifiedBridge(config.port, fileURLToPath(new URL('./bridge.js', import.meta.url)));
    await delay(500);
    health = await checkBridge(config);
  }
  if (!health.ready && !health.detail.includes('ECONNREFUSED')) {
    throw new Error(health.detail + '. Run Repair-BhootMCP.cmd to restart a verified BhootMCP instance. Settings: ' + configPath());
  }
  if (!health.ready) {
    const log = await open(join(dirname(configPath()), 'bridge-launcher.log'), 'a');
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./bridge.js', import.meta.url))], {
          detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], shell: false,
          env: { ...process.env, BHOOT_BRIDGE_CONFIG: configPath() }
        });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
    } finally { await log.close(); }
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(250); health = await checkBridge(config); if (health.ready) break;
    }
    if (!health.ready) throw new Error(health.detail + '. See bridge-launcher.log in ' + dirname(configPath()));
  }
  console.log('BhootMCP bridge is running.');
  if (!process.argv.includes('--no-clipboard')) {
    if (process.platform !== 'win32') throw new Error('Clipboard setup currently supports Windows only.');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'clip.exe'), [], {
        windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'ignore']
      });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Could not copy pairing code.')));
      child.stdin.on('error', reject);
      child.stdin.end(config.browserToken);
    });
    console.log('Pairing code copied to your clipboard. Paste it into the BhootMCP extension, then click Pair and Start Claude tab.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Launcher failed');
  process.exitCode = 1;
}
