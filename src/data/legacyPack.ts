// The bundled example (synthetic) still uses the single-file pack format of the prototype.
import type { MarketData } from '../calc/types';
import { sanitizePack } from './pack';

export const sanitizeMarket = (o: unknown): MarketData => sanitizePack(o) ?? { tickers: {} };

export async function loadExampleBundle(): Promise<{ profile: unknown; market: MarketData }> {
  const [profile, pack] = await Promise.all([import('../example/profile.json'), import('../example/pack.json')]);
  return { profile: profile.default, market: sanitizeMarket(pack.default) };
}
