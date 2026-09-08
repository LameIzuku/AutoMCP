import test from 'node:test';
import assert from 'node:assert/strict';
import { Resolver } from '../resolver.js';
import { MockProviders, ApiProviders } from '../providers.js';
import { extractQuestion, handleHook } from '../hook.js';
import type { Candidate, Judgment } from '../schema.js';

const input = { question: 'Which language?', original_request: 'Extend the TypeScript app' };
class Fixture extends MockProviders {
  override mock = false;
  calls = 0;
  override async candidate(provider: string): Promise<Candidate> {
    this.calls++;
    return { answer: provider === 'openai' ? 'TypeScript' : 'JavaScript', needs_user: false, assumptions: [] };
  }
  override async judge(_input?: unknown, a?: Candidate): Promise<Judgment> {
    return { winner: a?.answer === 'TypeScript' ? 'A' : 'B', confidence: 0.9, reason: 'Matches project', needs_user: false };
  }
}
test('selects the correct provider despite randomized candidate order; deduplicates concurrent requests', async () => {
  const provider = new Fixture();
  const resolver = new Resolver(provider);
  const [a, b] = await Promise.all([resolver.resolve(input), resolver.resolve(input)]);
  assert.equal(a.answer, 'TypeScript'); assert.equal(a.selected_provider, 'openai');
  assert.deepEqual(a, b); assert.equal(provider.calls, 2);
});
test('explicit user questions make no provider calls', async () => {
  const p = new Fixture();
  assert.equal((await new Resolver(p).resolve({ ...input, requires_user_input: true })).status, 'needs_user');
  assert.equal(p.calls, 0);
});
test('one provider failure never forwards the surviving answer', async () => {
  const p = new Fixture(); p.candidate = async () => { throw new Error('private secret'); };
  const r = await new Resolver(p).resolve(input);
  assert.equal(r.status, 'error'); assert.equal(r.answer, null);
  assert.ok(!JSON.stringify(r).includes('private secret'));
});
test('candidate uncertainty and low judge confidence require the user', async () => {
  const p = new Fixture();
  p.candidate = async () => ({ answer: 'Ask the owner', assumptions: [], needs_user: true });
  assert.equal((await new Resolver(p).resolve(input)).status, 'needs_user');
  const q = new Fixture();
  q.judge = async () => ({ winner: 'A', confidence: 0.4, reason: 'Uncertain', needs_user: false });
  assert.equal((await new Resolver(q).resolve(input)).status, 'needs_user');
});
test('rejects malformed input and judge output', async () => {
  await assert.rejects(new Resolver(new Fixture()).resolve({ question: '' }));
  const p = new Fixture(); p.judge = async () => ({ winner: 'C' } as any);
  assert.equal((await new Resolver(p).resolve(input)).status, 'error');
});
const event = { hookEventName: 'stop', reason: 'end_turn', sessionId: 'test',
  lastAssistantMessage: `<bhoot-question>${JSON.stringify(input)}</bhoot-question>` };
test('hook extracts explicit questions only and ignores continuation/session shutdown', () => {
  assert.ok(extractQuestion(event));
  assert.equal(extractQuestion({ ...event, stopHookActive: true }), null);
  assert.equal(extractQuestion({ ...event, reason: 'shutdown' }), null);
  assert.equal(extractQuestion({ ...event, lastAssistantMessage: 'Done. Any questions?' }), null);
});
test('hook returns a same-session continuation; never forwards mock output', async () => {
  const r: any = await handleHook(event, new Resolver(new Fixture()));
  assert.equal(r.decision, 'block'); assert.match(r.reason, /TypeScript/);
  assert.equal(await handleHook(event, new Resolver(new MockProviders())), null);
});
test('HTTP adapters send expected payloads and parse both provider formats', async () => {
  const saved = { ...process.env }; const originalFetch = globalThis.fetch;
  Object.assign(process.env, { OPENAI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test', OPENAI_MODEL: 'test-openai', ANTHROPIC_MODEL: 'test-claude' });
  const requests: any[] = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body)); requests.push(body);
    const answer = { answer: 'TypeScript', needs_user: false, assumptions: [] };
    return new Response(JSON.stringify(String(url).includes('anthropic') ?
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_answer', input: answer }] } :
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }), { status: 200 });
  };
  try {
    const p = new ApiProviders();
    const full = { ...input, project_context: '', known_preferences: '', session_id: 'test', requires_user_input: false };
    assert.equal((await p.candidate('openai', full)).answer, 'TypeScript');
    assert.equal((await p.candidate('anthropic', full)).answer, 'TypeScript');
    assert.equal(requests[0].store, false); assert.equal(requests[0].text.format.strict, true);
    assert.equal(requests[1].tool_choice.name, 'submit_answer');
  } finally { globalThis.fetch = originalFetch; process.env = saved; }
});
