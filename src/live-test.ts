import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readConfig, configPath } from './bridge.js';
import { checkBridge } from './bridge-health.js';
import { configuredProviders } from './factory.js';
import { Resolver } from './resolver.js';
import { findCodex } from './codex-path.js';
import { safeDiagnostic } from './diagnostics.js';

try {
  console.log('Codex CLI:', await findCodex());
  const config = await readConfig();
  // Short one-way fingerprint identifies mismatched settings without printing either token.
  console.log('Settings:', configPath());
  console.log('Settings fingerprint:', createHash('sha256').update(config.clientToken).digest('hex').slice(0,12));
  const health = await checkBridge(config);
  if (!health.ready) throw new Error(health.detail);
  console.log('Bridge authentication: OK');
  const input = JSON.parse(await readFile(new URL('../examples/question.json', import.meta.url), 'utf8'));
  console.log('Sending sample clarification. Allow up to four minutes for Claude and three more for judging.');
  const providers = configuredProviders();
  const result = await new Resolver({
    mock: providers.mock,
    async candidate(provider, question) {
      const label = provider === 'openai' ? 'Sol / Codex' : 'Sonnet / browser';
      console.log(label + ': starting');
      try { const answer = await providers.candidate(provider, question); console.log(label + ': answer received'); return answer; }
      catch (error) { console.error(label + ': ' + safeDiagnostic(error)); throw error; }
    },
    async judge(question, a, b) {
      console.log('Sol judge: starting');
      try { const result = await providers.judge(question, a, b); console.log('Sol judge: finished'); return result; }
      catch (error) { console.error('Sol judge: ' + safeDiagnostic(error)); throw error; }
    }
  }).resolve(input);
  console.log(JSON.stringify(result, null, 2));
  console.log(result.status === 'resolved' && !result.mock ? 'LIVE TEST PASSED' : 'LIVE TEST DID NOT COMPLETE');
  process.exitCode = result.status === 'resolved' && !result.mock ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live test failed');
  process.exitCode = 1;
}
