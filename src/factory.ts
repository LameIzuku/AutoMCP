import { createProviders } from './providers.js';
import { AccountProviders } from './accounts.js';

export function configuredProviders() {
  if (process.env.BHOOT_MOCK === '1') return createProviders();
  if (process.env.BHOOT_MODE === 'accounts') {
    const file = process.env.BHOOT_CLAUDE_CAPTURE;
    return new AccountProviders(file);
  }
  return createProviders();
}
