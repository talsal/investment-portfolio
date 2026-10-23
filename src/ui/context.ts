import type { Computed } from '../calc/portfolio';
import type { MarketData, Profile } from '../calc/types';

export interface Ctx {
  P: Profile;
  M: MarketData;
  C: Computed;
  now: Date;
}
