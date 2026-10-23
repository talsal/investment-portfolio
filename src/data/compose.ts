import type { BfInputs, MarketData, MarketMeta, TickerPack } from '../calc/types';
import type { AnalysisFile, CpiFile, FundamentalsFile, HistoryFile, ManualFile, MarketFile } from './schema';

export interface DataBundle {
  market: MarketFile | null;
  cpi: CpiFile | null;
  spy: HistoryFile | null;
  usdIls: HistoryFile | null;
  history: Record<string, HistoryFile>;
  fundamentals: Record<string, FundamentalsFile>;
  analysis: Record<string, AnalysisFile>;
  /** Machine drafts; only populated in reviewer preview mode (?drafts=1). */
  drafts: Record<string, AnalysisFile>;
  manual: Record<string, ManualFile>;
}

export const emptyBundle = (): DataBundle => ({ market: null, cpi: null, spy: null, usdIls: null, history: {}, fundamentals: {}, analysis: {}, drafts: {}, manual: {} });

const dmy = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Aligns a daily series to a master calendar: carries the last known value forward, and fills days before the
 * series starts with its first value (so a stock "worth its first close" before it existed never produces NaN).
 */
export function alignSeries(master: string[], src: { dates: string[]; close: number[] }): number[] {
  const out: number[] = new Array(master.length);
  let j = 0, last = src.close[0] ?? NaN;
  for (let i = 0; i < master.length; i++) {
    const d = master[i] as string;
    while (j < src.dates.length && (src.dates[j] as string) <= d) { last = src.close[j] as number; j++; }
    out[i] = last;
  }
  return out;
}

/** Provider numbers, then owner-supplied manual numbers, then *approved* analysis text. Drafts never reach the UI as facts. */
export function mergeBf(f: FundamentalsFile | undefined, a: AnalysisFile | undefined, manual?: ManualFile, draft?: AnalysisFile): BfInputs | undefined {
  // A draft (preview mode) takes precedence over the approved text so a reviewer sees what would change.
  const ok = draft && draft.status === 'draft' ? draft : a && a.status === 'approved' ? a : undefined;
  if (!f && !ok && !manual?.inputs) return undefined;
  const bf: BfInputs = { ...(f?.inputs ?? {}), ...(manual?.inputs ?? {}) };
  if (ok) {
    if (ok.status === 'draft') bf.draft = true;
    for (const k of ['moat', 'moatTxt', 'growth', 'growthTxt', 'track', 'cyclical', 'next', 'pen', 'peNotes', 'fcfNotes'] as const) {
      if (ok[k] !== undefined) (bf as Record<string, unknown>)[k] = ok[k];
    }
  }
  return bf;
}

/** Builds the app's MarketData from the separate data files. Pure: no I/O, no clock. */
export function composeMarket(b: DataBundle): MarketData {
  const m = b.market;
  const M: MarketData = { tickers: {} };
  if (!m) return M;
  const quotes = m.groups.quotes;
  const asofIso = quotes?.asof ?? Object.values(m.tickers).map((t) => t.asof).sort().pop() ?? null;
  if (asofIso) M.asof = dmy(asofIso);
  if (m.fx && m.fx.usdIls > 0) M.fx = m.fx.usdIls;
  const stalePrices: string[] = [];
  for (const [sym, t] of Object.entries(m.tickers)) {
    const man = b.manual[sym];
    const f = b.fundamentals[sym];
    const pk: TickerPack = { name: t.name, cur: t.currency, price: t.price };
    const events = man?.events ?? t.events;
    const div = man?.div ?? (t.div ? { perShare: t.div.perShare, freq: t.div.freq } : undefined);
    if (events?.length) pk.events = events;
    if (div) pk.div = div;
    if (man?.watchAdded) pk.watchAdded = man.watchAdded;
    const bf = mergeBf(f, b.analysis[sym], man, b.drafts[sym]);
    if (bf) pk.bf = bf;
    if (f?.base) pk.base = f.base;
    if (t.stale) stalePrices.push(sym);
    M.tickers[sym] = pk;
  }

  // Price history aligned on the benchmark's trading calendar.
  const spy = b.spy;
  if (spy && spy.dates.length > 1) {
    const dates = spy.dates;
    const close: Record<string, number[]> = {};
    for (const [sym, h] of Object.entries(b.history)) if (h.dates.length) close[sym] = alignSeries(dates, h);
    M.hist = { dates, spy: spy.close, close, fx: b.usdIls?.dates.length ? alignSeries(dates, b.usdIls) : undefined };
  }
  if (m.benchmark) {
    M.spyNow = m.benchmark.price;
    M.benchmarkDefaultDate = m.benchmark.baseDate ?? (asofIso ? `${asofIso.slice(0, 4)}-01-01` : undefined);
  }
  if (b.cpi && b.cpi.yoyPct !== null && b.cpi.label) M.cpi = { yoyPct: b.cpi.yoyPct, label: b.cpi.label };

  const meta: MarketMeta = {
    groups: m.groups,
    fundamentalsAsof: Object.fromEntries(Object.entries(b.fundamentals).map(([k, v]) => [k, v.asof])),
    analysisAsof: Object.fromEntries(Object.entries(b.analysis).filter(([, v]) => v.status === 'approved').map(([k, v]) => [k, v.reviewedAt ?? v.asof])),
    draftsShown: Object.keys(b.drafts),
    stalePrices,
    cpiAsof: b.cpi?.asof ?? null,
    historyAsof: spy?.asof ?? null,
  };
  M.meta = meta;
  return M;
}
