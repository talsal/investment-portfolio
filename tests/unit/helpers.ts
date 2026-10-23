import type { HoldingRow, MarketData, Profile } from '../../src/calc/types';
import { blankProfile } from '../../src/profile/schema';

export const row = (o: Partial<HoldingRow> = {}): HoldingRow => ({ n: '', t: '', c: 'USD', ty: 'eq', q: '', k: '', p: '', ...o });
export const profile = (o: Partial<Profile> = {}): Profile => ({ ...blankProfile(), ...o });
export const market = (o: Partial<MarketData> = {}): MarketData => ({ tickers: {}, ...o });
