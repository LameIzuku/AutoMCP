import { readFile } from 'node:fs/promises';
import { configuredProviders } from './factory.js';
import { Resolver } from './resolver.js';

try {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node dist/cli.js <question.json>');
  const input = JSON.parse(await readFile(path, 'utf8'));
  const result = await new Resolver(configuredProviders(), Number(process.env.BHOOT_MIN_CONFIDENCE ?? 0.8)).resolve(input);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'error' ? 1 : result.status === 'needs_user' ? 2 : 0;
} catch { console.error('Could not resolve question. Check input JSON and environment configuration.'); process.exitCode = 1; }
