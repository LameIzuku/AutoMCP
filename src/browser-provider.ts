import { setTimeout as delay } from 'node:timers/promises';
import { readConfig, type BridgeConfig } from './bridge.js';
import { candidateSchema, type Input } from './schema.js';
import { request as httpRequest } from 'node:http';
import { DiagnosticError } from './diagnostics.js';

async function request(config: BridgeConfig, path: string, body?: unknown) {
  // Use the same direct loopback transport as the launcher's successful health check.
  return new Promise<any>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: config.port, path,
      method: body === undefined ? 'GET' : 'POST', agent: false,
      headers: { Authorization: `Bearer ${config.clientToken}`, 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 100000) req.destroy(new Error('Oversized response'));
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new DiagnosticError(`Browser bridge HTTP ${res.statusCode}. Check pairing and the dedicated Claude tab.`));
        }
        try { resolve(JSON.parse(data)); } catch { reject(new DiagnosticError('Browser bridge returned invalid JSON')); }
      });
      res.on('error', () => { clearTimeout(timer); reject(new DiagnosticError('Browser bridge response was interrupted')); });
    });
    const timer = setTimeout(() => req.destroy(new Error('Timeout')), 5000);
    req.on('error', () => { clearTimeout(timer); reject(new DiagnosticError('Cannot reach the local browser bridge; run Start-BhootMCP.cmd')); });
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
export async function browserReady() {
  const config = await readConfig();
  const state = await request(config, '/health');
  if (!state.browserConnected) throw new DiagnosticError('Claude extension is not sending a heartbeat. Click Start Claude tab in the extension and leave that tab open.');
  return config;
}
export async function browserCandidate(input: Input) {
  const config = await browserReady();
  const job = await request(config, '/jobs', input);
  while (Date.now() < job.expires + 5000) {
    await delay(1000);
    const result = await request(config, `/jobs/${job.id}`);
    if (result.state === 'done') return candidateSchema.parse(result.candidate);
    if (result.state === 'error') {
      const message = String(result.error || '');
      if (/^BHOOT_CAPTURE_v0\.2\.3:chars=\d+;body=[01];articles=\d+$/.test(message)) {
        throw new DiagnosticError('Claude capture diagnostic: ' + message);
      }
      if (message.includes('JSON')) {
        throw new DiagnosticError('Claude capture is running extension code older than 0.2.3. Reload BhootMCP at chrome://extensions, confirm version 0.2.3, then refresh its Claude tab.');
      }
      const allowed = [
        ['Sign into Claude', 'Claude needs login in the dedicated tab.'],
        ['Select Sonnet', 'Select Sonnet 5 Medium in the dedicated Claude tab.'],
        ['draft', 'The Claude composer contains a draft; clear it before retrying.'],
        ['insert question', 'Claude editor rejected the question insertion.'],
        ['send button', 'Claude Send button was unavailable.'],
        ['interrupted', 'Submission was interrupted or the dedicated tab changed.'],
        ['JSON', 'Claude finished without the expected JSON answer.'],
        ['timed out', 'Claude timed out. Check login, usage limits, and whether the dedicated tab is open.']
      ];
      throw new DiagnosticError(allowed.find(([fragment]) => message.includes(fragment))?.[1] || 'Claude browser job failed; inspect the dedicated tab.');
    }
  }
  throw new DiagnosticError('Claude browser timed out. Inspect the dedicated tab.');
}
