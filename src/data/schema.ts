/**
 * Shapes of the static JSON files under /data. Shared by the browser app (reads them) and the refresh scripts
 * (write them). Every file carries `schema` so a future format can be migrated or refused cleanly.
 *
 *   data/market.json                 prices, FX, benchmark, dividends, earnings dates + per-group freshness
 *   data/history/<SYMBOL>.json       daily closes (default 5 years); `_USDILS` and `SPY` are system series
 *   data/fundamentals/<SYMBOL>.json  numeric inputs for the criteria table (provider-derived)
 *   data/analysis/<SYMBOL>.json      qualitative fields (moat, growth, notes) with status draft|approved
 *   data/manual/<SYMBOL>.json        owner-curated values providers cannot supply (dividends, event dates)
 *   data/cpi.json                    Israeli CPI, year over year
 *   data/universe.json               which tickers the pipeline tracks
 */
export const DATA_SCHEMA = 1;

export type GroupId = 'fx' | 'quotes' | 'benchmark' | 'calendar' | 'cpi';
/** ok: fresh from the provider. stale: some values kept from an earlier run. unavailable: nothing could be fetched. */
export type GroupState = 'ok' | 'stale' | 'unavailable';

export interface GroupStatus {
  state: GroupState;
  /** Date the data refers to (YYYY-MM-DD), or null when nothing is known. */
  asof: string | null;
  /** When the pipeline last succeeded for this group. */
  fetchedAt: string | null;
  /** Provider id, e.g. "boi", "twelvedata". */
  source: string;
  /** Short machine-readable reason for stale/unavailable (never contains secrets). */
  note?: string;
}

export interface MarketTicker {
  price: number;
  /** Date of the price (YYYY-MM-DD). */
  asof: string;
  currency: 'USD';
  /** Display name, if the universe provides one. */
  name?: string;
  /** Last known regular dividend. Source: provider or data/manual. */
  div?: { perShare: number; freq: number; asof?: string; source?: string };
  events?: Array<{ d: string | null; what: string; st?: 'confirmed' | 'est' | 'unk' }>;
  /** Which per-ticker files exist, so the browser never requests (and logs 404s for) files that are not there. */
  has?: Array<'fundamentals' | 'analysis' | 'manual' | 'history'>;
  /** Marks the price as carried over from an earlier run because the latest fetch failed. */
  stale?: boolean;
}

export interface MarketFile {
  schema: number;
  generatedAt: string;
  groups: Partial<Record<GroupId, GroupStatus>>;
  fx?: { usdIls: number; asof: string };
  benchmark?: { symbol: string; price: number; asof: string; baseDate?: string };
  tickers: Record<string, MarketTicker>;
}

export interface HistoryFile {
  schema: number;
  symbol: string;
  source: string;
  asof: string;
  /** Ascending YYYY-MM-DD. */
  dates: string[];
  close: number[];
}

export interface FundamentalsInputs {
  epsT?: number | null;
  epsF?: number | null;
  epsN?: number;
  fcfPs?: number;
  fcfTotal?: string;
  fcfTrend?: number;
  roe?: number;
  bv?: number;
  earnOk?: boolean;
}
export interface FundamentalsFile {
  schema: number;
  symbol: string;
  source: string;
  /** Date of the underlying financial statements / metrics. */
  asof: string;
  fetchedAt: string;
  inputs: FundamentalsInputs;
  /** Five display strings for the "base data" table (revenue, EPS, FCF, ROIC, gross margin). */
  base?: string[];
}

export type AnalysisStatus = 'draft' | 'approved';
export interface AnalysisFile {
  schema: number;
  symbol: string;
  status: AnalysisStatus;
  asof: string;
  moat?: 'ok' | 'weak' | 'bad' | 'none' | 'contested';
  moatTxt?: string;
  growth?: 'up' | 'slow' | 'flat' | 'neg' | 'na';
  growthTxt?: string;
  track?: string;
  cyclical?: boolean;
  next?: string;
  pen?: string;
  peNotes?: string[];
  fcfNotes?: string[];
}

export interface ManualFile {
  schema: number;
  symbol: string;
  asof: string;
  div?: { perShare: number; freq: number };
  events?: Array<{ d: string | null; what: string; st?: 'confirmed' | 'est' | 'unk' }>;
  watchAdded?: { date: string; px: number };
  /** Owner-supplied fundamentals that free providers lack (e.g. forward EPS); overrides provider values. */
  inputs?: FundamentalsInputs;
}

export interface CpiFile {
  schema: number;
  /** 12-month change in percent, or null while unknown. */
  yoyPct: number | null;
  /** Display label, e.g. "ספטמבר 2026". */
  label: string;
  /** Month the figure refers to (YYYY-MM). */
  asof: string | null;
  fetchedAt: string | null;
  source: string;
}

export interface UniverseFile {
  schema: number;
  benchmark: string;
  /** Default benchmark base date; when absent the app uses the first trading day of the year. */
  benchmarkBaseDate?: string;
  tickers: Array<{ symbol: string; name?: string }>;
}
