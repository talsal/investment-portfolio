import type { MarketData } from '../calc/types';
import { composeMarket, emptyBundle, type DataBundle } from './compose';
import { DATA_SCHEMA } from './schema';
import { isSymbol, parseAnalysisFile, parseCpiFile, parseFundamentalsFile, parseHistoryFile, parseManualFile, parseMarketFile } from './validate';

/** Fetches and parses one JSON file; null when missing, unreachable or not JSON. */
export type Fetcher = (url: string) => Promise<unknown | null>;

export const fetchJson: Fetcher = async (url) => {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

export interface Wanted {
  /** Stocks the user holds: fundamentals, analysis, manual data and price history are loaded. */
  held: string[];
  /** Stocks that were ever traded (their history feeds the progress chart). */
  traded: string[];
  /** Watchlist: fundamentals, analysis and manual data only. */
  watch: string[];
}

/**
 * Loads the static data files on demand. The core files (market, CPI) are fetched once; per-ticker files are
 * fetched only for tickers the user cares about and that exist in market.json. Failures never throw: a missing or
 * malformed file simply leaves that data out, and the freshness panel says so.
 */
export class DataLoader {
  private bundle: DataBundle = emptyBundle();
  private tried = new Set<string>();
  private composed: MarketData | null = null;
  coreLoaded = false;

  /** `includeDrafts` is the reviewer preview (?drafts=1): machine drafts are fetched and shown labelled. */
  constructor(private base = './data/', private get: Fetcher = fetchJson, private includeDrafts = false) {}

  async loadCore(): Promise<boolean> {
    const [market, cpi] = await Promise.all([this.get(`${this.base}market.json`), this.get(`${this.base}cpi.json`)]);
    this.bundle.market = parseMarketFile(market);
    this.bundle.cpi = parseCpiFile(cpi);
    this.coreLoaded = !!this.bundle.market;
    this.composed = null;
    return this.coreLoaded;
  }

  private async one<T>(key: string, path: string, parse: (o: unknown) => T | null, put: (v: T) => void): Promise<boolean> {
    if (this.tried.has(key)) return false;
    this.tried.add(key);
    const v = parse(await this.get(`${this.base}${path}`));
    if (v === null) return false;
    put(v);
    return true;
  }

  /** Loads whatever the given tickers need and is not loaded yet. Returns true when new data arrived. */
  async ensure(w: Wanted): Promise<boolean> {
    const m = this.bundle.market;
    if (!m) return false;
    const known = (s: string) => isSymbol(s) && Object.prototype.hasOwnProperty.call(m.tickers, s);
    const analyse = [...new Set([...w.held, ...w.watch])].filter(known);
    const hist = [...new Set([...w.held, ...w.traded])].filter(known);
    const jobs: Array<Promise<boolean>> = [];
    // market.json says which files exist (`has`); without that hint (older files) every kind is tried.
    const has = (s: string, kind: 'fundamentals' | 'analysis' | 'draft' | 'manual' | 'history') => { const h = m.tickers[s]?.has; return !h || h.includes(kind); };
    for (const s of analyse) {
      if (has(s, 'fundamentals')) jobs.push(this.one(`f:${s}`, `fundamentals/${s}.json`, parseFundamentalsFile, (v) => { this.bundle.fundamentals[s] = v; }));
      if (has(s, 'analysis')) jobs.push(this.one(`a:${s}`, `analysis/${s}.json`, parseAnalysisFile, (v) => { this.bundle.analysis[s] = v; }));
      if (this.includeDrafts && has(s, 'draft')) jobs.push(this.one(`d:${s}`, `analysis/${s}.draft.json`, (o) => parseAnalysisFile(o, 'draft'), (v) => { this.bundle.drafts[s] = v; }));
      if (has(s, 'manual')) jobs.push(this.one(`m:${s}`, `manual/${s}.json`, parseManualFile, (v) => { this.bundle.manual[s] = v; }));
    }
    if (hist.length) {
      const bench = m.benchmark?.symbol ?? 'SPY';
      jobs.push(this.one('h:bench', `history/${bench}.json`, parseHistoryFile, (v) => { this.bundle.spy = v; }));
      jobs.push(this.one('h:fx', 'history/_USDILS.json', parseHistoryFile, (v) => { this.bundle.usdIls = v; }));
      for (const s of hist.filter((x) => has(x, 'history'))) jobs.push(this.one(`h:${s}`, `history/${s}.json`, parseHistoryFile, (v) => { this.bundle.history[s] = v; }));
    }
    const changed = (await Promise.all(jobs)).some(Boolean);
    if (changed) this.composed = null;
    return changed;
  }

  market(): MarketData {
    return (this.composed ??= composeMarket(this.bundle));
  }

  get schema(): number { return DATA_SCHEMA; }
}
