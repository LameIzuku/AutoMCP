import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { randomUUID } from 'node:crypto';

const code = await readFile(new URL('../../extension/content.js', import.meta.url), 'utf8');
// DOM fixture mirrors the roles/data-testid attributes observed in the live Claude page.
async function fixture(options: { model?: string; draft?: string; malformed?: boolean; plain?: boolean; answerText?: string; delayed?: boolean; ambiguous?: boolean; hiddenPreview?: boolean; replyBody?: boolean } = {}) {
  const dom = new JSDOM(`<div data-testid="chat-input" contenteditable="true">${options.draft || ''}</div><button data-testid="chat-input-send">Send</button><button data-testid="model-selector-dropdown" aria-label="Model: ${options.model || 'Sonnet 5 Medium'}"></button>`, { url: 'https://claude.ai/new', runScripts: 'outside-only' });
  const win = dom.window as any;
  // Advance only the retry clock so malformed-response tests cover the 15-second grace period quickly.
  const realNow = Date.now; let clockSteps = 0;
  win.Date.now = () => realNow() + (clockSteps++ * 1000);
  const id = randomUUID(); let phase = 'prepare'; let completed: any; let submits = 0;
  win.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(message: any) {
    if (message.type === 'tick') return completed ? {} : { job: { id, phase, prompt: 'BhootMCP request ' + id, expires: Date.now()+10000 } };
    if (message.type === 'submitted') { phase = 'submitted'; submits++; return { ok: true }; }
    if (message.type === 'result') { completed = message; return { ok: true }; }
  } } };
  win.document.execCommand = (_command: string, _ui: boolean, value: string) => { win.document.querySelector('[contenteditable]').textContent = value; return true; };
  win.document.querySelector('[data-testid="chat-input-send"]').onclick = () => {
    const article = win.document.createElement('div'); article.setAttribute('role', 'article'); article.textContent = 'BhootMCP request ' + id;
    const answer = win.document.createElement('div'); answer.setAttribute('role', 'article');
    const pre = win.document.createElement(options.plain ? 'p' : 'pre');
    const raw = options.malformed ? 'bad json' : JSON.stringify({ answer: options.answerText || 'TypeScript', needs_user: false, assumptions: [] });
    const render = () => { pre.textContent = (options.plain ? 'Here is the answer:\n' : '') + raw + (options.ambiguous ? '\n' + raw : ''); };
    if (options.delayed) win.setTimeout(render, 25); else render();
    if (options.hiddenPreview) {
      const heading = win.document.createElement('h2'); heading.className = 'sr-only';
      heading.setAttribute('data-find-omitted', '');
      heading.textContent = 'Claude responded: {"answer":"Use TypeScript, consistent with the existing dashboard codebase and its strict tsconfig.';
      answer.append(heading);
    }
    if (options.replyBody) {
      const body = win.document.createElement('div'); body.setAttribute('data-perf-reply-text', ''); body.append(pre); answer.append(body);
    } else answer.append(pre);
    const status = win.document.createElement('div'); status.setAttribute('role', 'status'); status.textContent = 'Claude finished the response';
    win.document.body.append(article, answer, status);
  };
  // Accelerate the content script's polling without changing the implementation.
  const setIntervalOriginal = win.setInterval.bind(win); win.setInterval = (fn: () => void) => setIntervalOriginal(fn, 20);
  win.eval(code);
  for (let i=0; i<100 && !completed; i++) await new Promise(r=>setTimeout(r,10));
  dom.window.close();
  return { completed, submits };
}
test('extension inserts one prompt and captures its JSON answer', async () => {
  const result = await fixture();
  assert.equal(result.submits, 1); assert.equal(result.completed.candidate.answer, 'TypeScript');
});
test('extension refuses Opus and preserves existing composer drafts', async () => {
  const opus = await fixture({ model: 'Opus 4.8' }); assert.equal(opus.submits, 0); assert.match(opus.completed.error, /Sonnet/);
  const draft = await fixture({ draft: 'User unfinished work' }); assert.equal(draft.submits, 0); assert.match(draft.completed.error, /draft/);
});
test('extension fails on malformed JSON instead of forwarding arbitrary output', async () => {
  const result = await fixture({ malformed: true }); assert.equal(result.submits, 1); assert.ok(result.completed.error);
});
test('extension accepts plain-text JSON and braces inside quoted answer strings', async () => {
  const answerText = 'Use TypeScript with { strict: true } and "quoted" strings.';
  const result = await fixture({ plain: true, answerText });
  assert.equal(result.completed.candidate.answer, answerText);
});
test('extension waits for final rendering after a completion announcement', async () => {
  const result = await fixture({ delayed: true });
  assert.equal(result.completed.candidate.answer, 'TypeScript');
});
test('extension rejects multiple candidate objects rather than guessing which one is final', async () => {
  const result = await fixture({ ambiguous: true });
  assert.match(result.completed.error, /BHOOT_CAPTURE_v0\.2\.3/);
});
test('Claude hidden truncated JSON preview does not contaminate the observed reply body', async () => {
  const result = await fixture({ plain: true, hiddenPreview: true, replyBody: true });
  assert.equal(result.completed.candidate.answer, 'TypeScript');
});
test('fallback strips hidden accessibility preview when reply-body wrapper is absent', async () => {
  const result = await fixture({ plain: true, hiddenPreview: true });
  assert.equal(result.completed.candidate.answer, 'TypeScript');
});
