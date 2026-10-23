import { lastIndexLE } from './benchmark';
import { nz, normTicker } from './num';
import type { MarketData, Profile } from './types';

export type HistTrade = [date: string, ticker: string, side: 'B' | 'S', qty: number, price: number];

interface Series { val: number[]; alt: number[]; inv: number[] }

export interface HistoryResult {
  dates: string[];
  trades: HistTrade[];
  skipped: string[];
  /** USD and ILS series: actual value, same amounts in S&P 500, net invested. */
  usd: Series;
  ils: Series;
  grossUsd: number;
  grossIls: number;
  fxAt(date: string): number;
}

/**
 * Value of the user's stock trades over time vs. investing the same amounts in the S&P 500 on the same days.
 * Only trades in tickers that have price history are used; others are reported in `skipped`.
 * Returns null when there is nothing to chart.
 */
export function buildHistory(P: Profile, M: MarketData, fxNow: number): HistoryResult | null {
  const H = M.hist;
  const trades: HistTrade[] = [], skipped: string[] = [];
  for (const t of P.trades) {
    const T = normTicker(t.t), q = nz(t.q), p = nz(t.p);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.d || '') || !T || !(q > 0) || !(p > 0)) continue;
    if (!H || !H.close || !H.close[T]) { if (!skipped.includes(T)) skipped.push(T); continue; }
    trades.push([t.d, T, t.s === 'S' ? 'S' : 'B', q, p]);
  }
  if (!H || !H.dates || !trades.length) return null;
  trades.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const first = trades[0] as HistTrade;
  const idx0 = H.dates.findIndex((d) => d >= first[0]);
  if (idx0 < 0 || H.dates.length - idx0 < 2) return null;
  const dates = H.dates.slice(idx0);
  const spyAt = (d: string) => H.spy[lastIndexLE(H.dates, d)] as number;
  const fxAt = (d: string) => (H.fx ? (H.fx[lastIndexLE(H.dates, d)] as number) : fxNow);
  const tickers = [...new Set(trades.map((t) => t[1]))];
  const usd: Series = { val: [], alt: [], inv: [] }, ils: Series = { val: [], alt: [], inv: [] };
  let grossUsd = 0, grossIls = 0;
  dates.forEach((d, i) => {
    const q: Record<string, number> = {};
    let inv = 0, invN = 0, units = 0, gU = 0, gN = 0;
    for (const t of trades) {
      if (t[0] > d) continue;
      const amt = t[3] * t[4], sg = t[2] === 'B' ? 1 : -1, fx = fxAt(t[0]);
      q[t[1]] = (q[t[1]] || 0) + sg * t[3];
      inv += sg * amt; invN += sg * amt * fx; units += (sg * amt) / spyAt(t[0]);
      if (sg > 0) { gU += amt; gN += amt * fx; }
    }
    let v = 0;
    for (const T of tickers) v += (q[T] || 0) * ((H.close[T] as number[])[idx0 + i] as number);
    const a = units * (H.spy[idx0 + i] as number), fxi = H.fx ? (H.fx[idx0 + i] as number) : fxNow;
    usd.val.push(v); usd.alt.push(a); usd.inv.push(inv);
    ils.val.push(v * fxi); ils.alt.push(a * fxi); ils.inv.push(invN);
    grossUsd = gU; grossIls = gN;
  });
  return { dates, trades, skipped, usd, ils, grossUsd, grossIls, fxAt };
}

/** Step line of net invested capital (cumulative buys minus sells) for the chart. */
export function investedSteps(h: HistoryResult, ils: boolean): Array<[string, number]> {
  const pts: Array<[string, number]> = [];
  const byDate: Record<string, number> = {};
  let inv = 0;
  for (const t of h.trades) byDate[t[0]] = (byDate[t[0]] || 0) + t[3] * t[4] * (t[2] === 'B' ? 1 : -1) * (ils ? h.fxAt(t[0]) : 1);
  const first = h.dates[0] as string;
  for (const d of Object.keys(byDate).sort()) {
    const x = d < first ? first : d;
    pts.push([x, inv]);
    inv += byDate[d] as number;
    pts.push([x, inv]);
  }
  pts.push([h.dates[h.dates.length - 1] as string, inv]);
  return pts;
}
