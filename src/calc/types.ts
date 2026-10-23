export type Currency = 'USD' | 'ILS' | 'AGO';
export type AssetType = 'eq' | 'bond' | 'other';
export type MoatState = 'ok' | 'weak' | 'bad' | 'none' | 'contested';
export type GrowthState = 'up' | 'slow' | 'flat' | 'neg' | 'na';
export type EventStatus = 'confirmed' | 'est' | 'unk';

/** Numeric fields are kept as the strings the user typed; calc parses them. */
export interface HoldingRow { n: string; t: string; c: Currency; ty: AssetType; q: string; k: string; p: string }
export interface FundRow { n: string; b: string; d: string; e: string; r: string }
export interface TradeRow { d: string; t: string; s: 'B' | 'S'; q: string; p: string }

export const CF_CATS = ['rent', 'food', 'out', 'car', 'bills', 'kids', 'health', 'other'] as const;
export type CfCat = (typeof CF_CATS)[number];
export type CashFlowInput = { income: string; extra: string; target: string } & Record<CfCat, string>;

export interface Settings {
  /** ISO date (YYYY-MM-DD) for the S&P comparison base; empty = use the market pack's default. */
  benchmarkDate: string;
  /** True while the synthetic example is loaded: the app then uses the bundled fake market data. */
  example: boolean;
}

export interface Profile {
  fx: string; cashUsd: string; cashNis: string; mmf: string; tradeRate: string; eqTarget: string;
  rows: HoldingRow[]; gemel: FundRow[]; hish: FundRow[]; trades: TradeRow[];
  cf: CashFlowInput; settings: Settings;
  /** Tickers the user follows without holding them. */
  watchlist: string[];
  /** Inputs for the sustainable-withdrawal estimate (strings as typed). */
  withdrawal: { years: string; realRate: string };
  updatedAt: number;
}

export interface BfInputs {
  epsT?: number | null; epsF?: number | null; epsN?: number; fcfPs?: number; fcfTotal?: string; fcfTrend?: number;
  roe?: number; bv?: number; earnOk?: boolean; pen?: string; peNotes?: string[]; fcfNotes?: string[];
  moat?: MoatState; moatTxt?: string; growth?: GrowthState; growthTxt?: string; track?: string;
  cyclical?: boolean; next?: string;
}
export interface MarketEvent { d: string | null; what: string; st?: EventStatus }
export interface TickerPack {
  name?: string; cur?: string; price: number; bf?: BfInputs; base?: string[]; baseClose?: number;
  events?: MarketEvent[]; div?: { perShare: number; freq?: number }; watch?: boolean;
  watchAdded?: { date: string; px: number };
}
export interface Benchmark { date: string; dateLabel?: string; spyBase: number; spyCur: number }
export interface History { dates: string[]; fx?: number[]; spy: number[]; close: Record<string, number[]> }
export interface MarketData {
  asof?: string; fx?: number; bm?: Benchmark; hist?: History; tickers: Record<string, TickerPack>;
  /** Israeli CPI, year over year. Optional. */
  cpi?: { yoyPct: number; label: string };
  /** Marks synthetic data that must never be presented as real. */
  demo?: boolean;
}
