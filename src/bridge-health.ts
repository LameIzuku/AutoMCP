import { request } from 'node:http';
import type { BridgeConfig } from './bridge.js';

export function checkBridge(config: BridgeConfig): Promise<{ ready: boolean; detail: string }> {
  // Direct loopback HTTP avoids any fetch dispatcher/proxy inherited by the shell.
  return new Promise(resolve => {
    let settled = false;
    const finish = (ready: boolean, detail: string) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ ready, detail }); }
    };
    const req = request({ hostname: '127.0.0.1', port: config.port, path: '/health', method: 'GET',
      headers: { Authorization: `Bearer ${config.clientToken}` }, agent: false }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 4096) { finish(false, 'Unexpected response from local port'); req.destroy(); } });
      res.on('end', () => {
        if (res.statusCode !== 200) return finish(false, `Local bridge returned HTTP ${res.statusCode}`);
        try { finish(JSON.parse(data).ok === true, 'Local bridge responded'); }
        catch { finish(false, 'Local port returned invalid health response'); }
      });
      res.on('error', () => finish(false, 'Local bridge response was interrupted'));
    });
    const timer = setTimeout(() => { finish(false, 'Local bridge health check timed out'); req.destroy(); }, 3000);
    req.on('error', (error: NodeJS.ErrnoException) => finish(false, `Local connection failed (${error.code || 'unknown'})`));
    req.end();
  });
}
