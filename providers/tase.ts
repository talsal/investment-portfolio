import { ProviderError, type HistoryProvider, type ProviderInfo } from './types';

export const taseInfo: ProviderInfo = {
  id: 'tase',
  name: 'TASE Data Hub',
  redistribution: 'restricted',
  termsUrl: 'https://datahub.tase.co.il/',
  note: 'Optional. Needs a TASE Data Hub API key and a plan that permits display. Not implemented yet: see docs/data-pipeline.md.',
};

/**
 * Placeholder for Israeli securities (ETFs, funds, TASE-listed stocks). Israeli rows work today with manual prices.
 * The Data Hub endpoint paths and plan/licence terms could not be verified (no public documentation reachable,
 * no API key), so this adapter deliberately fails loudly instead of guessing. To implement it: fill `fetchDaily`
 * with the end-of-day endpoint, return prices in ILS (agorot divided by 100), and register it in registry.ts.
 */
export function makeTase(apiKey: string | undefined): HistoryProvider {
  return {
    info: taseInfo,
    async fetchDaily() {
      void apiKey;
      throw new ProviderError('TASE adapter is not implemented', 'unsupported');
    },
  };
}
