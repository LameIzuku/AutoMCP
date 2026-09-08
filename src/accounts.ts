import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { inputSchema, candidateSchema, candidateJsonSchema, judgmentSchema, judgmentJsonSchema, type Input, type Candidate } from './schema.js';
import { candidateInstruction, judgeInstruction, integerSetting, type Providers } from './providers.js';
import { browserCandidate, browserReady } from './browser-provider.js';
import { findCodex } from './codex-path.js';
import { DiagnosticError } from './diagnostics.js';

export function questionHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(inputSchema.parse(input))).digest('hex');
}
export function effortFor(input: Input): 'low' | 'medium' {
  // Transparent initial heuristic, not a measurement of account quota.
  return /security|architecture|migration|concurren|distributed|authentication/i.test(input.question)
    || input.project_context.length > 4000 ? 'medium' : 'low';
}
const capturedSchema = z.object({
  question_hash: z.string().regex(/^[a-f0-9]{64}$/),
  model_label: z.string().regex(/^Sonnet\b/i),
  source_url: z.string().url().refine(s => new URL(s).hostname === 'claude.ai'),
  captured_at: z.string().datetime(),
  candidate: candidateSchema
}).strict();

export async function loadCapture(path: string, input: Input): Promise<Candidate> {
  const saved = capturedSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  if (saved.question_hash !== questionHash(input)) throw new Error('Claude answer belongs to a different question or context');
  const age = Date.now() - Date.parse(saved.captured_at);
  if (age < -60000 || age > 24 * 60 * 60 * 1000) throw new Error('Claude answer has expired');
  return saved.candidate;
}

export async function codexJson(prompt: string, schema: object, effort: 'low' | 'medium'): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'bhoot-codex-'));
  const output = join(directory, 'answer.json');
  const schemaFile = join(directory, 'schema.json');
  try {
    await writeFile(schemaFile, JSON.stringify(schema));
    const executable = await findCodex();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--color', 'never', '--json', '-C', directory,
        '-m', 'gpt-5.6-sol', '-c', `model_reasoning_effort="${effort}"`,
        '--output-schema', schemaFile, '--output-last-message', output, '-'],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill(); reject(new DiagnosticError('Codex timed out after 180 seconds')); }, 180000);
      // Drain streams; never forward noisy logs or account information into MCP stdout.
      let diagnostic = 'Codex failed; check account login and model access.';
      const classify = (chunk: Buffer) => {
        const text = chunk.toString();
        if (/not logged in|authentication|unauthorized|401|login required/i.test(text)) diagnostic = 'Codex needs a valid ChatGPT login in this terminal.';
        else if (/usage limit|rate limit|quota|429/i.test(text)) diagnostic = 'Codex account usage limit was reached.';
        else if (/model.*not (found|supported|available)|does not.*access.*model/i.test(text)) diagnostic = 'This Codex login does not have access to gpt-5.6-sol.';
        else if (/sandbox.*(failed|error)|Windows sandbox.*setup/i.test(text)) diagnostic = 'Codex Windows sandbox setup failed.';
      };
      child.stdout.on('data', classify); child.stderr.on('data', classify);
      child.once('error', () => { clearTimeout(timer); reject(new DiagnosticError('Codex could not start; check BHOOT_CODEX_BIN')); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new DiagnosticError(diagnostic + ` Exit code: ${code}.`)); });
      child.stdin.on('error', () => {});
      child.stdin.end('Answer only from the supplied context. Do not use tools, inspect files, or execute commands.\n' + prompt);
    });
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    // Delete only this freshly created, uniquely named temporary directory.
    await rm(directory, { recursive: true, force: true });
  }
}

export class AccountProviders implements Providers {
  mock = false;
  private remaining = integerSetting('BHOOT_MAX_REQUESTS', 30, 3, 10000);
  constructor(private captureFile?: string) {}
  private async ask(prompt: string, schema: object, effort: 'low' | 'medium') {
    if (this.remaining <= 0) throw new Error('Process Codex request limit reached');
    this.remaining--;
    return codexJson(prompt, schema, effort);
  }
  async candidate(provider: 'openai' | 'anthropic', input: Input): Promise<Candidate> {
    // Validate the browser capture before either branch consumes Codex usage.
    if (this.captureFile) {
      const captured = await loadCapture(this.captureFile, input);
      if (provider === 'anthropic') return captured;
    } else {
      await browserReady();
      if (provider === 'anthropic') return browserCandidate(input);
    }
    return candidateSchema.parse(await this.ask(candidateInstruction + '\n' + JSON.stringify(input), candidateJsonSchema, effortFor(input)));
  }
  async judge(input: Input, A: Candidate, B: Candidate) {
    return judgmentSchema.parse(await this.ask(judgeInstruction + '\n' + JSON.stringify({ context: input, A, B }), judgmentJsonSchema, 'medium'));
  }
}
