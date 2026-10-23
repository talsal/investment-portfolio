// The bundled example (synthetic) still uses the single-file pack format of the prototype.
import type { MarketData, TickerPack } from '../calc/types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerces untrusted JSON into MarketData. Drops anything of the wrong shape; never throws. */
export function sanitizeMarket(o: unknown): MarketData {
  const M: MarketData = { tickers: {} };
  if (!isObj(o)) return M;
  if (typeof o.asof === 'string') M.asof = o.asof;
  if (typeof o.fx === 'number' && isFinite(o.fx) && o.fx > 0) M.fx = o.fx;
  if (isObj(o.bm) && typeof o.bm.date === 'string' && typeof o.bm.spyBase === 'number' && typeof o.bm.spyCur === 'number') {
    M.bm = { date: o.bm.date, dateLabel: typeof o.bm.dateLabel === 'string' ? o.bm.dateLabel : undefined, spyBase: o.bm.spyBase, spyCur: o.bm.spyCur };
  }
  if (isObj(o.hist) && Array.isArray(o.hist.dates) && Array.isArray(o.hist.spy) && isObj(o.hist.close)) {
    M.hist = { dates: o.hist.dates as string[], spy: o.hist.spy as number[], close: o.hist.close as Record<string, number[]>, fx: Array.isArray(o.hist.fx) ? (o.hist.fx as number[]) : undefined };
  }
  if (isObj(o.tickers)) {
    for (const [k, v] of Object.entries(o.tickers)) {
      if (isObj(v) && typeof v.price === 'number' && isFinite(v.price)) M.tickers[k.toUpperCase()] = v as unknown as TickerPack;
    }
  }
  if (isObj(o.cpi) && typeof o.cpi.yoyPct === 'number' && typeof o.cpi.label === 'string') M.cpi = { yoyPct: o.cpi.yoyPct, label: o.cpi.label };
  if (o.demo === true) M.demo = true;
  return M;
}

export async function loadExampleBundle(): Promise<{ profile: unknown; market: MarketData }> {
  const [profile, pack] = await Promise.all([import('../example/profile.json'), import('../example/pack.json')]);
  return { profile: profile.default, market: sanitizeMarket(pack.default) };
}
