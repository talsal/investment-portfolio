import type { FundamentalsInputs, MarketTicker } from '../src/data/schema';
import { getJson, type GetOptions } from './http';
import { ProviderError, type CalendarProvider, type FundamentalsProvider, type FundamentalsResult, type ProviderInfo, type Quote, type QuoteProvider } from './types';

export const finnhubInfo: ProviderInfo = {
  id: 'finnhub',
  name: 'Finnhub',
  redistribution: 'restricted',
  termsUrl: 'https://finnhub.io/terms-of-service',
  note: 'Personal plans may not redistribute or share data or derived results; business use needs written approval.',
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** "$6.6B" / "$644M" from a value in millions of dollars. */
export function formatMillions(m: number): string {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  return `${sign}$${a >= 1000 ? `${round(a / 1000, 1)}B` : `${Math.round(a)}M`}`;
}

/** Signed percent for the "base data" table, with a true minus sign (matches the reference). */
export const fmtSignedPct = (v: number): string => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}%`;

/** Average year-over-year growth in percent over up to `periods` changes; input newest first. Null if not computable. */
export function avgYoyGrowthPct(newestFirst: number[], periods = 4): number | null {
  const v = newestFirst.slice(0, periods + 1);
  const g: number[] = [];
  for (let i = 0; i < v.length - 1; i++) {
    const cur = v[i] as number, prev = v[i + 1] as number;
    if (finite(cur) && finite(prev) && prev > 0) g.push((cur / prev - 1) * 100);
  }
  return g.length ? round(g.reduce((a, b) => a + b, 0) / g.length, 1) : null;
}

type Series = Array<{ period?: string; v?: number }>;
const seriesValues = (s: unknown): number[] =>
  (Array.isArray(s) ? (s as Series) : []).filter((p) => finite(p.v) && typeof p.period === 'string').sort((a, b) => (b.period as string).localeCompare(a.period as string)).map((p) => p.v as number);

/**
 * Maps a Finnhub "basic financials" response to the criteria inputs. Everything is optional: a field the plan or
 * the company does not provide stays undefined and the UI shows "no data" (never a made-up value).
 * Forward EPS is not available on free plans, so P/E needs it from data/manual/<SYMBOL>.json.
 * `earnOk` here only means "trailing GAAP EPS is positive"; a human judgement can override it in analysis/manual.
 */
export function mapFinnhubMetric(resp: unknown, today: string): FundamentalsResult {
  const r = resp as { metric?: Record<string, unknown>; series?: { annual?: Record<string, unknown> } };
  const m = r?.metric;
  if (!m || typeof m !== 'object' || !Object.keys(m).length) throw new ProviderError('Finnhub returned no metrics', 'parse');
  const annual = r.series?.annual ?? {};
  const inputs: FundamentalsInputs = {};
  const eps = m.epsTTM;
  inputs.epsT = finite(eps) && eps > 0 ? round(eps, 3) : null;
  inputs.earnOk = inputs.epsT !== null;
  if (finite(m.freeCashFlowPerShareTTM)) inputs.fcfPs = round(m.freeCashFlowPerShareTTM, 3);
  if (finite(m.freeCashFlowTTM)) inputs.fcfTotal = formatMillions(m.freeCashFlowTTM);
  const roe = finite(m.roeTTM) ? m.roeTTM : finite(m.roeRfy) ? m.roeRfy : undefined;
  if (roe !== undefined) inputs.roe = round(roe, 1);
  const bv = finite(m.bookValuePerShareQuarterly) ? m.bookValuePerShareQuarterly : finite(m.bookValuePerShareAnnual) ? m.bookValuePerShareAnnual : undefined;
  if (bv !== undefined) inputs.bv = round(bv, 2);
  const fcfSeries = seriesValues(annual.freeCashFlow ?? annual.fcf);
  const trend = avgYoyGrowthPct(fcfSeries);
  if (trend !== null) inputs.fcfTrend = trend;

  const pct = (v: unknown) => (finite(v) ? fmtSignedPct(v) : '—');
  const base = [pct(m.revenueGrowth3Y), pct(m.epsGrowth3Y), trend !== null ? fmtSignedPct(trend) : '—', '—', finite(m.grossMarginTTM) ? `${m.grossMarginTTM.toFixed(1)}%` : '—'];
  return { asof: today, inputs, base };
}

export interface FinnhubOptions { apiKey: string; now?: () => Date; get?: Partial<GetOptions> }

const BASE = 'https://finnhub.io/api/v1';

/** Quotes, basic financials and earnings calendar. Key via FINNHUB_API_KEY. Field mapping unverified live (no key). */
export function makeFinnhub(o: FinnhubOptions): QuoteProvider & FundamentalsProvider & CalendarProvider {
  const now = o.now ?? (() => new Date());
  const url = (path: string, q: Record<string, string>) => `${BASE}${path}?${new URLSearchParams({ ...q, token: o.apiKey }).toString()}`;
  const get = (u: string) => getJson(u, { secretParams: ['token'], ...o.get });
  return {
    info: finnhubInfo,
    async fetchQuote(symbol): Promise<Quote> {
      const r = (await get(url('/quote', { symbol }))) as { c?: unknown; t?: unknown };
      if (!finite(r?.c) || r.c <= 0 || !finite(r.t) || r.t <= 0) throw new ProviderError('Finnhub returned no quote', 'parse');
      return { price: r.c, asof: new Date(r.t * 1000).toISOString().slice(0, 10) };
    },
    async fetchFundamentals(symbol) {
      return mapFinnhubMetric(await get(url('/stock/metric', { symbol, metric: 'all' })), now().toISOString().slice(0, 10));
    },
    async fetchEarnings(symbol, from, to) {
      const r = (await get(url('/calendar/earnings', { symbol, from, to }))) as { earningsCalendar?: Array<{ date?: string; hour?: string; quarter?: number; year?: number }> };
      const out: NonNullable<MarketTicker['events']> = [];
      for (const e of r?.earningsCalendar ?? []) {
        if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
        const when = e.hour === 'bmo' ? ', לפני פתיחת המסחר' : e.hour === 'amc' ? ', אחרי סגירת המסחר' : '';
        const q = finite(e.quarter) && finite(e.year) ? ` ${e.quarter} ${e.year}` : '';
        out.push({ d: e.date, what: `דוח רבעון${q}${when}`, st: 'est' });
      }
      return out.sort((a, b) => ((a.d as string) < (b.d as string) ? -1 : 1));
    },
    async fetchDividend(symbol, asof) {
      const from = new Date(Date.parse(asof) - 400 * 86400000).toISOString().slice(0, 10);
      const r = (await get(url('/stock/dividend', { symbol, from, to: asof }))) as Array<{ amount?: unknown; date?: string }>;
      if (!Array.isArray(r)) throw new ProviderError('Finnhub dividend response unexpected', 'parse');
      const pays = r.filter((x) => finite(x.amount) && x.amount > 0 && typeof x.date === 'string').sort((a, b) => (a.date as string).localeCompare(b.date as string));
      if (!pays.length) return null;
      const lastYear = pays.filter((x) => Date.parse(x.date as string) > Date.parse(asof) - 366 * 86400000);
      return { perShare: (pays[pays.length - 1] as { amount: number }).amount, freq: Math.min(12, Math.max(1, lastYear.length)) };
    },
  };
}
