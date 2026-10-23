import type { MarketData } from '../../src/calc/types';

type Any = Record<string, any>;

const toIso = (dmy: string): string => `${dmy.slice(6, 10)}-${dmy.slice(3, 5)}-${dmy.slice(0, 2)}`;

/**
 * Splits a single-file market pack (the prototype's format, used by the synthetic fixtures) into the file layout
 * under /data. Lets tests exercise the real loader while still comparing against the reference engine.
 * Returns a map of path (relative to data/) -> JSON value.
 */
export function packToFiles(pack: Any): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const generatedAt = '2026-10-22T22:30:00.000Z';
  const asof = pack.asof ? toIso(pack.asof) : null;
  const tickers: Record<string, Any> = {};
  const hist: Any | undefined = pack.hist;

  for (const [sym, t] of Object.entries<Any>(pack.tickers ?? {})) {
    const has: string[] = [];
    tickers[sym] = { price: t.price, asof: asof ?? '2026-10-22', currency: 'USD', ...(t.name ? { name: t.name } : {}), ...(t.div ? { div: t.div } : {}), ...(t.events ? { events: t.events } : {}), has };
    const bf: Any | undefined = t.bf;
    if (bf) {
      const inputs: Any = {};
      for (const k of ['epsT', 'epsF', 'epsN', 'fcfPs', 'fcfTotal', 'fcfTrend', 'roe', 'bv', 'earnOk']) if (bf[k] !== undefined) inputs[k] = bf[k];
      has.push('fundamentals', 'analysis');
      files[`fundamentals/${sym}.json`] = { schema: 1, symbol: sym, source: 'test', asof: asof ?? '2026-10-22', fetchedAt: generatedAt, inputs, ...(t.base ? { base: t.base } : {}) };
      const a: Any = { schema: 1, symbol: sym, status: 'approved', asof: asof ?? '2026-10-22' };
      for (const k of ['moat', 'moatTxt', 'growth', 'growthTxt', 'track', 'cyclical', 'next', 'pen', 'peNotes', 'fcfNotes']) if (bf[k] !== undefined) a[k] = bf[k];
      files[`analysis/${sym}.json`] = a;
    }
    if (t.watchAdded) has.push('manual');
    if (hist?.close?.[sym]) has.push('history');
    if (t.watchAdded) files[`manual/${sym}.json`] = { schema: 1, symbol: sym, asof: asof ?? '2026-10-22', watchAdded: t.watchAdded };
    if (hist?.close?.[sym]) files[`history/${sym}.json`] = { schema: 1, symbol: sym, source: 'test', asof: hist.dates.at(-1), dates: hist.dates, close: hist.close[sym] };
  }

  const groups: Any = {};
  if (asof) groups.quotes = { state: 'ok', asof, fetchedAt: generatedAt, source: 'twelvedata' };
  if (pack.fx) groups.fx = { state: 'ok', asof: asof ?? '2026-10-22', fetchedAt: generatedAt, source: 'boi' };
  const market: Any = { schema: 1, generatedAt, groups, tickers };
  if (pack.fx) market.fx = { usdIls: pack.fx, asof: asof ?? '2026-10-22' };
  if (hist) {
    market.benchmark = { symbol: 'SPY', price: hist.spy.at(-1), asof: hist.dates.at(-1), ...(pack.bm?.date ? { baseDate: pack.bm.date } : {}) };
    groups.benchmark = { state: 'ok', asof: hist.dates.at(-1), fetchedAt: generatedAt, source: 'twelvedata' };
    files['history/SPY.json'] = { schema: 1, symbol: 'SPY', source: 'test', asof: hist.dates.at(-1), dates: hist.dates, close: hist.spy };
    if (hist.fx) files['history/_USDILS.json'] = { schema: 1, symbol: '_USDILS', source: 'test', asof: hist.dates.at(-1), dates: hist.dates, close: hist.fx };
  }
  files['market.json'] = market;
  files['cpi.json'] = pack.cpi
    ? { schema: 1, yoyPct: pack.cpi.yoyPct, label: pack.cpi.label, asof: '2026-09', fetchedAt: generatedAt, source: 'cbs' }
    : { schema: 1, yoyPct: null, label: '', asof: null, fetchedAt: null, source: 'cbs' };
  return files;
}

export type { MarketData };
