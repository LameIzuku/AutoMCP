import { createHash, randomInt } from 'node:crypto';
import { inputSchema, candidateSchema, judgmentSchema, type Result } from './schema.js';
import type { Providers } from './providers.js';

export class Resolver {
  private cache = new Map<string, Promise<Result>>();
  constructor(private providers: Providers, private threshold = 0.8) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid confidence threshold');
  }
  async resolve(raw: unknown): Promise<Result> {
    const input = inputSchema.parse(raw);
    const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    const work = this.run(input);
    this.cache.set(key, work);
    return work;
  }
  private async run(input: ReturnType<typeof inputSchema.parse>): Promise<Result> {
    const base = { answer: null, confidence: 0, mock: this.providers.mock };
    if (input.requires_user_input) return { ...base, status: 'needs_user', reason: 'This question requires user input.' };
    try {
      const answers = await Promise.allSettled([
        this.providers.candidate('openai', input), this.providers.candidate('anthropic', input)
      ]);
      if (answers.some(x => x.status === 'rejected')) return { ...base, status: 'error',
        reason: 'A candidate provider failed. Check login or API configuration, model access, browser capture, timeout and request limits. No answer was forwarded.' };
      const candidates = answers.map(x => candidateSchema.parse((x as PromiseFulfilledResult<unknown>).value));
      const exposed = { openai: candidates[0], anthropic: candidates[1] };
      if (candidates.some(x => x.needs_user)) return { ...base, status: 'needs_user', candidates: exposed,
        reason: 'At least one candidate identified missing information that needs your input.' };
      const order = randomInt(2) ? [0, 1] : [1, 0];
      const judge = judgmentSchema.parse(await this.providers.judge(input, candidates[order[0]], candidates[order[1]]));
      if (judge.needs_user || judge.winner === 'none' || judge.confidence < this.threshold) {
        return { ...base, status: 'needs_user', candidates: exposed, confidence: judge.confidence, reason: judge.reason };
      }
      const index = order[judge.winner === 'A' ? 0 : 1];
      return { status: 'resolved', answer: candidates[index].answer, confidence: judge.confidence,
        reason: judge.reason, selected_provider: index === 0 ? 'openai' : 'anthropic',
        candidates: exposed, mock: this.providers.mock };
    } catch {
      return { ...base, status: 'error', reason: 'Provider or judge returned an invalid, incomplete, or failed response. No answer was forwarded.' };
    }
  }
}
