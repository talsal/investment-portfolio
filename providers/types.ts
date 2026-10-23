import type { FundamentalsInputs, MarketTicker } from '../src/data/schema';

/**
 * Provider adapters. The refresh scripts only depend on these interfaces, so a data vendor can be swapped by
 * writing one adapter and changing an environment variable; the UI never sees a vendor.
 */
export type Redistribution = 'open' | 'unclear' | 'restricted';

export interface ProviderInfo {
  id: string;
  name: string;
  /**
   * Whether publishing this provider's data on a public site is allowed. Anything other than "open" is only used
   * when its id is listed in DATA_LICENSE_ACK (the owner confirms they hold the right to display it).
   */
  redistribution: Redistribution;
  termsUrl: string;
  note: string;
}

export interface Daily { dates: string[]; close: number[] }
export interface Quote { price: number; asof: string }

export interface FxProvider {
  info: ProviderInfo;
  /** USD/ILS daily series (ascending), from `from` (YYYY-MM-DD) when given. */
  fetchUsdIls(from?: string): Promise<Daily>;
}
export interface HistoryProvider {
  info: ProviderInfo;
  fetchDaily(symbol: string, from: string): Promise<Daily>;
}
export interface QuoteProvider {
  info: ProviderInfo;
  fetchQuote(symbol: string): Promise<Quote>;
}
export interface FundamentalsResult { asof: string; inputs: FundamentalsInputs; base?: string[] }
export interface FundamentalsProvider {
  info: ProviderInfo;
  fetchFundamentals(symbol: string): Promise<FundamentalsResult>;
}
export interface CalendarProvider {
  info: ProviderInfo;
  fetchEarnings(symbol: string, from: string, to: string): Promise<NonNullable<MarketTicker['events']>>;
  /** Last regular dividend and payments per year, or null when the symbol pays none. Optional per vendor/plan. */
  fetchDividend?(symbol: string, asof: string): Promise<{ perShare: number; freq: number } | null>;
}
export interface CpiProvider {
  info: ProviderInfo;
  fetchCpi(): Promise<{ yoyPct: number; label: string; asof: string }>;
}

/** Thrown for failures worth reporting but never fatal to the whole run. Messages must not contain secrets. */
export class ProviderError extends Error {
  constructor(message: string, readonly kind: 'http' | 'parse' | 'quota' | 'config' | 'unsupported' = 'http') {
    super(message);
  }
}
