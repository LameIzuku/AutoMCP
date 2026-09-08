import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { browserReady } from './browser-provider.js';
import { findCodex } from './codex-path.js';
import { safeDiagnostic } from './diagnostics.js';

async function run(command: string, args: string[], cwd: string, capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false, windowsHide: false,
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
    let text = '';
    if (capture) child.stdout!.on('data', chunk => { process.stdout.write(chunk); text += chunk; });
    child.once('error', () => reject(new Error('Could not launch Grok CLI')));
    child.once('close', code => code === 0 ? resolve(text) : reject(new Error(`Grok exited with code ${code}`)));
  });
}
try {
  const project = dirname(dirname(fileURLToPath(import.meta.url)));
  const testMode = process.argv.includes('--test');
  const userDirectory = process.argv.slice(2).find(x => x !== '--test');
  const cwd = userDirectory ? resolve(userDirectory) : process.cwd();
  const grok = process.env.BHOOT_GROK_BIN || join(process.env.USERPROFILE || homedir(), '.grok', 'bin', 'grok.exe');
  await access(grok);
  process.env.BHOOT_MODE = 'accounts';
  delete process.env.BHOOT_CLAUDE_CAPTURE; delete process.env.BHOOT_MOCK;
  process.env.BHOOT_CODEX_BIN = await findCodex();
  console.log('Checking paired Sonnet browser...');
  try { await browserReady(); } catch (error) { throw new Error(safeDiagnostic(error)); }
  // The CLI writes only the named MCP server entry; unrelated Grok settings are preserved.
  await run(grok, ['mcp', 'add', 'bhoot', '-e', 'BHOOT_MODE=accounts', '-e', `BHOOT_CODEX_BIN=${process.env.BHOOT_CODEX_BIN}`,
    '--', process.execPath, join(project, 'dist', 'server.js')], cwd);
  const rules = await readFile(join(project, 'examples', 'grok-mcp-rules.txt'), 'utf8');
  if (testMode) {
    console.log('Grok will call BhootMCP and continue with its answer. Approve the BhootMCP tool if Grok requests it.');
    const output = await run(grok, ['--cwd', cwd, '--rules', rules, '--no-subagents', '--disable-web-search',
      '--max-turns', '8', '--output-format', 'json', '--prompt-file', join(project, 'examples', 'grok-integration-test.txt')], cwd, true);
    // Parse the final response text, not echoed prompts, before checking the continuation marker.
    let result;
    try { result = JSON.parse(output); } catch { throw new Error('Grok did not return the expected JSON result. Inspect output above.'); }
    if (!String(result.text || '').includes('BHOOT_GROK_CONTINUATION_OK')) throw new Error('Grok did not confirm continuation. Inspect its response above.');
    console.log('\nGrok reports that it received the clarification and continued.');
  } else {
    console.log('Starting Grok with BhootMCP clarification rules in ' + cwd);
    await run(grok, ['--cwd', cwd, '--rules', rules], cwd);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Grok integration failed'); process.exitCode = 1;
}
