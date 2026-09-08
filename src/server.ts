import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { inputSchema } from './schema.js';
import { configuredProviders } from './factory.js';
import { Resolver } from './resolver.js';

try {
  const resolver = new Resolver(configuredProviders(), Number(process.env.BHOOT_MIN_CONFIDENCE ?? 0.8));
  const server = new McpServer({ name: 'BhootMCP', version: '0.1.0' });
  server.registerTool('resolve_clarification', {
    description: 'Compare Claude and OpenAI answers for a technical clarification. Uses API credits in API mode, or a matching browser-captured Sonnet answer and signed-in Codex usage in accounts mode. Supply original request and relevant context. Never use this to grant permissions. If status is needs_user/error or mock is true, ask the user instead of continuing automatically.',
    inputSchema: inputSchema.shape
  }, async input => {
    const result = await resolver.resolve(input);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: result.status === 'error' };
  });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : 'BhootMCP startup failed');
  process.exitCode = 1;
}
