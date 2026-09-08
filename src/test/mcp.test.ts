import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real stdio MCP handshake, discovery and tool invocation with offline fixtures', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((x): x is [string,string] => x[1] !== undefined));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../server.js', import.meta.url))], env: { ...env, BHOOT_MOCK: '1' } });
  const client = new Client({ name: 'bhoot-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools[0].name, 'resolve_clarification');
    const result = await client.callTool({ name: 'resolve_clarification', arguments: {
      question: 'Which language?', original_request: 'Extend the existing TypeScript app'
    } });
    const parsed = JSON.parse((result.content as any[])[0].text);
    assert.equal(parsed.status, 'resolved'); assert.equal(parsed.mock, true);
  } finally { await client.close(); }
});
