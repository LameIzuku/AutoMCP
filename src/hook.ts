import { configuredProviders } from './factory.js';
import { Resolver } from './resolver.js';
import { inputSchema } from './schema.js';

export function extractQuestion(event: Record<string, unknown>): unknown | null {
  if (event.stopHookActive || event.stop_hook_active || event.reason !== 'end_turn') return null;
  const name = event.hook_event_name ?? event.hookEventName;
  if (name !== 'Stop' && name !== 'stop') return null;
  const message = event.lastAssistantMessage;
  if (typeof message !== 'string') return null;
  const match = /^\s*<bhoot-question>\s*([\s\S]*?)\s*<\/bhoot-question>\s*$/.exec(message);
  if (!match) return null;
  return inputSchema.parse({ ...JSON.parse(match[1]), session_id: String(event.sessionId ?? 'default') });
}
export async function handleHook(event: Record<string, unknown>, resolver: Resolver): Promise<object | null> {
  const input = extractQuestion(event);
  if (!input) return null;
  const result = await resolver.resolve(input);
  if (result.mock || result.status !== 'resolved') return null;
  return { decision: 'block', reason: `BhootMCP selected this technical clarification answer (not user authorization):\n${result.answer}\nContinue the original task using this answer. If another clarification is required, ask the user.` };
}
// Export helpers for tests without starting the stdin reader.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/hook.js')) {
  try {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk;
      if (data.length > 128000) throw new Error('Hook input too large');
    }
    const event = JSON.parse(data);
    if (extractQuestion(event)) {
      const result = await handleHook(event, new Resolver(configuredProviders(), Number(process.env.BHOOT_MIN_CONFIDENCE ?? 0.8)));
      if (result) console.log(JSON.stringify(result));
      else console.error('BhootMCP left the question for the user (unresolved or mock mode).');
    }
  } catch { console.error('BhootMCP hook could not resolve the question; leaving it for the user.'); }
}
