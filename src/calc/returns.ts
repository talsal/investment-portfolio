import { RULES } from '../config/rules';
import { nz, rate } from './num';
import type { Computed } from './portfolio';
import type { Profile } from './types';

const DAY_MS = 86400000;

export interface TradingReturn {
  inv: number; cur: number;
  /** Cumulative return, percent. */
  cum: number;
  /** Annualised percent, or null when holding period is unknown or shorter than the minimum. */
  ann: number | null;
  /** Purchase-amount-weighted average holding period in days (0 when there are no dated purchases). */
  avgDays: number;
}

/**
 * Return of the trading portfolio over the holdings that have a cost.
 * Annualisation is linear (cum * 365 / avgDays), weighted by purchase amount from the user's dated buys,
 * and shown only when the average holding period reaches the minimum. `now` is injected for testability.
 */
export function tradingReturn(C: Computed, P: Profile, now: number): TradingReturn | null {
  const { inv, cur } = C.pl.tr;
  if (!(inv > 0)) return null;
  const cum = ((cur - inv) / inv) * 100;
  let w = 0, ws = 0;
  for (const t of P.trades) {
    if (t.s !== 'B') continue;
    const a = nz(t.q) * nz(t.p), dt = Date.parse(t.d);
    if (a > 0 && dt > 0) { w += a; ws += a * Math.max(0, (now - dt) / DAY_MS); }
  }
  const avgDays = w > 0 ? ws / w : 0;
  const ann = avgDays >= RULES.annualization.minHoldingDays ? (cum * RULES.annualization.daysPerYear) / avgDays : null;
  return { inv, cur, cum, ann, avgDays };
}

export interface PlPart { key: 'tr' | 'gemel' | 'hish'; inv: number; cur: number }

/** Total profit table: parts that have a cost basis / deposits. */
export function totalProfit(C: Computed) {
  const parts: PlPart[] = (['tr', 'gemel', 'hish'] as const)
    .map((key) => ({ key, inv: C.pl[key].inv, cur: C.pl[key].cur }))
    .filter((x) => x.inv > 0);
  if (!parts.length) return null;
  let inv = 0, cur = 0;
  for (const x of parts) { inv += x.inv; cur += x.cur; }
  const profit = cur - inv;
  return { parts, inv, cur, profit, retPct: (profit / inv) * 100 };
}

export interface AnnualRow { kind: 'trade' | 'gemel' | 'hish'; name: string; bal: number; ratePct: number }

/** Estimated annual profit from the user's own rate assumptions. */
export function annualEstimate(C: Computed, P: Profile) {
  const rows: AnnualRow[] = [];
  const tr = rate(P.tradeRate);
  if (tr !== null && C.tradeTotal > 0) rows.push({ kind: 'trade', name: '', bal: C.tradeTotal, ratePct: tr });
  for (const g of ['gemel', 'hish'] as const) {
    for (const r of P[g]) {
      const b = nz(r.b), rr = rate(r.r);
      if (b > 0 && rr !== null) rows.push({ kind: g, name: r.n, bal: b, ratePct: rr });
    }
  }
  if (!rows.length) return null;
  let bal = 0, profit = 0;
  for (const x of rows) { bal += x.bal; profit += (x.bal * x.ratePct) / 100; }
  return { rows, bal, profit, monthly: profit / 12, weightedPct: (profit / bal) * 100 };
}

/** Real return = (1 + nominal) / (1 + inflation) - 1, in percent. */
export function realReturnPct(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
