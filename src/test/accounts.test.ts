import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputSchema } from '../schema.js';
import { questionHash, effortFor, loadCapture } from '../accounts.js';

const input = inputSchema.parse({ question: 'Which language?', original_request: 'Extend dashboard' });
test('account effort routing is bounded to low/medium', () => {
  assert.equal(effortFor(input), 'low');
  assert.equal(effortFor({ ...input, question: 'Which authentication architecture?' }), 'medium');
});
test('browser captures must match question, time, and Sonnet model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bhoot-capture-test-'));
  const path = join(directory, 'capture.json');
  const capture = { question_hash: questionHash(input), model_label: 'Sonnet 5 Medium',
    source_url: 'https://claude.ai/chat/test', captured_at: new Date().toISOString(),
    candidate: { answer: 'TypeScript', needs_user: false, assumptions: [] } };
  try {
    await writeFile(path, JSON.stringify(capture));
    assert.equal((await loadCapture(path, input)).answer, 'TypeScript');
    await assert.rejects(loadCapture(path, { ...input, question: 'Different question' }));
    await writeFile(path, JSON.stringify({ ...capture, model_label: 'Opus' }));
    await assert.rejects(loadCapture(path, input));
    await writeFile(path, JSON.stringify({ ...capture, captured_at: '2020-01-01T00:00:00.000Z' }));
    await assert.rejects(loadCapture(path, input));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
